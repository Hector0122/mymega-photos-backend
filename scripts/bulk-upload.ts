import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, extname, resolve, basename } from 'path';
import { config } from 'dotenv';
import { performance } from 'perf_hooks';
import cliProgress from 'cli-progress';

config({ path: resolve(__dirname, '..', '.env') });
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import * as exifr from 'exifr';
import { computePerceptualHash } from '../src/common/image-analysis';
import { THUMB_RESIZE, THUMB_QUALITY } from '../src/common/constants';

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
]);

const EXIF_DATE_TAGS = ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'ModifyDate'];
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);

type Result = {
  filepath: string;
  filename: string;
  sizeBytes: number;
  status: 'subido' | 'fallido' | 'duplicado' | 'error';
  error: string;
};

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
    '.heic': 'image/heic', '.heif': 'image/heif',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
  };
  return map[ext] || 'application/octet-stream';
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n'))
    return `"${val.replace(/"/g, '""')}"`;
  return val;
}

function scanFiles(dir: string): string[] {
  const results: string[] = [];
  const queue = [resolve(dir)];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: string[];
    try { entries = readdirSync(current); } catch { continue; }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stat: ReturnType<typeof statSync>;
      try { stat = statSync(fullPath); } catch { continue; }
      if (stat.isDirectory()) {
        queue.push(fullPath);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) results.push(fullPath);
      }
    }
  }
  return results;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function writeCsv(results: Result[], dirPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dirName = basename(resolve(dirPath));
  const csvPath = `bulk-upload_${dirName}_${timestamp}.csv`;
  let csv = 'filepath,filename,size_bytes,status,error\n';
  for (const r of results)
    csv += `${escapeCsv(r.filepath)},${escapeCsv(r.filename)},${r.sizeBytes},${r.status},${escapeCsv(r.error)}\n`;
  const uploaded = results.filter(r => r.status === 'subido').length;
  const failed = results.filter(r => r.status === 'fallido' || r.status === 'error').length;
  const duplicates = results.filter(r => r.status === 'duplicado').length;
  csv += `\n# Resumen: ${uploaded} subidos, ${failed} fallidos, ${duplicates} duplicados\n`;
  csv += `# Fecha: ${new Date().toISOString()}\n`;
  writeFileSync(csvPath, csv, 'utf-8');
  return csvPath;
}

async function getPhotoDate(filePath: string, buffer: Buffer): Promise<Date> {
  let photoDate: Date | null = null
  const exifData = await exifr.parse(buffer, EXIF_DATE_TAGS).catch(() => null)
  if (exifData) {
    for (const tag of EXIF_DATE_TAGS) {
      const d = exifData[tag]
      if (d) { photoDate = d; break }
    }
  }
  if (photoDate) {
    const y = photoDate.getFullYear()
    if (y < 1900 || y > new Date().getFullYear() + 1) photoDate = null
  }
  if (!photoDate) {
    const name = basename(filePath)
    const patterns: RegExp[] = [
      /(\d{4})-?(\d{2})-?(\d{2})/,
      /(\d{4})_(\d{2})(\d{2})/,
      /IMG[_-](\d{4})(\d{2})(\d{2})/i,
      /VID[_-](\d{4})(\d{2})(\d{2})/i,
    ]
    for (const p of patterns) {
      const m = name.match(p)
      if (m) {
        const y = parseInt(m[1], 10)
        const mo = parseInt(m[2], 10)
        const d = parseInt(m[3], 10)
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= new Date().getFullYear() + 1)
          { photoDate = new Date(y, mo - 1, d, 12, 0, 0); break }
      }
    }
  }
  if (!photoDate) photoDate = statSync(filePath).mtime
  return photoDate
}

async function main() {
  const dirPath = process.argv[2]
  if (!dirPath) {
    console.error('Uso: npm run subir-masivo -- /ruta/al/disco')
    console.error('  --no-dedup   Saltar detección de duplicados')
    process.exit(1)
  }

  const skipDedup = process.argv.includes('--no-dedup')
  const startTime = performance.now()

  const r2AccountId = process.env.R2_ACCOUNT_ID
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY
  const r2Bucket = process.env.R2_BUCKET_NAME
  const r2PublicUrl = process.env.R2_PUBLIC_URL
  if (!r2AccountId || !r2AccessKey || !r2SecretKey || !r2Bucket) {
    console.error('Error: Faltan variables de entorno R2_* (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)')
    process.exit(1)
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('Error: DATABASE_URL es requerida')
    process.exit(1)
  }

  const email = process.env.BULK_EMAIL
  if (!email) {
    console.error('Error: BULK_EMAIL es requerido (correo del usuario dueño de las fotos)')
    process.exit(1)
  }

  console.log(`📂 Escaneando ${dirPath}...`)
  const allFiles = scanFiles(dirPath)
  const totalBytes = allFiles.reduce((sum, f) => {
    try { return sum + statSync(f).size } catch { return sum }
  }, 0)
  console.log(`Encontrados ${allFiles.length} archivos (${formatBytes(totalBytes)})`)

  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: dbUrl })

  const userResult = await pool.query('SELECT id FROM "User" WHERE email = $1', [email])
  if (userResult.rows.length === 0) {
    console.error(`Error: No se encontró usuario con email ${email}`)
    await pool.end()
    process.exit(1)
  }
  const userId = userResult.rows[0].id
  console.log(`Usuario: ${email} (${userId})`)

  const r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`
  const s3 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: r2AccessKey, secretAccessKey: r2SecretKey },
    requestHandler: { requestTimeout: 1_800_000 },
  })

  const results: Result[] = []

  if (!skipDedup) {
    console.log('🔍 Cargando hashes existentes para detección de duplicados...')
    const hashResult = await pool.query(
      'SELECT "perceptualHash" FROM "Photo" WHERE "deletedAt" IS NULL AND "perceptualHash" IS NOT NULL'
    )
    const hashSet = new Set(hashResult.rows.map(r => r.perceptualHash))
    console.log(`Biblioteca: ${hashSet.size} hashes únicos`)

    console.log('🔎 Calculando perceptual hash de cada archivo...')
    const dedupBar = new cliProgress.SingleBar({
      format: 'Hash: [{bar}] {percentage}% | {value}/{total} | {current}',
      barCompleteChar: '█', barIncompleteChar: '░', clearOnComplete: true,
    })
    dedupBar.start(allFiles.length, 0, { current: '' })

    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i]
      dedupBar.update(i, { current: basename(file) })
      const ext = extname(file).toLowerCase()
      if (VIDEO_EXTS.has(ext)) continue
      try {
        const buffer = readFileSync(file)
        const hash = await computePerceptualHash(buffer)
        if (hash && hashSet.has(hash)) {
          results.push({ filepath: file, filename: basename(file), sizeBytes: statSync(file).size, status: 'duplicado', error: '' })
        }
      } catch { /* continue */ }
    }
    dedupBar.stop()
    console.log(`Duplicados: ${results.filter(r => r.status === 'duplicado').length}`)
  }

  let toUpload = skipDedup
    ? allFiles
    : allFiles.filter(f => !results.some(r => r.filepath === f))

  if (toUpload.length === 0) {
    const csvPath = writeCsv(results, dirPath)
    console.log(`✅ No hay archivos nuevos para subir. CSV: ${csvPath}`)
    await pool.end()
    return
  }

  console.log(`\n📤 Subiendo ${toUpload.length} archivo(s) directamente a R2...`)

  const uploadBar = new cliProgress.SingleBar({
    format: 'Subida: [{bar}] {percentage}% | {value}/{total} archivos | {current}',
    barCompleteChar: '█', barIncompleteChar: '░',
  })
  uploadBar.start(toUpload.length, 0, { current: '' })

  const CONCURRENCY = 8
  let uploadedCount = 0

  async function sendWithRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn()
      } catch (err: any) {
        if (attempt === retries - 1) throw err
        console.warn(`  ⚠️ Intento ${attempt + 1}/${retries} falló, reintentando en ${delayMs}ms...`)
        await new Promise(r => setTimeout(r, delayMs))
      }
    }
    throw new Error('unreachable')
  }

  async function uploadOne(filePath: string): Promise<Result> {
    const filename = basename(filePath).replace(/[ ()]/g, '_')
    const ext = extname(filePath).toLowerCase()
    const mimeType = getMimeType(ext)
    const isVideo = VIDEO_EXTS.has(ext)
    const isImage = IMAGE_EXTS.has(ext)

    try {
      const buffer = readFileSync(filePath)
      const photoDate = await getPhotoDate(filePath, buffer)
      const timestamp = photoDate.getTime()
      const fullKey = `uploads/${userId}/${timestamp}-${filename}`
      const encodedKey = fullKey.split('/').map(encodeURIComponent).join('/')
      const publicUrl = r2PublicUrl
        ? `${r2PublicUrl}/${encodedKey}`
        : `${r2Endpoint}/${r2Bucket}/${encodedKey}`

      let thumbS3Key: string | null = null
      let perceptualHash: string | null = null
      let existsInR2 = false

      try {
        await s3.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: fullKey }))
        existsInR2 = true
      } catch { /* not in R2 yet */ }

      if (!existsInR2) {
        await sendWithRetry(() => s3.send(new PutObjectCommand({
          Bucket: r2Bucket, Key: fullKey, Body: buffer, ContentType: mimeType,
        })))

        if (isImage) {
          try {
            const thumbKey = `thumbnails/${userId}/${timestamp}-${filename}`
            const thumbBuffer = await sharp(buffer)
              .resize(THUMB_RESIZE)
              .jpeg({ quality: THUMB_QUALITY })
              .toBuffer()
            await s3.send(new PutObjectCommand({
              Bucket: r2Bucket, Key: thumbKey, Body: thumbBuffer, ContentType: 'image/jpeg',
            }))
            thumbS3Key = thumbKey
          } catch {}
          try {
            perceptualHash = await computePerceptualHash(buffer)
          } catch {}
        }
      }

      await pool.query(
        `INSERT INTO "Photo" ("id", "s3Key", "thumbS3Key", "url", "filename", "mimeType", "size", "perceptualHash", "createdAt", "userId")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ("s3Key") DO NOTHING`,
        [randomUUID(), fullKey, thumbS3Key, publicUrl, filename, mimeType, buffer.length, perceptualHash, photoDate, userId]
      )

      return { filepath: filePath, filename, sizeBytes: buffer.length, status: existsInR2 ? 'subido' : 'subido', error: '' }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return { filepath: filePath, filename, sizeBytes: statSync(filePath).size, status: 'fallido', error: errMsg }
    }
  }

  for (let i = 0; i < toUpload.length; i += CONCURRENCY) {
    const chunk = toUpload.slice(i, i + CONCURRENCY)
    const chunkResults = await Promise.allSettled(chunk.map(uploadOne))
    for (const r of chunkResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value)
      } else {
        results.push({ filepath: '', filename: '', sizeBytes: 0, status: 'error', error: r.reason?.message || 'Unknown' })
      }
    }
    uploadedCount += chunk.length
    uploadBar.update(uploadedCount, { current: '' })
  }

  uploadBar.stop()
  await pool.end()

  const uploaded = results.filter(r => r.status === 'subido').length
  const failed = results.filter(r => r.status === 'fallido' || r.status === 'error').length
  const duplicates = results.filter(r => r.status === 'duplicado').length
  const uploadedBytes = results.filter(r => r.status === 'subido').reduce((s, r) => s + r.sizeBytes, 0)

  const csvPath = writeCsv(results, dirPath)
  const elapsed = ((performance.now() - startTime) / 1000 / 60).toFixed(1)
  console.log(`\n${'='.repeat(40)}`)
  console.log(`📊  REPORTE FINAL`)
  console.log(`${'='.repeat(40)}`)
  console.log(`  Subidos:     ${uploaded}`)
  console.log(`  Fallidos:    ${failed}`)
  console.log(`  Duplicados:  ${duplicates}`)
  console.log(`  Total datos: ${formatBytes(uploadedBytes)}`)
  console.log(`  Tiempo:      ${elapsed} min`)
  console.log(`  CSV:         ${csvPath}`)
  console.log(`${'='.repeat(40)}`)
}

main().catch(err => {
  console.error('Error fatal:', err.message)
  process.exit(1)
})
