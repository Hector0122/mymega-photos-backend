# Vaulta — Plan de limpieza y bugs (histórico)

---

## ✅ Bugs solventados

| # | Bug | Fix |
|---|---|---|
| 1 | **401 en `/photos/:id/stream`** al descargar/compartir/guardar offline | Cabeceras `Authorization` en `RNFS.downloadFile` — commit `1f8daeb` |
| 2 | **ffmpeg en Railway** — ENOENT con `ffmpeg-static` | Fallback a `which ffmpeg` + `nixpacks.toml` |
| 3 | **Pantalla negra al descargar offline** | Overlay de carga |
| 4 | **Auto-delete papelera 30 días** | Implementado en `cleanExpiredTrash` en `onModuleInit` |

---

## ✅ Optimizaciones ya implementadas en el remoto

| # | Cambio | Estado |
|---|---|---|
| 1 | Extraer `computeBlurScore` y `computePerceptualHash` a `src/common/image-analysis.ts` | ✅ Hecho |
| 2 | Centralizar `getBucketName()` en `s3.provider.ts` | ✅ Hecho |
| 3 | Extraer `findOwnedPhoto()` en `photos.service.ts` | ✅ Hecho |
| 4 | Eliminar `uploadPhoto()` muerto | ✅ Hecho |
| 5 | Eliminar import no usado `publicObjectUrl` en `export.service.ts` | ✅ Hecho |
| 6 | Extraer `fetchWithTimeout` a util compartido | ✅ Hecho (`api/fetchWithTimeout.ts`) |
| 9 | Centralizar `604800` (7 días), `300` (resize), `70` (JPEG quality), `ALLOWED_MIMES` en constantes | ✅ Hecho (`common/constants.ts`) |
| 12 | Extraer config de upload a factory function | ✅ Hecho |
| 18 | Dividir `Home/index.tsx` (extraídos `HomeEmptyState.tsx`, `PhotoGridItem.tsx`) | ✅ Hecho |

---

## 🧹 Plan de limpieza de código (pendiente)

Priorizado por tipo de cambio y riesgo.

### 🏆 Prioridad Alta (sin riesgo, alto impacto)

| # | Cambio | Archivos |
|---|---|---|
| 1 | **Extraer `computeBlurScore` y `computePerceptualHash`** a `src/common/image-analysis.ts` — triplicados en `photos.service.ts`, `upload.worker.ts` y `analysis.service.ts` | 3 archivos, ~80 líneas c/u |
| 2 | **Centralizar `getBucketName()`** en `s3.provider.ts` — patrón `R2_BUCKET_NAME \|\| AWS_S3_BUCKET` repetido en 4 servicios | `photos.service.ts`, `albums.service.ts`, `migration.service.ts`, `analysis.service.ts` |
| 3 | **Extraer `findOwnedPhoto()`** — guard `if (!photo \|\| photo.userId !== userId \|\| photo.deletedAt)` aparece ~10 veces en `photos.service.ts` | `photos.service.ts` |
| 4 | **Eliminar `uploadPhoto()` muerto** — método de 57 líneas que ningún controller llama | `photos.service.ts:222-278` |
| 5 | **Eliminar import no usado** `publicObjectUrl` en `export.service.ts` | `export.service.ts:14` |

### 🥈 Prioridad Media

| # | Cambio | Detalle |
|---|---|---|
| 6 | **Extraer `fetchWithTimeout`** a util compartido — duplicado en `client.ts` y `auth.ts` | Frontend |
| 7 | **Reemplazar `any` por tipos concretos** en 7 componentes (usar `useTheme()` en vez de props `colors: any`) | `AlbumPickerModal`, `DateRangePicker`, `FABMenu`, `FilterBar`, `RecuerdosSection`, `SelectionBar`, `Skeleton` |
| 8 | **Extraer `fetchPhotosPage` params** a objeto `FetchPhotosOptions` en vez de 8 params posicionales | `client.ts:181` |
| 9 | **Centralizar `604800` (7 días)** en constante compartida — aparece en ~10 lugares en 5 archivos | Backend y frontend |
| 10 | **Centralizar `300` (resize) y `70` (JPEG quality)** en constantes | Backend |
| 11 | **Eliminar `dateRange()` duplicado** — existe en `Home/index.tsx` y `Home/utils.ts` | Frontend |
| 14 | **Agregar logging a `catch {}` silenciosos** — ~25 catches vacíos en frontend y 4 en backend | Múltiples archivos |

### 🥉 Prioridad Baja (cosméticos / opcionales)

| # | Cambio | Detalle |
|---|---|---|
| 15 | **Mover `as any` de `FormData`** a tipo correcto de React Native | `Upload/index.tsx:111`, `UploadQueue.ts:107` |
| 16 | **Dividir `photos.controller.ts`** (316 → ~150) extrayendo lógica de stream y JWT | Backend |
| 17 | **Dividir `photos.service.ts`** (650 → servicios más pequeños: crud, upload, analysis) | Backend |
| 19 | **Eliminar `void` innecesario** en `main.ts:15` y `data: unknown` no usado en decorator | Backend |
| 20 | **Agregar try-catch a `jwt.verify()`** en `/photos/:id/stream` para que devuelva 401 en vez de 500 | `photos.controller.ts:186-198` |
| 21 | **Estandarizar semicolon vs no-semicolon** (mix en frontend) | Frontend |
| 22 | **Eliminar `handleFavoriteToggle` vacío** en `PhotoPreview` | Frontend |
| 23 | **Eliminar `groupPhotosByDate()` no usado** en `Home/utils.ts` | Frontend |
