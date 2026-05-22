# Vaulta — Feature overview

## ✅ Implementadas

### Core UX
| # | Feature | Archivos |
|---|---------|----------|
| 1 | **Pull-to-refresh + error/empty states** en Home | `frontend/pages/Home/index.tsx` — `RefreshControl`, estado `error`, pantalla vacía con icono |
| 2 | **Cámara directa** — tomar foto desde la app | `frontend/pages/Upload/index.tsx` — botón "Cámara" usa `launchCamera` |
| 3 | **Slideshow entre fotos** — deslizar izq/der en preview | `frontend/pages/PhotoPreview/index.tsx` — `ScrollView` horizontal con `pagingEnabled` y `width: screenWidth` explícito |
| 4 | **Subir sin base64 (multipart)** | `frontend/pages/Upload/index.tsx` — `FormData`; `backend/src/app.controller.ts` — `FileInterceptor` |
| 5 | **Caché local con AsyncStorage** | `frontend/api/cache.ts` — `loadCachedPhotos` / `saveCachedPhotos`; `frontend/pages/Home/index.tsx` — cache-then-refresh |
| 6 | **Selección múltiple + batch** | `frontend/pages/Home/index.tsx` — long press, action bar con descargar/compartir/eliminar/añadir a álbum, seleccionar todo/ninguna |
| 7 | **Paginación infinita** | `backend/src/app.service.ts` — Prisma cursor-based; `frontend/pages/Home/index.tsx` — scroll infinito, 50 fotos por página |
| 8 | **FAB animado expandible** | `frontend/pages/Home/index.tsx` — FAB principal con sub-botones animados (galería + cámara + video) |
| 9 | **Filtro por rango de fechas** | `frontend/pages/Home/index.tsx` — modal con `Calendar` (`react-native-calendars`), selección inicio/fin en un solo paso, búsqueda automática; `backend/src/app.service.ts` — `createdAt` gte/lte en Prisma |
| 10 | **Subida múltiple batch** (selección desde galería) + worker thread + notificación push al terminar | `frontend/pages/Upload/index.tsx` — `launchImageLibrary` con `selectionLimit: 0`, grid de thumbnails, fire-and-forget a `POST /photos/upload-batch`; `backend/src/photos/upload.worker.ts` — worker thread con S3 upload + thumbnail + blurScore + perceptualHash + DB insert + cleanup temp files; `backend/src/photos/photos.service.ts` — `startBatchUpload()` con mapa de progreso y Firebase notificación al completar |
| 11 | **Edición básica de imagen** (recortar cuadrado) | `frontend/pages/Upload/index.tsx` — `@react-native-community/image-editor` |
| 12 | **MasonryGrid custom** — Grid 2-columnas propio (reemplazó `react-native-masonry-list`) | `frontend/pages/Home/index.tsx` — implementación manual con `numColumns: 2` |
| 14 | **Splash screen themable** — Fondo blanco (light), #121212 (dark) según tema | `frontend/theme.ts` |

### Organización
| # | Feature | Archivos |
|---|---------|----------|
| 15 | **Autenticación JWT** (login/register) | `backend/src/auth/` — módulo NestJS con JWT strategy, guards, decorators; `frontend/pages/Login/`; `frontend/context/AuthContext.tsx` |
| 16 | **Refresh token rotation** — `POST /auth/refresh`, tokens de 40 bytes hex hasheados, one-time use | `backend/src/auth/auth.service.ts` — rotación; `frontend/api/client.ts` — renovación automática |
| 17 | **Álbumes / Colecciones** | `backend/src/albums/` — CRUD de álbumes, asociar/desasociar fotos; `frontend/pages/Albums/` — vista con galería por álbum |
| 18 | **Favoritos** | `backend/src/app.controller.ts` — `PATCH /photos/:id/favorite`; `frontend/pages/Home/index.tsx` — filtro + badge corazón; `frontend/pages/PhotoPreview/index.tsx` — toggle |
| 19 | **Tags / etiquetas** | `backend/src/app.controller.ts` — `POST/DELETE /photos/:id/tags`; `frontend/pages/PhotoPreview/index.tsx` — añadir/eliminar chips |
| 20 | **Búsqueda por nombre y tags** | `backend/src/app.service.ts` — `?q=` con `contains` insensitive + `tags: { has: query }` |
| 21 | **"Este día" / Recuerdos** | `backend/src/app.service.ts` — `GET /photos/this-day` filtra misma fecha en años anteriores; `frontend/pages/Home/index.tsx` — carrusel horizontal "Recuerda..." |

### Análisis inteligente
| # | Feature | Archivos |
|---|---------|----------|
| 22 | **Detección de borrosidad** | `backend/src/app.service.ts` — `computeBlurScore` con `sharp` (gradiente Laplaciano); guarda `blurred` + `blurScore` por foto |
| 23 | **Filtro de fotos borrosas** | `frontend/pages/Home/index.tsx` — icono "blur-off" para filtrar; badge en thumbnail |
| 24 | **Hash perceptual + detección de duplicados** | `backend/src/app.service.ts` — `computePerceptualHash` (8×8 DCT-style); `GET /photos/duplicates` agrupa por hash; `frontend/pages/Duplicates/` |
| 25 | **Análisis bulk** | `backend/src/app.controller.ts` — `POST /photos/analyze-all` procesa fotos sin hash |
| 26 | **Estadísticas** | `backend/src/app.controller.ts` — `GET /photos/stats` devuelve conteo total, álbumes, favoritos, borrosas |

### Utilidades
| # | Feature | Archivos |
|---|---------|----------|
| 27 | **Offline — guardar fotos en dispositivo** | `frontend/api/offline.ts` — download + file cache; `frontend/pages/PhotoPreview/index.tsx` — toggle offline con indicador |
| 28 | **Compartir vía enlace (presigned URL)** | `backend/src/app.controller.ts` — `GET /photos/:id/share?expiresIn=`; `frontend/pages/PhotoPreview/index.tsx` — botón "Compartir" |
| 29 | **Exportar fotos (ZIP + email)** | `backend/src/app.service.ts` — 3 modalidades: todo (`POST /photos/export`), por álbum (`POST /albums/:id/export`), por fecha (`POST /photos/export-by-date`). Genera ZIP con `archiver`, sube a S3, email opcional vía Mailgun |
| 30 | **Exportación asíncrona con progreso + Firebase notification** | `backend/src/export/export.worker.ts` — worker thread con ZIP + S3 upload + email opcional; `backend/src/export/export.service.ts` — inyecta `FirebaseService`, envía push al completar/fallar; sin polling, sin modal |
| 32 | **Tema claro/oscuro** | `frontend/context/ThemeContext.tsx`; `frontend/theme.ts` — colores dinámicos en toda la app |
| 33 | **Banner de conexión** | `frontend/components/ConnectionBanner.tsx` — indica red disponible/no disponible |
| 34 | **Skeleton loading + FadeIn** | `frontend/components/Skeleton.tsx`; `frontend/components/FadeInView.tsx` — animaciones de carga |
| 35 | **Zoom de imagen** (pinch-to-zoom) | `frontend/components/ZoomableImage.tsx` |
| 36 | **Perfil de usuario** | `frontend/pages/Profile/` — info del usuario, estadísticas, cerrar sesión |
| 37 | **Error Boundary** | `frontend/components/ErrorBoundary.tsx` — captura errores de render, botón "Reintentar", evita crash total |
| 38 | **Haptic Feedback** | `frontend/utils/haptics.ts` — `react-native-haptic-feedback` en long press, fav, eliminar, descargar, subida exitosa |
| 39 | **Añadir fotos a álbum desde Home** | `frontend/pages/Home/index.tsx` — botón "Álbum" en barra de selección, modal con lista de álbumes, `POST /albums/:id/photos` |
| 40 | **Validación de duplicados al añadir a álbum** | `backend/src/albums/albums.service.ts` — filtra fotos ya existentes antes de conectar; devuelve `added` + `alreadyInAlbum` |
| 41 | **Portada de álbum** (`coverPhotoId`) | `backend/src/albums/albums.service.ts` — selección de portada via `coverPhotoId`; `frontend/pages/Albums/AlbumView.tsx` — botón "Portada" en selección múltiple |
| 42 | **Renombrar álbum** | `backend/src/albums/albums.service.ts` — `PATCH /albums/:id` con `name`; `frontend/pages/Albums/AlbumView.tsx` — modal de rename |
| 43 | **Pull-to-refresh en AlbumView** | `frontend/pages/Albums/AlbumView.tsx` — `RefreshControl` |
| 44 | **Filtro por fecha en AlbumView** | `frontend/pages/Albums/AlbumView.tsx` — modal `Calendar` para filtrar fotos del álbum |
| 45 | **Upload queue persistente** — Cola MMKV-backed, sube aunque cambies de pantalla, reintentos automáticos al reconectar | `frontend/services/UploadQueue.ts` |
| 46 | **NetworkContext** — Proveedor global de conectividad (NetInfo), usado por ConnectionBanner + UploadQueue | `frontend/context/NetworkContext.tsx` |
| 47 | **AlbumPickerModal** — Modal reutilizable para añadir fotos a álbum desde cualquier pantalla | `frontend/components/AlbumPickerModal.tsx` |
| 48 | **ExportProgressModal** — Progreso en tiempo real de exportación ZIP (polling cada 1.5s) | `frontend/components/ExportProgressModal.tsx` |
| 49 | **Widget Android** — Home screen widget con últimas 4 fotos, actualización automática | `frontend/api/widget.ts` |
| 50 | **Toast global** | `frontend/components/Toast.tsx` — animado, auto-dismiss, posiciones configurables; `frontend/context/ToastContext.tsx` — provider global fuera del navigator, sobrevive cambios de screen |
| 51 | **Firebase push notifications** | `backend/src/firebase/firebase.service.ts` — `sendToUser()` con canal Android personalizado (`vaulta_export`), icono `ic_notification`, color `#007AFF`, priority high; `backend/src/firebase/device-token.controller.ts` — `POST /device-token`; `frontend/api/notifications.ts` — `registerFcmToken()` llama al endpoint; `App.tsx` — `NotificationHandler` usa Toast global; Home se refresca automáticamente al recibir notificación |
| 52 | **Canal Android personalizado** | `frontend/android/app/src/main/java/com/frontend/MainApplication.kt` — notification channel `vaulta_export` (importance HIGH, vibration, badge); `frontend/android/app/src/main/res/drawable/ic_notification.xml` — icono cámara vector drawable; `frontend/android/app/src/main/res/values/colors.xml` — `notification_icon_color: #007AFF` |
| 53 | **Upload concurrente con worker_thread** | `backend/src/photos/upload.worker.ts` — worker thread procesa S3 upload + thumbnail + blurScore + perceptualHash + DB insert + cleanup; `backend/src/photos/photos.service.ts` — `startBatchUpload()` con mapa de progreso en memoria; `backend/src/photos/photos.controller.ts` — `POST /photos/upload-batch` con `FilesInterceptor` (50 archivos, diskStorage) |
| 54 | **Auto-refresh Home al completar subida** | `frontend/pages/Home/index.tsx` — `onMessage` de Firebase dispara `loadPhotos()` vía ref; sin necesidad de refresh manual |
| 55 | **Firebase modular API v22+** | `frontend/api/notifications.ts` — migrado de API namespaced (`messaging()`) a modular (`getMessaging(getApp())`); `frontend/pages/Home/index.tsx` — mismo patrón |
| 56 | **Fix ruta duplicados** | `backend/src/photos/photos.controller.ts` — `@Get('photos/duplicates')` antes de `photos/:id` para evitar que Express atrape "duplicates" como parámetro `:id` |
| 57 | **Iconos de acción más pequeños y centrados** | `frontend/pages/PhotoPreview/index.tsx` — iconos de 28→22, `space-evenly`, padding reducido, `minWidth` en botones |
| 58 | **Soporte de video** — subida, thumbnail y reproducción | `backend/src/photos/upload.worker.ts` — extrae un frame con `fluent-ffmpeg` + `ffmpeg-static` para thumbnail de video, salta sharp; `frontend/components/VideoPlayer.tsx` — reproductor con poster thumbnail, play/pause, buffer config; `frontend/pages/Home/index.tsx` — thumbnail con overlay play; `frontend/pages/PhotoPreview/index.tsx` — `VideoPlayer` para videos con poster, `ZoomableImage` para fotos; `frontend/pages/Upload/index.tsx` — `mediaType: 'mixed'` para seleccionar videos de galería, botones separados Foto/Video en cámara |
| 59 | **Seed de base de datos** | `backend/prisma/seed.ts` — usuario demo configurable via `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_NAME` |
| 60 | **Testing** | `backend/src/auth/auth.service.spec.ts` — 8 tests backend; `frontend/__tests__/` — 4 tests frontend (theme, client) |

### Privacidad y seguridad
| # | Feature | Archivos |
|---|---------|----------|
| 61 | **Soft delete / Papelera** | `backend/src/app.service.ts` — `deletedAt` column, soft-delete/restore/list/permanent-delete; `frontend/pages/Trash/` — restaurar o eliminar definitivamente |
| 62 | **Modo privado (fotos)** | `backend/src/app.service.ts` — toggle `private` en Photo; al activar se desconecta de álbumes no-vault y se agrega a la Caja Fuerte. Al desactivar se remueve de vault. Filtro `private: false` por defecto en Home |
| 63 | **Álbum vault "Caja Fuerte" con PIN** | `backend/src/albums/albums.service.ts` — `GET /albums/vault` auto-crea álbum vault, sincroniza fotos privadas huérfanas; `frontend/pages/Albums/VaultView.tsx` — gate de PIN (4 dígitos en AsyncStorage), grid gallery, selección múltiple para quitar fotos (desmarca privadas) |
| 64 | **Bloqueo: no agregar privadas a álbumes** | `backend/src/albums/albums.service.ts` — `addPhotos` rechaza fotos con `private: true` si el álbum no es vault |
| 65 | **Bloqueo: no borrar vault** | `backend/src/albums/albums.service.ts` — `delete` lanza error si `album.vault === true` |
| 66 | **Validación UI: foto en álbum no puede ser privada** | `frontend/pages/PhotoPreview/index.tsx` — consulta `GET /photos/:id/albums`, si está en álbum normal deshabilita el toggle privado con alerta |
| 67 | **Filtro privacidad en Home** | `frontend/pages/Home/index.tsx` — toggle visibility para ver solo privadas; `backend/src/app.service.ts` — `privateOnly` param |
| 68 | **Fotos privadas excluidas de export/compartir/"este día"** | `backend/src/app.service.ts` — todas las queries de export, share link y `getThisDayPhotos` filtran `private: false` |
| 69 | **Fotos privadas en lote (bulk)** | `backend/src/photos/photos.service.ts:523` — `bulkSetPrivate(ids[])`; `backend/src/photos/photos.controller.ts` — `PATCH /photos/bulk-private`; `frontend/components/SelectionBar.tsx` — botón "Privada" en selección múltiple; `frontend/pages/Home/index.tsx` — handler con confirmación |
| 70 | **Álbumes dentro de la Caja Fuerte** | `backend/src/albums/albums.service.ts:67` — `listVaultAlbums()`; `backend/src/albums/albums.controller.ts` — `POST /albums` acepta `vault: true`, `GET /albums/vault` retorna `{ mainVault, vaultAlbums }`; `frontend/pages/Albums/VaultView.tsx` — vista de carpetas con álbumes vault + FAB para crear sub-álbum + navegación a `AlbumView`

### Migraciones y mantenimiento
| # | Feature | Archivos |
|--:|---------|----------|
| 69 | **Sincronizar S3 → DB** | `backend/src/app.service.ts` — `POST /photos/sync-s3` backfill; `AUTO_SYNC_S3` en startup |
| 70 | **Migrar thumbnails** | `backend/src/app.service.ts` — `POST /photos/migrate-thumbnails` genera los que faltan |
| 71 | **Migrar a carpetas (uploads/ + thumbnails/)** | `backend/src/app.service.ts` — `POST /photos/migrate-folders` reorganiza S3 |
| 72 | **Migrar fotos privadas a vault** | `backend/src/app.service.ts` — `POST /photos/migrate-vault` conecta privadas existentes a la Caja Fuerte y las desconecta de álbumes normales |
| 73 | **Usar `.env` real en frontend** | `frontend/.env` → `frontend/api/server/index.ts` via `react-native-config` |
| 74 | **Limpiar dependencias muertas** | Se eliminaron `expo-image-picker`, `aws-sdk` v2, `multer` |

---

## ✅ Fixes críticos aplicados

| # | Fix | Archivos |
|---|-----|----------|
| 1 | **Prisma singleton** — `PrismaModule` global (`@Global()`) | `prisma.module.ts`, varios módulos |
| 2 | **JWT decoder** — `atob()` nativo + email/name en token | `AuthContext.tsx`, `auth.service.ts` |
| 3 | **JWT_SECRET requerido** — Sin fallback hardcodeado | `auth.module.ts`, `jwt.strategy.ts` |
| 4 | **Endpoints migración protegidos** — Requieren JWT | `app.controller.ts` |
| 5 | **Presigned URLs** — Expiry 7 días | `app.service.ts` |
| 6 | **Ownership en álbumes** — Verifica pertenencia | `albums/albums.service.ts` |
| 7 | **deletePhoto** — Sin `.catch(() => {})` silencioso | `app.service.ts` |
| 8 | **Home: toggle favoritos** — Ref para evitar stale closure | `frontend/pages/Home/index.tsx` |
| 9 | **Batch download paralelo** — `Promise.allSettled` | `frontend/pages/Home/index.tsx` |
| 10 | **Índices DB** — `@@index([userId])`, `[userId, favorite]`, `[userId, createdAt]` | `prisma/schema.prisma` |
| 11 | **CORS** — `origin: env var o true` + `credentials: false` | `main.ts` |
| 12 | **Demo user** — Email/password via `.env` | `prisma.service.ts` |
| 13 | **Auto-sync S3** — Solo si `AUTO_SYNC_S3=true` | `app.service.ts` |
| 14 | **Cache scoped por usuario** — Claves incluyen userId | `api/cache.ts`, `api/offline.ts` |
| 15 | **401 auto-logout** — Token se limpia automáticamente | `api/client.ts`, `AuthContext.tsx` |
| 16 | **Logout limpia caché** — Borra fotos cacheadas | `AuthContext.tsx` |
| 17 | **Índices DB en Album** — `@@index([userId])` | `prisma/schema.prisma` |
| 18 | **`.env.example`** — Creado con todas las variables | `.env.example` |
| 20 | **PhotoPreview** — Error alerts, loading states, `useWindowDimensions` | `pages/PhotoPreview/index.tsx` |
| 21 | **Upload** — Validación 500MB, GPS grados/min/seg, limpieza EXIF | `pages/Upload/index.tsx` |
| 22 | **Álbumes** — Loading state, textos ES, `_count?.photos ?? 0` | `pages/Albums/index.tsx` |
| 23 | **Login** — `KeyboardAvoidingView` Android, validación email, toggle pass | `pages/Login/index.tsx` |
| 24 | **Profile** — `authenticatedPatch` en vez de `fetch` manual | `pages/Profile/index.tsx` |
| 25 | **`authenticatedPost`/`authenticatedPatch`** — Añadidos a `client.ts` | `api/client.ts` |
| 26 | **`thumbS3Key` migration** — Columna faltante + regenerar Prisma | `prisma/migrations/20260514221648_add_thumb_s3_key/` |
| 27 | **Rate limiting en auth** — login 10/min, register 5/min | `auth/auth.controller.ts` |
| 28 | **MIME validation** — Filtro Multer con `ALLOWED_MIMES` | `app.controller.ts` |
| 29 | **Validación lat/lng** — Rangos -90/90 y -180/180 | `app.controller.ts` |
| 30 | **Dead code eliminado** — 5 funciones no usadas en `api/server/index.ts` | `api/server/index.ts` |
| 31 | **Token en memoria** — `_tokenCache` evita leer AsyncStorage | `api/client.ts` |
| 32 | **Timeout en fetch** — `AbortController` con 15s | `api/client.ts`, `api/auth.ts` |

---

## ❌ Pendientes / Bugs conocidos

| # | Issue | Archivos |
|---|-------|----------|
| 1 | **Thumbnails de video** — ffmpeg no se encuentra en Railway (ENOENT con `ffmpeg-static` en pnpm). Se agregó fallback a `which ffmpeg` + `nixpacks.toml` pero no está verificado. | `backend/src/photos/upload.worker.ts` — resolución de ruta ffmpeg; `backend/nixpacks.toml` |
| 2 | **Pantalla negra al descargar offline** — al tocar el icono de nube (Guardar) en PhotoPreview, la pantalla se queda en negro intermitentemente. Se agregó overlay de carga como workaround. | `frontend/pages/PhotoPreview/index.tsx` — `handleOfflineToggle` |
| 3 | **Auto-delete papelera 30 días** — implementado en backend (`cleanExpiredTrash` en `onModuleInit`) pero no verificado en producción. | `backend/src/photos/photos.service.ts` |

## 📋 Pendientes / Futuras

| # | Feature | Descripción | Requisitos |
|---|---|---|---|
| 1 | **Subida masiva desde disco externo** — Script que copia 100GB de fotos a R2 sin pasar por el celular | Script Node.js que lee fotos del disco duro y las sube al backend. Detección de duplicados, barra de progreso | Plan detallado en `AI_PLAN.md` |
| 3 | **Upload en segundo plano** — Las subidas continúan aunque cierres la app | Notificación de progreso nativa. WorkManager (Android), NSURLSession (iOS) | Investigar compatibilidad con RN 0.83.1 |
| 4 | **Sincronización automática con galería** — Escanea DCIM/Camera y sube nuevas fotos | Filtra screenshots/WhatsApp, compara con ya subidas, sube en lote con progreso | Escaneo periódico opcional |
| 5 | **Búsqueda avanzada** — Por tags, rango de fechas, ubicación, blurry | Mejorar search bar actual con filtros combinados | Backend ya soporta tags, falta UI |
| 6 | **Álbumes compartidos** — Compartir álbum por enlace | Generar link público con expiración | Requiere nueva endpoint + pantalla |
| 7 | **Autenticación biométrica** — FaceID / Huella para abrir Caja Fuerte | `react-native-biometrics` | Hardware compatible |
| 8 | **Multi-idioma** — i18n (ES/EN) | `react-native-i18n` o similar | Archivos de traducción |
| 9 | **Estadísticas de almacenamiento** — "15GB de 50GB usados" | Consultar tamaño total en R2 vs plan | Depende del plan de R2 |
| 10 | **Reconocimiento facial** — Detectar caras en fotos, comparar similitudes, preguntar nombre al usuario o descartar. Agrupar fotos por persona automáticamente. Buscar por nombre de persona. | Modelo `Face` en Prisma (id, photoId, name, encoding B64, boundingBox JSON, confidence, confirmed). Instalar `@vladmandic/face-api` con TensorFlow.js para detección + descriptores faciales (128 floats). Integrar en upload worker y analysis service. Endpoints: `GET /faces/unconfirmed`, `PATCH /faces/:id` (nombrar), `DELETE /faces/:id` (descartar), `GET /faces/people`, `GET /faces/photos?person=X`. UI: pantalla `Faces` con caras agrupadas por similitud, modal "¿Quién es?" con input o descartar. | Modelos face-api ~30MB. Alta complejidad (ML en backend). |

## 🔑 Credenciales por defecto

| Campo    | Valor              |
|----------|--------------------|
| Email    | `demo@vaulta.com`  |
| Password | `123456`           |

> Se crean automáticamente al arrancar el backend si no existen. Configurable via `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_NAME` en `.env`.

---

## 📁 Estructura del proyecto

```
PersonalProject/
├── AI_PLAN.md                          # Plan de AI + subida masiva
├── FEATURES.md                         # Este archivo (feature overview)
│
├── frontend/                           # React Native 0.83.1
│   ├── pages/
│   │   ├── Login/                      # Login / Register
│   │   ├── Home/                       # Grid masonry, búsqueda, FAB, pull-to-refresh, recuerdos, auto-refresh en upload
│   │   ├── Upload/                     # Cámara + galería + fire-and-forget batch upload + crop + GPS + video
│   │   ├── PhotoPreview/               # Slideshow (ScrollView), zoom, tags, fav, offline, compartir, iconos ajustados
│   │   ├── Albums/                     # Lista de álbumes + AlbumView (grid, fecha, portada, rename)
│   │   │   └── VaultView.tsx           # Caja Fuerte con PIN, vista de carpetas (sub-álbumes vault) + grid de todas las privadas
│   │   ├── Profile/                    # Perfil + estadísticas + export
│   │   ├── Trash/                      # Papelera (restaurar / eliminar permanente)
│   │   └── Duplicates/                 # Detección de fotos duplicadas
│   ├── components/
│   │   ├── AlbumPickerModal.tsx         # Modal para añadir foto a álbum
│   │   ├── ConnectionBanner.tsx         # Indicador de red
│   │   ├── DateRangePicker.tsx          # Calendario para rango de fechas
│   │   ├── ErrorBoundary.tsx            # Error boundary global
│   │   ├── ExportProgressModal.tsx      # Progreso de export ZIP
│   │   ├── FABMenu.tsx                  # Speed-dial FAB (cámara/galería/video)
│   │   ├── FadeInView.tsx               # Fade-in animation wrapper
│   │   ├── FilterBar.tsx                # Filtros: fecha, favoritos, blurry
│   │   ├── LazyCalendar.tsx             # Calendar con React.lazy()
│   │   ├── RecuerdosSection.tsx         # "On this day" strip
│   │   ├── SelectionBar.tsx             # Action bar for multi-select
│   │   ├── Skeleton.tsx                 # Skeleton loaders
│   │   ├── Toast.tsx                    # Banner animado con posiciones y auto-dismiss
│   │   ├── UploadQueueBanner.tsx        # Banner de cola de subida
│   │   ├── VideoPlayer.tsx              # Reproductor de video con play/pause, loading, error+retry
│   │   └── ZoomableImage.tsx            # Pinch-to-zoom
│   ├── api/
│   │   ├── auth.ts                      # Auth API (login/register)
│   │   ├── cache.ts                     # AsyncStorage photo cache
│   │   ├── client.ts                    # API client autenticado (JWT Bearer + refresh)
│   │   ├── notifications.ts             # FCM token registration, foreground handler (modular API v22+)
│   │   ├── offline.ts                   # Almacenamiento offline en filesystem
│   │   ├── storage.ts                   # MMKV storage init
│   │   ├── widget.ts                    # Android widget manager
│   │   └── server/index.ts              # BASE_URL desde .env
│   ├── context/
│   │   ├── AuthContext.tsx               # Estado de autenticación global + refresh
│   │   ├── NetworkContext.tsx            # Proveedor global de conectividad (NetInfo)
│   │   ├── ThemeContext.tsx              # Tema claro/oscuro/sistema
│   │   └── ToastContext.tsx              # Toast global (provider + hook)
│   ├── services/
│   │   └── UploadQueue.ts               # Cola MMKV-backed de subida persistente
│   ├── types/                           # TypeScript declarations
│   ├── theme.ts                         # Tokens de color + useTheme hook
│   ├── App.tsx                          # Stack + Tab navigator, auth flow condicional, ToastProvider global
│   ├── __tests__/                       # Frontend tests
│   └── android/                         # Gradle 8.13, JDK 21, notification channel + icon
│
└── mymega-photos-backend/               # NestJS 11 API
    ├── src/
    │   ├── main.ts                      # Bootstrap + 500MB body limit + CORS
    │   ├── app.module.ts                # Module definition + global ValidationPipe
    │   ├── app.controller.ts            # Rutas base
    │   ├── app.service.ts               # Servicios base (S3, sharp, Prisma CRUD legacy)
    │   ├── prisma.module.ts             # PrismaModule global (@Global)
    │   ├── prisma.service.ts            # PrismaClient wrapper
    │   ├── auth/                        # JWT auth module
    │   │   ├── auth.module.ts           # Passport + JWT + Throttler
    │   │   ├── auth.controller.ts       # POST /auth/login, /register, /refresh, /logout
    │   │   ├── auth.service.ts          # bcrypt + JWT sign + refresh rotation
    │   │   ├── auth.service.spec.ts     # Tests
    │   │   ├── jwt.strategy.ts          # Passport JWT strategy
    │   │   ├── jwt-auth.guard.ts        # @UseGuards(JwtAuthGuard)
    │   │   ├── current-user.decorator.ts
    │   │   ├── skip-auth.decorator.ts   # @SkipAuth()
    │   │   └── dto/                     # LoginDto, RegisterDto, RefreshTokenDto, UpdateProfileDto
    │   ├── albums/                      # Albums CRUD module
    │   │   ├── albums.module.ts
    │   │   ├── albums.controller.ts     # CRUD + add/remove photos
    │   │   └── albums.service.ts        # Many-to-many con validaciones (vault, privadas, portada)
    │   ├── photos/                      # Photos: CRUD, upload-batch, worker thread
    │   │   ├── photos.module.ts
    │   │   ├── photos.controller.ts     # 20+ endpoints (CRUD + stream + share + tags + trash + stats + this-day + duplicates)
    │   │   ├── photos.service.ts        # Lógica de negocio, startBatchUpload con Worker
    │   │   └── upload.worker.ts         # Worker thread: S3 + thumbnail + blur + hash + DB
    │   ├── export/                      # Export module: ZIP worker + Firebase push
    │   │   ├── export.module.ts
    │   │   ├── export.controller.ts     # POST /photos/export, /albums/:id/export, /photos/export-by-date, GET /exports/:id
    │   │   ├── export.service.ts        # Gestión de exports + notificaciones push + Mailgun
    │   │   ├── export.worker.ts         # Worker thread: ZIP, S3 upload, email via Mailgun
    │   │   └── export.types.ts          # ExportProgress interface
    │   ├── analysis/                    # Análisis: blur, hash, duplicados
    │   │   ├── analysis.module.ts
    │   │   ├── analysis.controller.ts   # POST /photos/analyze-all, /photos/:id/analyze, GET /photos/duplicates
    │   │   └── analysis.service.ts      # computeBlurScore, computePerceptualHash
    │   ├── migration/                   # Migraciones S3
    │   │   ├── migration.module.ts
    │   │   ├── migration.controller.ts  # 5 endpoints: thumbnails, folders, sync-s3, fix-video-thumbnails, migrate-vault
    │   │   └── migration.service.ts     # syncS3ToDb, generateMissingThumbnails, migrateToFolders, fixVideoThumbnails, migrateVault
    │   ├── firebase/                    # Firebase Admin + device token registration
    │   │   ├── firebase.module.ts
    │   │   ├── firebase.service.ts      # sendToUser con configuración Android
    │   │   └── device-token.controller.ts  # POST /device-token
    │   └── common/                      # S3 provider, exception filter
    │       ├── s3.module.ts
    │       ├── s3.provider.ts           # S3Client factory (R2 o AWS)
    │       └── exception.filter.ts      # Global exception filter
    └── prisma/
        ├── schema.prisma                # User + Photo + Album + DeviceToken models
        ├── seed.ts                      # Seed de usuario demo
        └── migrations/                  # Migraciones SQL aplicadas
```

## 🚀 Cómo empezar

```bash
# Backend
cd mymega-photos-backend
npm install
npm run start:dev

# Frontend
cd frontend
npm install
npx react-native start              # Metro
npx react-native run-android        # Build + install

# Dispositivo (proxy backend)
adb reverse tcp:3000 tcp:3000
```

```bash
# kill port 3000
kill -9 $(lsof -t -i:3000)
```

## 🔐 Variables de entorno clave

| Variable | Descripción |
|----------|-------------|
| `AWS_S3_BUCKET` | Bucket S3 para fotos y thumbnails |
| `AWS_REGION` | Región AWS (default: `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | Credenciales AWS |
| `AWS_SECRET_ACCESS_KEY` | Credenciales AWS |
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Clave para firmar JWT |
| `AUTO_SYNC_S3` | `true` para sincronizar S3 → DB al iniciar |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Ruta al JSON de service account de Firebase |
| `DATABASE_SCHEMA` | Esquema de base de datos (default: `public`) |
| `MAILGUN_API_KEY` | (Opcional) API Key de Mailgun para exportación por email |
| `MAILGUN_DOMAIN` | (Opcional) Dominio de Mailgun |
| `SMTP_HOST` | (Opcional) Host SMTP alternativo a Mailgun |
| `SMTP_PORT` | Puerto SMTP (default: `587`) |
| `SMTP_USER` | Usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `SMTP_FROM` | Remitente email (default: `noreply@vaulta.app`) |
| `DEMO_EMAIL` | Email del usuario demo (default: `demo@vaulta.com`) |
| `DEMO_PASSWORD` | Password del usuario demo (default: `123456`) |
| `DEMO_NAME` | Nombre del usuario demo |
