import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MigrationService } from './migration/migration.service';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly migrationService: MigrationService) {}

  async onApplicationBootstrap() {
    if (process.env.AUTO_SYNC_S3 !== 'true') return;
    try {
      const { synced } = await this.migrationService.syncS3ToDb();
      if (synced > 0)
        this.logger.log(`Synced ${synced} existing S3 photos to demo user`);
    } catch {
      // fail silently — e.g. no S3 configured, or no demo user yet
    }
  }
}
