import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '..', '.env') })

const DB_URL = process.env.DATABASE_URL
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY
const BUCKET = process.env.R2_BUCKET_NAME

if (!DB_URL || !ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET) {
  console.error('Faltan variables de entorno. Revisa el .env')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
})

async function listAllKeys(prefix: string): Promise<Set<string>> {
  const keys = new Set<string>()
  let token: string | undefined
  while (true) {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.add(obj.Key)
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break
    token = res.NextContinuationToken
  }
  return keys
}

async function main() {
  const adapter = new PrismaPg(
    { connectionString: DB_URL },
    { schema: process.env.DATABASE_SCHEMA || 'public' },
  )
  const prisma = new PrismaClient({ adapter })

  const [totales, vivos, borrados, sinThumb, porUsuario] = await Promise.all([
    prisma.photo.count(),
    prisma.photo.count({ where: { deletedAt: null } }),
    prisma.photo.count({ where: { deletedAt: { not: null } } }),
    prisma.photo.count({ where: { deletedAt: null, thumbS3Key: null } }),
    prisma.photo.groupBy({
      by: ['userId'],
      where: { deletedAt: null },
      _count: true,
    }),
  ])

  console.log('=== REGISTROS EN BASE DE DATOS ===')
  console.log(`  Total (incluye borrados): ${totales}`)
  console.log(`  Vivos (deletedAt = null):  ${vivos}`)
  console.log(`  Borrados (en papelera):    ${borrados}`)
  console.log(`  Vivos sin thumbnail:       ${sinThumb}`)
  console.log('')
  console.log('  Por usuario:')
  for (const u of porUsuario) {
    console.log(`    ${u.userId}: ${u._count} vivos`)
  }

  const userId = process.argv[2]
  if (userId) {
    console.log(`\n=== CRUCE R2 vs BD para usuario ${userId} ===`)
    const userIds = porUsuario.map((u) => u.userId)
    if (!userIds.includes(userId)) {
      console.log(`  Usuario ${userId} no encontrado en la BD. Usuarios disponibles: ${userIds.join(', ')}`)
      await prisma.$disconnect()
      return
    }

    const [r2Uploads, r2Thumbs] = await Promise.all([
      listAllKeys(`uploads/${userId}/`),
      listAllKeys(`thumbnails/${userId}/`),
    ])

    const dbPhotos = await prisma.photo.findMany({
      where: { userId, deletedAt: null },
      select: { s3Key: true, thumbS3Key: true, filename: true },
    })

    const dbKeys = new Set(dbPhotos.map((p) => p.s3Key))
    const dbThumbKeys = new Set(
      dbPhotos.filter((p) => p.thumbS3Key).map((p) => p.thumbS3Key!),
    )

    const enR2NoEnDB = [...r2Uploads].filter((k) => !dbKeys.has(k))
    const enDBNoEnR2 = [...dbKeys].filter((k) => !r2Uploads.has(k))
    const thumbsEnR2NoEnDB = [...r2Thumbs].filter((k) => !dbThumbKeys.has(k))
    const thumbsEnDBNoEnR2 = [...dbThumbKeys].filter((k) => !r2Thumbs.has(k))

    console.log(`\n  R2 uploads/${userId}/:    ${r2Uploads.size}`)
    console.log(`  R2 thumbnails/${userId}/: ${r2Thumbs.size}`)
    console.log(`  BD vivos:                 ${dbKeys.size}`)
    console.log(`  BD con thumbnail:         ${dbThumbKeys.size}`)

    if (enR2NoEnDB.length > 0) {
      console.log(`\n  ⚠️  En R2 pero NO en BD (${enR2NoEnDB.length}):`)
      for (const k of enR2NoEnDB.slice(0, 20)) console.log(`    ${k}`)
      if (enR2NoEnDB.length > 20) console.log(`    ... y ${enR2NoEnDB.length - 20} más`)
    }

    if (enDBNoEnR2.length > 0) {
      console.log(`\n  ⚠️  En BD pero NO en R2 (${enDBNoEnR2.length}):`)
      for (const k of enDBNoEnR2.slice(0, 20)) console.log(`    ${k}`)
      if (enDBNoEnR2.length > 20) console.log(`    ... y ${enDBNoEnR2.length - 20} más`)
    }

    if (thumbsEnR2NoEnDB.length > 0) {
      console.log(`\n  ⚠️  Thumbs en R2 pero NO en BD (${thumbsEnR2NoEnDB.length}):`)
      for (const k of thumbsEnR2NoEnDB.slice(0, 20)) console.log(`    ${k}`)
      if (thumbsEnR2NoEnDB.length > 20) console.log(`    ... y ${thumbsEnR2NoEnDB.length - 20} más`)
    }

    if (thumbsEnDBNoEnR2.length > 0) {
      console.log(`\n  ⚠️  Thumbs en BD pero NO en R2 (${thumbsEnDBNoEnR2.length}):`)
      for (const k of thumbsEnDBNoEnR2.slice(0, 20)) console.log(`    ${k}`)
      if (thumbsEnDBNoEnR2.length > 20) console.log(`    ... y ${thumbsEnDBNoEnR2.length - 20} más`)
    }

    if (
      enR2NoEnDB.length === 0 &&
      enDBNoEnR2.length === 0 &&
      thumbsEnR2NoEnDB.length === 0 &&
      thumbsEnDBNoEnR2.length === 0
    ) {
      console.log('\n  ✅ Todo coincide entre R2 y BD')
    }
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
