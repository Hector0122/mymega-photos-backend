import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('photos')
  async getPhotos(): Promise<string[]> {
    return this.appService.getPhotos();
  }

  @Get('photos/:filename')
  getPhotoByFilename() {
    return this.appService.getPhotoByFilename();
  }
}
