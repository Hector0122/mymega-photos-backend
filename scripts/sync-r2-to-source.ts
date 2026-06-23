import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, extname, resolve, basename } from 'path'
import { config } from 'dotenv'
import { resolve as pathResolve } from 'path'
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import cliProgress from 'cli-progress'
import * as exifr from 'exifr'

config({ path: pathResolve(__dirname, '..', '.env') })

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
])
const EXIF_DATE_TAGS = ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'ModifyDate']
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'])

function scanFiles(dir: string): string[] {
  const results: string[] = []
  const queue = [resolve(dir)]
  while (queue.length > 0) {
    const current = queue.pop()!
    let entries: string[]
    try { entries = readdirSync(current) } catch { continue }
    for (const entry of entries) {
      const fullPath = join(current, entry)
      let stat: ReturnType<typeof statSync>
      try { stat = statSync(fullPath) } catch { continue }
      if (stat.isDirectory()) queue.push(fullPath)
      else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase()
        if (ALLOWED_EXTENSIONS.has(ext)) results.push(fullPath)
      }
    }
  }
  return results
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

async function getUserId(dbUrl: string, email: string): Promise<string> {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: dbUrl })
  try {
    const result = await pool.query('SELECT id FROM "User" WHERE email = $1', [email])
    if (result.rows.length === 0) throw new Error('Usuario no encontrado')
    return result.rows[0].id
  } finally {
    await pool.end()
  }
}

async function getDbPhotos(dbUrl: string, userId: string) {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: dbUrl })
  try {
    const result = await pool.query('SELECT id, "s3Key", "thumbS3Key" FROM "Photo" WHERE "userId" = $1', [userId])
    return result.rows
  } finally {
    await pool.end()
  }
}

async function deleteDbPhotos(dbUrl: string, ids: string[]) {
  if (ids.length === 0) return 0
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: dbUrl })
  try {
    const result = await pool.query('DELETE FROM "Photo" WHERE id = ANY($1::uuid[])', [ids])
    return result.rowCount || 0
  } finally {
    await pool.end()
  }
}

async function main() {
  const sourceDir = process.argv[2]
  if (!sourceDir) { console.error('Uso: npx tsx scripts/sync-r2-to-source.ts <source-dir> [--execute]'); process.exit(1) }
  const execute = process.argv.includes('--execute')

  const r2AccountId = process.env.R2_ACCOUNT_ID
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY
  const r2Bucket = process.env.R2_BUCKET_NAME
  const dbUrl = process.env.DATABASE_URL
  const email = process.env.BULK_EMAIL

  if (!r2AccountId || !r2AccessKey || !r2SecretKey || !r2Bucket || !dbUrl || !email) {
    console.error('Error: Faltan variables de entorno (R2_*, DATABASE_URL, BULK_EMAIL)')
    process.exit(1)
  }

  const userId = await getUserId(dbUrl, email)
  console.log(`Usuario: ${email} (${userId})`)

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: r2AccessKey, secretAccessKey: r2SecretKey },
  })

  console.log(`\n📂 Escaneando carpeta fuente ${sourceDir}...`)
  const allFiles = scanFiles(sourceDir)
  console.log(`Archivos encontrados: ${allFiles.length}`)

  const expectedUploadKeys = new Set<string>()
  const expectedThumbKeys = new Set<string>()
  const failedToRead: string[] = []

  const bar = new cliProgress.SingleBar({
    format: 'Calculando keys: [{bar}] {percentage}% | {value}/{total}',
    barCompleteChar: '█', barIncompleteChar: '░',
  })
  bar.start(allFiles.length, 0)

  for (const filePath of allFiles) {
    try {
      const buffer = readFileSync(filePath)
      const photoDate = await getPhotoDate(filePath, buffer)
      const timestamp = photoDate.getTime()
      const filename = basename(filePath).replace(/[ ()]/g, '_')
      const uploadKey = `uploads/${userId}/${timestamp}-${filename}`
      expectedUploadKeys.add(uploadKey)
      if (IMAGE_EXTS.has(extname(filePath).toLowerCase())) {
        expectedThumbKeys.add(`thumbnails/${userId}/${timestamp}-${filename}`)
      }
    } catch (e) {
      failedToRead.push(filePath)
    }
    bar.increment()
  }
  bar.stop()

  console.log(`Keys esperadas en uploads: ${expectedUploadKeys.size}`)
  console.log(`Keys esperadas en thumbnails: ${expectedThumbKeys.size}`)
  if (failedToRead.length) console.warn(`No se pudieron leer ${failedToRead.length} archivos`)

  async function listR2Keys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let token: string | undefined
    while (true) {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: r2Bucket, Prefix: prefix, ContinuationToken: token }))
      if (res.Contents) for (const obj of res.Contents) if (obj.Key) keys.push(obj.Key)
      if (!res.IsTruncated) break
      token = res.NextContinuationToken
    }
    return keys
  }

  console.log('\n☁️ Listando R2 uploads...')
  const uploadKeys = await listR2Keys(`uploads/${userId}/`)
  const uploadsToDelete = uploadKeys.filter(k => !expectedUploadKeys.has(k))
  console.log(`  Total uploads: ${uploadKeys.length}`)
  console.log(`  A borrar:      ${uploadsToDelete.length}`)

  console.log('\n☁️ Listando R2 thumbnails...')
  const thumbKeys = await listR2Keys(`thumbnails/${userId}/`)
  const thumbsToDelete = thumbKeys.filter(k => !expectedThumbKeys.has(k))
  console.log(`  Total thumbnails: ${thumbKeys.length}`)
  console.log(`  A borrar:         ${thumbsToDelete.length}`)

  const dbRows = await getDbPhotos(dbUrl, userId)
  const dbIdsToDelete: string[] = []
  for (const row of dbRows) {
    if (!expectedUploadKeys.has(row.s3Key)) dbIdsToDelete.push(row.id)
  }
  console.log(`\n🗄 Registros DB: ${dbRows.length}, a borrar: ${dbIdsToDelete.length}`)

  const missingInR2 = [...expectedUploadKeys].filter(k => !uploadKeys.includes(k))
  console.log(`\n⚠️ Archivos fuente que NO están en R2: ${missingInR2.length}`)
  if (missingInR2.length > 0 && missingInR2.length <= 20) for (const k of missingInR2) console.log('  ', k)

  if (!execute) {
    console.log(`\n🔎 MODO SIMULACIÓN. No se borró nada.`)
    console.log(`Ejecuta con --execute para borrar.`)
    if (uploadsToDelete.length > 0) {
      const sample = uploadsToDelete.slice(0, 5)
      console.log('\nEjemplos de uploads a borrar:')
      for (const k of sample) console.log('  ', k)
    }
    return
  }

  console.log(`\n🗑 BORRANDO...`)

  for (const key of uploadsToDelete) {
    console.log(`  Borrando upload: ${key}`)
    await s3.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key }))
  }

  for (const key of thumbsToDelete) {
    console.log(`  Borrando thumbnail: ${key}`)
    await s3.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key }))
  }

  if (dbIdsToDelete.length > 0) {
    const deleted = await deleteDbPhotos(dbUrl, dbIdsToDelete)
    console.log(`  Borrados ${deleted} registros de DB`)
  }

  console.log('\n✅ Limpieza completada')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
