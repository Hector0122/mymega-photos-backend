import { Controller, Get, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
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

  @Post('photos/upload')
  @HttpCode(HttpStatus.OK)
  async uploadPhoto(@Body() body: { image: string; filename: string }) {
    if (!body.image) throw new BadRequestException('No image provided');
    const url = await this.appService.uploadPhotoBase64(body.image, body.filename);
    return { url };
  }
}
