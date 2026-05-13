# MyMega Photos — Context for AI assistants

## Project overview

Photo-sharing app: React Native frontend (Android) + NestJS backend, photos stored in AWS S3 with server-side thumbnail generation.

## Repo structure

```
.
├── frontend/                  # React Native 0.83.1 app
│   ├── pages/
│   │   ├── Login/             # Login / Register screen
│   │   ├── Home/              # Masonry grid of photo thumbnails, grouped by date
│   │   ├── Upload/            # Pick photo from gallery → multipart/FormData → POST to backend
│   │   └── PhotoPreview/      # Full-image view, download (RNFS), share, delete
│   ├── api/
│   │   ├── auth.ts            # Auth API (login/register calls)
│   │   ├── client.ts          # Authenticated API client (JWT Bearer header)
│   │   ├── cache.ts           # AsyncStorage photo cache
│   │   └── server/            # Base API client (BASE_URL)
│   ├── context/
│   │   └── AuthContext.tsx     # Auth state + login/register/logout
│   ├── types/                 # TS declarations
│   ├── App.tsx                # Stack + Tab navigator + conditional auth flow
│   └── android/               # Android native project
└── mymega-photos-backend/     # NestJS 11 API
    ├── src/
    │   ├── main.ts            # Bootstrap + 50MB json limit + CORS
    │   ├── app.module.ts      # Module definition + global ValidationPipe
    │   ├── app.controller.ts  # 8 routes (CRUD + migrations + sync-s3)
    │   ├── app.service.ts     # S3 client, sharp, Prisma CRUD
    │   ├── prisma.service.ts  # PrismaClient wrapper (extends PrismaClient)
    │   └── auth/
    │       ├── auth.module.ts
    │       ├── auth.controller.ts
    │       ├── auth.service.ts
    │       ├── jwt.strategy.ts
    │       ├── jwt-auth.guard.ts
    │       └── current-user.decorator.ts
    ├── prisma/
    │   ├── schema.prisma      # User + Photo models with relation
    │   └── migrations/        # 3 SQL migrations (init, metadata, user)
    ├── prisma.config.ts       # Prisma config (DATABASE_URL)
    └── .env                   # AWS credentials + DATABASE_URL (not tracked)
```

## Key technical decisions

- **`adb reverse tcp:3000 tcp:3000`** — device reaches backend via USB, no WiFi dependency
- **Server-side thumbnails** via `sharp` (300px, 70% quality, `thumb-{key}`) instead of client-side
- **Photo date** derived from timestamp in S3 key (`{ts}-filename.ext`); falls back to `LastModified` then today
- **Filename** extracted from URL path by stripping `thumb-` prefix to derive the original S3 key
- **Gradle 8.13** required (9.0.0 has `IBM_SEMERU` `NoSuchFieldError` with JDK 21)

## Common commands

### Backend
```bash
cd mymega-photos-backend
npm run build          # compile TS
npm run start:dev      # watch mode on :3000
```

### Frontend
```bash
cd frontend
yarn start             # Metro bundler on :8081
yarn android           # build + install APK
npx tsc --noEmit       # type-check
```

### Device connection
```bash
adb devices            # verify device
adb reverse tcp:3000 tcp:3000   # proxy :3000 to device
```

## Important gotchas

- Backend must be restarted after every change (`npm run build` + restart)
- `adb reverse` must be re-run after USB disconnect
- Metro hot-reload works for JS changes; native code changes need `yarn android`
- `GET /photos?maxKeys=50&pageToken=` returns `{ photos: { uri, date }[], nextToken: string | null }` (paginated via Prisma cursor, token is photo `id` — old S3 ContinuationToken no longer used)
- All `/photos/*` routes require JWT Bearer token in `Authorization` header
- Upload screen shows a green banner "Foto subida correctamente" at top and auto-navigates to Home after 800ms (no Alert)
- `POST /photos/sync-s3` imports existing S3 photos into DB (needs at least 1 user registered)
- Migration endpoints: `POST /photos/migrate-thumbnails`, `POST /photos/migrate-folders`, `POST /photos/sync-s3`
- `JWT_SECRET` env var configures the JWT signing key (defaults to `mymega-secret-key`)
- `DATABASE_URL` must point to a running Postgres instance with migrations applied

## Recent changes

- Prisma fully integrated: photos saved/read/deleted from Postgres (cursor-based pagination)
- User model added with relation to Photo (userId foreign key)
- JWT authentication: `POST /auth/register`, `POST /auth/login`, all photo routes protected
- Frontend auth: Login/Register screen, AuthContext, JWT token in AsyncStorage
- `POST /photos/sync-s3` — backfill existing S3 photos into DB (assigned to first user)
- Old: `GET /photos` paginated via S3 ContinuationToken → Now: cursor-based via Prisma
- Old: all routes public → Now: JWT Bearer required for `/photos/*`
- Albums module: `GET /albums`, `POST /albums`, `DELETE /albums/:id`, `POST /albums/:id/photos`, `DELETE /albums/:id/photos`
- Search: `GET /photos?q=` — searches filename with case-insensitive contains
- Image editing: crop to square before upload via `@react-native-community/image-editor`
- Geolocation: GPS extracted from EXIF on upload (if available), stored as `lat`/`lng` in DB, `GET /photos/geo` returns geotagged photos, Map tab with markers via `react-native-maps`

## Coding conventions

- TypeScript, strict mode
- NestJS decorators for routes/DI
- React Native functional components + hooks
- No semicolons where possible, 2-space indent
- No inline comments in code (unless absolutely necessary)
