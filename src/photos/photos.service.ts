import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import * as crypto from 'crypto';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { PrismaService } from '../prisma.service';
import { S3_CLIENT, publicObjectUrl } from '../common/s3.provider';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);
  private _batches = new Map<
    string,
    {
      status: string;
      completed: number;
      failed: number;
      total: number;
      message: string;
    }
  >();

  constructor(
    private prisma: PrismaService,
    @Inject(S3_CLIENT) private s3: S3Client,
    private firebase: FirebaseService,
  ) {}

  getBatchStatus(batchId: string) {
    return (
      this._batches.get(batchId) || {
        status: 'not_found',
        completed: 0,
        failed: 0,
        total: 0,
        message: '',
      }
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async startBatchUpload(
    userId: string,
    files: Express.Multer.File[],
  ): Promise<string> {
    const bucket = this.getBucket();
    const region = process.env.AWS_REGION || 'us-east-1';
    const batchId = crypto.randomUUID();

    this._batches.set(batchId, {
      status: 'pending',
      completed: 0,
      failed: 0,
      total: files.length,
      message: 'Iniciando subida…',
    });

    const workerFiles = files.map((f) => ({
      path: f.path,
      filename: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    }));

    const r2AccountId = process.env.R2_ACCOUNT_ID;
    const workerPath = path.join(__dirname, 'upload.worker.js');
    const worker = new Worker(workerPath, {
      workerData: { batchId, userId, files: workerFiles, bucket, region, r2AccountId },
    });

    worker.on('message', (msg: any) => {
      const b = this._batches.get(msg.batchId);
      if (!b) return;

      if (msg.type === 'progress') {
        b.status = 'processing';
        b.completed = msg.completed;
        b.failed = msg.failed;
        b.message = msg.message;
      } else if (msg.type === 'done') {
        b.status = 'done';
        b.completed = msg.completed;
        b.failed = msg.failed;
        b.message = msg.message;
        this.firebase
          .sendToUser(userId, {
            title: 'Subida completada',
            body: msg.message,
          })
          .catch((err) =>
            this.logger.error('Firebase notification error', err),
          );
      } else if (msg.type === 'error') {
        b.status = 'error';
        b.message = msg.message;
        this.logger.error(`Upload batch ${batchId} failed: ${msg.message}`);
      }
    });

    worker.on('error', (err) => {
      this.logger.error(`Worker error for batch ${batchId}`, err);
      const b = this._batches.get(batchId);
      if (b) {
        b.status = 'error';
        b.message = err.message;
      }
    });

    return batchId;
  }

  private getBucket(): string {
    const bucket = process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('R2_BUCKET_NAME or AWS_S3_BUCKET env variable is required');
    return bucket;
  }

  async getPhotos(
    userId: string,
    cursor?: string,
    maxKeys: number = 50,
    query?: string,
    favoritesOnly?: boolean,
    blurryOnly?: boolean,
    privateOnly?: boolean,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const bucket = this.getBucket();

    const dbPhotos = await this.prisma.photo.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(favoritesOnly ? { favorite: true } : {}),
        ...(blurryOnly ? { blurred: true } : {}),
        ...(privateOnly ? { private: true } : { private: false }),
        ...(query
          ? {
              OR: [
                { filename: { contains: query, mode: 'insensitive' } },
                { tags: { has: query } },
              ],
            }
          : {}),
        ...(dateFrom || dateTo
          ? {
              createdAt: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            }
          : {}),
      },
      take: maxKeys,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const presignExpiry = 604800;

    const results = await Promise.all(
      dbPhotos.map(async (photo) => {
        const thumbKey = photo.thumbS3Key;
        const uri = await getSignedUrl(
          this.s3,
          new GetObjectCommand({
            Bucket: bucket,
            Key: thumbKey || photo.s3Key,
          }),
          { expiresIn: presignExpiry },
        );
        return {
          uri,
          date: photo.createdAt.toISOString().slice(0, 10),
          id: photo.id,
          favorite: photo.favorite,
          tags: photo.tags,
          blurred: photo.blurred,
          private: photo.private,
          mimeType: photo.mimeType,
        };
      }),
    );

    const nextToken =
      dbPhotos.length === maxKeys ? dbPhotos[dbPhotos.length - 1].id : null;
    return { photos: results, nextToken };
  }

  async uploadPhoto(
    userId: string,
    buffer: Buffer,
    filename: string,
  ): Promise<string> {
    const bucket = this.getBucket();

    const timestamp = Date.now();
    const fullKey = `uploads/${userId}/${timestamp}-${filename}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fullKey,
        Body: buffer,
        ContentType: 'image/jpeg',
      }),
    );

    const thumbKey = `thumbnails/${userId}/${timestamp}-${filename}`;
    const thumbBuffer = await sharp(buffer)
      .resize(300)
      .jpeg({ quality: 70 })
      .toBuffer();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: 'image/jpeg',
      }),
    );

    const url = publicObjectUrl(bucket, fullKey);

    const [blurResult, pHash] = await Promise.all([
      this.computeBlurScore(buffer),
      this.computePerceptualHash(buffer),
    ]);

    await this.prisma.photo.create({
      data: {
        s3Key: fullKey,
        thumbS3Key: thumbKey,
        url,
        filename,
        mimeType: 'image/jpeg',
        size: buffer.length,
        blurred: blurResult.blurred,
        blurScore: blurResult.score,
        perceptualHash: pHash,
        userId,
      },
    });

    return url;
  }

  async getPhotoUrl(userId: string, photoId: string): Promise<string> {
    const bucket = this.getBucket();
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();

    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }),
      { expiresIn: 604800 },
    );
  }

  async getPhotoStream(userId: string, photoId: string) {
    const bucket = this.getBucket();
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();

    const command = new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key });
    const response = await this.s3.send(command);
    return {
      stream: response.Body as NodeJS.ReadableStream,
      contentType: photo.mimeType,
      contentLength: photo.size,
    };
  }

  async getShareLink(
    userId: string,
    photoId: string,
    expiresIn: number = 604800,
  ): Promise<string> {
    const bucket = this.getBucket();
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();
    if (photo.private)
      throw new BadRequestException('No se puede compartir una foto privada');

    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }),
      { expiresIn },
    );
  }

  async toggleFavorite(userId: string, photoId: string): Promise<boolean> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();

    const updated = await this.prisma.photo.update({
      where: { id: photoId },
      data: { favorite: !photo.favorite },
    });
    return updated.favorite;
  }

  async addTag(
    userId: string,
    photoId: string,
    tag: string,
  ): Promise<string[]> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();

    const normalized = tag.trim().toLowerCase();
    if (!normalized) return photo.tags;
    if (photo.tags.includes(normalized)) return photo.tags;

    const updated = await this.prisma.photo.update({
      where: { id: photoId },
      data: { tags: { push: normalized } },
    });
    return updated.tags;
  }

  async removeTag(
    userId: string,
    photoId: string,
    tag: string,
  ): Promise<string[]> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();

    const updated = await this.prisma.photo.update({
      where: { id: photoId },
      data: {
        tags: { set: photo.tags.filter((t) => t !== tag.toLowerCase()) },
      },
    });
    return updated.tags;
  }
  async getThisDayPhotos(userId: string) {
    const bucket = this.getBucket();

    const today = new Date();
    const month = today.getMonth();
    const day = today.getDate();

    const photos = await this.prisma.photo.findMany({
      where: { userId, deletedAt: null, private: false },
      select: {
        id: true,
        createdAt: true,
        s3Key: true,
        thumbS3Key: true,
        filename: true,
      },
    });

    const matching = photos.filter((p) => {
      const d = new Date(p.createdAt);
      return (
        d.getMonth() === month &&
        d.getDate() === day &&
        d.getFullYear() !== today.getFullYear()
      );
    });

    const grouped = new Map<number, typeof matching>();
    for (const p of matching) {
      const year = new Date(p.createdAt).getFullYear();
      const existing = grouped.get(year) || [];
      existing.push(p);
      grouped.set(year, existing);
    }

    const result = await Promise.all(
      Array.from(grouped.entries())
        .sort(([a], [b]) => b - a)
        .map(async ([year, yearPhotos]) => {
          const photo = yearPhotos[0];
          const thumbKey = photo.thumbS3Key || photo.s3Key;
          const uri = await getSignedUrl(
            this.s3,
            new GetObjectCommand({ Bucket: bucket, Key: thumbKey }),
            { expiresIn: 604800 },
          );
          return {
            year,
            uri,
            id: photo.id,
            filename: photo.filename,
            count: yearPhotos.length,
            yearsAgo: today.getFullYear() - year,
          };
        }),
    );

    return result;
  }

  async getStats(userId: string) {
    const [photoCount, albumCount, favoriteCount, blurryCount] =
      await Promise.all([
        this.prisma.photo.count({
          where: { userId, deletedAt: null, private: false },
        }),
        this.prisma.album.count({ where: { userId } }),
        this.prisma.photo.count({
          where: { userId, deletedAt: null, private: false, favorite: true },
        }),
        this.prisma.photo.count({
          where: { userId, deletedAt: null, private: false, blurred: true },
        }),
      ]);
    return { photoCount, albumCount, favoriteCount, blurryCount };
  }

  async togglePrivate(userId: string, photoId: string): Promise<boolean> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();

    const newPrivate = !photo.private;

    if (newPrivate) {
      let vault = await this.prisma.album.findFirst({
        where: { userId, vault: true },
      });
      if (!vault) {
        vault = await this.prisma.album.create({
          data: { name: 'Caja Fuerte', userId, vault: true },
        });
      }
      await this.prisma.album.update({
        where: { id: vault.id },
        data: { photos: { connect: { id: photoId } } },
      });
      const nonVaultAlbums = await this.prisma.album.findMany({
        where: { userId, vault: false, photos: { some: { id: photoId } } },
        select: { id: true },
      });
      for (const a of nonVaultAlbums) {
        await this.prisma.album.update({
          where: { id: a.id },
          data: { photos: { disconnect: { id: photoId } } },
        });
      }
    } else {
      const vault = await this.prisma.album.findFirst({
        where: { userId, vault: true },
      });
      if (vault) {
        await this.prisma.album.update({
          where: { id: vault.id },
          data: { photos: { disconnect: { id: photoId } } },
        });
      }
    }

    const updated = await this.prisma.photo.update({
      where: { id: photoId },
      data: { private: newPrivate },
    });
    return updated.private;
  }

  async getPhotoAlbums(
    userId: string,
    photoId: string,
  ): Promise<{ id: string; name: string; vault: boolean }[]> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();

    return this.prisma.album.findMany({
      where: { userId, photos: { some: { id: photoId } } },
      select: { id: true, name: true, vault: true },
    });
  }

  async softDeletePhoto(userId: string, photoId: string): Promise<void> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || photo.deletedAt)
      throw new NotFoundException();

    await this.prisma.photo.update({
      where: { id: photoId },
      data: { deletedAt: new Date() },
    });
  }

  async restorePhoto(userId: string, photoId: string): Promise<void> {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || !photo.deletedAt)
      throw new NotFoundException();

    await this.prisma.photo.update({
      where: { id: photoId },
      data: { deletedAt: null },
    });
  }

  async getTrash(userId: string) {
    const bucket = this.getBucket();

    const photos = await this.prisma.photo.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });

    return Promise.all(
      photos.map(async (photo) => {
        const thumbKey = photo.thumbS3Key;
        const uri = await getSignedUrl(
          this.s3,
          new GetObjectCommand({
            Bucket: bucket,
            Key: thumbKey || photo.s3Key,
          }),
          { expiresIn: 604800 },
        );
        return {
          id: photo.id,
          uri,
          filename: photo.filename,
          deletedAt: photo.deletedAt,
          size: photo.size,
        };
      }),
    );
  }

  async permanentlyDeletePhoto(userId: string, photoId: string): Promise<void> {
    const bucket = this.getBucket();

    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.userId !== userId || !photo.deletedAt)
      throw new NotFoundException();

    const s3Keys = [photo.s3Key];
    if (photo.thumbS3Key) s3Keys.push(photo.thumbS3Key);

    await Promise.allSettled(
      s3Keys.map((key) =>
        this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      ),
    );

    await this.prisma.photo.delete({ where: { id: photoId } });
  }

  private async computeBlurScore(
    buffer: Buffer,
  ): Promise<{ blurred: boolean; score: number }> {
    const { data, info } = await sharp(buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sum = 0;
    let count = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = y * info.width + x;
        let dx = 0,
          dy = 0;
        if (x > 0) dx = Math.abs(data[idx] - data[idx - 1]);
        if (y > 0) dy = Math.abs(data[idx] - data[idx - info.width]);
        sum += dx + dy;
        count++;
      }
    }
    const score = sum / count;
    return { blurred: score < 10, score: Math.round(score * 100) / 100 };
  }

  private async computePerceptualHash(buffer: Buffer): Promise<string> {
    const { data, info } = await sharp(buffer)
      .resize(8, 8, { fit: 'cover' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const hash = Array.from(data)
      .map((v) => (v > avg ? '1' : '0'))
      .join('');
    return BigInt('0b' + hash)
      .toString(16)
      .padStart(16, '0');
  }
}
