# Plan de Reorganización de R2

## Objetivo

- Eliminar originales (`uploads/`) de R2 para ahorrar espacio (~40 GB)
- Reorganizar fotos y videos en estructura espejo del backup local con userId
- Fotos: `fotos/{userId}/{año}/{mes}/...`, `thumbs/{userId}/fotos/{año}/{mes}/...`
- Videos: `videos/{userId}/...`, `thumbs/{userId}/videos/{año}/{mes}/...`
- Subir fotos desde local generando solo master (2048px) + thumb (300px), sin original

---

## Fase 1 ✅ Constantes

**`src/common/constants.ts`**
- `LARGE_RESIZE = 1920 → 2048`
- `LARGE_QUALITY = 85`

---

## Fase 2 ✅ Migrar videos + re-subir faltantes + limpiar huérfanos

| Paso | Estado |
|---|---|
| `migrate-videos-r2.ts --execute` | ✅ 761 videos migrados |
| `upload-missing-videos.ts` | ✅ 82 videos faltantes re-subidos |
| Borrar 8 huérfanos de R2 | ✅ ~600 MB recuperados |

Scripts eliminados post-ejecución.

---

## Fase 3 ✅ Limpiar R2 de fotos

**`scripts/clean-r2-photos.ts --force`**
- `uploads/` — 12,420 objetos (39.2 GB) ✅ eliminado
- `thumbnails/` — 12,062 objetos (160 MB) ✅ eliminado
- `large/` — 12,384 objetos (4.7 GB) ✅ eliminado

Script eliminado post-ejecución.

---

## Fase 4 ✅ Limpiar DB de registros de imágenes

**`scripts/clean-db-images.ts --execute`**

Elimina todos los `Photo` donde `mimeType LIKE 'image/%'`. Los videos se conservan.

Script eliminado post-ejecución.

---

## Fase 5 ✅ Modificar workers (no subir originales, userId en paths)

### `src/photos/upload.worker.ts`
- ❌ No sube original a `uploads/`
- ✅ Sube master a `fotos/{userId}/{año}/{mes}/{fmt(date)}.jpg`
- ✅ Sube thumb a `thumbs/{userId}/fotos/{año}/{mes}/{fmt(date)}.jpg`
- `s3Key` en BD → apunta a `fotos/...`

### `scripts/bulk-upload.ts`
- ❌ No sube original
- ✅ Sube master + thumb con userId en path
- ✅ Usa `LARGE_RESIZE = 2048`
- ✅ Usa `failOn: 'none'` para forzar procesamiento de JPEGs corruptos
- ✅ Sufijos de conflicto tipo Excel: `_A`, `_B`...`_Z`, `_AA`, `_AB`...
- Videos: solo se sube el archivo (sin thumbnail en bulk)

---

## Fase 6 ✅ Servicios — no requieren cambios

`photos.service.ts`, `faces.service.ts`, `analysis.service.ts`, `export.worker.ts`
- Ya usan `s3Key` que ahora apunta a `fotos/...` o `videos/...`
- Sin cambios adicionales

---

## Fase 7 ✅ Subir fotos desde backup local

**`scripts/bulk-upload.ts`**

```bash
cd vaulta_backend
BULK_EMAIL=hpave954@gmail.com npx ts-node scripts/bulk-upload.ts /mnt/c/Users/Hector/Pictures/Respaldo/fotos --no-dedup
```

Genera:
- `fotos/{userId}/{año}/{mes}/{YYYY-MM-DD_HHMMSS}.jpg` (2048px, Q85)
- `thumbs/{userId}/fotos/{año}/{mes}/{YYYY-MM-DD_HHMMSS}.jpg` (300px, Q70)
- No almacena original en R2

**Resultado final:**
- 12,181 fotos subidas ✅
- 40 fallidos originales → 39 re-subidos con `failOn: 'none'` ✅
- 1 corrupto permanente: `2017-01-01_120000_C.jpg` (formato no soportado)
- 152 duplicados de pruebas anteriores eliminados ✅

---

## Fase 8 🔲 Separación Fotos/Videos en la app (futuro)

- Endpoint `GET /photos?type=fotos|videos`
- Pestañas separadas en frontend

---

## Fase 9 🔲 Compresión de videos en R2 (pendiente)

**Objetivo:** Reducir tamaño de los 762 videos en R2 transcodificando a 1080p H.264.

**Estrategia propuesta:**
1. Leer videos desde **backup local** (no tocar R2 todavía)
2. Transcodificar con ffmpeg a 1080p H.264 (reducción ~50-70%)
3. Generar thumbnails si faltan
4. Sobrescribir en R2 con versión comprimida
5. Actualizar tamaños en DB

**Consideraciones:**
- Tiempo estimado: 25-60 horas de procesamiento (762 videos)
- Requiere backup local intacto antes de tocar R2
- Pierde calidad original (irreversible)
- Script: `scripts/compress-videos.ts` (a crear)

**Estado:** Pendiente para futura sesión. Por ahora se trabaja con originales en R2.

---

## Scripts activos

Solo quedan 2 scripts en `vaulta_backend/scripts/`:

| Script | Propósito |
|---|---|
| `bulk-upload.ts` | Subida masiva desde disco local a R2 + DB |
| `verify-sync.ts` | Verificación de sincronización DB/R2/Local |

**19 scripts eliminados** tras completar la migración.

---

## Resumen de estado

| Fase | Estado |
|---|---|
| 1 Constantes | ✅ |
| 2 Migrar videos | ✅ |
| 3 Limpiar R2 fotos | ✅ |
| 4 Limpiar DB imágenes | ✅ |
| 5 Workers | ✅ |
| 6 Servicios | ✅ |
| 7 Bulk upload | ✅ |
| 8 App tabs | 🔲 Futuro |
| 9 Video compression | 🔲 Pendiente |

---

## Notas

- Meses en español: `01-Enero`, `02-Febrero`, ..., `12-Diciembre`
- Formato fecha: `YYYY-MM-DD_HHMMSS`
- Sufijo conflictos: `_A`, `_B`, `_C`, ... `_Z`, `_AA`, `_AB`, etc. (estilo Excel)
- `withoutEnlargement: true` — no agranda fotos más pequeñas que 2048px
- `.3gp` ignorados (no tienen registro en DB)
- `userId` incluido en todas las rutas de R2
- Archivo corrupto persistente: `2017-01-01_120000_C.jpg` — formato no soportado por sharp, posiblemente archivo corrupto en origen
