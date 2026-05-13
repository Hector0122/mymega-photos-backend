"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppService = void 0;
const common_1 = require("@nestjs/common");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const sharp_1 = __importDefault(require("sharp"));
const prisma_service_1 = require("./prisma.service");
let AppService = class AppService {
    prisma;
    async onApplicationBootstrap() {
        try {
            const { synced } = await this.syncS3ToDb();
            if (synced > 0)
                console.log(`Synced ${synced} existing S3 photos to demo user`);
        }
        catch {
        }
    }
    s3 = new client_s3_1.S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
            : undefined,
    });
    constructor(prisma) {
        this.prisma = prisma;
    }
    baseName(key) {
        return key.replace('uploads/', '').replace('thumbnails/', '');
    }
    async getPhotos(userId, cursor, maxKeys = 50, query, favoritesOnly) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const dbPhotos = await this.prisma.photo.findMany({
            where: {
                userId,
                ...(favoritesOnly ? { favorite: true } : {}),
                ...(query
                    ? {
                        OR: [
                            { filename: { contains: query, mode: 'insensitive' } },
                            { tags: { has: query } },
                        ],
                    }
                    : {}),
            },
            take: maxKeys,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { createdAt: 'desc' },
        });
        const results = await Promise.all(dbPhotos.map(async (photo) => {
            const base = this.baseName(photo.s3Key);
            const thumbKey = `thumbnails/${base}`;
            let uri;
            try {
                await this.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key: thumbKey }));
                uri = await (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: thumbKey }), { expiresIn: 3600 });
            }
            catch {
                uri = await (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }), { expiresIn: 3600 });
            }
            return { uri, date: photo.createdAt.toISOString().slice(0, 10), id: photo.id, favorite: photo.favorite, tags: photo.tags };
        }));
        const nextToken = dbPhotos.length === maxKeys ? dbPhotos[dbPhotos.length - 1].id : null;
        return { photos: results, nextToken };
    }
    async uploadPhoto(userId, buffer, filename, lat, lng) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const timestamp = Date.now();
        const fullKey = `uploads/${userId}/${timestamp}-${filename}`;
        await this.s3.send(new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: fullKey,
            Body: buffer,
            ContentType: 'image/jpeg',
        }));
        const thumbKey = `thumbnails/${userId}/${timestamp}-${filename}`;
        const thumbBuffer = await (0, sharp_1.default)(buffer)
            .resize(300)
            .jpeg({ quality: 70 })
            .toBuffer();
        await this.s3.send(new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: thumbKey,
            Body: thumbBuffer,
            ContentType: 'image/jpeg',
        }));
        const url = `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fullKey}`;
        await this.prisma.photo.create({
            data: {
                s3Key: fullKey,
                url,
                filename,
                mimeType: 'image/jpeg',
                size: buffer.length,
                userId,
                ...(lat !== undefined ? { lat } : {}),
                ...(lng !== undefined ? { lng } : {}),
            },
        });
        return url;
    }
    async getPhotoUrl(userId, photoId) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
        if (!photo || photo.userId !== userId)
            throw new common_1.NotFoundException();
        return (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }), { expiresIn: 3600 });
    }
    async getShareLink(userId, photoId, expiresIn = 604800) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
        if (!photo || photo.userId !== userId)
            throw new common_1.NotFoundException();
        return (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }), { expiresIn });
    }
    async deletePhoto(userId, photoId) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
        if (!photo || photo.userId !== userId)
            throw new common_1.NotFoundException();
        const base = this.baseName(photo.s3Key);
        const thumbKey = `thumbnails/${base}`;
        await Promise.allSettled([
            this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: photo.s3Key })),
            this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: thumbKey })),
        ]);
        await this.prisma.photo
            .deleteMany({ where: { userId, id: photoId } })
            .catch(() => { });
    }
    async toggleFavorite(userId, photoId) {
        const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
        if (!photo || photo.userId !== userId)
            throw new common_1.NotFoundException();
        const updated = await this.prisma.photo.update({
            where: { id: photoId },
            data: { favorite: !photo.favorite },
        });
        return updated.favorite;
    }
    async addTag(userId, photoId, tag) {
        const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
        if (!photo || photo.userId !== userId)
            throw new common_1.NotFoundException();
        const normalized = tag.trim().toLowerCase();
        if (!normalized)
            return photo.tags;
        if (photo.tags.includes(normalized))
            return photo.tags;
        const updated = await this.prisma.photo.update({
            where: { id: photoId },
            data: { tags: { push: normalized } },
        });
        return updated.tags;
    }
    async removeTag(userId, photoId, tag) {
        const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
        if (!photo || photo.userId !== userId)
            throw new common_1.NotFoundException();
        const updated = await this.prisma.photo.update({
            where: { id: photoId },
            data: { tags: { set: photo.tags.filter((t) => t !== tag.toLowerCase()) } },
        });
        return updated.tags;
    }
    async getGeotaggedPhotos(userId) {
        const photos = await this.prisma.photo.findMany({
            where: { userId, lat: { not: null }, lng: { not: null } },
            select: { id: true, url: true, filename: true, lat: true, lng: true, s3Key: true },
            orderBy: { createdAt: 'desc' },
        });
        return photos;
    }
    async generateMissingThumbnails() {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const command = new client_s3_1.ListObjectsV2Command({ Bucket: bucket });
        const response = await this.s3.send(command);
        const fullKeys = (response.Contents || [])
            .map((obj) => obj.Key)
            .filter((key) => {
            if (!key)
                return false;
            if (key.startsWith('thumbnails/'))
                return false;
            if (key.startsWith('thumb-'))
                return false;
            return true;
        });
        let generated = 0;
        for (const key of fullKeys) {
            const base = this.baseName(key);
            const thumbKey = `thumbnails/${base}`;
            try {
                await this.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key: thumbKey }));
            }
            catch {
                const obj = await this.s3.send(new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key }));
                const buffer = await obj.Body.transformToByteArray();
                const thumbBuffer = await (0, sharp_1.default)(Buffer.from(buffer))
                    .resize(300)
                    .jpeg({ quality: 70 })
                    .toBuffer();
                await this.s3.send(new client_s3_1.PutObjectCommand({
                    Bucket: bucket,
                    Key: thumbKey,
                    Body: thumbBuffer,
                    ContentType: 'image/jpeg',
                }));
                generated++;
            }
        }
        return { generated };
    }
    async migrateToFolders() {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const command = new client_s3_1.ListObjectsV2Command({ Bucket: bucket });
        const response = await this.s3.send(command);
        const keys = (response.Contents || []).map((obj) => obj.Key).filter(Boolean);
        let moved = 0;
        for (const key of keys) {
            if (key.startsWith('uploads/') || key.startsWith('thumbnails/'))
                continue;
            if (key.startsWith('thumb-')) {
                const base = key.slice(6);
                const dest = `thumbnails/${base}`;
                try {
                    await this.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key: dest }));
                }
                catch {
                    await this.s3.send(new client_s3_1.CopyObjectCommand({
                        Bucket: bucket,
                        CopySource: `/${bucket}/${key}`,
                        Key: dest,
                    }));
                    moved++;
                }
                await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: key }));
            }
            else {
                const dest = `uploads/${key}`;
                try {
                    await this.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key: dest }));
                }
                catch {
                    await this.s3.send(new client_s3_1.CopyObjectCommand({
                        Bucket: bucket,
                        CopySource: `/${bucket}/${key}`,
                        Key: dest,
                    }));
                    moved++;
                }
                await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: key }));
            }
        }
        return { moved };
    }
    async syncS3ToDb() {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const demoUser = await this.prisma.user.findUnique({
            where: { email: 'demo@mymega.com' },
        });
        if (!demoUser)
            throw new Error('Default user (demo@mymega.com) not found');
        let continuationToken;
        let synced = 0;
        do {
            const command = new client_s3_1.ListObjectsV2Command({
                Bucket: bucket,
                ContinuationToken: continuationToken,
            });
            const response = await this.s3.send(command);
            const fullKeys = (response.Contents || [])
                .map((obj) => ({
                key: obj.Key,
                size: obj.Size || 0,
                lastModified: obj.LastModified,
            }))
                .filter(({ key }) => {
                if (!key)
                    return false;
                if (key.startsWith('thumbnails/'))
                    return false;
                if (key.startsWith('thumb-'))
                    return false;
                return true;
            });
            for (const { key, size, lastModified } of fullKeys) {
                const existing = await this.prisma.photo.findUnique({
                    where: { s3Key: key },
                });
                if (existing)
                    continue;
                const base = this.baseName(key);
                const lastPart = base.includes('/') ? base.split('/').pop() : base;
                const ts = parseInt(lastPart.split('-')[0], 10);
                const createdAt = !isNaN(ts) && ts > 0 ? new Date(ts) : lastModified || new Date();
                const filename = lastPart.split('-').slice(1).join('-') || lastPart;
                const url = `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
                await this.prisma.photo.create({
                    data: {
                        s3Key: key,
                        url,
                        filename,
                        mimeType: 'image/jpeg',
                        size,
                        createdAt,
                        userId: demoUser.id,
                    },
                });
                synced++;
            }
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);
        return { synced };
    }
};
exports.AppService = AppService;
exports.AppService = AppService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AppService);
//# sourceMappingURL=app.service.js.map