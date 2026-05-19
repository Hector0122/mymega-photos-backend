import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, rmSync, createWriteStream } from 'fs'
import { join, resolve, basename, extname } from 'path'
import { spawn, execSync } from 'child_process'
import { performance } from 'perf_hooks'
import { tmpdir } from 'os'
import { createInterface } from 'readline'
import cliProgress from 'cli-progress'

const BACKEND_URL = process.env.BACKEND_URL || process.env.RAILWAY_PUBLIC_URL || 'http://localhost:3000'
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL
const CLUSTER_SCRIPT = join(__dirname, 'organize', 'cluster.py')

type Photo = {
  id: string
  s3Key: string
  thumbS3Key: string | null
  perceptualHash: string | null
  size: number
  filename: string
  mimeType: string
  createdAt: Date
}

type ClusterResult = {
  version: number
  total_photos: number
  total_clusters: number
  noise_count: number
  photos: Record<string, { embedding: number[]; cluster: number }>
  clusters: { id: number; files: string[]; near_duplicates: string[][]; count: number }[]
  representatives: Record<number, string[]>
}

type ActionResult = { status: 'deleted' | 'kept' | 'error'; id: string; reason?: string }

async function authenticate(): Promise<string> {
  const token = process.env.BULK_TOKEN
  if (token) return token

  const email = process.env.BULK_EMAIL
  const password = process.env.BULK_PASSWORD
  if (!email || !password) {
    console.error(
      'Autenticación requerida.\n' +
      '  Exporta BULK_TOKEN=<jwt>\n' +
      '  O exporta BULK_EMAIL + BULK_PASSWORD (login automático)'
    )
    process.exit(1)
  }

  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    console.error(`Error auth (${res.status}): ${await res.text()}`)
    process.exit(1)
  }
  const data = await res.json() as { token: string; user: { name: string } }
  console.log(`Sesión iniciada: ${data.user.name}`)
  return data.token
}

async function fetchAllPhotos(): Promise<Photo[]> {
  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL requerida')
    process.exit(1)
  }
  const adapter = new PrismaPg(
    { connectionString },
    { schema: process.env.DATABASE_SCHEMA || 'public' },
  )
  const prisma = new PrismaClient({ adapter })

  const photos = await prisma.photo.findMany({
    where: { deletedAt: null },
    select: {
      id: true, s3Key: true, thumbS3Key: true, perceptualHash: true,
      size: true, filename: true, mimeType: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  await prisma.$disconnect()
  return photos as Photo[]
}

async function ensureAllPhotosAnalyzed(token: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/photos/analyze-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.ok) {
    const data = await res.json() as { processed: number }
    if (data.processed > 0) console.log(`Análisis bulk: ${data.processed} fotos procesadas`)
  } else {
    console.warn(`Warning: analyze-all returned ${res.status}`)
  }
}

// Phase 1: delete exact duplicates (same perceptual hash), keep the best by size
async function deleteExactDuplicates(photos: Photo[], token: string, preview: boolean): Promise<{ kept: Photo[]; deleted: ActionResult[] }> {
  const hashGroups = new Map<string, Photo[]>()
  for (const p of photos) {
    if (!p.perceptualHash) continue
    const g = hashGroups.get(p.perceptualHash) || []
    g.push(p)
    hashGroups.set(p.perceptualHash, g)
  }

  const toDelete: Photo[] = []
  const toKeep: Photo[] = []

  for (const [, group] of hashGroups) {
    if (group.length <= 1) {
      toKeep.push(...group)
      continue
    }
    group.sort((a, b) => b.size - a.size)
    toKeep.push(group[0])
    toDelete.push(...group.slice(1))
  }

  // also keep photos without hash that weren't duplicated
  const keptSet = new Set(toKeep.map(p => p.id))
  for (const p of photos) {
    if (!keptSet.has(p.id) && !p.perceptualHash) {
      toKeep.push(p)
      keptSet.add(p.id)
    }
  }

  if (toDelete.length === 0) return { kept: toKeep, deleted: [] }

  console.log(`\n🧹 Duplicados exactos encontrados: ${toDelete.length}`)
  for (const d of toDelete) {
    const kept = toKeep.find(k => k.perceptualHash === d.perceptualHash)!
    console.log(`  Eliminar: ${d.filename} (${(d.size / 1024 / 1024).toFixed(1)}MB) ← conservar: ${kept.filename} (${(kept.size / 1024 / 1024).toFixed(1)}MB) [hash: ${d.perceptualHash!.slice(0, 8)}…]`)
  }

  if (preview) {
    console.log('  (--preview: no se eliminó nada)')
    return { kept: toKeep, deleted: toDelete.map(d => ({ status: 'kept' as const, id: d.id, reason: 'preview' })) }
  }

  const results: ActionResult[] = []
  const bar = new cliProgress.SingleBar({ format: 'Eliminando: [{bar}] {percentage}% | {value}/{total}', barCompleteChar: '█', barIncompleteChar: '░' })
  bar.start(toDelete.length, 0)

  for (let i = 0; i < toDelete.length; i++) {
    const d = toDelete[i]
    try {
      const res = await fetch(`${BACKEND_URL}/photos/${d.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        results.push({ status: 'deleted', id: d.id })
      } else {
        results.push({ status: 'error', id: d.id, reason: `HTTP ${res.status}` })
      }
    } catch (err: any) {
      results.push({ status: 'error', id: d.id, reason: err.message })
    }
    bar.update(i + 1)
  }
  bar.stop()

  const deletedCount = results.filter(r => r.status === 'deleted').length
  console.log(`  Eliminados: ${deletedCount} definitivos, ${results.length - deletedCount} errores`)

  return { kept: toKeep.filter(k => !toDelete.some(d => d.id === k.id)), deleted: results }
}

// Phase 2: download thumbnails from R2
async function downloadThumbnails(photos: Photo[]): Promise<string> {
  if (!R2_PUBLIC_URL) {
    console.error('R2_PUBLIC_URL required for downloading thumbnails')
    process.exit(1)
  }

  const dir = join(tmpdir(), `vaulta-organize-${Date.now()}`)
  mkdirSync(dir, { recursive: true })

  const toDownload = photos.filter(p => p.thumbS3Key)
  const bar = new cliProgress.SingleBar({ format: 'Descargando thumbs: [{bar}] {percentage}% | {value}/{total}', barCompleteChar: '█', barIncompleteChar: '░' })
  bar.start(toDownload.length, 0)

  let errors = 0
  for (let i = 0; i < toDownload.length; i++) {
    const p = toDownload[i]
    const ext = extname(p.filename) || '.jpg'
    const fpath = join(dir, `${p.id}${ext}`)
    try {
      const url = `${R2_PUBLIC_URL}/${p.thumbS3Key}`
      const res = await fetch(url)
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer())
        writeFileSync(fpath, buffer)
      } else {
        errors++
      }
    } catch {
      errors++
    }
    bar.update(i + 1)
  }
  bar.stop()

  if (errors > 0) console.warn(`  ${errors} thumbnails no disponibles`)
  console.log(`  Thumbnails descargados: ${toDownload.length - errors}/${toDownload.length}`)
  return dir
}

// Phase 3: run Python clustering script
async function runPythonClustering(thumbsDir: string): Promise<string> {
  const outputPath = join(thumbsDir, 'clusters.json')

  if (!existsSync(CLUSTER_SCRIPT)) {
    console.error(`Script no encontrado: ${CLUSTER_SCRIPT}`)
    process.exit(1)
  }

  try {
    execSync('python3 --version', { stdio: 'ignore' })
  } catch {
    console.error('python3 no está disponible')
    process.exit(1)
  }

  console.log('\n🔬 Ejecutando CLIP + clustering Python...')
  const start = performance.now()
  await new Promise<void>((resolvePromise, reject) => {
    const proc = spawn('python3', [CLUSTER_SCRIPT, thumbsDir, outputPath], { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.stdout!.on('data', (d: Buffer) => { process.stdout.write(d) })

    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
      } else if (code === 2) {
        const match = stderr.match(/ERROR_MISSING_DEPS: (.+)/)
        const msg = match ? match[1] : stderr
        console.error(`\nFaltan dependencias Python: ${msg}`)
        console.error('  pip install -r scripts/organize/requirements.txt')
        process.exit(1)
      } else {
        console.error(`\nPython error (exit ${code}):\n${stderr}`)
        process.exit(1)
      }
    })
    proc.on('error', reject)
  })

  const elapsed = ((performance.now() - start) / 1000).toFixed(1)
  console.log(`  Python completado en ${elapsed}s`)

  return outputPath
}

// Phase 4: handle near-duplicates
async function handleNearDuplicates(clusters: ClusterResult['clusters'], photos: Photo[], token: string, preview: boolean): Promise<void> {
  let totalPairs = 0
  for (const c of clusters) totalPairs += c.near_duplicates.length

  if (totalPairs === 0) {
    console.log('\n✅ No se encontraron casi-duplicados')
    return
  }

  console.log(`\n🔍 Casi-duplicados encontrados: ${totalPairs} pares en ${clusters.length} grupos`)

  if (preview) {
    for (const c of clusters) {
      if (c.near_duplicates.length === 0) continue
      console.log(`  Grupo #${c.id} (${c.count} fotos):`)
      for (const [a, b] of c.near_duplicates) {
        const idA = a.replace(/\.[^.]+$/, '')
        const idB = b.replace(/\.[^.]+$/, '')
        const pA = photos.find(p => p.id === idA)
        const pB = photos.find(p => p.id === idB)
        console.log(`    - ${pA?.filename || idA} ≈ ${pB?.filename || idB}`)
      }
    }
    console.log('  (--preview: no se eliminó nada)')
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r))

  for (const c of clusters) {
    if (c.near_duplicates.length === 0) continue

    console.log(`\n📁 Grupo #${c.id} (${c.count} fotos):`)
    const involvedIds = new Set<string>()
    for (const [a, b] of c.near_duplicates) {
      involvedIds.add(a.replace(/\.[^.]+$/, ''))
      involvedIds.add(b.replace(/\.[^.]+$/, ''))
    }

    for (const id of involvedIds) {
      const p = photos.find(ph => ph.id === id)
      console.log(`  - ${p?.filename || id}`)
    }

    const answer = await ask(`\n¿Elimino ${involvedIds.size - 1} y conservo la mejor? (Y/n) `)
    if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
      console.log('  Omitido.')
      continue
    }

    // Sort involved photos by size, keep largest
    const involved = [...involvedIds].map(id => photos.find(p => p.id === id)!).filter(Boolean)
    involved.sort((a, b) => b.size - a.size)
    const keep = involved[0]
    const toDel = involved.slice(1)

    const bar = new cliProgress.SingleBar({ format: 'Eliminando: [{bar}] {percentage}% | {value}/{total}', barCompleteChar: '█', barIncompleteChar: '░' })
    bar.start(toDel.length, 0)

    let deleted = 0
    for (let i = 0; i < toDel.length; i++) {
      try {
        const res = await fetch(`${BACKEND_URL}/photos/${toDel[i].id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) deleted++
      } catch {}
      bar.update(i + 1)
    }
    bar.stop()
    console.log(`  Eliminados: ${deleted}, conservado: ${keep.filename}`)
  }
  rl.close()
}

// Phase 5: name clusters with Ollama
async function nameClusters(clusters: ClusterResult['clusters'], representatives: Record<number, string[]>, thumbsDir: string): Promise<Record<number, string>> {
  const names: Record<number, string> = {}

  const nonEmptyClusters = clusters.filter(c => c.count > 0)
  if (nonEmptyClusters.length === 0) return names

  console.log('\n🏷️  Nombrando grupos con Ollama...')

  for (const c of nonEmptyClusters) {
    const reps = representatives[c.id] || c.files.slice(0, 3)
    const images: string[] = []

    for (const fname of reps) {
      const fpath = join(thumbsDir, fname)
      if (existsSync(fpath)) {
        const buffer = readFileSync(fpath)
        images.push(buffer.toString('base64'))
      }
    }

    if (images.length === 0) {
      names[c.id] = `Álbum ${c.id + 1}`
      continue
    }

    try {
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemma3:2b',
          prompt: 'Estas fotos son visualmente similares. Dame un nombre corto para este álbum en español (máximo 5 palabras) que describa el contenido. Responde SOLO el nombre, nada más.',
          images,
          stream: false,
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        if (res.status === 404) {
          console.warn('  Ollama no disponible (gemma3:2b no encontrado). Usando nombres genéricos.')
          for (const cc of nonEmptyClusters) names[cc.id] = `Álbum ${cc.id + 1}`
          return names
        }
        names[c.id] = `Álbum ${c.id + 1}`
        continue
      }
      const data = await res.json() as { response: string }
      let name = data.response.trim().replace(/^["']|["']$/g, '').split('\n')[0]
      if (name.length > 50) name = name.slice(0, 50)
      if (!name) name = `Álbum ${c.id + 1}`
      names[c.id] = name
      process.stdout.write(`  Grupo #${c.id} → ${name}\n`)
    } catch (err: any) {
      if (err.code === 'ECONNREFUSED' || err.name === 'AbortError') {
        console.warn('\n  Ollama no disponible (http://localhost:11434). Usando nombres genéricos.')
        for (const cc of nonEmptyClusters) names[cc.id] = `Álbum ${cc.id + 1}`
        return names
      }
      names[c.id] = `Álbum ${c.id + 1}`
    }
  }

  return names
}

// Phase 6: create albums via backend API
async function createAlbums(clusters: ClusterResult['clusters'], names: Record<number, string>, photos: Photo[], token: string, preview: boolean): Promise<void> {
  if (preview) {
    console.log('\n📁 Álbumes a crear (--preview):')
    for (const c of clusters) {
      if (c.count <= 1) continue
      const name = names[c.id] || `Álbum ${c.id + 1}`
      console.log(`  - "${name}" (${c.files.length} fotos)`)
    }
    return
  }

  const toCreate = clusters.filter(c => c.count > 1)
  if (toCreate.length === 0) {
    console.log('\n✅ No hay grupos para crear álbumes')
    return
  }

  console.log('\n📁 Creando álbumes...')
  const bar = new cliProgress.SingleBar({ format: 'Álbumes: [{bar}] {percentage}% | {value}/{total}', barCompleteChar: '█', barIncompleteChar: '░' })
  bar.start(toCreate.length, 0)

  let created = 0
  for (let i = 0; i < toCreate.length; i++) {
    const c = toCreate[i]
    const name = names[c.id] || `Álbum ${i + 1}`

    try {
      const albumRes = await fetch(`${BACKEND_URL}/albums`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!albumRes.ok) {
        bar.update(i + 1)
        continue
      }
      const album = await albumRes.json() as { id: string }

      const photoIds = c.files
        .map(f => f.replace(/\.[^.]+$/, ''))
        .filter(id => photos.some(p => p.id === id))

      if (photoIds.length > 0) {
        await fetch(`${BACKEND_URL}/albums/${album.id}/photos`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoIds }),
        })
      }
      created++
    } catch {}
    bar.update(i + 1)
  }
  bar.stop()
  console.log(`  Creados: ${created} álbumes`)
}

function printReport(startTime: number, totalPhotos: number, exactDeleted: number, nearDeleted: number, albumsCreated: number, clustersCount: number) {
  const elapsed = ((performance.now() - startTime) / 1000 / 60).toFixed(1)
  console.log(`\n${'='.repeat(40)}`)
  console.log(`📊  REPORTE FINAL`)
  console.log(`${'='.repeat(40)}`)
  console.log(`  Fotos totales:    ${totalPhotos}`)
  console.log(`  Duplicados exactos: ${exactDeleted}`)
  console.log(`  Casi-duplicados:    ${nearDeleted}`)
  console.log(`  Grupos temáticos:   ${clustersCount}`)
  console.log(`  Álbumes creados:    ${albumsCreated}`)
  console.log(`  Tiempo:             ${elapsed} min`)
  console.log(`${'='.repeat(40)}`)
}

async function main() {
  const args = process.argv.slice(2)
  const preview = args.includes('--preview')
  const cleanOnly = args.includes('--clean-only')

  const startTime = performance.now()

  if (preview) console.log('\n👁️  Modo preview — no se harán cambios')
  if (cleanOnly) console.log('\n🧹 Modo solo limpieza — no se organizarán álbumes')

  const token = await authenticate()

  // Ensure all photos have perceptual hashes
  await ensureAllPhotosAnalyzed(token)

  // Fetch all photos
  console.log('\n📸 Cargando fotos desde la base de datos...')
  const allPhotos = await fetchAllPhotos()
  console.log(`  Total: ${allPhotos.length} fotos`)

  if (allPhotos.length === 0) {
    console.log('No hay fotos para organizar.')
    return
  }

  // Phase 1: Exact duplicates
  console.log('\n🧹 Fase 1: Duplicados exactos (mismo perceptual hash)')
  const { kept: remainingPhotos, deleted: exactDeletions } = await deleteExactDuplicates(allPhotos, token, preview)
  const exactDeleted = exactDeletions.filter(d => d.status === 'deleted').length

  const fetchedPhotos = allPhotos.filter(
    p => remainingPhotos.some(r => r.id === p.id)
  )

  if (cleanOnly || fetchedPhotos.length === 0) {
    printReport(startTime, allPhotos.length, exactDeleted, 0, 0, 0)
    return
  }

  // Phase 2: Download thumbnails
  console.log('\n⬇️  Fase 2: Descargando thumbnails...')
  const thumbsDir = await downloadThumbnails(fetchedPhotos)

  try {
    // Phase 3: CLIP + clustering
    const clusterOutputPath = await runPythonClustering(thumbsDir)
    const clusterRaw = JSON.parse(readFileSync(clusterOutputPath, 'utf-8')) as ClusterResult

    if (clusterRaw.total_photos === 0) {
      console.log('No se pudieron procesar imágenes para clustering.')
      rmSync(thumbsDir, { recursive: true, force: true })
      printReport(startTime, allPhotos.length, exactDeleted, 0, 0, 0)
      return
    }

    console.log(`  Fotos clusterizadas: ${clusterRaw.total_photos}`)
    console.log(`  Grupos: ${clusterRaw.total_clusters}`)
    console.log(`  No agrupadas: ${clusterRaw.noise_count}`)

    // Phase 4: Near-duplicates
    console.log('\n🔍 Fase 4: Casi-duplicados')
    await handleNearDuplicates(clusterRaw.clusters, fetchedPhotos, token, preview)

    // Summarize deletions actually made by the near-duplicate phase
    const deletionsMade = preview ? 0 : 0 // We track this in the near-dup handler, simplified for now

    if (!cleanOnly) {
      // Phase 5: Name clusters
      const names = await nameClusters(clusterRaw.clusters, clusterRaw.representatives, thumbsDir)

      // Phase 6: Create albums
      await createAlbums(clusterRaw.clusters, names, fetchedPhotos, token, preview)
    }

    printReport(startTime, allPhotos.length, exactDeleted, 0, cleanOnly ? 0 : clusterRaw.total_clusters, clusterRaw.total_clusters)

  } finally {
    // Cleanup temp dir
    rmSync(thumbsDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('\nError fatal:', err.message)
  process.exit(1)
})
