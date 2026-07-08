import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import pLimit from 'p-limit';
import * as dotenv from 'dotenv';
import { program } from 'commander';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
globalThis.require = require;

// .env.local has precedence over .env
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const MATCH_THRESHOLD = 0.5;
const FACE_DETECT_MAX_WIDTH = 1024;
const CHECKPOINT_FILE = 'scan-state.json';
const TMP_DIR = path.join(os.tmpdir(), 'vaulta-scan-local');

interface DetectedFace {
  encoding: number[];
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
}

interface PendingPhoto {
  id: string;
  s3Key: string;
}

interface ConfirmedPerson {
  personName: string;
  encodings: number[][];
}

interface CheckpointData {
  processedIds: string[];
  failedIds: { photoId: string; error: string }[];
  lastCursor: string | null;
  totalProcessed: number;
  totalFaces: number;
  startedAt: string;
}

interface RuntimeState {
  processedIds: Set<string>;
  failedIds: { photoId: string; error: string }[];
  lastCursor: string | null;
  totalProcessed: number;
  totalFaces: number;
  startedAt: string;
}

function freshState(): RuntimeState {
  return {
    processedIds: new Set(),
    failedIds: [],
    lastCursor: null,
    totalProcessed: 0,
    totalFaces: 0,
    startedAt: new Date().toISOString(),
  };
}

let state = freshState();
let confirmedPeople: ConfirmedPerson[] = [];
let s3: S3Client;
let bucket = '';
let apiUrl = '';
let apiKey = '';
let dryRun = false;
let totalPending = 0;
let startTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function formatEta(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '--';
  return formatDuration(sec * 1000);
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function loadCheckpoint(): RuntimeState {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const raw: CheckpointData = JSON.parse(
        fs.readFileSync(CHECKPOINT_FILE, 'utf-8'),
      );
      return {
        processedIds: new Set(raw.processedIds || []),
        failedIds: raw.failedIds || [],
        lastCursor: raw.lastCursor || null,
        totalProcessed: raw.totalProcessed || 0,
        totalFaces: raw.totalFaces || 0,
        startedAt: raw.startedAt || new Date().toISOString(),
      };
    }
  } catch {
    /* ignore */
  }
  return freshState();
}

function saveCheckpoint() {
  const raw: CheckpointData = {
    processedIds: Array.from(state.processedIds),
    failedIds: state.failedIds,
    lastCursor: state.lastCursor,
    totalProcessed: state.totalProcessed,
    totalFaces: state.totalFaces,
    startedAt: state.startedAt,
  };
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(raw, null, 2));
}

async function fetchApi<T>(
  method: string,
  route: string,
  body?: any,
): Promise<T> {
  const url = `${apiUrl.replace(/\/+$/, '')}/faces/${route.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${route}: ${res.status} ${text}`);
  }
  return res.json();
}

async function fetchPending(
  take: number,
  cursor?: string | null,
): Promise<{ photos: PendingPhoto[]; nextCursor: string | null }> {
  let url = `pending?take=${take}`;
  if (cursor) url += `&cursor=${cursor}`;
  return fetchApi('GET', url);
}

async function fetchConfirmedEncodings(): Promise<{
  people: ConfirmedPerson[];
}> {
  return fetchApi('GET', 'confirmed-encodings');
}

async function sendResults(
  results: {
    photoId: string;
    faces: {
      encoding: number[];
      boxX: number;
      boxY: number;
      boxWidth: number;
      boxHeight: number;
      personName?: string;
    }[];
  }[],
): Promise<any> {
  return fetchApi('POST', 'ingest', { results });
}

async function downloadFromR2(s3Key: string, destPath: string): Promise<void> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
  );
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as NodeJS.ReadableStream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  fs.writeFileSync(destPath, Buffer.concat(chunks));
}

let faceapi: any = null;
let tf: any = null;

async function ensureModels(): Promise<void> {
  if (faceapi) return;

  const modPath = path.join(process.cwd(), 'models', 'face-api');
  faceapi = await import('@vladmandic/face-api');
  tf = faceapi.tf;
  if (!tf) {
    const tfjsMod = await import('@tensorflow/tfjs-node');
    tf = tfjsMod;
  }

  await faceapi.nets.tinyFaceDetector.loadFromDisk(modPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modPath);
}

async function runDetection(imagePath: string): Promise<DetectedFace[]> {
  await ensureModels();

  const { data, info } = await sharp(fs.readFileSync(imagePath))
    .resize(FACE_DETECT_MAX_WIDTH, FACE_DETECT_MAX_WIDTH, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tensor = tf.tensor3d(
    data,
    [info.height, info.width, info.channels],
    'int32',
  );

  try {
    const input = tf.cast(tensor, 'float32');

    try {
      const detections = await faceapi
        .detectAllFaces(
          input,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 416,
            scoreThreshold: 0.5,
          }),
        )
        .withFaceLandmarks()
        .withFaceDescriptors()
        .run();

      return detections.map((d: any) => {
        const enc = Array.from(d.descriptor);
        if (enc.length !== 128) {
          console.warn(`  Unexpected encoding length: ${enc.length}, expected 128`);
        }
        return {
          encoding: enc,
          boxX: d.detection.box.x,
          boxY: d.detection.box.y,
          boxWidth: d.detection.box.width,
          boxHeight: d.detection.box.height,
        };
      });
    } finally {
      tf.dispose(input);
    }
  } finally {
    tf.dispose(tensor);
  }
}

function matchFaces(
  faces: DetectedFace[],
): (DetectedFace & { personName?: string })[] {
  if (confirmedPeople.length === 0) return faces;

  return faces.map((face) => {
    let bestMatch = '';
    let bestDistance = Infinity;

    for (const person of confirmedPeople) {
      for (const refEnc of person.encodings) {
        const dist = euclideanDistance(face.encoding, refEnc);
        if (dist < MATCH_THRESHOLD && dist < bestDistance) {
          bestDistance = dist;
          bestMatch = person.personName;
        }
      }
    }

    return bestMatch ? { ...face, personName: bestMatch } : face;
  });
}

function printProgress(processed: number, failed: number, facesFound: number) {
  const elapsed = Date.now() - startTime;
  const rate = elapsed > 0 ? (processed / elapsed) * 1000 : 0;
  const remaining = totalPending - processed - failed;
  const eta = rate > 0 ? remaining / rate : 0;
  const barWidth = 24;
  const pct =
    totalPending > 0 ? Math.min((processed + failed) / totalPending, 1) : 0;
  const filled = Math.round(barWidth * pct);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

  const parts = [
    `\r${bar}`,
    `  ${processed.toLocaleString()}/${totalPending.toLocaleString()}`,
    `  ${rate.toFixed(1)}/s`,
    `  faces:${facesFound}`,
  ];
  if (failed > 0) parts.push(` !${failed}`);
  if (eta > 0 && isFinite(eta)) parts.push(` ETA:${formatEta(eta)}`);
  parts.push(`  ${formatDuration(elapsed)}`);

  process.stdout.write(parts.join(''));
}

async function processPhoto(
  photo: PendingPhoto,
): Promise<DetectedFace[] | null> {
  const tmpFile = path.join(TMP_DIR, `${photo.id}.jpg`);
  try {
    await downloadFromR2(photo.s3Key, tmpFile);
    return await runDetection(tmpFile);
  } catch (err) {
    console.error(`\n  Error processing ${photo.s3Key}: ${(err as Error).message}`);
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  program
    .name('scan-local')
    .description('Scan pending photos for faces using local CPU')
    .option(
      '--batch <n>',
      'Photos per request to POST /faces/ingest (max 100)',
      parseInt,
      50,
    )
    .option(
      '--concurrency <n>',
      'Concurrent photo downloads (1-5)',
      parseInt,
      3,
    )
    .option('--dry-run', 'Do not send results, only show what would be sent')
    .option('--resume', 'Resume from scan-state.json checkpoint')
    .option('--max-photos <n>', 'Stop after processing N photos', parseInt)
    .option(
      '--take <n>',
      'Photos per page from pending endpoint',
      parseInt,
      100,
    )
    .parse(process.argv);

  const opts = program.opts();
  const batchSize = Math.min(opts.batch || 50, 100);
  const concurrency = Math.min(Math.max(opts.concurrency || 3, 1), 5);
  const maxPhotos = opts.maxPhotos || Infinity;
  const take = opts.take || 100;
  dryRun = !!opts.dryRun;
  const resume = !!opts.resume;

  apiUrl = (process.env.VAULTA_API_URL || '').replace(/\/+$/, '');
  apiKey = process.env.VAULTA_API_KEY || '';

  if (!apiUrl || !apiKey) {
    console.error(
      'Error: VAULTA_API_URL y VAULTA_API_KEY must be set in .env.local',
    );
    process.exit(1);
  }

  const r2AccountId = process.env.R2_ACCOUNT_ID;
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY;
  bucket = process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET || '';

  if (!r2AccountId || !r2AccessKey || !r2SecretKey || !bucket) {
    console.error(
      'Error: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME must be set in .env',
    );
    process.exit(1);
  }

  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: r2AccessKey,
      secretAccessKey: r2SecretKey,
    },
  });

  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  console.log(`\nVaulta Scan Local`);
  console.log(`──────────────────`);
  console.log(`API:     ${apiUrl}`);
  console.log(`Bucket:  ${bucket}`);
  console.log(
    `Mode:    ${dryRun ? 'DRY RUN (no data will be sent)' : 'NORMAL'}`,
  );

  if (resume) {
    state = loadCheckpoint();
    console.log(
      `Resume:  ${state.totalProcessed} done, ${state.failedIds.length} failed`,
    );
  }

  console.log('');
  process.stdout.write('Loading face detection models...');
  try {
    await ensureModels();
    process.stdout.write(' OK\n');
  } catch (err) {
    process.stdout.write(' FAILED\n');
    console.error(`Error loading models: ${(err as Error).message}`);
    process.exit(1);
  }

  process.stdout.write('Downloading confirmed face encodings...');
  try {
    const resp = await fetchConfirmedEncodings();
    confirmedPeople = resp.people;
    const totalEncs = confirmedPeople.reduce(
      (s, p) => s + p.encodings.length,
      0,
    );
    process.stdout.write(
      ` ${confirmedPeople.length} people, ${totalEncs} encodings\n`,
    );
  } catch (err) {
    process.stdout.write(' FAILED\n');
    console.error(`  ${(err as Error).message}. Continuing without matching.`);
    confirmedPeople = [];
  }

  console.log('');

  if (resume && state.lastCursor) {
    state.lastCursor = state.lastCursor;
  }

  let cursor: string | null = state.lastCursor;
  let processed = state.totalProcessed;
  let facesFound = state.totalFaces;
  let failedCount = state.failedIds.length;
  let morePages = true;
  startTime = Date.now();

  const limit = pLimit(concurrency);

  while (morePages) {
    let pending: { photos: PendingPhoto[]; nextCursor: string | null };

    try {
      pending = await fetchPending(take, cursor);
    } catch (err) {
      console.error(`\nError fetching pending: ${(err as Error).message}`);
      await sleep(5000);
      continue;
    }

    if (pending.photos.length === 0) {
      morePages = false;
      break;
    }

    if (totalPending === 0) {
      totalPending = resume
        ? pending.photos.length + processed + failedCount
        : pending.photos.length;
    }

    const batch: PendingPhoto[] = [];
    for (const photo of pending.photos) {
      if (state.processedIds.has(photo.id)) continue;
      batch.push(photo);
      if (processed + failedCount + batch.length >= maxPhotos) break;
    }

    if (batch.length === 0) {
      cursor = pending.nextCursor;
      if (!cursor) morePages = false;
      continue;
    }

    const results = await Promise.allSettled(
      batch.map((photo) => limit(() => processPhoto(photo))),
    );

    const pendingIngest: {
      photoId: string;
      faces: (DetectedFace & { personName?: string })[];
    }[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const photo = batch[i];

      if (r.status === 'fulfilled' && r.value) {
        const matchedFaces = matchFaces(r.value);

        if (matchedFaces.length > 0) {
          facesFound += matchedFaces.length;
          pendingIngest.push({ photoId: photo.id, faces: matchedFaces });
        } else {
          state.processedIds.add(photo.id);
          processed++;
        }
      } else {
        const errMsg =
          r.status === 'rejected'
            ? (r.reason as Error)?.message || 'unknown'
            : 'null result';
        state.failedIds.push({ photoId: photo.id, error: errMsg });
        failedCount++;
      }
    }

    if (!dryRun && pendingIngest.length > 0) {
      const chunkSize = batchSize;
      for (let i = 0; i < pendingIngest.length; i += chunkSize) {
        const chunk = pendingIngest.slice(i, i + chunkSize);
        try {
          await sendResults(chunk);
          for (const item of chunk) {
            state.processedIds.add(item.photoId);
            processed++;
          }
        } catch (err) {
          console.error(
            `\nError sending batch: ${(err as Error).message}. Retrying...`,
          );
          await sleep(2000);
          try {
            await sendResults(chunk);
            for (const item of chunk) {
              state.processedIds.add(item.photoId);
              processed++;
            }
          } catch (err2) {
            console.error(
              `\nPersistent error, skipping batch: ${(err2 as Error).message}`,
            );
            for (const item of chunk) {
              state.failedIds.push({
                photoId: item.photoId,
                error: 'ingest_failed after retry',
              });
              failedCount++;
            }
          }
        }
      }
    } else if (dryRun && pendingIngest.length > 0) {
      for (const item of pendingIngest) {
        state.processedIds.add(item.photoId);
        processed++;
      }
      const totalFaces = pendingIngest.reduce((s, r) => s + r.faces.length, 0);
      console.log(
        `\n[Dry-run] Batch ready: ${pendingIngest.length} photos, ${totalFaces} faces\n`,
      );
    }

    cursor = pending.nextCursor;
    state.lastCursor = cursor;
    if (!cursor) morePages = false;

    state.totalProcessed = processed;
    state.totalFaces = facesFound;

    if (processed + failedCount >= maxPhotos) {
      morePages = false;
    }

    saveCheckpoint();
    printProgress(processed, failedCount, facesFound);
  }

  const elapsed = Date.now() - startTime;
  saveCheckpoint();

  console.log('\n');
  console.log('────────────────────────────────────────');
  console.log('Summary:');
  console.log(`  Photos processed:  ${processed.toLocaleString()}`);
  console.log(`  Faces found:       ${facesFound.toLocaleString()}`);
  console.log(`  Failed:            ${failedCount.toLocaleString()}`);
  console.log(`  Total time:        ${formatDuration(elapsed)}`);

  if (confirmedPeople.length > 0) {
    console.log(`  Local matching:    yes (${confirmedPeople.length} people)`);
  }
  if (dryRun) {
    console.log('  Mode:              DRY RUN');
  }
  console.log(`  Checkpoint:        ${CHECKPOINT_FILE}`);
  console.log('');
}

process.on('SIGINT', () => {
  console.log('\n\nInterrupted. Saving checkpoint...');
  saveCheckpoint();
  console.log('Checkpoint saved. Use --resume to continue.');
  process.exit(0);
});

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  saveCheckpoint();
  process.exit(1);
});
