import { Controller, Get, Post, Delete, Body, Param, Query, HttpCode, HttpStatus, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('photos')
  async getPhotos(
    @Query('pageToken') pageToken?: string,
    @Query('maxKeys') maxKeys?: string,
  ): Promise<{ photos: { uri: string; date: string }[]; nextToken: string | null }> {
    return this.appService.getPhotos(pageToken, maxKeys ? parseInt(maxKeys, 10) : 50);
  }

  @Get('photos/:filename')
  async getPhotoByFilename(@Param('filename') filename: string) {
    return { url: await this.appService.getPhotoUrl(`${filename}`) };
  }

  @Post('photos/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadPhoto(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    const url = await this.appService.uploadPhoto(file.buffer, file.originalname);
    return { url };
  }

  @Delete('photos/:filename')
  @HttpCode(HttpStatus.OK)
  async deletePhoto(@Param('filename') filename: string) {
    await this.appService.deletePhoto(filename);
    return { deleted: true };
  }

  @Post('photos/migrate-thumbnails')
  @HttpCode(HttpStatus.OK)
  async migrateThumbnails() {
    return this.appService.generateMissingThumbnails();
  }

  @Post('photos/migrate-folders')
  @HttpCode(HttpStatus.OK)
  async migrateFolders() {
    return this.appService.migrateToFolders();
  }
}
