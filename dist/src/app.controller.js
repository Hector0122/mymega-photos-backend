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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const app_service_1 = require("./app.service");
let AppController = class AppController {
    appService;
    constructor(appService) {
        this.appService = appService;
    }
    async getPhotos(pageToken, maxKeys) {
        return this.appService.getPhotos(pageToken, maxKeys ? parseInt(maxKeys, 10) : 50);
    }
    async getPhotoByFilename(filename) {
        return { url: await this.appService.getPhotoUrl(`${filename}`) };
    }
    async uploadPhoto(file) {
        if (!file)
            throw new common_1.BadRequestException('No file provided');
        const url = await this.appService.uploadPhoto(file.buffer, file.originalname);
        return { url };
    }
    async deletePhoto(filename) {
        await this.appService.deletePhoto(filename);
        return { deleted: true };
    }
    async migrateThumbnails() {
        return this.appService.generateMissingThumbnails();
    }
    async migrateFolders() {
        return this.appService.migrateToFolders();
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)('photos'),
    __param(0, (0, common_1.Query)('pageToken')),
    __param(1, (0, common_1.Query)('maxKeys')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getPhotos", null);
__decorate([
    (0, common_1.Get)('photos/:filename'),
    __param(0, (0, common_1.Param)('filename')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getPhotoByFilename", null);
__decorate([
    (0, common_1.Post)('photos/upload'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: 50 * 1024 * 1024 } })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "uploadPhoto", null);
__decorate([
    (0, common_1.Delete)('photos/:filename'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('filename')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "deletePhoto", null);
__decorate([
    (0, common_1.Post)('photos/migrate-thumbnails'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "migrateThumbnails", null);
__decorate([
    (0, common_1.Post)('photos/migrate-folders'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "migrateFolders", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [app_service_1.AppService])
], AppController);
//# sourceMappingURL=app.controller.js.map