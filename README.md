# Vaulta — Backend

NestJS 11 API that stores photos in AWS S3, generates thumbnails via `sharp`, and serves signed URLs.

## Prerequisites

- Node.js >=20
- npm or pnpm
- AWS S3 bucket with credentials

## Setup

```bash
npm install
```

### Environment variables

Create a `.env` file in the project root:

```env
AWS_ACCESS_KEY_ID=tu-access-key
AWS_SECRET_ACCESS_KEY=tu-secret-key
AWS_REGION=us-east-2
AWS_S3_BUCKET=mymega-photos
```

## Start

```bash
# development (watch mode)
npm run start:dev

# production
npm run build && npm run start:prod
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/photos` | List photos — returns `{ uri, date }[]` (thumbnail signed URLs) |
| `GET` | `/photos/:filename` | Get signed URL for a specific file |
| `POST` | `/photos/upload` | Upload a photo (accepts `{ image: base64, filename }`) |
| `DELETE` | `/photos/:filename` | Delete photo + its thumbnail from S3 |
| `POST` | `/photos/migrate-thumbnails` | Generate missing thumbnails for all existing photos |
| `POST` | `/photos/migrate-folders` | Move root-level files to `uploads/` and `thumbnails/` folders |

### Upload format

```json
{
  "image": "<base64-encoded-image>",
  "filename": "photo-name.jpg"
}
```

## Notes

- Accepts payloads up to 50 MB (configured in `main.ts`)
- Thumbnails: 300px width, 70% quality, stored in `thumbnails/` folder
- Originals stored in `uploads/` folder
- `GET /photos` date is extracted from the S3 key timestamp (`{unix-ts}-filename.ext`), falls back to `LastModified` then today

### Migrations

```bash
# Generate thumbnails for existing photos
curl -X POST http://localhost:3000/photos/migrate-thumbnails

# Move root-level files into uploads/ and thumbnails/ folders
curl -X POST http://localhost:3000/photos/migrate-folders
```
