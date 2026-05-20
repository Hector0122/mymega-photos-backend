import { readFileSync, readdirSync, statSync, mkdirSync, renameSync, existsSync } from 'fs'
import { join, extname, resolve, basename, dirname } from 'path'
import { performance } from 'perf_hooks'
import { createHash } from 'crypto'
import * as cliProgress from 'cli-progress'

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.gif', '.bmp', '.tiff', '.tif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
])

type FileEntry = {
  path: string
  sizeBytes: number
  sha256: string
  phash: string | null
}

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
      if (stat.isDirectory()) {
        queue.push(fullPath)
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase()
        if (ALLOWED_EXTENSIONS.has(ext)) {
          results.push(fullPath)
        }
      }
    }
  }
  return results
}

function computeSha256(filePath: string): string {
  const h = createHash('sha256')
  const fd = readFileSync(filePath)
  h.update(fd)
  return h.digest('hex')
}

async function computePhash(filePath: string): Promise<string | null> {
  try {
    const mod = await import('sharp') as any
    const sharp = mod.default || mod
    const buffer = readFileSync(filePath)
    const { data } = await sharp(buffer)
      .resize(8, 8, { fit: 'cover' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const pixels = Array.from(data) as number[]
    const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length
    const hashBin = pixels.map(v => v > avg ? '1' : '0').join('')
    return BigInt('0b' + hashBin).toString(16).padStart(16, '0')
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function moveFile(filePath: string, destDir: string): string {
  mkdirSync(destDir, { recursive: true })
  let dest = join(destDir, basename(filePath))
  const ext = extname(filePath)
  const name = basename(filePath, ext)
  let counter = 1
  while (existsSync(dest)) {
    dest = join(destDir, `${name}_${counter}${ext}`)
    counter++
  }
  renameSync(filePath, dest)
  return dest
}

function getDuplicateDir(sourceDir: string, custom?: string): string {
  if (custom) return resolve(custom)
  const parent = dirname(resolve(sourceDir))
  const base = basename(resolve(sourceDir))
  return join(parent, `${base}_Duplicates`)
}

function printReport(
  total: number,
  totalBytes: number,
  dupGroups: { hash: string; files: string[]; type: string }[],
  dupBytes: number,
  moved: number,
  elapsedMin: string,
  destDir: string,
  dryRun: boolean,
) {
  const dupCount = dupGroups.reduce((s, g) => s + g.files.length - 1, 0)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`📊  REPORTE FINAL`)
  console.log(`${'='.repeat(50)}`)
  console.log(`  Archivos escaneados:  ${total} (${formatBytes(totalBytes)})`)
  console.log(`  Grupos duplicados:    ${dupGroups.length}`)
  console.log(`  Archivos duplicados:  ${dupCount} (${formatBytes(dupBytes)})`)
  if (!dryRun) {
    console.log(`  Movidos:              ${moved}`)
    console.log(`  Destino:              ${destDir}`)
  } else {
    console.log(`  Modo:                 dry-run (sin mover)`)
  }
  console.log(`  Tiempo:               ${elapsedMin} min`)
  console.log(`${'='.repeat(50)}`)

  if (dupGroups.length > 0) {
    console.log(`\n📋  DETALLE DE DUPLICADOS:`)
    dupGroups.forEach((group, idx) => {
      const label = group.type === 'sha256' ? 'SHA256 exacto' : 'Hash perceptual'
      console.log(`\n  #${idx + 1} [${label}] ${group.hash.slice(0, 16)}...`)
      console.log(`    📄 ${group.files[0]}  ← conservado`)
      for (const dup of group.files.slice(1)) {
        console.log(`    🗑️  ${dup}`)
      }
    })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dirPath = args[0]
  if (!dirPath) {
    console.error('Uso: npx tsx scripts/clean-dups.ts <ruta> [opciones]')
    console.error('')
    console.error('Opciones:')
    console.error('  --dry-run       Solo mostrar duplicados, no mover')
    console.error('  --move-to <dir> Carpeta destino para duplicados (default: <origen>_Duplicates)')
    console.error('  --no-phash      Saltar detección por perceptual hash (solo SHA256)')
    console.error('')
    console.error('Ejemplos:')
    console.error('  npx tsx scripts/clean-dups.ts "D:\\FotoClean" --dry-run')
    console.error('  npx tsx scripts/clean-dups.ts "D:\\FotoClean" --move-to "D:\\Basura"')
    console.error('  npx tsx scripts/clean-dups.ts "/mnt/c/Users/Hector/Pictures/FotoClean" --clean-dups')
    process.exit(1)
  }

  const dryRun = args.includes('--dry-run')
  const cleanDups = args.includes('--clean-dups')
  const skipPhash = args.includes('--no-phash')
  const moveToIdx = args.indexOf('--move-to')
  const customDest = moveToIdx !== -1 && moveToIdx + 1 < args.length ? args[moveToIdx + 1] : undefined

  if (!dryRun && !cleanDups) {
    console.log('ℹ️  Modo solo lectura. Usa --clean-dups para mover duplicados.')
  }
  const doMove = cleanDups && !dryRun

  const startTime = performance.now()
  const destDir = getDuplicateDir(dirPath, customDest)

  console.log(`📂 Escaneando ${resolve(dirPath)}...`)
  const allFiles = scanFiles(dirPath)
  const totalBytes = allFiles.reduce((sum, f) => {
    try { return sum + statSync(f).size } catch { return sum }
  }, 0)
  console.log(`Encontrados ${allFiles.length} archivos (${formatBytes(totalBytes)})`)

  if (allFiles.length === 0) {
    console.log('No se encontraron archivos compatibles.')
    return
  }

  // ── Fase 1: SHA256 ──
  console.log('\n🔎 Fase 1: Calculando SHA256...')
  const shaBar = new cliProgress.SingleBar({
    format: 'SHA256: [{bar}] {percentage}% | {value}/{total} | {current}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    clearOnComplete: true,
  })
  shaBar.start(allFiles.length, 0, { current: '' })

  const shaGroups = new Map<string, string[]>()
  const filesByPath = new Map<string, FileEntry>()

  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i]
    shaBar.update(i, { current: basename(filePath) })
    const hash = computeSha256(filePath)
    if (!shaGroups.has(hash)) shaGroups.set(hash, [])
    shaGroups.get(hash)!.push(filePath)
    filesByPath.set(filePath, { path: filePath, sizeBytes: statSync(filePath).size, sha256: hash, phash: null })
  }
  shaBar.stop()

  // ── Fase 2: Perceptual hash ──
  let phashGroups: Map<string, string[]> = new Map()
  if (!skipPhash) {
    const uniqueFiles = allFiles.filter(f => (shaGroups.get(filesByPath.get(f)!.sha256)?.length ?? 0) === 1)
    if (uniqueFiles.length > 0) {
      console.log('\n🔎 Fase 2: Calculando perceptual hash...')
      const phashBar = new cliProgress.SingleBar({
        format: 'PHash: [{bar}] {percentage}% | {value}/{total} | {current}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        clearOnComplete: true,
      })
      phashBar.start(uniqueFiles.length, 0, { current: '' })

      const computed = new Map<string, string[]>()
      for (let i = 0; i < uniqueFiles.length; i++) {
        const filePath = uniqueFiles[i]
        phashBar.update(i, { current: basename(filePath) })
        const ph = await computePhash(filePath)
        filesByPath.get(filePath)!.phash = ph
        if (ph) {
          if (!computed.has(ph)) computed.set(ph, [])
          computed.get(ph)!.push(filePath)
        }
      }
      phashBar.stop()

      // Keep only groups with >1 file
      for (const [ph, paths] of Array.from(computed)) {
        if (paths.length > 1) {
          phashGroups.set(ph, paths)
        }
      }
    }
  }

  // ── Build duplicate groups ──
  const dupGroups: { hash: string; files: string[]; type: string }[] = []

  for (const [hash, paths] of Array.from(shaGroups)) {
    if (paths.length > 1) {
      dupGroups.push({ hash, files: paths, type: 'sha256' })
    }
  }

  // Filter out files already caught by SHA256
  const shaDupPaths = new Set(dupGroups.flatMap(g => g.files))
  for (const [ph, paths] of Array.from(phashGroups)) {
    const filtered = paths.filter(p => !shaDupPaths.has(p))
    if (filtered.length > 1) {
      dupGroups.push({ hash: ph, files: filtered, type: 'phash' })
    }
  }

  const totalDuplicates = dupGroups.reduce((s, g) => s + g.files.length - 1, 0)

  if (totalDuplicates === 0) {
    console.log('\n✅ No se encontraron duplicados.')
    return
  }

  console.log(`\n${totalDuplicates} archivo(s) duplicado(s) encontrados en ${dupGroups.length} grupo(s).`)

  // Compute total duplicate bytes before moving
  const dupBytes = dupGroups.reduce((s, g) => {
    return s + g.files.slice(1).reduce((acc, f) => {
      try { return acc + statSync(f).size } catch { return acc }
    }, 0)
  }, 0)

  // ── Move duplicates ──
  let moved = 0
  if (doMove) {
    console.log(`\n📦 Moviendo duplicados a: ${destDir}`)
    const moveBar = new cliProgress.SingleBar({
      format: 'Moviendo: [{bar}] {percentage}% | {value}/{total}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      clearOnComplete: true,
    })
    const allDups = dupGroups.flatMap(g => g.files.slice(1))
    moveBar.start(allDups.length, 0)

    for (let i = 0; i < allDups.length; i++) {
      const dest = moveFile(allDups[i], destDir)
      moved++
      moveBar.update(i + 1)
    }
    moveBar.stop()
  }

  // ── Report ──
  const elapsed = ((performance.now() - startTime) / 1000 / 60).toFixed(1)
  printReport(allFiles.length, totalBytes, dupGroups, dupBytes, moved, elapsed, destDir, !doMove)
}

main().catch(err => {
  console.error('Error fatal:', err.message)
  process.exit(1)
})
