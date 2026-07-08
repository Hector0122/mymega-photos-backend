import { parentPort, workerData } from 'worker_threads';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
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

const MATCH_THRESHOLD = 0.45;
const MATCH_RATIO = 1.2;

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function resolveScriptPath(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'faces', 'face-detect.mjs'),
    path.join(process.cwd(), 'dist', 'faces', 'face-detect.mjs'),
    path.join(process.cwd(), 'src', 'faces', 'face-detect.mjs'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
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
    const scriptPath = resolveScriptPath();

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

    proc.on('error', (err) => {
      console.error(
        `runDetection spawn error: ${err.message}, scriptPath: ${scriptPath}`,
      );
      resolve([]);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(
          `face-detect.mjs exited code ${code}, stderr: ${stderr}, scriptPath: ${scriptPath}`,
        );
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
  console.log(
    `[scan-worker] Starting scan for ${input.photoIds.length} photos`,
  );
  console.log(`[scan-worker] face-detect.mjs path: ${resolveScriptPath()}`);
  console.log(`[scan-worker] __dirname: ${__dirname}`);
  console.log(`[scan-worker] cwd: ${process.cwd()}`);
  const rawUrl = process.env.DATABASE_URL || '';
  const connectionString = rawUrl.includes('sslmode=')
    ? rawUrl
    : `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}${
        rawUrl.includes('railway.internal')
          ? 'sslmode=disable'
          : 'sslmode=require'
      }`;
  const adapter = new PrismaPg(
    { connectionString },
    { schema: process.env.DATABASE_SCHEMA || 'public' },
  );
  const prisma = new PrismaClient({ adapter });
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
  let stopped = false;
  const total = input.photoIds.length;
  const { userId } = input;

  parentPort?.on('message', (msg) => {
    if (msg === 'stop') stopped = true;
  });

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

  for (let i = 0; i < total && !stopped; i += concurrency) {
    const chunk = input.photoIds.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async (photoId) => {
        const photo = await prisma.photo.findUnique({
          where: { id: photoId },
          select: { s3Key: true, mimeType: true, userId: true },
        });

        if (!photo || photo.mimeType.startsWith('video/')) return 0;
        if (photo.userId !== userId) return 0;

        const tmpDir = path.join(os.tmpdir(), 'vaulta-faces');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, `${photoId}.jpg`);

        try {
          await downloadFromS3(s3, bucket, photo.s3Key, tmpFile);
          const faces = await runDetection(tmpFile);

          if (faces.length === 0) return 0;

          await prisma.$transaction(async (tx) => {
            await tx.face.deleteMany({ where: { photoId } });

            await tx.face.createMany({
              data: faces.map((f) => ({
                photoId,
                encoding: f.encoding,
                boxX: f.boxX,
                boxY: f.boxY,
                boxWidth: f.boxWidth,
                boxHeight: f.boxHeight,
              })),
            });

            const allExisting = await tx.face.findMany({
              where: {
                personName: { not: null },
                confirmed: true,
                photo: { userId },
              },
              select: { personName: true, encoding: true },
            });

            const personEncodings = new Map<string, number[][]>();
            for (const ef of allExisting) {
              if (!ef.personName) continue;
              const encs = personEncodings.get(ef.personName) || [];
              encs.push(ef.encoding as number[]);
              personEncodings.set(ef.personName, encs);
            }

            if (personEncodings.size > 0) {
              const newFaces = await tx.face.findMany({
                where: { photoId, personName: null, ignored: false },
              });

              for (const face of newFaces) {
                const encoding = face.encoding as number[];
                const scores: { name: string; avgDist: number }[] = [];

                for (const [name, encs] of personEncodings) {
                  let sum = 0;
                  for (const refEnc of encs) {
                    sum += euclideanDistance(encoding, refEnc);
                  }
                  scores.push({ name, avgDist: sum / encs.length });
                }

                scores.sort((a, b) => a.avgDist - b.avgDist);

                if (scores.length === 0) continue;
                const best = scores[0];
                if (best.avgDist >= MATCH_THRESHOLD) continue;

                if (scores.length >= 2) {
                  const second = scores[1];
                  if (second.avgDist / best.avgDist < MATCH_RATIO) continue;
                }

                await tx.face.update({
                  where: { id: face.id },
                  data: { personName: best.name, confirmed: true },
                });
              }
            }
          });

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
  console.error(`[scan-worker] Unhandled error: ${err.message}`);
  console.error(err.stack);
  parentPort?.postMessage({
    type: 'error',
    message: err.message,
    stack: err.stack,
  });
});
