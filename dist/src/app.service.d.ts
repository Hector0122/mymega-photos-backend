import { OnApplicationBootstrap } from '@nestjs/common';
import { MigrationService } from './migration/migration.service';
export declare class AppService implements OnApplicationBootstrap {
    private readonly migrationService;
    private readonly logger;
    constructor(migrationService: MigrationService);
    onApplicationBootstrap(): Promise<void>;
}
