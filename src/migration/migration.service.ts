import { Injectable, Inject } from '@nestjs/common';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import exifr from 'exifr';
import sharp from 'sharp';
import { PrismaService } from '../prisma.service';
import {
  S3_CLIENT,
  publicObjectUrl,
  getBucketName,
} from '../common/s3.provider';
import { THUMB_RESIZE, THUMB_QUALITY } from '../common/constants';

@Injectable()
export class MigrationService {
  constructor(
    private prisma: PrismaService,
    @Inject(S3_CLIENT) private s3: S3Client,
  ) {}

  private baseName(key: string): string {
    return key
      .replace(/^(thumbs|thumbnails)\//, '')
      .replace(/^(fotos|videos)\/[^/]+\//, '')
      .replace(/^uploads\//, '');
  }

  async syncS3ToDb(
    userId: string,
    limit?: number,
  ): Promise<{ synced: number }> {
    const bucket = getBucketName();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new Error('User not found');

    let continuationToken: string | undefined;
    let synced = 0;
    const thumbMap = new Map<string, string>();

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      });
      const response = await this.s3.send(command);

      const entries = (response.Contents || []).map((obj) => ({
        key: obj.Key!,
        size: obj.Size || 0,
        lastModified: obj.LastModified,
      }));

      for (const { key, size, lastModified } of entries) {
        if (key.startsWith('thumbnails/') || key.startsWith('thumbs/')) {
          const base = this.baseName(key);
          thumbMap.set(base, key);
          continue;
        }
        if (key.startsWith('thumb-')) continue;
        if (limit && synced >= limit) break;

        // Saltar si ya está importada (permite batches)
        const existing = await this.prisma.photo.findUnique({
          where: { s3Key: key },
        });
        if (existing) continue;

        const base = this.baseName(key);
        const lastPart = base.includes('/') ? base.split('/').pop()! : base;
        const filename = lastPart.split('-').slice(1).join('-') || lastPart;
        const url = publicObjectUrl(bucket, key);

        // Detectar tipo MIME por extensión
        const ext = key.split('.').pop()?.toLowerCase() || 'jpg';
        const mimeType =
          ext === 'mp4'
            ? 'video/mp4'
            : ext === 'heic'
              ? 'image/heic'
              : ext === 'mov'
                ? 'video/quicktime'
                : ext === 'png'
                  ? 'image/png'
                  : ext === 'gif'
                    ? 'image/gif'
                    : ext === 'webp'
                      ? 'image/webp'
                      : 'image/jpeg';

        // Extraer fecha EXIF con fallback a fecha del path y lastModified
        let createdAt: Date | null = null;
        try {
          const obj = await this.s3.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: key,
              Range: 'bytes=0-65536',
            }),
          );
          const buf = Buffer.from(await obj.Body!.transformToByteArray());
          const exif = await exifr.parse(buf, ['DateTimeOriginal']);
          if (exif?.DateTimeOriginal) {
            createdAt = new Date(exif.DateTimeOriginal);
          }
        } catch {
          /* fallback */
        }

        if (!createdAt || createdAt.getTime() < 946684800000) {
          // Fallback: fecha desde el path de S3 (ej. 2026-05-15)
          const m = key.match(/(\d{4}-\d{2}-\d{2})/);
          if (m) createdAt = new Date(m[1]);
        }

        if (!createdAt || createdAt.getTime() < 946684800000) {
          createdAt = lastModified || new Date();
        }

        await this.prisma.photo.create({
          data: {
            s3Key: key,
            thumbS3Key: thumbMap.get(base) || undefined,
            url,
            filename,
            mimeType,
            size,
            createdAt,
            userId: user.id,
          },
        });
        synced++;
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken && (!limit || synced < limit));

    return { synced };
  }

  async generateMissingThumbnails(): Promise<{ generated: number }> {
    const bucket = getBucketName();

    const command = new ListObjectsV2Command({ Bucket: bucket });
    const response = await this.s3.send(command);
    const fullKeys = (response.Contents || [])
      .map((obj) => obj.Key!)
      .filter((key) => {
        if (!key) return false;
        if (key.startsWith('thumbnails/')) return false;
        if (key.startsWith('thumb-')) return false;
        return true;
      });

    let generated = 0;
    for (const key of fullKeys) {
      const base = this.baseName(key);
      const thumbKey = `thumbnails/${base}`;
      try {
        await this.s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: thumbKey }),
        );
      } catch {
        const obj = await this.s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        const buffer = await obj.Body!.transformToByteArray();
        const thumbBuffer = await sharp(Buffer.from(buffer))
          .resize(THUMB_RESIZE)
          .jpeg({ quality: THUMB_QUALITY })
          .toBuffer();
        await this.s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: thumbKey,
            Body: thumbBuffer,
            ContentType: 'image/jpeg',
          }),
        );
        generated++;
      }
    }
    return { generated };
  }

  async migrateToFolders(): Promise<{ moved: number }> {
    const bucket = getBucketName();

    const command = new ListObjectsV2Command({ Bucket: bucket });
    const response = await this.s3.send(command);
    const keys = (response.Contents || [])
      .map((obj) => obj.Key!)
      .filter(Boolean);

    let moved = 0;
    for (const key of keys) {
      if (key.startsWith('uploads/') || key.startsWith('thumbnails/')) continue;

      if (key.startsWith('thumb-')) {
        const base = key.slice(6);
        const dest = `thumbnails/${base}`;
        try {
          await this.s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: dest }),
          );
        } catch {
          await this.s3.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: `/${bucket}/${key}`,
              Key: dest,
            }),
          );
          moved++;
        }
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
      } else {
        const dest = `uploads/${key}`;
        try {
          await this.s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: dest }),
          );
        } catch {
          await this.s3.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: `/${bucket}/${key}`,
              Key: dest,
            }),
          );
          moved++;
        }
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
      }
    }
    return { moved };
  }

  async fixVideoThumbnails(): Promise<{ checked: number; fixed: number; backfilled: number }> {
    const bucket = getBucketName();

    const thumbSet = new Set<string>();
    let token: string | undefined;
    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'thumbs/',
        ContinuationToken: token,
      });
      const r = await this.s3.send(cmd);
      for (const obj of r.Contents || []) {
        if (obj.Key && obj.Key.includes('/videos/')) thumbSet.add(obj.Key);
      }
      token = r.NextContinuationToken;
    } while (token);

    const allVideos = await this.prisma.photo.findMany({
      where: { mimeType: { startsWith: 'video/' } },
      select: { id: true, s3Key: true, thumbS3Key: true },
    });

    let fixed = 0;
    let backfilled = 0;

    for (const video of allVideos) {
      const expectedThumb = video.s3Key
        .replace('videos/', 'thumbs/')
        .replace(/\.\w+$/, '.jpg');

      if (video.thumbS3Key) {
        if (!thumbSet.has(video.thumbS3Key)) {
          await this.prisma.photo.update({
            where: { id: video.id },
            data: { thumbS3Key: null },
          });
          fixed++;
        }
      } else {
        if (thumbSet.has(expectedThumb)) {
          await this.prisma.photo.update({
            where: { id: video.id },
            data: { thumbS3Key: expectedThumb },
          });
          backfilled++;
        }
      }
    }

    return { checked: allVideos.length, fixed, backfilled };
  }

  async migrateVault(userId: string): Promise<{ moved: number }> {
    const privates = await this.prisma.photo.findMany({
      where: { userId, deletedAt: null, private: true },
      select: { id: true },
    });
    if (privates.length === 0) return { moved: 0 };

    let vault = await this.prisma.album.findFirst({
      where: { userId, vault: true },
    });
    if (!vault) {
      vault = await this.prisma.album.create({
        data: { name: 'Caja Fuerte', userId, vault: true },
      });
    }

    const photoIds = privates.map((p) => p.id);

    await this.prisma.album.update({
      where: { id: vault.id },
      data: { photos: { connect: photoIds.map((id) => ({ id })) } },
    });

    const nonVaultAlbums = await this.prisma.album.findMany({
      where: {
        userId,
        vault: false,
        photos: { some: { id: { in: photoIds } } },
      },
      select: { id: true },
    });
    for (const a of nonVaultAlbums) {
      await this.prisma.album.update({
        where: { id: a.id },
        data: { photos: { disconnect: photoIds.map((id) => ({ id })) } },
      });
    }

    return { moved: privates.length };
  }
}
