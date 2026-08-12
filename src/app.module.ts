import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AllExceptionsFilter } from './common/exception.filter';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PrismaModule } from './prisma.module';
import { S3Module } from './common/s3.module';
import { AuthModule } from './auth/auth.module';
import { AlbumsModule } from './albums/albums.module';
import { PhotosModule } from './photos/photos.module';
import { ExportModule } from './export/export.module';
import { FirebaseModule } from './firebase/firebase.module';
import { AnalysisModule } from './analysis/analysis.module';
import { MigrationModule } from './migration/migration.module';
import { FacesModule } from './faces/faces.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // ponytail: 300/min por IP — holgado porque el multi-select del frontend
    // dispara N requests en paralelo (Home/index.tsx); el límite estricto vive
    // en auth.controller.ts vía @Throttle
    ThrottlerModule.forRoot({ throttlers: [{ limit: 300, ttl: 60000 }] }),
    PrismaModule,
    S3Module,
    AuthModule,
    AlbumsModule,
    PhotosModule,
    ExportModule,
    AnalysisModule,
    MigrationModule,
    FirebaseModule,
    FacesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Auth fail-closed: todo endpoint exige JWT salvo que se marque @SkipAuth.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
    },
  ],
})
export class AppModule {}
