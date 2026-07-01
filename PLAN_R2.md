# Plan de Reorganización de R2

## Objetivo

- Eliminar originales (`uploads/`) de R2 para ahorrar espacio (~40 GB)
- Reorganizar fotos y videos en estructura espejo del backup local con userId
- Fotos: `large/{userId}/fotos/...`, `thumbs/{userId}/fotos/...`
- Videos: `videos/{userId}/...`, `thumbs/{userId}/videos/...`
- Subir fotos desde local generando solo large (2048px) + thumb (300px), sin original

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

Scripts: `scripts/migrate-videos-r2.ts`, `scripts/upload-missing-videos.ts`

---

## Fase 3 ✅ Limpiar R2 de fotos

**`scripts/clean-r2-photos.ts --force`**
- `uploads/` — 12,420 objetos (39.2 GB) ✅ eliminado
- `thumbnails/` — 12,062 objetos (160 MB) ✅ eliminado
- `large/` — 12,384 objetos (4.7 GB) ✅ eliminado

---

## Fase 4 ⬜ Limpiar DB de registros de imágenes

**`scripts/clean-db-images.ts`**

Elimina todos los `Photo` donde `mimeType LIKE 'image/%'`. Los videos se conservan.

```bash
npx ts-node scripts/clean-db-images.ts --dry-run   # simular
npx ts-node scripts/clean-db-images.ts --execute    # ejecutar
```

---

## Fase 5 ✅ Modificar workers (no subir originales, userId en paths)

### `src/photos/upload.worker.ts`
- ❌ No sube original a `uploads/`
- ✅ Sube large a `large/{userId}/fotos/{año}/{mes}/{fmt(date)}.jpg`
- ✅ Sube thumb a `thumbs/{userId}/fotos/{año}/{mes}/{fmt(date)}.jpg`
- `s3Key` en BD → apunta a `large/...`

### `scripts/bulk-upload.ts`
- ❌ No sube original
- ✅ Sube large + thumb con userId en path
- ✅ Usa `LARGE_RESIZE = 2048`
- Videos: solo se sube el archivo (sin thumbnail en bulk)

---

## Fase 6 ✅ Servicios — no requieren cambios

`photos.service.ts`, `faces.service.ts`, `analysis.service.ts`, `export.worker.ts`
- Ya usan `s3Key` que ahora apunta a `large/...` o `videos/...`
- Sin cambios adicionales

---

## Fase 7 ⬜ Subir fotos desde backup local

**`scripts/bulk-upload.ts`**

```bash
cd vaulta_backend
npx ts-node scripts/bulk-upload.ts /mnt/c/Users/Hector/Pictures/Respaldo/fotos --email tu@email.com
```

Genera:
- `large/{userId}/fotos/{año}/{mes}/{YYYY-MM-DD_HHMMSS}.jpg` (2048px, Q85)
- `thumbs/{userId}/fotos/{año}/{mes}/{YYYY-MM-DD_HHMMSS}.jpg` (300px, Q70)
- No almacena original en R2

---

## Fase 8 🔲 Separación Fotos/Videos en la app (futuro)

- Endpoint `GET /photos?type=fotos|videos`
- Pestañas separadas en frontend

---

## Resumen de comandos (ejecución ordenada)

```bash
# ✅ YA EJECUTADOS:
cd vaulta_backend
npx ts-node scripts/migrate-videos-r2.ts --execute        # Fase 2
npx ts-node scripts/upload-missing-videos.ts              # Fase 2b
# (borrar 8 huérfanos manual)
npx ts-node scripts/clean-r2-photos.ts --force            # Fase 3

# ⬜ PENDIENTES:
npx ts-node scripts/clean-db-images.ts --dry-run          # Fase 4
npx ts-node scripts/clean-db-images.ts --execute          # Fase 4
npx ts-node scripts/bulk-upload.ts /mnt/c/Users/Hector/Pictures/Respaldo/fotos --email <email>  # Fase 7
```

---

## Notas

- Meses en español: `01-Enero`, `02-Febrero`, ..., `12-Diciembre`
- Formato fecha: `YYYY-MM-DD_HHMMSS`
- Sufijo conflictos: `_A`, `_B`, `_C`, ...
- `withoutEnlargement: true` — no agranda fotos más pequeñas que 2048px
- `.3gp` ignorados (no tienen registro en DB)
- `userId` incluido en todas las rutas de R2
