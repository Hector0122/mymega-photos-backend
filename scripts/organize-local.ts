import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join, extname } from 'path'
import { execSync, spawn } from 'child_process'
import { performance } from 'perf_hooks'
import { tmpdir } from 'os'
import cliProgress from 'cli-progress'

const MEDIA_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.gif', '.bmp', '.tiff', '.tif', '.avif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mts', '.m2ts',
  '.3gp', '.m4v', '.wmv', '.flv', '.vob',
])

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const CLUSTER_SCRIPT = join(__dirname, 'organize', 'cluster.py')

type Entry = { path: string; size: number; basename: string }

function scanMedia(dir: string): Entry[] {
  const result: Entry[] = []
  const queue = [dir]
  while (queue.length > 0) {
    const cur = queue.pop()!
    try {
      for (const name of readdirSync(cur)) {
        const fp = join(cur, name)
        try {
          const s = statSync(fp)
          if (s.isDirectory()) queue.push(fp)
          else if (s.isFile() && MEDIA_EXTS.has(extname(name).toLowerCase()))
            result.push({ path: fp, size: s.size, basename: name })
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return result
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

async function main() {
  const args = process.argv.slice(2)
  const preview = args.includes('--preview')
  const dir = args.find(a => !a.startsWith('--'))

  if (!dir) {
    console.log('Uso: npx tsx scripts/organize-local.ts <directorio> [--preview]')
    console.log('  Ej: npx tsx scripts/organize-local.ts "D:\\FotoClean" --preview')
    process.exit(1)
  }

  const startTime = performance.now()

  let targetDir = dir
  const m = targetDir.match(/^([A-Za-z]):[\\/]?(.*)$/)
  if (m) targetDir = `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
  if (!existsSync(targetDir)) { console.error(` No existe: ${targetDir}`); process.exit(1) }

  console.log(`ORGANIZADOR VISUAL IA`)
  console.log(`  Directorio: ${targetDir}`)
  if (preview) console.log('  Modo preview — solo mostrar, no modificar')

  // Phase 1: Scan
  console.log('\nEscaneando archivos multimedia...')
  const allMedia = scanMedia(targetDir)
  const images = allMedia.filter(e => IMAGE_EXTS.has(extname(e.path).toLowerCase()))
  const videos = allMedia.filter(e => !IMAGE_EXTS.has(extname(e.path).toLowerCase()))
  console.log(`  ${allMedia.length} archivos (${images.length} imágenes, ${videos.length} videos)`)

  if (images.length < 5) {
    console.log('Muy pocas imágenes para clusterizar.')
    return
  }

  // Phase 2: Write file list for Python
  const workDir = join(tmpdir(), `vaulta-organize-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  const filelistPath = join(workDir, 'filelist.json')
  writeFileSync(filelistPath, JSON.stringify(images.map(e => e.path)))

  // Phase 3: Run CLIP + clustering
  console.log('\nEjecutando CLIP + clustering...')
  const clusterOutput = join(workDir, 'clusters.json')

  try {
    execSync('python3 --version', { stdio: 'ignore' })
  } catch {
    console.error('python3 no disponible')
    rmSync(workDir, { recursive: true, force: true })
    process.exit(1)
  }

  const pyStart = performance.now()
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('python3', [CLUSTER_SCRIPT, filelistPath, clusterOutput], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.stdout!.on('data', (d: Buffer) => { process.stdout.write(d) })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else if (code === 2) {
        const match = stderr.match(/ERROR_MISSING_DEPS: (.+)/)
        console.error(`\nFaltan dependencias Python: ${match ? match[1] : stderr}`)
        process.exit(1)
      } else {
        console.error(`\nPython error (exit ${code}):\n${stderr}`)
        process.exit(1)
      }
    })
    proc.on('error', reject)
  })
  const pyElapsed = ((performance.now() - pyStart) / 1000).toFixed(1)
  console.log(`  Python completado en ${pyElapsed}s`)

  // Phase 4: Read clusters
  const clusterRaw = JSON.parse(readFileSync(clusterOutput, 'utf-8'))
  const totalClusters = clusterRaw.total_clusters as number
  const noiseCount = clusterRaw.noise_count as number

  console.log(`\nRESULTADOS`)
  console.log(`  Grupos temáticos:  ${totalClusters}`)
  console.log(`  Sin agrupar:       ${noiseCount}`)

  if (totalClusters === 0) {
    console.log('No se formaron grupos.')
    rmSync(workDir, { recursive: true, force: true })
    return
  }

  // Map cluster files (now full paths) to entries
  const clusters = clusterRaw.clusters as { id: number; files: string[]; near_duplicates: string[][] }[]
  const clusterFolders = new Map<number, Entry[]>()

  for (const c of clusters) {
    if (c.files.length <= 1) continue
    const entries: Entry[] = []
    for (const fpath of c.files) {
      const entry = allMedia.find(e => e.path === fpath)
      if (entry) entries.push(entry)
    }
    if (entries.length > 1) clusterFolders.set(c.id, entries)
  }
  console.log(`  Grupos con >1 foto: ${clusterFolders.size}`)

  // Phase 5: Name clusters with Moondream
  console.log('\nNombrando grupos con IA (Moondream)...')
  const clusterNames = new Map<number, string>()
  let namedClusters = 0

  for (const [clusterId, entries] of clusterFolders) {
    const reps = (clusterRaw.representatives as Record<number, string[]>)[clusterId] || []
    const repImages: string[] = []
    for (const fpath of reps) {
      if (existsSync(fpath)) {
        repImages.push(readFileSync(fpath).toString('base64'))
      }
    }

    if (repImages.length === 0) {
      clusterNames.set(clusterId, `Grupo ${clusterId + 1}`)
      continue
    }

    try {
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'moondream',
          prompt: 'Describe estas imágenes en 3-5 palabras en español, solo el nombre del tema común.',
          images: repImages,
          stream: false,
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const data = await res.json() as { response: string }
        let name = data.response.trim().replace(/^["']|["']$/g, '').split('\n')[0]
        if (name.length > 60) name = name.slice(0, 60)
        if (!name) name = `Grupo ${clusterId + 1}`
        clusterNames.set(clusterId, name)
        namedClusters++
        process.stdout.write(`  ${name}\n`)
      } else {
        clusterNames.set(clusterId, `Grupo ${clusterId + 1}`)
      }
    } catch {
      clusterNames.set(clusterId, `Grupo ${clusterId + 1}`)
    }
  }
  if (namedClusters === 0) {
    console.log('  (nombres genéricos — Moondream no respondió)')
    for (const [id] of clusterFolders) clusterNames.set(id, `Grupo ${id + 1}`)
  } else {
    console.log(`  Nombrados: ${namedClusters}/${clusterFolders.size}`)
  }

  // Phase 6: Create albums
  if (!preview) {
    console.log('\nCreando carpetas de álbumes...')
    let moved = 0
    let totalSize = 0

    for (const [clusterId, entries] of clusterFolders) {
      const albumName = clusterNames.get(clusterId) || `Grupo ${clusterId + 1}`
      const safeName = albumName.replace(/[<>:"/\\|?*]/g, '_').trim()
      const albumDir = join(targetDir, `_Album_${safeName}`)
      mkdirSync(albumDir, { recursive: true })

      for (const entry of entries) {
        const dest = join(albumDir, entry.basename)
        try {
          try { execSync(`mv "${entry.path}" "${dest}"`, { stdio: 'ignore' }) }
          catch { execSync(`cp "${entry.path}" "${dest}" && rm "${entry.path}"`, { stdio: 'ignore' }) }
          moved++
          totalSize += entry.size
        } catch { /* skip */ }
      }
    }
    console.log(`  Movidos: ${moved} archivos (${formatBytes(totalSize)}) a ${clusterFolders.size} álbumes`)

    // Clean empty dirs
    const removeEmpty = (dir: string): boolean => {
      try {
        const items = readdirSync(dir)
        let allEmpty = true
        for (const name of items) {
          const fp = join(dir, name)
          if (statSync(fp).isDirectory()) { if (!removeEmpty(fp)) allEmpty = false }
          else { allEmpty = false }
        }
        if (allEmpty && dir !== targetDir) { rmSync(dir, { recursive: true }); return true }
        return false
      } catch { return false }
    }
    removeEmpty(targetDir)
  } else {
    console.log('\nAlbumes a crear:')
    for (const [clusterId, entries] of clusterFolders) {
      const name = clusterNames.get(clusterId) || `Grupo ${clusterId + 1}`
      const total = entries.reduce((s, e) => s + e.size, 0)
      console.log(`  "${name}" → ${entries.length} fotos (${formatBytes(total)})`)
    }
  }

  rmSync(workDir, { recursive: true, force: true })

  const totalMin = ((performance.now() - startTime) / 1000 / 60).toFixed(1)
  console.log(`\n${'='.repeat(40)}`)
  console.log(`COMPLETADO en ${totalMin} min`)
}

main().catch(err => { console.error('\nError:', err.message); process.exit(1) })
