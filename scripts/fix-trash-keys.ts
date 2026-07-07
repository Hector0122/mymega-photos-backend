import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'
import { config } from 'dotenv'
import { resolve } from 'path'
import { Pool } from 'pg'

config({ path: resolve(__dirname, '..', '.env') })

const USER_ID = process.argv.find(a => a.startsWith('--user-id='))?.split('=')[1]
const EXECUTE = process.argv.includes('--execute')

if (!USER_ID) { console.error('Error: --user-id=xxx es requerido'); process.exit(1) }

const r2AccountId = process.env.R2_ACCOUNT_ID
const r2Bucket = process.env.R2_BUCKET_NAME

async function main() {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const bucket = r2Bucket!

  console.log('\n🔍 Analizando fotos en papelera...')
  const trashResult = await pool.query(
    'SELECT id, "s3Key", "thumbS3Key", "largeS3Key", filename FROM "Photo" WHERE "userId" = $1 AND "deletedAt" IS NOT NULL',
    [USER_ID],
  )
  console.log(`  Fotos en papelera: ${trashResult.rows.length}`)

  let fixedUploads = 0
  let fixedThumbs = 0
  let fixedLarge = 0
  let alreadyOk = 0

  for (const photo of trashResult.rows) {
    const originalKey: string = photo.s3Key
    const thumbKey: string | null = photo.thumbS3Key
    const largeKey: string | null = photo.largeS3Key

    let newOriginal = originalKey
    let newThumb = thumbKey
    let newLarge = largeKey

    // Si la key no tiene '/', es formato plano antiguo
    const isFlat = !originalKey.includes('/')

    if (isFlat) {
      // Probar formato migrado: uploads/{key}
      const migratedOriginal = `uploads/${originalKey}`
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: migratedOriginal }))
        newOriginal = migratedOriginal
      } catch {
        // No existe en formato migrado, dejar como está
      }

      if (!thumbKey) {
        const migratedThumb = `thumbnails/${originalKey}`
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: migratedThumb }))
          newThumb = migratedThumb
        } catch {
          // No existe thumbnail migrado
        }
      }

      if (!largeKey) {
        const migratedLarge = `large/${originalKey}`
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: migratedLarge }))
          newLarge = migratedLarge
        } catch {
          // No existe large migrado
        }
      }
    }

    // Verificar si thumb actual existe (puede ser plano o migrado)
    if (newThumb && newThumb.includes('/')) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: newThumb }))
      } catch {
        // Si el thumb actual no existe, intentar derivado del original
        const derivedThumb = newOriginal.replace(/^uploads\//, 'thumbnails/')
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: derivedThumb }))
          newThumb = derivedThumb
        } catch {
          newThumb = null
        }
      }
    }

    // Verificar si large actual existe
    if (newLarge && newLarge.includes('/')) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: newLarge }))
      } catch {
        const derivedLarge = newOriginal.replace(/^uploads\//, 'large/')
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: derivedLarge }))
          newLarge = derivedLarge
        } catch {
          newLarge = null
        }
      }
    }

    const needsUpdate =
      newOriginal !== originalKey ||
      newThumb !== thumbKey ||
      newLarge !== largeKey

    if (needsUpdate) {
      if (EXECUTE) {
        await pool.query(
          'UPDATE "Photo" SET "s3Key" = $1, "thumbS3Key" = $2, "largeS3Key" = $3 WHERE id = $4',
          [newOriginal, newThumb, newLarge, photo.id],
        )
      }
      if (newOriginal !== originalKey) fixedUploads++
      if (newThumb !== thumbKey) fixedThumbs++
      if (newLarge !== largeKey) fixedLarge++
      console.log(`  🔧 ${photo.filename}: ${originalKey} → ${newOriginal}`)
    } else {
      alreadyOk++
    }
  }

  console.log(`\n📊 Resumen:`)
  console.log(`  Originals arreglados: ${fixedUploads}`)
  console.log(`  Thumbnails arreglados: ${fixedThumbs}`)
  console.log(`  Large arreglados: ${fixedLarge}`)
  console.log(`  Sin cambios: ${alreadyOk}`)

  if (!EXECUTE) {
    console.log('\n🔎 MODO SIMULACIÓN. Ejecuta con --execute para aplicar cambios.')
  } else {
    console.log('\n✅ Cambios aplicados.')
  }

  await pool.end()
  await s3.destroy()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
