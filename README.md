# Vaulta — Backend

NestJS 11 API for photo management. Stores photos in Cloudflare R2 (S3-compatible), generates thumbnails via `sharp`, manages metadata in PostgreSQL (Neon), with push notifications (Firebase) and email export (Mailgun).

## Tech stack

- **Runtime:** Node.js >=20
- **Framework:** NestJS 11 (TypeScript, strict mode)
- **Database:** PostgreSQL via Prisma ORM (Neon)
- **Storage:** Cloudflare R2 (S3-compatible)
- **Auth:** JWT + Refresh token rotation
- **AI:** Sharp (thumbnails), custom blur/hash analysis
- **Notifications:** Firebase Admin SDK
- **Email:** Mailgun API

## Setup

```bash
npm install
cp .env.example .env   # configure all variables
npx prisma migrate dev # run migrations
npm run start:dev      # development (watch mode)
```

## Environment variables

See `.env.example` for all required variables: `DATABASE_URL`, `JWT_SECRET`, R2 credentials, etc.

## API endpoints (main)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/register` | Register user |
| `POST` | `/auth/login` | Login, returns JWT + refresh token |
| `POST` | `/auth/refresh` | Rotate refresh token |
| `POST` | `/auth/logout` | Invalidate refresh token |
| `POST` | `/auth/update-profile` | Update name/password |
| `GET` | `/photos` | List photos (cursor-based pagination) |
| `GET` | `/photos/stats` | Photo/album/favorite counts |
| `GET` | `/photos/trash` | List soft-deleted photos |
| `GET` | `/photos/this-day` | Photos from same date in prior years |
| `GET` | `/photos/duplicates` | Duplicate groups (by perceptual hash) |
| `GET` | `/photos/:id` | Single photo signed URL |
| `GET` | `/photos/:id/stream` | Stream (byte-range, public with `?token=`) |
| `GET` | `/photos/:id/share` | Generate share link |
| `POST` | `/photos/upload` | Single photo upload (multipart) |
| `POST` | `/photos/upload-batch` | Batch upload via worker thread |
| `PATCH` | `/photos/:id/favorite` | Toggle favorite |
| `PATCH` | `/photos/:id/private` | Toggle private |
| `POST` | `/photos/:id/tags` | Add tag |
| `DELETE` | `/photos/:id/tags` | Remove tag |
| `DELETE` | `/photos/:id` | Soft delete |
| `POST` | `/photos/:id/restore` | Restore from trash |
| `DELETE` | `/photos/trash/:id` | Permanently delete (S3 + DB) |
| `POST` | `/photos/export` | Export all photos as ZIP (email) |
| `POST` | `/albums/:id/export` | Export album as ZIP |
| `POST` | `/photos/export-by-date` | Export by date range |
| `GET` | `/exports/:id` | Poll export progress |
| `POST` | `/device-token` | Register FCM push token |
| `POST` | `/photos/analyze-all` | Re-analyze all photos |
| `GET` | `/albums` | List albums |
| `POST` | `/albums` | Create album |
| `DELETE` | `/albums/:id` | Delete album |
| `POST` | `/albums/:id/photos` | Add photos to album |
| `DELETE` | `/albums/:id/photos` | Remove photos from album |

## Notes

- **500MB** max file size (configured in `main.ts`)
- Thumbnails: 300px width, 70% quality, stored as `thumbnails/thumb-{key}`
- Videos: thumbnail extracted at 1s mark via ffmpeg
- All photo routes require JWT Bearer auth (except `/stream` which accepts `?token=`)
- S3 keys format: `{timestamp}-{original-filename}`
- Presigned URLs expire after 7 days

## Deployment

Currently deployed on Railway. See `.env.example` for all required env vars.
