import { Injectable } from '@nestjs/common';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Express } from 'express';

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

  async getPhotos(): Promise<string[]> {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');
    const command = new ListObjectsV2Command({ Bucket: bucket });
    const response = await this.s3.send(command);
    const keys = (response.Contents || [])
      .map((obj) => obj.Key!)
      .filter(Boolean);

    const signedUrls = await Promise.all(
      keys.map((key) =>
        getSignedUrl(this.s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 })
      )
    );
    return signedUrls;
  }

  async uploadPhotoBase64(base64Image: string, filename: string): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');
    
    const key = `${Date.now()}-${filename}`;
    const buffer = Buffer.from(base64Image, 'base64');
    
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
    });
    
    await this.s3.send(command);
    return `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  }

  async getPhotoByFilename() {}
}
