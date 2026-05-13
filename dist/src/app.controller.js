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
const jwt_auth_guard_1 = require("./auth/jwt-auth.guard");
const current_user_decorator_1 = require("./auth/current-user.decorator");
const app_service_1 = require("./app.service");
let AppController = class AppController {
    appService;
    constructor(appService) {
        this.appService = appService;
    }
    async getPhotos(user, pageToken, maxKeys, query, favorites) {
        return this.appService.getPhotos(user.id, pageToken, maxKeys ? parseInt(maxKeys, 10) : 50, query, favorites === 'true');
    }
    async toggleFavorite(user, id) {
        const favorite = await this.appService.toggleFavorite(user.id, id);
        return { favorite };
    }
    async addTag(user, id, tag) {
        if (!tag || typeof tag !== 'string')
            throw new common_1.BadRequestException('tag is required');
        const tags = await this.appService.addTag(user.id, id, tag);
        return { tags };
    }
    async removeTag(user, id, tag) {
        if (!tag || typeof tag !== 'string')
            throw new common_1.BadRequestException('tag is required');
        const tags = await this.appService.removeTag(user.id, id, tag);
        return { tags };
    }
    async getGeotaggedPhotos(user) {
        return this.appService.getGeotaggedPhotos(user.id);
    }
    async getPhotoById(user, id) {
        return { url: await this.appService.getPhotoUrl(user.id, id) };
    }
    async uploadPhoto(user, file, lat, lng) {
        if (!file)
            throw new common_1.BadRequestException('No file provided');
        const url = await this.appService.uploadPhoto(user.id, file.buffer, file.originalname, lat ? parseFloat(lat) : undefined, lng ? parseFloat(lng) : undefined);
        return { url };
    }
    async getShareLink(user, id, expiresIn) {
        const url = await this.appService.getShareLink(user.id, id, expiresIn ? parseInt(expiresIn, 10) : 604800);
        return { url };
    }
    async deletePhoto(user, id) {
        await this.appService.deletePhoto(user.id, id);
        return { deleted: true };
    }
    async migrateThumbnails() {
        return this.appService.generateMissingThumbnails();
    }
    async migrateFolders() {
        return this.appService.migrateToFolders();
    }
    async syncS3() {
        return this.appService.syncS3ToDb();
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)('photos'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('pageToken')),
    __param(2, (0, common_1.Query)('maxKeys')),
    __param(3, (0, common_1.Query)('q')),
    __param(4, (0, common_1.Query)('favorites')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getPhotos", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Patch)('photos/:id/favorite'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "toggleFavorite", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('photos/:id/tags'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)('tag')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "addTag", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Delete)('photos/:id/tags'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)('tag')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "removeTag", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)('photos/geo'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getGeotaggedPhotos", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)('photos/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getPhotoById", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('photos/upload'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: 50 * 1024 * 1024 } })),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Query)('lat')),
    __param(3, (0, common_1.Query)('lng')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "uploadPhoto", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)('photos/:id/share'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('expiresIn')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getShareLink", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Delete)('photos/:id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
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
__decorate([
    (0, common_1.Post)('photos/sync-s3'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "syncS3", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [app_service_1.AppService])
], AppController);
//# sourceMappingURL=app.controller.js.map