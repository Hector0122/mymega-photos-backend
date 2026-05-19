import { parentPort, workerData } from 'worker_threads';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as exifr from 'exifr';
const req = createRequire(__filename);

interface UploadWorkerInput {
  batchId: string;
  userId: string;
  files: { path: string; filename: string; mimeType: string; size: number }[];
  bucket: string;
  region: string;
  r2AccountId?: string;
}

async function run(input: UploadWorkerInput) {
  const { batchId, userId, files, bucket, region, r2AccountId } = input;
  const r2Endpoint = r2AccountId
    ? `https://${r2AccountId}.r2.cloudflarestorage.com`
    : undefined;
  const s3 = new S3Client({
    region: r2Endpoint ? 'auto' : region,
    endpoint: r2Endpoint,
    forcePathStyle: !!r2Endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY!,
    },
    requestHandler: {
      requestTimeout: 300_000,
    },
  });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const adapter = new PrismaPg(
    { connectionString },
    { schema: process.env.DATABASE_SCHEMA || 'public' },
  );
  const prisma = new PrismaClient({ adapter });
  const sharp = (await import('sharp')).default;

  let completed = 0;
  let failed = 0;
  let lastError = '';

  const sendProgress = (message: string) => {
    parentPort?.postMessage({
      type: 'progress',
      batchId,
      completed,
      failed,
      total: files.length,
      message,
    });
  };

  for (const file of files) {
    try {
      const buffer = fs.readFileSync(file.path);
      const exifData = await exifr.parse(buffer, ['DateTimeOriginal']).catch(() => null)
      const FALLBACK = new Date('1999-01-01')
      let photoDate = exifData?.DateTimeOriginal || FALLBACK
      const y = photoDate.getFullYear()
      if (y < 1900 || y > new Date().getFullYear() + 1) photoDate = FALLBACK
      const timestamp = photoDate.getTime()
      const fullKey = `uploads/${userId}/${timestamp}-${file.filename}`;
      const isVideo = file.mimeType.startsWith('video/');

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fullKey,
          Body: buffer,
          ContentType: file.mimeType,
        }),
      );

      const url = r2Endpoint
        ? `${r2Endpoint}/${bucket}/${fullKey}`
        : `https://${bucket}.s3.${region}.amazonaws.com/${fullKey}`;

      let videoThumbKey: string | undefined

      if (isVideo) {
        const thumbKey = `thumbnails/${userId}/${timestamp}-${file.filename}.jpg`;
        const thumbPath = file.path + '-thumb.jpg';
        try {
          let ffmpegPath: string | null = null
          try {
            const staticPath = req('ffmpeg-static')
            if (fs.existsSync(staticPath)) ffmpegPath = staticPath
          } catch { /* fall through */ }
          if (!ffmpegPath) {
            try {
              const { execSync } = await import('child_process')
              ffmpegPath = execSync('which ffmpeg', { encoding: 'utf8' }).trim()
            } catch { /* ffmpeg not on PATH */ }
          }
          if (!ffmpegPath) {
            console.error(`[UploadWorker] ffmpeg not found, skipping thumbnail for ${file.filename}`)
          } else {
            const ffmpeg = (await import('fluent-ffmpeg')).default;
            ffmpeg.setFfmpegPath(ffmpegPath);
            await new Promise<void>((resolve, reject) => {
              ffmpeg(file.path)
                .on('end', () => resolve())
                .on('error', reject)
                .screenshots({
                  count: 1,
                  timemarks: ['1'],
                  filename: path.basename(thumbPath),
                  folder: path.dirname(thumbPath),
                  size: '300x?',
                });
            });
            const thumbBuffer = fs.readFileSync(thumbPath);
            await s3.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: thumbKey,
                Body: thumbBuffer,
                ContentType: 'image/jpeg',
              }),
            );
            try {
              fs.unlinkSync(thumbPath);
            } catch {
              /* ignore */
            }
            videoThumbKey = thumbKey
          }
        } catch (e) {
          const errMsg = (e as Error).message;
          lastError += ` thumb:${errMsg}`;
          console.error(`[UploadWorker] Thumbnail generation failed for ${file.filename}: ${errMsg}`);
        }

        await prisma.photo.create({
          data: {
            s3Key: fullKey,
            thumbS3Key: videoThumbKey,
            url,
            filename: file.filename,
            mimeType: file.mimeType,
            size: file.size,
            createdAt: photoDate,
            userId,
          },
        });
      } else {
        const thumbKey = `thumbnails/${userId}/${timestamp}-${file.filename}`;
        const thumbBuffer = await sharp(buffer)
          .resize(300)
          .jpeg({ quality: 70 })
          .toBuffer();

        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: thumbKey,
            Body: thumbBuffer,
            ContentType: 'image/jpeg',
          }),
        );

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
        const blurScore = sum / count;
        const blurred = blurScore < 10;

        const { data: hashData } = await sharp(buffer)
          .resize(8, 8, { fit: 'cover' })
          .grayscale()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const avg = hashData.reduce((a, b) => a + b, 0) / hashData.length;
        const hashBin = Array.from(hashData)
          .map((v) => (v > avg ? '1' : '0'))
          .join('');
        const perceptualHash = BigInt('0b' + hashBin)
          .toString(16)
          .padStart(16, '0');

        await prisma.photo.create({
          data: {
            s3Key: fullKey,
            thumbS3Key: thumbKey,
            url,
            filename: file.filename,
            mimeType: file.mimeType,
            size: file.size,
            blurred,
            blurScore: Math.round(blurScore * 100) / 100,
            perceptualHash,
            createdAt: photoDate,
            userId,
          },
        });
      }

      completed++;
      sendProgress(`Subida ${completed} de ${files.length}`);
    } catch (err) {
      failed++;
      lastError = `${file.filename}: ${(err as Error).message}`;
      sendProgress(`Error: ${lastError}`);
    } finally {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
    }
  }

  await prisma.$disconnect();

  parentPort?.postMessage({
    type: 'done',
    batchId,
    completed,
    failed,
    message: `Subida completada: ${completed} archivo(s) subido(s)${failed > 0 ? `, ${failed} fallaron: ${lastError}` : ''}`,
  });
}

run(workerData as UploadWorkerInput).catch((err: Error) => {
  parentPort?.postMessage({
    type: 'error',
    batchId: (workerData as UploadWorkerInput).batchId,
    message: err.message,
  });
});
