import { Module } from '@nestjs/common';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [FirebaseModule, AnalysisModule],
  controllers: [PhotosController],
  providers: [PhotosService],
})
export class PhotosModule {}
