import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'
import { config } from 'dotenv'
import { resolve } from 'path'
import { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { extname, basename } from 'path'

config({ path: resolve(__dirname, '..', '.env') })

const USER_ID = process.argv.find(a => a.startsWith('--user-id='))?.split('=')[1]
const EXECUTE = process.argv.includes('--execute')

if (!USER_ID) { console.error('Error: --user-id=xxx es requerido'); process.exit(1) }

const r2PublicUrl = process.env.R2_PUBLIC_URL
const r2AccountId = process.env.R2_ACCOUNT_ID
const r2Bucket = process.env.R2_BUCKET_NAME

function decodeFilename(key: string): string {
  const match = key.match(/^uploads\/[^/]+\/\d+-(.+)$/)
  return match ? match[1] : basename(key)
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
    '.heic': 'image/heic', '.heif': 'image/heif',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
  }
  return map[ext] || 'application/octet-stream'
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'])

async function main() {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  })
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const bucket = r2Bucket!

  // 1. List all R2 upload keys for this user
  console.log('☁️  Listando R2...')
  const r2Keys = new Set<string>()
  let token: string | undefined
  while (true) {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `uploads/${USER_ID}/`,
      ContinuationToken: token,
    }))
    if (res.Contents) for (const obj of res.Contents) if (obj.Key) r2Keys.add(obj.Key)
    process.stdout.write(`\r  R2: ${r2Keys.size}`)
    if (!res.IsTruncated) break
    token = res.NextContinuationToken
  }
  console.log(`\n  Total R2: ${r2Keys.size}`)

  // 2. Query DB keys
  console.log('\n🗄️  Consultando DB...')
  const dbResult = await pool.query('SELECT id, "s3Key", "thumbS3Key" FROM "Photo" WHERE "userId" = $1', [USER_ID])
  const dbKeys = new Set(dbResult.rows.map(r => r.s3Key))
  console.log(`  Total DB: ${dbKeys.size}`)

  // 3. Find differences
  const missingInDB = [...r2Keys].filter(k => !dbKeys.has(k))
  const missingInR2 = [...dbKeys].filter(k => !r2Keys.has(k))

  console.log(`\n📊 Discrepancias:`)
  console.log(`  En R2 pero NO en DB: ${missingInDB.length}`)
  console.log(`  En DB pero NO en R2: ${missingInR2.length}`)

  if (missingInDB.length > 0) {
    console.log('\nArchivos en R2 sin registro DB:')
    for (const key of missingInDB) console.log(`  ${key}`)
  }

  if (!EXECUTE) {
    console.log('\n🔎 MODO SIMULACIÓN. Ejecuta con --execute para aplicar cambios.')
    await pool.end()
    await s3.destroy()
    return
  }

  // 4. Register missing R2 objects in DB
  if (missingInDB.length > 0) {
    console.log('\n📝 Registrando en DB...')
    let inserted = 0
    for (const key of missingInDB) {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        const ext = extname(key).toLowerCase()
        const mimeType = head.ContentType || getMimeType(ext)
        const filename = decodeFilename(key)
        const size = head.ContentLength || 0
        const lastModified = head.LastModified || new Date()
        const encodedKey = key.split('/').map(encodeURIComponent).join('/')
        const publicUrl = r2PublicUrl
          ? `${r2PublicUrl}/${encodedKey}`
          : `https://${r2AccountId}.r2.cloudflarestorage.com/${bucket}/${encodedKey}`

        let thumbS3Key: string | null = null
        if (IMAGE_EXTS.has(ext)) {
          const tKey = key.replace('uploads/', 'thumbnails/')
          try {
            await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: tKey }))
            thumbS3Key = tKey
          } catch { /* no thumbnail */ }
        }

        await pool.query(
          `INSERT INTO "Photo" ("id", "s3Key", "thumbS3Key", "url", "filename", "mimeType", "size", "createdAt", "userId")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT ("s3Key") DO NOTHING`,
          [randomUUID(), key, thumbS3Key, publicUrl, filename, mimeType, size, lastModified, USER_ID]
        )
        inserted++
        process.stdout.write(`\r  Insertados: ${inserted}/${missingInDB.length}`)
      } catch (err: any) {
        console.warn(`\n  ⚠️ Error con ${key}: ${err.message}`)
      }
    }
    console.log(`\n  Total insertados: ${inserted}`)
  }

  // 5. Delete orphan DB records
  if (missingInR2.length > 0) {
    console.log(`\n🗑️  Eliminando ${missingInR2.length} registros DB huérfanos...`)
    const result = await pool.query('DELETE FROM "Photo" WHERE "userId" = $1 AND "s3Key" = ANY($2::text[])', [USER_ID, missingInR2])
    console.log(`  Eliminados: ${result.rowCount}`)
  }

  // 6. Final count
  const finalDb = await pool.query('SELECT COUNT(*) FROM "Photo" WHERE "userId" = $1', [USER_ID])
  console.log(`\n✅ DB final: ${finalDb.rows[0].count} registros`)

  await pool.end()
  await s3.destroy()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
