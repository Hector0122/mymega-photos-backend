# Vaulta — Roadmap de funcionalidades

## ✅ Implementadas

| # | Feature | Archivos |
|---|---------|----------|
| 1 | **Pull-to-refresh + error/empty states** en Home | `frontend/pages/Home/index.tsx` |
| 2 | **Cámara directa** — tomar foto desde la app | `frontend/pages/Upload/index.tsx` |
| 3 | **Usar `.env` real en frontend** | `frontend/.env` via `react-native-config` |
| 4 | **Limpiar dependencias muertas** | Se eliminaron `expo-image-picker`, `aws-sdk` v2, `multer` |
| 5 | **Slideshow entre fotos** — deslizar izq/der en preview | `frontend/pages/PhotoPreview/index.tsx` |
| 6 | **Subir sin base64 (multipart)** | `frontend/pages/Upload/index.tsx` — `FormData`; backend — `FileInterceptor` |
| 7 | **Caché local con AsyncStorage** | `frontend/api/cache.ts` |
| 8 | **Selección múltiple** | Long press para seleccionar, action bar con descargar/compartir/eliminar |
| 9 | **Paginación infinita** | Cursor-based pagination vía Prisma, scroll infinito |
| 10 | **Prisma integrado en backend** | `prisma.service.ts`, fotos en DB + S3 |
| 11 | **Autenticación JWT** | Login/register con JWT (7d expiry) |
| 12 | **Álbumes / Colecciones** | CRUD álbumes, añadir/quitar fotos |
| 13 | **Búsqueda por nombre** | Query param `?q=` con `contains` insensitive |
| 14 | **Edición básica de imagen** | Recortar a cuadrado vía `@react-native-community/image-editor` |
| 15 | **Mapa con geolocalización** | `react-native-maps` con markers, GPS extraído de EXIF |
| 16 | **Refresh token rotation** | `POST /auth/refresh`, tokens de 40 bytes hex hasheados |
| 17 | **Tema oscuro** | 17 tokens de color, `useTheme()` hook, toggle Claro/Oscuro/Sistema |
| 18 | **MasonryGrid custom** | Grid 2-columnas propio (reemplazó `react-native-masonry-list`) |
| 19 | **Skeleton loaders** | `SkeletonBox`, `SkeletonPhotoGrid`, `SkeletonAlbumList` |
| 20 | **Zoom con gestos** | Pinch-to-zoom + doble tap + pan en PhotoPreview |
| 21 | **Indicador de conectividad** | Banner "Sin conexión a internet" via NetInfo |
| 22 | **Selección múltiple: botón Todo/Ninguna** | Seleccionar/deseleccionar todas las fotos visibles |
| 23 | **Animaciones fade-in** | FadeIn + slideUp en cada foto del grid |
| 24 | **Estadísticas en Profile** | Contador de fotos, álbumes y favoritos via `GET /photos/stats` |
| 25 | **Testing** | 8 tests backend (auth) + 4 tests frontend (theme, client) |
| 26 | **Splash screen themable** | Fondo blanco (light), #121212 (dark) |
| 27 | **Speed-dial FAB animado** | Menú flotante con Galería/Cámara/Video, spring animation |
| 28 | **Upload rediseñado** | Preview fullscreen, barra inferior flotante, progreso, chip GPS |
| 29 | **Duplicados real** | `DuplicatesScreen` con perceptual hash, selección y borrado en lote |
| 30 | **Exportar todo por correo** | `POST /photos/export` genera ZIP con `archiver`, sube a S3, envía email via **Mailgun API** con enlace 24h |
| 31 | **Papelera (Trash)** | Soft delete, restaurar, borrado permanente. `GET /photos/trash`, `DELETE /photos/trash/:id` |
| 32 | **Caja Fuerte / Vault** | Álbum privado protegido con PIN, almacenado en AsyncStorage |
| 33 | **Vista de álbum mejorada** | Renombrar, filtrar por fecha, exportar álbum, multi-select |
| 34 | **Recuerdos / "On this day"** | Strip horizontal de fotos del mismo día en años anteriores |
| 35 | **Filtros en timeline** | FilterBar + DateRangePicker: por fecha, favoritos, blurry |
| 36 | **Soporte de video** | `VideoPlayer` con poster, loading, error/retry. Thumbnails vía ffmpeg en backend. Streaming con byte-range (`GET /photos/:id/stream`) |
| 37 | **Push notifications** | Firebase Cloud Messaging: registro de dispositivo, notificaciones al completar export. Backend + frontend |
| 38 | **Upload queue persistente** | Cola MMKV-backed, sube aunque cambies de pantalla, reintentos automáticos al reconectar |
| 39 | **Widget Android** | Home screen widget con últimas 4 fotos, actualización automática |
| 40 | **Caché offline de fotos** | Descarga fotos al dispositivo para ver sin conexión |
| 41 | **Toast notification system** | `ToastContext` + componente animado (success/error/info) |
| 42 | **NetworkContext** | Proveedor global de conectividad, usado por ConnectionBanner + UploadQueue |
| 43 | **AlbumPickerModal** | Modal para añadir fotos a un álbum desde cualquier pantalla |
| 44 | **ExportProgressModal** | Progreso en tiempo real de exportación ZIP (polling cada 1.5s) |
| 45 | **ErrorBoundary global** | Captura errores de render, muestra "Algo salió mal" con retry |
| 46 | **Módulo Photos (backend)** | Endpoints: stream, share, tags, favorite, private, trash, this-day, stats, duplicates |
| 47 | **Módulo Export (backend)** | ZIP + Mailgun email. Export por fecha, por álbum. Worker thread |
| 48 | **Módulo Analysis (backend)** | Blur score, perceptual hash, análisis individual/masivo, detección de duplicados |
| 49 | **Módulo Migration (backend)** | 5 endpoints: migrate-thumbnails, folders, sync-s3, fix-video-thumbnails, migrate-vault |
| 50 | **Módulo Firebase (backend)** | Firebase Admin SDK, envío de notificaciones por usuario |
| 51 | **Common modules** | S3 provider (R2/AWS), Exception filter global, SkipAuth decorator |
| 52 | **Seed de base de datos** | `prisma/seed.ts` con usuario demo configurable |
| 53 | **Batch upload vía worker threads** | `upload.worker.ts` procesa subidas sin bloquear el event loop |

### Fixes críticos aplicados

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
| 19 | **Mapa** — Error states, bounding box, callout, cancelación | `pages/Map/index.tsx`, `app.service.ts` |
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

## 📁 Estructura del proyecto

```
PersonalProject/
├── AI_PLAN.md                          # Plan de AI + subida masiva
├── FEATURES.md                         # Este archivo (roadmap)
│
├── frontend/                           # React Native 0.83.1
│   ├── pages/
│   │   ├── Login/index.tsx             # Login / Register screen
│   │   ├── Home/index.tsx              # Grid masonry, FAB, pull-to-refresh, search bar, filters
│   │   ├── Home/utils.ts               # Photo types, date grouping, flattenWithHeaders
│   │   ├── Upload/index.tsx            # Cámara + galería + multipart + crop + GPS + video
│   │   ├── Albums/index.tsx            # Album list, create, delete
│   │   ├── Albums/AlbumView.tsx        # Album detail: rename, date filter, export, multi-select
│   │   ├── Albums/VaultView.tsx        # Caja Fuerte con PIN
│   │   ├── Map/index.tsx               # Map with geotagged photo markers
│   │   ├── PhotoPreview/index.tsx      # Slideshow + descargar/compartir/eliminar + zoom
│   │   ├── Profile/index.tsx           # Stats, export button, duplicates, logout
│   │   ├── Duplicates/index.tsx        # Duplicate photo groups by perceptual hash
│   │   └── Trash/index.tsx             # Papelera: restore + permanent delete
│   ├── components/
│   │   ├── AlbumPickerModal.tsx        # Modal para añadir foto a álbum
│   │   ├── ConnectionBanner.tsx        # Banner offline
│   │   ├── DateRangePicker.tsx         # Calendario para seleccionar rango de fechas
│   │   ├── ErrorBoundary.tsx           # Global error boundary
│   │   ├── ExportProgressModal.tsx     # Progreso de export ZIP
│   │   ├── FABMenu.tsx                 # Speed-dial FAB (cámara/galería/video)
│   │   ├── FadeInView.tsx              # Animación fade-in + slideUp
│   │   ├── FilterBar.tsx               # Filtros: fecha, favoritos, blurry
│   │   ├── LazyCalendar.tsx            # Calendar con React.lazy()
│   │   ├── RecuerdosSection.tsx        # "On this day" strip
│   │   ├── SelectionBar.tsx            # Action bar for multi-select
│   │   ├── Skeleton.tsx                # Skeleton loaders
│   │   ├── Toast.tsx                   # Toast notification component
│   │   ├── UploadQueueBanner.tsx       # Banner de cola de subida
│   │   ├── VaultaLogo.tsx              # Logo component
│   │   ├── VideoPlayer.tsx             # Video player with poster + error
│   │   └── ZoomableImage.tsx           # Pinch-to-zoom gesture
│   ├── api/
│   │   ├── auth.ts                     # Auth API (login/register)
│   │   ├── cache.ts                    # AsyncStorage photo cache
│   │   ├── client.ts                   # Authenticated API client (JWT Bearer + refresh)
│   │   ├── notifications.ts            # FCM push notification handlers
│   │   ├── offline.ts                  # Offline photo caching (RNFS)
│   │   ├── storage.ts                  # MMKV storage init
│   │   ├── widget.ts                   # Android widget manager
│   │   └── server/index.ts             # Base API client (BASE_URL)
│   ├── context/
│   │   ├── AuthContext.tsx              # Auth state + login/register/logout + refresh
│   │   ├── NetworkContext.tsx           # Connectivity provider (NetInfo)
│   │   ├── ThemeContext.tsx             # Theme provider (light/dark/system)
│   │   └── ToastContext.tsx             # Global toast notifications
│   ├── services/
│   │   └── UploadQueue.ts              # MMKV-backed upload queue
│   ├── theme.ts                        # Theme tokens + useTheme hook
│   ├── App.tsx                         # Stack + Tab navigator + auth + providers
│   ├── types/                          # TS declarations
│   ├── __tests__/                      # Frontend tests
│   └── android/                        # Gradle 8.13, JDK 21
│
└── mymega-photos-backend/              # NestJS 11
    ├── src/
    │   ├── main.ts                     # Bootstrap + CORS + 500MB body limit
    │   ├── app.module.ts               # Module definition + ValidationPipe global
    │   ├── app.controller.ts           # Rutas legacy
    │   ├── app.service.ts              # S3 client, sharp, Prisma CRUD legacy
    │   ├── prisma.module.ts            # PrismaModule global (@Global)
    │   ├── prisma.service.ts           # PrismaClient wrapper
    │   ├── auth/
    │   │   ├── auth.module.ts          # Passport + JWT + Throttler
    │   │   ├── auth.controller.ts      # POST /auth/login, /register, /refresh, /logout
    │   │   ├── auth.service.ts         # bcrypt hash/verify + JWT sign + refresh rotation
    │   │   ├── auth.service.spec.ts    # Tests
    │   │   ├── jwt.strategy.ts         # Passport JWT strategy
    │   │   ├── jwt-auth.guard.ts       # @UseGuards(JwtAuthGuard)
    │   │   ├── current-user.decorator.ts
    │   │   ├── skip-auth.decorator.ts  # @SkipAuth() para rutas públicas
    │   │   └── dto/                    # LoginDto, RegisterDto, RefreshTokenDto, UpdateProfileDto
    │   ├── albums/
    │   │   ├── albums.module.ts
    │   │   ├── albums.controller.ts    # CRUD + add/remove photos
    │   │   └── albums.service.ts       # Álbumes con relación many-to-many
    │   ├── photos/
    │   │   ├── photos.module.ts
    │   │   ├── photos.controller.ts    # 20+ endpoints (CRUD + stream + share + tags + trash + stats + this-day + duplicates)
    │   │   ├── photos.service.ts       # Lógica de negocio
    │   │   └── upload.worker.ts        # Worker thread: thumbnails, blur, hash, S3 upload
    │   ├── export/
    │   │   ├── export.module.ts
    │   │   ├── export.controller.ts    # POST /photos/export, /albums/:id/export, /photos/export-by-date, GET /exports/:id
    │   │   ├── export.service.ts       # Gestión de exports + notificaciones push
    │   │   ├── export.worker.ts        # Worker thread: ZIP, S3 upload, email via Mailgun
    │   │   └── export.types.ts         # ExportProgress interface
    │   ├── analysis/
    │   │   ├── analysis.module.ts
    │   │   ├── analysis.controller.ts  # POST /photos/analyze-all, /photos/:id/analyze, GET /photos/duplicates
    │   │   └── analysis.service.ts     # Blur score, perceptual hash computation
    │   ├── migration/
    │   │   ├── migration.module.ts
    │   │   ├── migration.controller.ts # 5 endpoints: thumbnails, folders, sync-s3, fix-video-thumbnails, migrate-vault
    │   │   └── migration.service.ts    # Migraciones de S3 a DB
    │   ├── firebase/
    │   │   ├── firebase.module.ts
    │   │   ├── firebase.service.ts     # Firebase Admin SDK, sendToUser
    │   │   └── device-token.controller.ts  # POST /device-token
    │   └── common/
    │       ├── s3.module.ts            # S3 module
    │       ├── s3.provider.ts          # S3Client factory (R2 o AWS)
    │       └── exception.filter.ts     # Global exception filter
    ├── prisma/
    │   ├── schema.prisma              # Modelos User, Photo, Album, DeviceToken
    │   ├── seed.ts                    # Seed de usuario demo
    │   └── migrations/                # 13 migraciones SQL
    └── prisma.config.ts               # Config de Prisma (DATABASE_URL)
```

## 🔑 Credenciales por defecto

| Campo    | Valor              |
|----------|--------------------|
| Email    | `demo@vaulta.com`  |
| Password | `123456`           |

> Se crean automáticamente al arrancar el backend si no existen. Configurable via `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_NAME` en `.env`.

---

## 📋 Pendientes / Futuras

| # | Feature | Descripción | Requisitos |
|---|---------|-------------|------------|
| 1 | **AI auto-álbumes** — Script local que organiza fotos por contexto | Usa CLIP + clustering para agrupar fotos visualmente similares y Ollama para nombrar los grupos. Corre en tu laptop. Crea álbumes via API del backend | Ver `AI_PLAN.md` para plan detallado |
| 2 | **Subida masiva desde disco externo** — Script que copia 100GB de fotos a R2 sin pasar por el celular | Script Node.js que lee fotos del disco duro y las sube al backend. Detección de duplicados, barra de progreso | Plan detallado en `AI_PLAN.md` |
| 3 | **Upload en segundo plano** — Las subidas continúan aunque cierres la app | Notificación de progreso nativa. WorkManager (Android), NSURLSession (iOS) | Investigar compatibilidad con RN 0.83.1 |
| 4 | **Sincronización automática con galería** — Escanea DCIM/Camera y sube nuevas fotos | Filtra screenshots/WhatsApp, compara con ya subidas, sube en lote con progreso | Escaneo periódico opcional |
| 5 | **Búsqueda avanzada** — Por tags, rango de fechas, ubicación, blurry | Mejorar search bar actual con filtros combinados | Backend ya soporta tags, falta UI |
| 6 | **Álbumes compartidos** — Compartir álbum por enlace | Generar link público con expiración | Requiere nueva endpoint + pantalla |
| 7 | **Autenticación biométrica** — FaceID / Huella para abrir Caja Fuerte | `react-native-biometrics` | Hardware compatible |
| 8 | **Multi-idioma** — i18n (ES/EN) | `react-native-i18n` o similar | Archivos de traducción |
| 9 | **Estadísticas de almacenamiento** — "15GB de 50GB usados" | Consultar tamaño total en R2 vs plan | Depende del plan de R2 |
