import { Injectable } from '@nestjs/common';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

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
    return (response.Contents || [])
      .map((obj) => obj.Key!)
      .filter(Boolean)
      .map((key) => `http://${bucket}.s3.amazonaws.com/${key}`);
  }

  async getPhotoByFilename() {}
}
