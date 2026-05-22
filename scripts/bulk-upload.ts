import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, extname, resolve, basename } from 'path';
import { performance } from 'perf_hooks';
import cliProgress from 'cli-progress';

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
]);
const BATCH_SIZE = 10;
const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.RAILWAY_PUBLIC_URL ||
  'http://localhost:3000';

type Result = {
  filepath: string;
  filename: string;
  sizeBytes: number;
  status: 'subido' | 'fallido' | 'duplicado' | 'error';
  error: string;
};

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
  };
  return map[ext] || 'application/octet-stream';
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

interface AuthResult {
  token: string;
  refreshToken?: string;
  user: { id: string; email: string; name: string };
}

async function authenticate(): Promise<string> {
  const token = process.env.BULK_TOKEN;
  if (token) return token;

  const email = process.env.BULK_EMAIL;
  const password = process.env.BULK_PASSWORD;

  if (!email || !password) {
    console.error(
      'Se necesita autenticación.\n' +
        'Opciones:\n' +
        '  1. Exporta BULK_TOKEN=<jwt>\n' +
        '  2. Exporta BULK_EMAIL + BULK_PASSWORD (se logea automático)\n' +
        '  3. Agrélos al .env del backend',
    );
    process.exit(1);
  }

  console.log(`Iniciando sesión como ${email}...`);
  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Error de autenticación (${res.status}): ${text}`);
    process.exit(1);
  }
  const data = (await res.json()) as AuthResult;
  console.log(`Sesión iniciada: ${data.user.name}`);
  return data.token;
}

function scanFiles(dir: string): string[] {
  const results: string[] = [];
  const queue = [resolve(dir)];

  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        queue.push(fullPath);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  return results;
}

async function computePerceptualHash(filePath: string): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default;
    const buffer = readFileSync(filePath);
    const { data: hashData } = await sharp(buffer)
      .resize(8, 8, { fit: 'cover' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const avg = hashData.reduce((a, b) => a + b, 0) / hashData.length;
    const hashBin = Array.from(hashData)
      .map((v) => (v > avg ? '1' : '0'))
      .join('');
    return BigInt('0b' + hashBin)
      .toString(16)
      .padStart(16, '0');
  } catch {
    return null;
  }
}

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

async function uploadBatch(token: string, files: string[]): Promise<Result[]> {
  const fileInfos: { path: string; size: number }[] = [];
  const buffers: Buffer[] = [];
  for (const filePath of files) {
    const ext = extname(filePath).toLowerCase();
    const buffer = readFileSync(filePath);
    buffers.push(buffer);
    fileInfos.push({ path: filePath, size: buffer.length });
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const form = new FormData();
    for (let i = 0; i < files.length; i++) {
      const blob = new Blob([new Uint8Array(buffers[i])], {
        type: getMimeType(extname(files[i]).toLowerCase()),
      });
      form.append('files', blob, basename(files[i]));
    }

    try {
      const res = await fetch(`${BACKEND_URL}/photos/upload-batch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const ok = res.ok;
      const text = ok ? '' : await res.text();
      if (ok) {
        return fileInfos.map((f) => ({
          filepath: f.path,
          filename: basename(f.path),
          sizeBytes: f.size,
          status: 'subido' as const,
          error: '',
        }));
      }
      const errMsg = `HTTP ${res.status}: ${text}`;
      if (attempt < MAX_RETRIES && (res.status >= 500 || res.status === 429)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.error(
          `  ⚠️  Lote falló con ${res.status}, reintentando en ${delay / 1000}s (intento ${attempt + 1}/${MAX_RETRIES})...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return fileInfos.map((f) => ({
        filepath: f.path,
        filename: basename(f.path),
        sizeBytes: f.size,
        status: 'fallido' as const,
        error: errMsg,
      }));
    } catch (err: any) {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.error(
          `  ⚠️  Error de red: ${err.message} — reintentando en ${delay / 1000}s (intento ${attempt + 1}/${MAX_RETRIES})...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return fileInfos.map((f) => ({
        filepath: f.path,
        filename: basename(f.path),
        sizeBytes: f.size,
        status: 'error' as const,
        error: err.message,
      }));
    }
  }

  return fileInfos.map((f) => ({
    filepath: f.path,
    filename: basename(f.path),
    sizeBytes: f.size,
    status: 'error' as const,
    error: 'Max retries exceeded',
  }));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function main() {
  const dirPath = process.argv[2];
  if (!dirPath) {
    console.error('Uso: npm run subir-masivo -- /ruta/al/disco');
    console.error('  --no-dedup   Saltar detección de duplicados');
    process.exit(1);
  }

  const skipDedup = process.argv.includes('--no-dedup');
  const startTime = performance.now();

  console.log(`📂 Escaneando ${dirPath}...`);
  const allFiles = scanFiles(dirPath);
  const totalBytes = allFiles.reduce((sum, f) => {
    try {
      return sum + statSync(f).size;
    } catch {
      return sum;
    }
  }, 0);
  console.log(
    `Encontrados ${allFiles.length} archivos (${formatBytes(totalBytes)})`,
  );

  const token = await authenticate();

  const results: Result[] = [];

  if (!skipDedup) {
    console.log(
      '🔍 Cargando hashes existentes para detección de duplicados...',
    );
    const { PrismaClient } = await import('@prisma/client');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error(
        'DATABASE_URL es requerida para detección de duplicados. Usa --no-dedup para saltar.',
      );
      process.exit(1);
    }
    const adapter = new PrismaPg(
      { connectionString },
      { schema: process.env.DATABASE_SCHEMA || 'public' },
    );
    const prisma = new PrismaClient({ adapter });

    const existing = await prisma.photo.findMany({
      where: { deletedAt: null, perceptualHash: { not: null } },
      select: { perceptualHash: true },
    });
    const hashSet = new Set(existing.map((p) => p.perceptualHash));
    await prisma.$disconnect();
    console.log(`Biblioteca: ${hashSet.size} hashes únicos`);

    console.log('🔎 Calculando perceptual hash de cada archivo...');
    const dedupBar = new cliProgress.SingleBar({
      format: 'Hash: [{bar}] {percentage}% | {value}/{total} | {current}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      clearOnComplete: true,
    });
    dedupBar.start(allFiles.length, 0, { current: '' });

    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      dedupBar.update(i, { current: basename(file) });
      const hash = await computePerceptualHash(file);
      if (hash && hashSet.has(hash)) {
        results.push({
          filepath: file,
          filename: basename(file),
          sizeBytes: statSync(file).size,
          status: 'duplicado',
          error: '',
        });
        continue;
      }
    }
    dedupBar.stop();
    console.log(
      `Duplicados: ${results.filter((r) => r.status === 'duplicado').length}`,
    );
  }

  const toUpload = skipDedup
    ? allFiles
    : allFiles.filter((f) => !results.some((r) => r.filepath === f));

  if (toUpload.length === 0) {
    const csvPath = writeCsv(results, dirPath);
    console.log(`✅ No hay archivos nuevos para subir. CSV: ${csvPath}`);
    return;
  }

  console.log(
    `\n📤 Subiendo ${toUpload.length} archivo(s) en lotes de ${BATCH_SIZE}...`,
  );

  const uploadBar = new cliProgress.SingleBar({
    format:
      'Subida: [{bar}] {percentage}% | {value}/{total} archivos | {speed}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
  });
  uploadBar.start(toUpload.length, 0, { speed: '' });

  const lastUpdate = { time: performance.now(), count: 0 };

  for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
    const batch = toUpload.slice(i, i + BATCH_SIZE);
    const batchResults = await uploadBatch(token, batch);
    results.push(...batchResults);

    const done = results.filter(
      (r) =>
        r.status === 'subido' || r.status === 'fallido' || r.status === 'error',
    ).length;

    const now = performance.now();
    const elapsed = (now - lastUpdate.time) / 1000;
    if (elapsed > 2) {
      const speed = ((done - lastUpdate.count) / elapsed) * BATCH_SIZE;
      const speedStr = `${formatBytes(speed * 1024 * 1024)}/s`;
      uploadBar.update(done, { speed: speedStr });
      lastUpdate.time = now;
      lastUpdate.count = done;
    } else {
      uploadBar.update(done);
    }
  }

  uploadBar.stop();

  const uploaded = results.filter((r) => r.status === 'subido').length;
  const failed = results.filter(
    (r) => r.status === 'fallido' || r.status === 'error',
  ).length;
  const duplicates = results.filter((r) => r.status === 'duplicado').length;
  const uploadedBytes = results
    .filter((r) => r.status === 'subido')
    .reduce((s, r) => s + r.sizeBytes, 0);

  const csvPath = writeCsv(results, dirPath);

  const elapsed = ((performance.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n${'='.repeat(40)}`);
  console.log(`📊  REPORTE FINAL`);
  console.log(`${'='.repeat(40)}`);
  console.log(`  Subidos:     ${uploaded}`);
  console.log(`  Fallidos:    ${failed}`);
  console.log(`  Duplicados:  ${duplicates}`);
  console.log(`  Total datos: ${formatBytes(uploadedBytes)}`);
  console.log(`  Tiempo:      ${elapsed} min`);
  console.log(`  CSV:         ${csvPath}`);
  console.log(`${'='.repeat(40)}`);
}

function writeCsv(results: Result[], dirPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dirName = basename(resolve(dirPath));
  const csvPath = `bulk-upload_${dirName}_${timestamp}.csv`;

  let csv = 'filepath,filename,size_bytes,status,error\n';
  for (const r of results) {
    csv += `${escapeCsv(r.filepath)},${escapeCsv(r.filename)},${r.sizeBytes},${r.status},${escapeCsv(r.error)}\n`;
  }

  const uploaded = results.filter((r) => r.status === 'subido').length;
  const failed = results.filter(
    (r) => r.status === 'fallido' || r.status === 'error',
  ).length;
  const duplicates = results.filter((r) => r.status === 'duplicado').length;
  csv += `\n# Resumen: ${uploaded} subidos, ${failed} fallidos, ${duplicates} duplicados\n`;
  csv += `# Fecha: ${new Date().toISOString()}\n`;

  writeFileSync(csvPath, csv, 'utf-8');
  return csvPath;
}

main().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
