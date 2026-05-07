"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppService = void 0;
const common_1 = require("@nestjs/common");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const client_s3_2 = require("@aws-sdk/client-s3");
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
    async getPhotos() {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const command = new client_s3_1.ListObjectsV2Command({ Bucket: bucket });
        const response = await this.s3.send(command);
        const keys = (response.Contents || [])
            .map((obj) => obj.Key)
            .filter(Boolean);
        const signedUrls = await Promise.all(keys.map((key) => (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_2.GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 })));
        return signedUrls;
    }
    async uploadPhotoBase64(base64Image, filename) {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket)
            throw new Error('AWS_S3_BUCKET env variable is required');
        const key = `${Date.now()}-${filename}`;
        const buffer = Buffer.from(base64Image, 'base64');
        const command = new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: 'image/jpeg',
        });
        await this.s3.send(command);
        return `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
    }
    async getPhotoByFilename() { }
};
exports.AppService = AppService;
exports.AppService = AppService = __decorate([
    (0, common_1.Injectable)()
], AppService);
//# sourceMappingURL=app.service.js.map