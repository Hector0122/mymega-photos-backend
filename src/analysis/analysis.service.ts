import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { PrismaService } from '../prisma.service';
import { S3_CLIENT } from '../common/s3.provider';

@Injectable()
export class AnalysisService {
  constructor(
    private prisma: PrismaService,
    @Inject(S3_CLIENT) private s3: S3Client,
  ) {}

  private getBucket(): string {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');
    return bucket;
  }

  async computeBlurScore(
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

  async computePerceptualHash(buffer: Buffer): Promise<string> {
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

  async analyzePhoto(photoId: string) {
    const bucket = this.getBucket();

    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
    });
    if (!photo) throw new NotFoundException();

    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }),
    );
    const buffer = await response.Body?.transformToByteArray();
    if (!buffer) throw new Error('Empty response body');

    const buf = Buffer.from(buffer);
    const [blurResult, pHash] = await Promise.all([
      this.computeBlurScore(buf),
      this.computePerceptualHash(buf),
    ]);

    await this.prisma.photo.update({
      where: { id: photoId },
      data: {
        blurred: blurResult.blurred,
        blurScore: blurResult.score,
        perceptualHash: pHash,
      },
    });

    return {
      blurred: blurResult.blurred,
      blurScore: blurResult.score,
      perceptualHash: pHash,
    };
  }

  async analyzeAllPhotos(userId: string): Promise<{ analyzed: number }> {
    const photos = await this.prisma.photo.findMany({
      where: { userId, deletedAt: null, private: false, perceptualHash: null },
    });

    let analyzed = 0;
    for (const photo of photos) {
      try {
        await this.analyzePhoto(photo.id);
        analyzed++;
      } catch {
        /* skip failed */
      }
    }
    return { analyzed };
  }

  async getDuplicates(userId: string) {
    const bucket = this.getBucket();

    const photos = await this.prisma.photo.findMany({
      where: {
        userId,
        deletedAt: null,
        private: false,
        perceptualHash: { not: null },
      },
      select: {
        id: true,
        s3Key: true,
        thumbS3Key: true,
        filename: true,
        perceptualHash: true,
        blurred: true,
        blurScore: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const presigned = await Promise.all(
      photos.map(async (p) => {
        const uri = await getSignedUrl(
          this.s3,
          new GetObjectCommand({
            Bucket: bucket,
            Key: p.thumbS3Key || p.s3Key,
          }),
          { expiresIn: 604800 },
        );
        return {
          id: p.id,
          url: uri,
          filename: p.filename,
          perceptualHash: p.perceptualHash,
          blurred: p.blurred,
          blurScore: p.blurScore,
          createdAt: p.createdAt,
        };
      }),
    );

    const hashGroups = new Map<string, typeof presigned>();
    for (const p of presigned) {
      if (!p.perceptualHash) continue;
      const existing = hashGroups.get(p.perceptualHash) || [];
      existing.push(p);
      hashGroups.set(p.perceptualHash, existing);
    }

    const duplicates = Array.from(hashGroups.values()).filter(
      (g) => g.length > 1,
    );
    return duplicates;
  }
}
