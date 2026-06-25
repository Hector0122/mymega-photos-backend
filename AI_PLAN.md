# AI_PLAN — Subida masiva de fotos

## Visión general

Un script que corre **localmente en tu laptop** (no en Railway, no en el celular):

1. **Subida masiva** — Volcar ~100GB de fotos desde un disco duro externo a R2 + Neon
2. **Post‑subida** — Detección facial automática lote por lote

No requiere cambios en la APK ni en Railway. Todo el cómputo pesado corre en tu Mac.

---

## Estrategia: 20GB por lote

| Razón | Detalle |
|---|---|
| RAM del servidor | 5 procesos `face‑api` simultáneos → ~1–2.5 GB RAM + 500% CPU. En un VPS pequeño (Railway) subir todo de golpe y disparar `detect‑all` puede matarlo por OOM |
| Incremental | Subes 20 GB → corres `detect‑all` → ya puedes usar la app con ese lote mientras subes el siguiente |
| Tolerancia a fallos | Si la subida se corta a los 85 GB, solo pierdes el lote actual |
| Tiempo de detección | 20 GB ≈ ~4–5 mil fotos → ~20 min de detección vs 1.5 h seguidas |

### Flujo recomendado

```
Por cada lote de 20GB:
  1. Subir fotos (script bulk-upload)
  2. Esperar a que Railway procese (thumbnails, blur, hash)
  3. Llamar POST /faces/detect-all (worker thread, 5 en paralelo, ~20min)
  4. Verificar resultados
  5. Pasar al siguiente lote
```

---

## Fase 1: Subida masiva (disco duro → R2)

### Qué hace

El script `scripts/bulk-upload.ts` lee todas las fotos de una carpeta en tu disco externo y las sube
al backend de Railway usando el endpoint `POST /photos/upload-batch`. Las fotos se procesan
igual (thumbnail, blur, hash) y quedan en R2 + Neon.

### Cómo se ejecuta

```bash
cd vaulta_backend
npx ts-node scripts/bulk-upload.ts /Volumes/DiscoExterno/fotos
```

### Detalles

- Escanea recursivamente la carpeta buscando `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.mp4`, etc.
- Usa autenticación JWT (pide email y password al iniciar)
- Sube en lotes de 10 archivos (`BATCH_SIZE = 10`) para no saturar Railway
- **Detección de duplicados**: antes de subir, compara perceptual hash de cada foto contra las que ya están en la DB — si existe exactamente igual, la salta
- Barra de progreso en terminal
- Reporte final (CSV): cuántas subió, cuántas fallaron, cuántos duplicados saltados

### Post‑subida: detección facial

Después de cada lote de 20 GB, ejecutar la detección facial:

```bash
TOKEN=$(curl -s -X POST $BACKEND_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"..."}' | jq -r '.token')

curl -X POST "$BACKEND_URL/faces/detect-all" \
  -H "Authorization: Bearer $TOKEN"
```

Esto corre en un **worker thread** separado (no bloquea el event loop) y procesa
5 fotos en paralelo. Cada foto:
1. Se descarga de R2 a `/tmp`
2. Se pasa a `face-detect.mjs` (child process con `@vladmandic/face-api`)
3. Se guardan los descriptores (128‑dim) en la DB
4. Se auto‑match contra personas existentes (si hay coincidencia < 0.5, se confirma automático)
5. Se limpia el archivo temporal

### Automatización (opcional)

Puedes crear un script wrapper que haga el ciclo completo:

```bash
#!/bin/bash
# upload-and-detect.sh

LOTE_GB=20
TOTAL_GB=100
BACKEND_URL="https://tu-app.railway.app"

for ((lote=1; lote<=TOTAL_GB/LOTE_GB; lote++)); do
  echo "=== Lote $lote de $((TOTAL_GB/LOTE_GB)) ==="

  # Subir 20GB
  npx ts-node scripts/bulk-upload.ts /Volumes/DiscoExterno/fotos \
    --max-gb $LOTE_GB --offset-gb $(( (lote-1) * LOTE_GB ))

  # Esperar a que Railway procese
  sleep 30

  # Detectar caras
  TOKEN=$(curl -s -X POST $BACKEND_URL/auth/login ... | jq -r '.token')
  curl -X POST "$BACKEND_URL/faces/detect-all" \
    -H "Authorization: Bearer $TOKEN"

  # Monitorear progreso (opcional)
  echo "Lote $lote completado. Esperando 5 min antes del siguiente..."
  sleep 300
done
```

---

## Optimizaciones de escala aplicadas

| Mejora | Archivo | Qué hace |
|---|---|---|
| Índice compuesto `[confirmed, ignored, personName]` | `schema.prisma` + migración | Acelera consultas de caras no confirmadas |
| Índice en `Face.createdAt` | `schema.prisma` + migración | Evita sort en memoria en `getPeople` |
| Worker thread en `findMoreFaces` | `find-more.worker.ts` | Comparación de descriptores fuera del event loop |
| Batches de 500 en `findMoreFaces` | `faces.service.ts` | Reduce memoria: 500 caras por lote en vez de todas |
| Worker thread en `detect-all` | `detect-all.worker.ts` | Detección facial completa en hilo separado |
| Concurrencia 5 en `detectBatch` | `faces.service.ts` | 5 fotos en paralelo vs 1 por 1 |

## Límites conocidos

| Operación | Sin cambios | Con optimizaciones |
|---|---|---|
| `detect-all` (20k fotos) | ~8h secuencial, bloquea server | ~20 min en worker, 5 paralelo |
| `findMoreFaces` (60k caras) | Brute force en main thread, ~3 s | Worker thread + batches, ~1 s |
| `getPeople` (60k registros) | Sort en memoria sin índice | Indexado por `createdAt` |
| Timeline / Home | Paginación cursor 50‑foto | Sin cambios, escala bien |

---

## Costos

| Componente | Hoy | Con Fase 1 |
|---|---|---|
| Railway | $0–5/mes | $0–5/mes |
| Neon | $0 | $0 |
| R2 (100 GB) | ~$1.35/mes | ~$1.35/mes |
| **Total** | **~$1–6/mes** | **~$1–6/mes** |

El script corre en tu laptop — **$0 extra**.

---

## Resumen de comandos

```bash
# Subir fotos del disco duro a la nube (salta duplicados automático)
npx ts-node scripts/bulk-upload.ts /ruta/al/disco

# Detectar caras en todas las fotos sin procesar
curl -X POST "$BACKEND_URL/faces/detect-all" -H "Authorization: Bearer $TOKEN"

# Buscar coincidencias no detectadas de una persona
curl "$BACKEND_URL/faces/find-more?person=Nombre" -H "Authorization: Bearer $TOKEN"

# Eliminar todo (para empezar de cero)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login ... | jq -r '.token')
curl -s -X DELETE http://localhost:3000/photos/all \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"DELETE_ALL"}'
```

---

## Notas técnicas

### Conexión a Neon

El script se conecta directamente a tu Neon para leer metadatos de fotos
(userId, s3Keys, etc.) usando la misma `DATABASE_URL` que tu backend.

### Variables de entorno necesarias

```bash
export DATABASE_URL="postgresql://..."
export BACKEND_URL="https://tu-app.railway.app"
export JWT_TOKEN="..."  # o usa login interactivo
```

---

## Large Image (1920px) — Feature complete

Generación automática de una versión intermedia (1920px, JPEG 85%) entre el thumbnail (300px) y el original full-resolution. El objetivo es que PhotoPreview cargue ~200-500 KB en vez de 3-12 MB.

### Arquitectura

```
Original (full res, ~6.5 MB) ──► Large (1920px, ~300 KB) ──► Thumbnail (300px, ~13 KB)
     │                                                             │
     ▼                                                             ▼
  Download/export                                             PhotoPreview
  (si el usuario quiere                                     (carga instantánea)
   la máxima calidad)
```

Tres archivos por foto en R2:
| Tipo | Prefijo R2 | Tamaño | Uso |
|---|---|---|---|
| Original | `uploads/` | 3-12 MB | Download/export |
| Large | `large/` | 200-500 KB | **PhotoPreview** (ZoomableImage) |
| Thumbnail | `thumbnails/` | 10-20 KB | Grid/blurred background |

Los videos se excluyen (ya se stremean, no tienen zoom ni thumbnail poster).

### Cambios realizados

#### Backend

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Campo `largeS3Key String?` en `Photo` + indexes `[filename]`, `[mimeType]`, `[tags]` (restaurados) |
| Migración | `20260624232211_add_large_s3_key` — añade columna a PostgreSQL |
| `src/common/constants.ts` | `LARGE_RESIZE = 1920`, `LARGE_QUALITY = 85` |
| `src/photos/upload.worker.ts` | Genera large con sharp (1920px, `fit: 'inside'`, `withoutEnlargement: true`) después del thumbnail, sube a `large/{userId}/{timestamp}-{filename}`, guarda `largeS3Key` en DB |
| `src/photos/photos.service.ts` | `getPhotos`, `getPhotoDetail`, `getThisDayPhotos`, `getMemories`, `getTrash` devuelven `largeUri` (presigned URL de la versión large) |
| `src/albums/albums.service.ts` | `getPhotos` (album listing) devuelve `largeUri` |

#### Frontend

| Archivo | Cambio |
|---|---|
| `api/client.ts` | `fetchPhotosPage` y `getPhotoDetail` tipados con `largeUri: string \| null` |
| `pages/PhotoPreview/index.tsx` | `PhotoItem` agrega `largeUri`. `PhotoPage` tiene estado `largeUri` separado. `ZoomableImage` usa `largeUri ?? fullUri ?? item.uri`. Prefetch de adyacentes usa `largeUri` si existe. |
| `pages/Home/utils.ts` | Tipo `Photo` agrega `largeUri?: string \| null` |
| `pages/Home/index.tsx` | Pasa `largeUri` al navegar a PhotoPreview |
| `pages/Albums/AlbumView.tsx` | Tipo `Photo` agrega `fullUri` y `largeUri`, los pasa al navegar |
| `components/RecuerdosSection.tsx` | Tipo `Recuerdo` agrega `largeUri` |

### Backfill para fotos existentes

Script que procesa las ~13k fotos existentes que aún no tienen versión large.

```
scripts/generate-large-versions.ts
```

**Uso por tandas (recomendado para no saturar la red):**

```bash
cd vaulta_backend

# Tanda 1: procesa 1500 fotos (~30-45 min)
npm run generate-large -- --limit=1500

# Tanda 2...N: repetir hasta que salga "No hay fotos pendientes"
npm run generate-large -- --limit=1500
```

**Características del script:**
- Concurrencia 3 (bajo perfil de red)
- Las fotos ya procesadas se saltan automáticamente (filtra `largeS3Key IS NULL`)
- Se puede interrumpir con Ctrl+C y reanudar sin duplicar trabajo
- Barra de progreso con: %, OK/FAIL, MB descargados/subidos, ETA, nombre del archivo actual, compresión obtenida
- Muestra errores completos (sin límite)
- Resumen final con tiempo, MB y % de ahorro

**Estimación de recursos para backfill completo:**

| Concepto | Valor |
|---|---|
| Fotos sin large | ~13,100 |
| Descarga estimada | ~59 GB (13k × 4.5 MB) |
| Subida estimada | ~3.9 GB (13k × 300 KB) |
| Tiempo estimado | ~4-6 h (con 1500/tanda) |
| Ahorro en descarga para la app | ~95% (6.5 MB → 300 KB por foto) |

**Fotos nuevas:** No requieren backfill — el upload worker ya genera la versión large automáticamente.

### Costos adicionales en R2

| Concepto | Valor |
|---|---|
| Archivos nuevos | ~13,100 |
| Almacenamiento extra | ~3.9 GB |
| Costo R2 extra/mes | ~$0.06 |
| **Total R2** | **~$1.41/mes** (84.4 GB actual + 3.9 GB large)
```
