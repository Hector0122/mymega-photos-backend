# MyMega Photos — Context for AI assistants

## Project overview

Photo-sharing app: React Native frontend (Android) + NestJS backend, photos stored in AWS S3 with server-side thumbnail generation.

## Repo structure

```
.
├── frontend/                  # React Native 0.83.1 app
│   ├── pages/
│   │   ├── Home/              # Masonry grid of photo thumbnails, grouped by date
│   │   ├── Upload/            # Pick photo from gallery → base64 → POST to backend
│   │   └── PhotoPreview/      # Full-image view, download (RNFS), share, delete
│   ├── api/server/            # API client: apiGet, apiDelete, getPhotoUrl, deletePhoto
│   ├── App.tsx                # Stack + Tab navigator
│   └── android/               # Android native project
└── mymega-photos-backend/     # NestJS 11 API
    ├── src/
    │   ├── main.ts            # Bootstrap + 50MB json limit
    │   ├── app.controller.ts  # Routes
    │   └── app.service.ts     # S3 client, listing, upload+thumb, delete, migration
    └── .env                   # AWS credentials (not tracked)
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
- `GET /photos?maxKeys=50&pageToken=` returns `{ photos: { uri, date }[], nextToken: string | null }` (paginated via S3 ContinuationToken)
- Upload screen shows a green banner "Foto subida correctamente" at top and auto-navigates to Home after 800ms (no Alert)

## Recent changes

- `GET /photos` returns `{ uri, date }[]` with dates from S3 key timestamps
- Thumbnail generation on upload, fallback to full image if missing
- DELETE removes both full + thumbnail
- Migration endpoint for backfilling thumbnails
- PhotoPreview screen with download, share, delete actions
- Upload screen: success banner + auto-redirect to Home

## Coding conventions

- TypeScript, strict mode
- NestJS decorators for routes/DI
- React Native functional components + hooks
- No semicolons where possible, 2-space indent
- No inline comments in code (unless absolutely necessary)
