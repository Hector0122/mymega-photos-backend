import { readdirSync, statSync } from 'fs'
import { join, extname, resolve } from 'path'
import { config } from 'dotenv'
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'
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
  
  console.log('=== VERIFICACIÓN DE SINCRONIZACIÓN ===\n')
  
  // 1. Contar local
  function countLocal(dir: string): number {
    let count = 0
    const queue = [dir]
    while (queue.length > 0) {
      const current = queue.pop()!
      for (const entry of readdirSync(current)) {
        const fullPath = join(current, entry)
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          queue.push(fullPath)
        } else {
          const ext = extname(entry).toLowerCase()
          if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) {
            count++
          }
        }
      }
    }
    return count
  }
  
  const localPhotos = countLocal('/mnt/c/Users/Hector/Pictures/Respaldo/fotos')
  const localVideos = countLocal('/mnt/c/Users/Hector/Pictures/Respaldo/videos')
  console.log('LOCAL:')
  console.log('  Fotos:', localPhotos)
  console.log('  Videos:', localVideos)
  console.log('  Total:', localPhotos + localVideos)
  
  // 2. Contar DB
  const dbPhotosResult = await pool.query('SELECT COUNT(*) FROM "Photo" WHERE "userId" = $1 AND "largeS3Key" IS NOT NULL', [USER_ID])
  const dbVideosResult = await pool.query('SELECT COUNT(*) FROM "Photo" WHERE "userId" = $1 AND "largeS3Key" IS NULL', [USER_ID])
  const dbPhotos = parseInt(dbPhotosResult.rows[0].count)
  const dbVideos = parseInt(dbVideosResult.rows[0].count)
  console.log('\nDB:')
  console.log('  Fotos:', dbPhotos)
  console.log('  Videos:', dbVideos)
  console.log('  Total:', dbPhotos + dbVideos)
  
  // 3. Verificar que cada foto en DB tenga sus objetos en R2
  console.log('\nVerificando objetos R2 para fotos...')
  const photoRows = await pool.query(
    'SELECT id, "s3Key", "thumbS3Key", filename FROM "Photo" WHERE "userId" = $1 AND "largeS3Key" IS NOT NULL',
    [USER_ID]
  )
  
  let missingLarge = 0
  let missingThumb = 0
  let checked = 0
  
  for (const photo of photoRows.rows) {
    checked++
    if (checked % 500 === 0) process.stdout.write(`\r  ${checked}/${photoRows.rows.length}`)
    
    // Verificar large
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: photo.s3Key }))
    } catch {
      missingLarge++
      if (missingLarge <= 5) console.log(`\n  ❌ Falta large: ${photo.s3Key}`)
    }
    
    // Verificar thumb
    if (photo.thumbS3Key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: photo.thumbS3Key }))
      } catch {
        missingThumb++
        if (missingThumb <= 5) console.log(`\n  ❌ Falta thumb: ${photo.thumbS3Key}`)
      }
    }
  }
  
  console.log(`\r  ✅ Fotos verificadas: ${checked}`)
  console.log(`  Large faltantes: ${missingLarge}`)
  console.log(`  Thumbs faltantes: ${missingThumb}`)
  
  // 4. Verificar videos
  console.log('\nVerificando objetos R2 para videos...')
  const videoRows = await pool.query(
    'SELECT id, "s3Key", filename FROM "Photo" WHERE "userId" = $1 AND "largeS3Key" IS NULL',
    [USER_ID]
  )
  
  let missingVideo = 0
  checked = 0
  
  for (const video of videoRows.rows) {
    checked++
    if (checked % 100 === 0) process.stdout.write(`\r  ${checked}/${videoRows.rows.length}`)
    
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: video.s3Key }))
    } catch {
      missingVideo++
      if (missingVideo <= 5) console.log(`\n  ❌ Falta video: ${video.s3Key}`)
    }
  }
  
  console.log(`\r  ✅ Videos verificados: ${checked}`)
  console.log(`  Videos faltantes: ${missingVideo}`)
  
  // 5. Verificar huérfanos en R2 (objetos sin registro en DB)
  console.log('\nBuscando huérfanos en R2...')
  
  async function listOrphans(prefix: string): Promise<string[]> {
    const orphans: string[] = []
    let continuationToken: string | undefined
    
    do {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }))
      
      for (const obj of result.Contents || []) {
        if (!obj.Key) continue
        const dbResult = await pool.query(
          'SELECT 1 FROM "Photo" WHERE "s3Key" = $1 OR "thumbS3Key" = $1 OR "largeS3Key" = $1 LIMIT 1',
          [obj.Key]
        )
        if (dbResult.rows.length === 0) {
          orphans.push(obj.Key)
        }
      }
      
      continuationToken = result.NextContinuationToken
    } while (continuationToken)
    
    return orphans
  }
  
  // Solo verificar muestras de cada prefijo para no tardar mucho
  const fotoOrphans = await listOrphans('fotos/' + USER_ID + '/')
  const thumbOrphans = await listOrphans('thumbs/' + USER_ID + '/fotos/')
  const videoOrphans = await listOrphans('videos/' + USER_ID + '/')
  
  console.log('  Huérfanos en fotos/:', fotoOrphans.length)
  console.log('  Huérfanos en thumbs/fotos/:', thumbOrphans.length)
  console.log('  Huérfanos en videos/:', videoOrphans.length)
  
  if (fotoOrphans.length > 0 && fotoOrphans.length <= 10) {
    console.log('  Ejemplos:', fotoOrphans.slice(0, 5))
  }
  if (thumbOrphans.length > 0 && thumbOrphans.length <= 10) {
    console.log('  Ejemplos:', thumbOrphans.slice(0, 5))
  }
  if (videoOrphans.length > 0 && videoOrphans.length <= 10) {
    console.log('  Ejemplos:', videoOrphans.slice(0, 5))
  }
  
  // Resumen
  console.log('\n' + '='.repeat(50))
  console.log('RESUMEN')
  console.log('='.repeat(50))
  console.log('Fotos:')
  console.log('  Local:', localPhotos)
  console.log('  DB:', dbPhotos)
  console.log('  R2 faltantes (large):', missingLarge)
  console.log('  R2 faltantes (thumb):', missingThumb)
  console.log('  R2 huérfanos:', fotoOrphans.length)
  console.log('Videos:')
  console.log('  Local:', localVideos)
  console.log('  DB:', dbVideos)
  console.log('  R2 faltantes:', missingVideo)
  console.log('  R2 huérfanos:', videoOrphans.length)
  
  const allOk = missingLarge === 0 && missingThumb === 0 && missingVideo === 0 && 
                fotoOrphans.length === 0 && thumbOrphans.length === 0 && videoOrphans.length === 0
  
  if (allOk) {
    console.log('\n✅ TODO SINCRONIZADO — No hay discrepancias')
  } else {
    console.log('\n⚠️ HAY DISCREPANCIAS — Revisar arriba')
  }
  
  await pool.end()
  s3.destroy()
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
