import { parentPort, workerData } from 'worker_threads';
import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface WorkerInput {
  userId: string;
  photoIds: string[];
  concurrency: number;
}

const MATCH_THRESHOLD = 0.5;

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function runDetection(imagePath: string): Promise<
  {
    encoding: number[];
    boxX: number;
    boxY: number;
    boxWidth: number;
    boxHeight: number;
  }[]
> {
  return new Promise((resolve) => {
    const scriptPath = path.join(
      process.cwd(),
      'src',
      'faces',
      'face-detect.mjs',
    );

    const proc = spawn('node', [scriptPath, imagePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', () => {
      resolve([]);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`face-detect.mjs exited with code ${code}: ${stderr}`);
        resolve([]);
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result.faces || []);
      } catch {
        resolve([]);
      }
    });
  });
}

async function downloadFromS3(
  s3: S3Client,
  bucket: string,
  key: string,
  destPath: string,
): Promise<void> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as NodeJS.ReadableStream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  fs.writeFileSync(destPath, Buffer.concat(chunks));
}

async function run(input: WorkerInput): Promise<void> {
  const prisma = new PrismaClient();
  const r2Endpoint = process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined;
  const s3 = new S3Client({
    region: r2Endpoint ? 'auto' : process.env.AWS_REGION || 'us-east-1',
    endpoint: r2Endpoint,
    forcePathStyle: !!r2Endpoint,
    credentials: {
      accessKeyId:
        process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey:
        process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET || '';

  let processed = 0;
  let facesFound = 0;
  let failed = 0;
  const total = input.photoIds.length;

  const { concurrency } = input;

  const sendProgress = () => {
    parentPort?.postMessage({
      type: 'progress',
      processed,
      facesFound,
      failed,
      total,
    });
  };

  for (let i = 0; i < total; i += concurrency) {
    const chunk = input.photoIds.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async (photoId) => {
        const photo = await prisma.photo.findUnique({
          where: { id: photoId },
          select: { s3Key: true, mimeType: true },
        });

        if (!photo || photo.mimeType.startsWith('video/')) return 0;

        const tmpDir = path.join(os.tmpdir(), 'vaulta-faces');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, `${photoId}.jpg`);

        try {
          await downloadFromS3(s3, bucket, photo.s3Key, tmpFile);
          const faces = await runDetection(tmpFile);

          if (faces.length === 0) return 0;

          await prisma.face.deleteMany({ where: { photoId } });

          await prisma.face.createMany({
            data: faces.map((f) => ({
              photoId,
              encoding: f.encoding,
              boxX: f.boxX,
              boxY: f.boxY,
              boxWidth: f.boxWidth,
              boxHeight: f.boxHeight,
            })),
          });

          const existingNames = await prisma.face.findMany({
            where: { personName: { not: null }, confirmed: true },
            select: { personName: true, encoding: true },
            distinct: ['personName'],
          });

          if (existingNames.length > 0) {
            const newFaces = await prisma.face.findMany({
              where: { photoId, personName: null, ignored: false },
            });

            for (const face of newFaces) {
              const encoding = face.encoding as number[];
              let bestMatch = '';
              let bestDistance = Infinity;

              for (const existing of existingNames) {
                if (!existing.personName) continue;
                const existingEncoding = existing.encoding as number[];
                const dist = euclideanDistance(encoding, existingEncoding);
                if (dist < MATCH_THRESHOLD && dist < bestDistance) {
                  bestDistance = dist;
                  bestMatch = existing.personName;
                }
              }

              if (bestMatch) {
                await prisma.face.update({
                  where: { id: face.id },
                  data: { personName: bestMatch, confirmed: true },
                });
              }
            }
          }

          return faces.length;
        } finally {
          try {
            fs.unlinkSync(tmpFile);
          } catch {
            /* ignore */
          }
        }
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        processed++;
        facesFound += r.value;
      } else {
        console.error(`Failed: ${r.reason}`);
        failed++;
      }
    }

    sendProgress();
  }

  await prisma.$disconnect();

  parentPort?.postMessage({
    type: 'done',
    processed,
    facesFound,
    failed,
  });
}

run(workerData as WorkerInput).catch((err: Error) => {
  parentPort?.postMessage({ type: 'error', message: err.message });
});
