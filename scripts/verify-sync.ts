import { config } from 'dotenv'
import { resolve } from 'path'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { Pool } from 'pg'

config({ path: resolve(__dirname, '..', '.env') })

const USER_ID = '909e2191-3271-4627-95d1-3f53b80be3e6'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  
  const bucket = process.env.R2_BUCKET_NAME!
  
  console.log('=== VERIFICACIÓN RÁPIDA ===\n')
  
  // 1. Listar TODOS los objetos de R2 por prefijos (batch, no individual)
  async function listAllKeys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let continuationToken: string | undefined
    let pages = 0
    
    do {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }))
      
      for (const obj of result.Contents || []) {
        if (obj.Key) keys.push(obj.Key)
      }
      
      pages++
      continuationToken = result.NextContinuationToken
    } while (continuationToken)
    
    console.log(`  ${prefix}: ${keys.length} objetos (${pages} páginas)`)
    return keys
  }
  
  const [fotosKeys, thumbsFotosKeys, videosKeys, thumbsVideosKeys] = await Promise.all([
    listAllKeys(`fotos/${USER_ID}/`),
    listAllKeys(`thumbs/${USER_ID}/fotos/`),
    listAllKeys(`videos/${USER_ID}/`),
    listAllKeys(`thumbs/${USER_ID}/videos/`),
  ])
  
  const r2FotosCount = fotosKeys.length
  const r2ThumbsFotosCount = thumbsFotosKeys.length
  const r2VideosCount = videosKeys.length
  const r2ThumbsVideosCount = thumbsVideosKeys.length
  
  // 2. Contar DB
  const dbFotosResult = await pool.query('SELECT COUNT(*) FROM "Photo" WHERE "userId" = $1 AND "largeS3Key" IS NOT NULL', [USER_ID])
  const dbVideosResult = await pool.query('SELECT COUNT(*) FROM "Photo" WHERE "userId" = $1 AND "largeS3Key" IS NULL', [USER_ID])
  const dbFotos = parseInt(dbFotosResult.rows[0].count)
  const dbVideos = parseInt(dbVideosResult.rows[0].count)
  
  // 3. Verificar que cada foto en DB tenga su thumb en R2 (muestra, no todas)
  console.log('\n--- Verificando thumbs de fotos (muestra) ---')
  const dbPhotoThumbs = await pool.query(
    'SELECT "thumbS3Key" FROM "Photo" WHERE "userId" = $1 AND "largeS3Key" IS NOT NULL AND "thumbS3Key" IS NOT NULL LIMIT 5',
    [USER_ID]
  )
  let sampleThumbsOk = 0
  for (const row of dbPhotoThumbs.rows) {
    const exists = thumbsFotosKeys.includes(row.thumbS3Key)
    if (exists) sampleThumbsOk++
    console.log(`  ${exists ? '✅' : '❌'} ${row.thumbS3Key.split('/').pop()}`)
  }
  
  // 4. Verificar huérfanos en R2 (objetos sin registro en DB)
  console.log('\n--- Verificando huérfanos en R2 ---')
  
  const dbKeys = new Set<string>()
  const dbAll = await pool.query('SELECT "s3Key", "thumbS3Key", "largeS3Key" FROM "Photo" WHERE "userId" = $1', [USER_ID])
  for (const row of dbAll.rows) {
    dbKeys.add(row.s3Key)
    if (row.thumbS3Key) dbKeys.add(row.thumbS3Key)
    if (row.largeS3Key) dbKeys.add(row.largeS3Key)
  }
  
  const orphanFotos = fotosKeys.filter(k => !dbKeys.has(k))
  const orphanThumbsFotos = thumbsFotosKeys.filter(k => !dbKeys.has(k))
  const orphanVideos = videosKeys.filter(k => !dbKeys.has(k))
  const orphanThumbsVideos = thumbsVideosKeys.filter(k => !dbKeys.has(k))
  
  console.log(`  Huérfanos fotos/: ${orphanFotos.length}`)
  console.log(`  Huérfanos thumbs/fotos/: ${orphanThumbsFotos.length}`)
  console.log(`  Huérfanos videos/: ${orphanVideos.length}`)
  console.log(`  Huérfanos thumbs/videos/: ${orphanThumbsVideos.length}`)
  
  // 5. Resumen
  console.log('\n' + '='.repeat(50))
  console.log('RESUMEN')
  console.log('='.repeat(50))
  console.log('Fotos:')
  console.log(`  DB: ${dbFotos}`)
  console.log(`  R2 fotos/: ${r2FotosCount}`)
  console.log(`  R2 thumbs/fotos/: ${r2ThumbsFotosCount}`)
  console.log(`  Huérfanos: ${orphanFotos.length + orphanThumbsFotos.length}`)
  console.log('Videos:')
  console.log(`  DB: ${dbVideos}`)
  console.log(`  R2 videos/: ${r2VideosCount}`)
  console.log(`  R2 thumbs/videos/: ${r2ThumbsVideosCount}`)
  console.log(`  Huérfanos: ${orphanVideos.length + orphanThumbsVideos.length}`)
  
  const allOk = dbFotos === r2FotosCount && 
                dbVideos === r2VideosCount &&
                orphanFotos.length === 0 && 
                orphanThumbsFotos.length === 0 &&
                orphanVideos.length === 0 &&
                orphanThumbsVideos.length === 0
  
  if (allOk) {
    console.log('\n✅ TODO SINCRONIZADO')
  } else {
    console.log('\n⚠️ HAY DISCREPANCIAS')
  }
  
  await pool.end()
  s3.destroy()
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
