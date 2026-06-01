import { Module } from '@nestjs/common';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { FacesModule } from '../faces/faces.module';

@Module({
  imports: [FirebaseModule, AnalysisModule, FacesModule],
  controllers: [PhotosController],
  providers: [PhotosService],
})
export class PhotosModule {}
