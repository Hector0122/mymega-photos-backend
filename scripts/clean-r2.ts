import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '..', '.env') })

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY
const BUCKET = process.env.R2_BUCKET_NAME

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET) {
  console.error('Faltan variables de entorno R2. Revisa el .env')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

async function listAllKeys(prefix?: string): Promise<string[]> {
  const keys: string[] = []
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
      if (obj.Key) keys.push(obj.Key)
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break
    token = res.NextContinuationToken
  }
  return keys
}

async function main() {
  const dryRun = process.argv[2] === '--dry-run' || process.argv[2] === '--dry'

  const keys = await listAllKeys()
  console.log(`Objetos encontrados en R2: ${keys.length}`)

  if (keys.length === 0) {
    console.log('Bucket ya está vacío.')
    return
  }

  if (dryRun) {
    console.log('\nModo DRY-RUN. Mostrando primeros 50 objetos:')
    for (const k of keys.slice(0, 50)) {
      console.log(`  ${k}`)
    }
    if (keys.length > 50) console.log(`  ... y ${keys.length - 50} más`)
    console.log('\nEjecutá sin --dry-run para borrar.')
    return
  }

  const BATCH = 1000
  let deleted = 0
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH)
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch.map((k) => ({ Key: k })) },
      }),
    )
    const count = res.Deleted?.length ?? 0
    deleted += count
    console.log(`  Borrados ${deleted} de ${keys.length}...`)
  }

  console.log(`\nListo. ${deleted} objetos eliminados de ${BUCKET}.`)
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
