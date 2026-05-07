import { Injectable } from '@nestjs/common';
import { S3Client, ListObjectsV2Command, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Express } from 'express';
import sharp from 'sharp';

@Injectable()
export class AppService {
  private s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

  private baseName(key: string): string {
    return key.replace('uploads/', '').replace('thumbnails/', '');
  }

  async getPhotos(continuationToken?: string, maxKeys: number = 50): Promise<{ photos: { uri: string; date: string }[]; nextToken: string | null }> {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: maxKeys,
      ContinuationToken: continuationToken,
    });
    const response = await this.s3.send(command);
    const keys = (response.Contents || [])
      .map((obj) => ({ key: obj.Key!, lastModified: obj.LastModified }))
      .filter(({ key }) => {
        if (!key) return false;
        if (key.startsWith('thumbnails/')) return false;
        if (key.startsWith('thumb-')) return false;
        return true;
      });

    const results = await Promise.all(
      keys.map(async ({ key, lastModified }) => {
        const base = this.baseName(key);
        const thumbKey = `thumbnails/${base}`;
        let uri: string;
        try {
          await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: thumbKey }));
          uri = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: bucket, Key: thumbKey }), { expiresIn: 3600 });
        } catch {
          uri = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
        }
        const ts = parseInt(base.split('-')[0], 10);
        const tsDate = !isNaN(ts) ? new Date(ts).toISOString().slice(0, 10) : null;
        const date = tsDate && tsDate > '2010-01-01'
          ? tsDate
          : (lastModified ? new Date(lastModified).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
        return { uri, date };
      })
    );

    const nextToken = response.NextContinuationToken ?? null;
    return { photos: results, nextToken };
  }

  async uploadPhoto(buffer: Buffer, filename: string): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');

    const timestamp = Date.now();
    const fullKey = `uploads/${timestamp}-${filename}`;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fullKey,
      Body: buffer,
      ContentType: 'image/jpeg',
    });
    await this.s3.send(command);

    const thumbKey = `thumbnails/${timestamp}-${filename}`;
    const thumbBuffer = await sharp(buffer).resize(300).jpeg({ quality: 70 }).toBuffer();
    const thumbCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: thumbKey,
      Body: thumbBuffer,
      ContentType: 'image/jpeg',
    });
    await this.s3.send(thumbCommand);

    return `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fullKey}`;
  }

  async getPhotoUrl(key: string): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: bucket, Key: `uploads/${key}` }), { expiresIn: 3600 });
  }

  async deletePhoto(key: string): Promise<void> {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `uploads/${key}` })).catch(() => {});
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `thumbnails/${key}` })).catch(() => {});
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `thumb-${key}` })).catch(() => {});
  }

  async generateMissingThumbnails(): Promise<{ generated: number }> {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');

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
        await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: thumbKey }));
      } catch {
        const obj = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const buffer = await obj.Body!.transformToByteArray();
        const thumbBuffer = await sharp(Buffer.from(buffer)).resize(300).jpeg({ quality: 70 }).toBuffer();
        await this.s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: thumbKey,
          Body: thumbBuffer,
          ContentType: 'image/jpeg',
        }));
        generated++;
      }
    }
    return { generated };
  }

  async migrateToFolders(): Promise<{ moved: number }> {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');

    const command = new ListObjectsV2Command({ Bucket: bucket });
    const response = await this.s3.send(command);
    const keys = (response.Contents || []).map((obj) => obj.Key!).filter(Boolean);

    let moved = 0;
    for (const key of keys) {
      if (key.startsWith('uploads/') || key.startsWith('thumbnails/')) continue;

      if (key.startsWith('thumb-')) {
        const base = key.slice(6);
        const dest = `thumbnails/${base}`;
        try {
          await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: dest }));
        } catch {
          await this.s3.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `/${bucket}/${key}`, Key: dest }));
          moved++;
        }
        await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } else {
        const dest = `uploads/${key}`;
        try {
          await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: dest }));
        } catch {
          await this.s3.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `/${bucket}/${key}`, Key: dest }));
          moved++;
        }
        await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }
    }
    return { moved };
  }
}
