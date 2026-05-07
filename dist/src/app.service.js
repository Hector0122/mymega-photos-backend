"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppService = void 0;
const common_1 = require("@nestjs/common");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const client_s3_2 = require("@aws-sdk/client-s3");
const sharp_1 = __importDefault(require("sharp"));
let AppService = class AppService {
    s3 = new client_s3_1.S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
            : undefined,
    });
    baseName(key) {
        return key.replace('uploads/', '').replace('thumbnails/', '');
    }
    async getPhotos(continuationToken, maxKeys = 50) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const command = new client_s3_1.ListObjectsV2Command({
            Bucket: bucket,
            MaxKeys: maxKeys,
            ContinuationToken: continuationToken,
        });
        const response = await this.s3.send(command);
        const keys = (response.Contents || [])
            .map((obj) => ({ key: obj.Key, lastModified: obj.LastModified }))
            .filter(({ key }) => {
            if (!key)
                return false;
            if (key.startsWith('thumbnails/'))
                return false;
            if (key.startsWith('thumb-'))
                return false;
            return true;
        });
        const results = await Promise.all(keys.map(async ({ key, lastModified }) => {
            const base = this.baseName(key);
            const thumbKey = `thumbnails/${base}`;
            let uri;
            try {
                await this.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key: thumbKey }));
                uri = await (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_2.GetObjectCommand({ Bucket: bucket, Key: thumbKey }), { expiresIn: 3600 });
            }
            catch {
                uri = await (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_2.GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
            }
            const ts = parseInt(base.split('-')[0], 10);
            const tsDate = !isNaN(ts) ? new Date(ts).toISOString().slice(0, 10) : null;
            const date = tsDate && tsDate > '2010-01-01'
                ? tsDate
                : (lastModified ? new Date(lastModified).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
            return { uri, date };
        }));
        const nextToken = response.NextContinuationToken ?? null;
        return { photos: results, nextToken };
    }
    async uploadPhoto(buffer, filename) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const timestamp = Date.now();
        const fullKey = `uploads/${timestamp}-${filename}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: fullKey,
            Body: buffer,
            ContentType: 'image/jpeg',
        });
        await this.s3.send(command);
        const thumbKey = `thumbnails/${timestamp}-${filename}`;
        const thumbBuffer = await (0, sharp_1.default)(buffer).resize(300).jpeg({ quality: 70 }).toBuffer();
        const thumbCommand = new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: thumbKey,
            Body: thumbBuffer,
            ContentType: 'image/jpeg',
        });
        await this.s3.send(thumbCommand);
        return `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fullKey}`;
    }
    async getPhotoUrl(key) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        return (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_2.GetObjectCommand({ Bucket: bucket, Key: `uploads/${key}` }), { expiresIn: 3600 });
    }
    async deletePhoto(key) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: `uploads/${key}` })).catch(() => { });
        await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: `thumbnails/${key}` })).catch(() => { });
        await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => { });
        await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: `thumb-${key}` })).catch(() => { });
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
                const obj = await this.s3.send(new client_s3_2.GetObjectCommand({ Bucket: bucket, Key: key }));
                const buffer = await obj.Body.transformToByteArray();
                const thumbBuffer = await (0, sharp_1.default)(Buffer.from(buffer)).resize(300).jpeg({ quality: 70 }).toBuffer();
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
                    await this.s3.send(new client_s3_1.CopyObjectCommand({ Bucket: bucket, CopySource: `/${bucket}/${key}`, Key: dest }));
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
                    await this.s3.send(new client_s3_1.CopyObjectCommand({ Bucket: bucket, CopySource: `/${bucket}/${key}`, Key: dest }));
                    moved++;
                }
                await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: key }));
            }
        }
        return { moved };
    }
};
exports.AppService = AppService;
exports.AppService = AppService = __decorate([
    (0, common_1.Injectable)()
], AppService);
//# sourceMappingURL=app.service.js.map