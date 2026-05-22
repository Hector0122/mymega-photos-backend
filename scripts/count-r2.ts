import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
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

async function countObjects(prefix: string) {
  let count = 0
  let totalSize = 0
  let continuationToken: string | undefined

  console.log(`📂 Contando objetos en: ${BUCKET}/${prefix || '(raíz)'}`)
  console.log('')

  while (true) {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    })

    const res = await s3.send(cmd)

    if (res.Contents) {
      for (const obj of res.Contents) {
        count++
        totalSize += obj.Size ?? 0
        console.log(
          `  ${String(count).padStart(6, ' ')}  ${formatBytes(obj.Size ?? 0).padStart(9, ' ')}  ${obj.Key}`,
        )
      }
    }

    if (!res.IsTruncated || !res.NextContinuationToken) break
    continuationToken = res.NextContinuationToken
  }

  console.log('')
  console.log('='.repeat(50))
  console.log(`  Total archivos: ${count}`)
  console.log(`  Total tamaño:   ${formatBytes(totalSize)}`)
  console.log('='.repeat(50))
}

function main() {
  const prefix = process.argv[2] || ''
  countObjects(prefix).catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
  })
}

main()
