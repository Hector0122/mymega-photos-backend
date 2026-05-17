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
var AppService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppService = void 0;
const common_1 = require("@nestjs/common");
const migration_service_1 = require("./migration/migration.service");
let AppService = AppService_1 = class AppService {
    migrationService;
    logger = new common_1.Logger(AppService_1.name);
    constructor(migrationService) {
        this.migrationService = migrationService;
    }
    async onApplicationBootstrap() {
        if (process.env.AUTO_SYNC_S3 !== 'true')
            return;
        try {
            const { synced } = await this.migrationService.syncS3ToDb();
            if (synced > 0)
                this.logger.log(`Synced ${synced} existing S3 photos to demo user`);
        }
        catch {
        }
    }
};
exports.AppService = AppService;
exports.AppService = AppService = AppService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [migration_service_1.MigrationService])
], AppService);
//# sourceMappingURL=app.service.js.map