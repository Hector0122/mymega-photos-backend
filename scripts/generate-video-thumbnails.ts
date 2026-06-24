import { readFileSync, mkdtempSync, unlinkSync, rmSync, existsSync } from 'fs'
import { join, resolve, basename as pathBasename, dirname as pathDirname } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { config } from 'dotenv'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Pool } from 'pg'
import cliProgress from 'cli-progress'
import { THUMB_RESIZE, THUMB_QUALITY } from '../src/common/constants'

config({ path: resolve(__dirname, '..', '.env') })

const USER_ID = process.argv.find(a => a.startsWith('--user-id='))?.split('=')[1]
if (!USER_ID) { console.error('Error: --user-id=xxx es requerido'); process.exit(1) }

const r2AccountId = process.env.R2_ACCOUNT_ID
const r2AccessKey = process.env.R2_ACCESS_KEY_ID
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY
const r2Bucket = process.env.R2_BUCKET_NAME
const r2PublicUrl = process.env.R2_PUBLIC_URL

const CONCURRENCY = 10

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  console.log('🔍 Buscando videos sin thumbnail en DB...')
  const videos = await pool.query(
    `SELECT id, "s3Key", filename FROM "Photo"
     WHERE "userId" = $1 AND "mimeType" LIKE 'video/%' AND "thumbS3Key" IS NULL
     ORDER BY "createdAt" DESC`,
    [USER_ID]
  )
  console.log(`  Videos sin thumbnail: ${videos.rows.length}`)

  if (videos.rows.length === 0) {
    console.log('✅ No hay videos pendientes.')
    await pool.end()
    return
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: r2AccessKey!, secretAccessKey: r2SecretKey! },
    requestHandler: { requestTimeout: 600_000 },
  })

  // Try to find ffmpeg
  let ffmpeg: any
  try {
    ffmpeg = (await import('fluent-ffmpeg')).default
    let ffmpegPath: string | null = null
    try {
      const staticPath = (await import('ffmpeg-static')).default
      if (staticPath && existsSync(staticPath)) ffmpegPath = staticPath
    } catch { /* fallback */ }
    if (!ffmpegPath) {
      const { execSync } = await import('child_process')
      try {
        ffmpegPath = execSync('which ffmpeg', { encoding: 'utf8' }).trim()
      } catch { /* not found */ }
    }
    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath)
      console.log(`  ffmpeg: ${ffmpegPath}`)
    } else {
      console.error('  ffmpeg no encontrado')
      await pool.end()
      await s3.destroy()
      process.exit(1)
    }
  } catch (e) {
    console.error('  Error cargando ffmpeg:', (e as Error).message)
    await pool.end()
    await s3.destroy()
    process.exit(1)
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'vaulta-thumbs-'))

  const progress = new cliProgress.SingleBar({
    format: 'Thumbnails: [{bar}] {percentage}% | {value}/{total} | OK: {ok} | FAIL: {fail}',
    barCompleteChar: '█', barIncompleteChar: '░',
  })
  progress.start(videos.rows.length, 0, { ok: 0, fail: 0 })

  let ok = 0
  let fail = 0

  async function processVideo(row: { id: string; s3Key: string; filename: string }) {
    const thumbPath = join(tempDir, randomUUID() + '-thumb.jpg')
    const thumbKey = row.s3Key.replace('uploads/', 'thumbnails/').replace(/\.[^.]+$/, '.jpg')
    const encodedKey = thumbKey.split('/').map(encodeURIComponent).join('/')
    const thumbUrl = r2PublicUrl
      ? `${r2PublicUrl}/${encodedKey}`
      : `https://${r2AccountId}.r2.cloudflarestorage.com/${r2Bucket}/${encodedKey}`

    try {
      const presignedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: r2Bucket!, Key: row.s3Key }),
        { expiresIn: 7200 },
      )

      await new Promise<void>((resolve_, reject) => {
        ffmpeg(presignedUrl)
          .seekInput(1)
          .on('end', () => resolve_())
          .on('error', reject)
          .screenshots({
            count: 1,
            filename: pathBasename(thumbPath),
            folder: pathDirname(thumbPath),
            size: `${THUMB_RESIZE}x?`,
          })
      })

      const thumbBuf = readFileSync(thumbPath)
      await s3.send(new PutObjectCommand({
        Bucket: r2Bucket!, Key: thumbKey, Body: thumbBuf, ContentType: 'image/jpeg',
      }))

      await pool.query(
        'UPDATE "Photo" SET "thumbS3Key" = $1, "url" = $2 WHERE id = $3',
        [thumbKey, thumbUrl + '?v=' + Date.now(), row.id]
      )

      ok++
    } catch (err: any) {
      fail++
      if (fail <= 5) console.warn(`\n  ⚠️ Error: ${row.filename} — ${err.message}`)
    } finally {
      try { unlinkSync(thumbPath) } catch { /* ignore */ }
      progress.increment({ ok, fail })
    }
  }

  for (let i = 0; i < videos.rows.length; i += CONCURRENCY) {
    const chunk = videos.rows.slice(i, i + CONCURRENCY)
    await Promise.all(chunk.map(processVideo))
  }

  progress.stop()

  // Cleanup temp dir
  try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }

  console.log(`\n✅ Hecho: ${ok} thumbnails generados, ${fail} fallidos`)

  await pool.end()
  await s3.destroy()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
