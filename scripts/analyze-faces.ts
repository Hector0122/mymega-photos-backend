import cliProgress from 'cli-progress'

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.RAILWAY_PUBLIC_URL ||
  'http://localhost:3000'
const BATCH_SIZE = 10

async function main(email: string, password: string) {
  console.log(`Conectando a ${BACKEND_URL}...`)

  const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!loginRes.ok) {
    console.error('Login fallido:', await loginRes.text())
    process.exit(1)
  }
  const { token } = (await loginRes.json()) as { token: string }
  console.log('Autenticado. Iniciando análisis...')

  const statsRes = await fetch(`${BACKEND_URL}/photos/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const stats = (await statsRes.json()) as { photoCount: number }
  const total = stats.photoCount
  console.log(`${total} fotos por analizar. Progreso:`)

  const bar = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic,
  )
  bar.start(total, 0)

  let totalFaces = 0
  let processed = 0

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const res = await fetch(
      `${BACKEND_URL}/photos?maxKeys=${BATCH_SIZE}&pageToken=${processed === 0 ? '' : offset}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    const data = (await res.json()) as { photos: { id: string }[] }
    if (!data.photos || data.photos.length === 0) break

    const ids = data.photos.map((p) => p.id)
    const detectRes = await fetch(`${BACKEND_URL}/faces/detect-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ photoIds: ids }),
    })

    if (detectRes.ok) {
      const result = (await detectRes.json()) as {
        processed: number
        facesFound: number
        failed: number
      }
      totalFaces += result.facesFound
      processed += result.processed
    }

    bar.update(processed)
  }

  bar.stop()
  console.log(`\nCompletado. ${totalFaces} rostros encontrados en ${processed} fotos.`)
}

const args = process.argv.slice(2)
if (args.length < 2) {
  console.log('Uso: npx tsx scripts/analyze-faces.ts <email> <password>')
  process.exit(1)
}

main(args[0], args[1]).catch(console.error)
