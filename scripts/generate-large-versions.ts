import { resolve } from 'path';
import { config } from 'dotenv';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import cliProgress from 'cli-progress';
import sharp from 'sharp';
import { LARGE_RESIZE, LARGE_QUALITY } from '../src/common/constants';

config({ path: resolve(__dirname, '..', '.env') });

const r2AccountId = process.env.R2_ACCOUNT_ID;
const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY;
const r2Bucket = process.env.R2_BUCKET_NAME;

const CONCURRENCY = 3;

const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0',
  10,
);

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('Buscando fotos sin large version...');
  let query = `SELECT id, "s3Key", filename FROM "Photo"
     WHERE "mimeType" NOT LIKE 'video/%' AND "largeS3Key" IS NULL
     ORDER BY "createdAt" DESC`;
  const params: any[] = [];
  if (LIMIT > 0) {
    query += ` LIMIT $1`;
    params.push(LIMIT);
  }
  const photos = await pool.query(query, params);
  console.log(`  Fotos sin large: ${photos.rows.length}`);
  if (LIMIT > 0) console.log(`  Limit solicitado: ${LIMIT}`);

  if (photos.rows.length === 0) {
    console.log('No hay fotos pendientes.');
    await pool.end();
    return;
  }

  const estimatedGb = ((photos.rows.length * 4.5) / 1024).toFixed(1);
  console.log(
    `  Descarga estimada: ~${estimatedGb} GB (${photos.rows.length} originales de ~4.5 MB c/u)`,
  );
  console.log();

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: r2AccessKey!, secretAccessKey: r2SecretKey! },
    requestHandler: { requestTimeout: 600_000 },
  });

  const startTime = Date.now();
  let totalDownloaded = 0;
  let totalUploaded = 0;

  const progress = new cliProgress.SingleBar({
    format:
      '[{bar}] {percentage}% | {value}/{total} | OK: {ok} FAIL: {fail} | ↓{down} ↑{up} | {eta_formatted} | {file}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    etaBuffer: 30,
  });
  progress.start(photos.rows.length, 0, {
    ok: 0,
    fail: 0,
    down: '0 MB',
    up: '0 MB',
    eta_formatted: '--',
    file: '',
  });

  let ok = 0;
  let fail = 0;

  async function processPhoto(row: {
    id: string;
    s3Key: string;
    filename: string;
  }) {
    const largeKey = row.s3Key.replace('uploads/', 'large/');
    progress.update({ file: `→ ${row.filename.slice(0, 40)}` });
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: r2Bucket!, Key: row.s3Key }),
      );
      const buffer = Buffer.from(await obj.Body!.transformToByteArray());
      totalDownloaded += buffer.length;

      const largeBuffer = await sharp(buffer)
        .resize(LARGE_RESIZE, LARGE_RESIZE, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: LARGE_QUALITY })
        .toBuffer();
      totalUploaded += largeBuffer.length;

      await s3.send(
        new PutObjectCommand({
          Bucket: r2Bucket!,
          Key: largeKey,
          Body: largeBuffer,
          ContentType: 'image/jpeg',
        }),
      );

      await pool.query('UPDATE "Photo" SET "largeS3Key" = $1 WHERE id = $2', [
        largeKey,
        row.id,
      ]);

      const savedPct = ((1 - largeBuffer.length / buffer.length) * 100).toFixed(
        0,
      );
      ok++;
      progress.update({
        ok,
        fail,
        down: mb(totalDownloaded),
        up: mb(totalUploaded),
        file: `${row.filename.slice(0, 30)} (${mb(buffer.length)}→${mb(largeBuffer.length)}, -${savedPct}%)`,
      });
    } catch (err: any) {
      fail++;
      progress.update({
        ok,
        fail,
        down: mb(totalDownloaded),
        up: mb(totalUploaded),
        file: `ERROR: ${row.filename.slice(0, 35)}`,
      });
      console.error(`  Error en ${row.filename}: ${err.message}`);
    } finally {
      progress.increment({
        ok,
        fail,
        down: mb(totalDownloaded),
        up: mb(totalUploaded),
      });
    }
  }

  for (let i = 0; i < photos.rows.length; i += CONCURRENCY) {
    const chunk = photos.rows.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(processPhoto));
  }

  progress.stop();

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nResumen:`);
  console.log(`  OK:     ${ok}`);
  console.log(`  FAIL:   ${fail}`);
  console.log(`  Tiempo: ${elapsed} min`);
  console.log(`  Bajado: ${mb(totalDownloaded)}`);
  console.log(`  Subido: ${mb(totalUploaded)}`);
  console.log(
    `  Ahorro: ${((1 - totalUploaded / totalDownloaded) * 100).toFixed(0)}%`,
  );

  await pool.end();
  s3.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
