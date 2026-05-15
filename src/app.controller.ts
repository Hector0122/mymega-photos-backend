import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CurrentUser } from './auth/current-user.decorator';
import { AppService } from './app.service';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @UseGuards(JwtAuthGuard)
  @Get('photos')
  async getPhotos(
    @CurrentUser() user: { id: string },
    @Query('pageToken') pageToken?: string,
    @Query('maxKeys') maxKeys?: string,
    @Query('q') query?: string,
    @Query('favorites') favorites?: string,
    @Query('blurry') blurry?: string,
  ) {
    return this.appService.getPhotos(
      user.id,
      pageToken,
      maxKeys ? parseInt(maxKeys, 10) : 50,
      query,
      favorites === 'true',
      blurry === 'true',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('photos/:id/favorite')
  @HttpCode(HttpStatus.OK)
  async toggleFavorite(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const favorite = await this.appService.toggleFavorite(user.id, id);
    return { favorite };
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/:id/tags')
  @HttpCode(HttpStatus.OK)
  async addTag(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    if (!tag || typeof tag !== 'string')
      throw new BadRequestException('tag is required');
    const tags = await this.appService.addTag(user.id, id, tag);
    return { tags };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('photos/:id/tags')
  @HttpCode(HttpStatus.OK)
  async removeTag(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    if (!tag || typeof tag !== 'string')
      throw new BadRequestException('tag is required');
    const tags = await this.appService.removeTag(user.id, id, tag);
    return { tags };
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/geo')
  async getGeotaggedPhotos(@CurrentUser() user: { id: string }) {
    return this.appService.getGeotaggedPhotos(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/stats')
  async getPhotoStats(@CurrentUser() user: { id: string }) {
    return this.appService.getStats(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/this-day')
  async getThisDayPhotos(@CurrentUser() user: { id: string }) {
    return this.appService.getThisDayPhotos(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/analyze-all')
  @HttpCode(HttpStatus.OK)
  async analyzeAllPhotos(@CurrentUser() user: { id: string }) {
    return this.appService.analyzeAllPhotos(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/duplicates')
  async getDuplicates(@CurrentUser() user: { id: string }) {
    return this.appService.getDuplicates(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/:id/analyze')
  @HttpCode(HttpStatus.OK)
  async analyzePhoto(
    @CurrentUser() _user: { id: string },
    @Param('id') id: string,
  ) {
    return this.appService.analyzePhoto(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/:id')
  async getPhotoById(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return { url: await this.appService.getPhotoUrl(user.id, id) };
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
          cb(null, true)
        } else {
          cb(new UnprocessableEntityException(`Formato no soportado: ${file.mimetype}`), false)
        }
      },
    }),
  )
  async uploadPhoto(
    @CurrentUser() user: { id: string },
    @UploadedFile() file: Express.Multer.File,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');

    if (lat !== undefined && (isNaN(Number(lat)) || Number(lat) < -90 || Number(lat) > 90)) {
      throw new BadRequestException('lat inválido')
    }
    if (lng !== undefined && (isNaN(Number(lng)) || Number(lng) < -180 || Number(lng) > 180)) {
      throw new BadRequestException('lng inválido')
    }

    const url = await this.appService.uploadPhoto(
      user.id,
      file.buffer,
      file.originalname,
      lat ? parseFloat(lat) : undefined,
      lng ? parseFloat(lng) : undefined,
    );
    return { url };
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/:id/share')
  async getShareLink(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const url = await this.appService.getShareLink(
      user.id,
      id,
      expiresIn ? parseInt(expiresIn, 10) : 604800,
    );
    return { url };
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/export')
  @HttpCode(HttpStatus.OK)
  async exportPhotos(@CurrentUser() user: { id: string }) {
    return this.appService.exportAllPhotos(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('photos/:id')
  @HttpCode(HttpStatus.OK)
  async deletePhoto(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    await this.appService.deletePhoto(user.id, id);
    return { deleted: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/migrate-thumbnails')
  @HttpCode(HttpStatus.OK)
  async migrateThumbnails() {
    return this.appService.generateMissingThumbnails();
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/migrate-folders')
  @HttpCode(HttpStatus.OK)
  async migrateFolders() {
    return this.appService.migrateToFolders();
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/sync-s3')
  @HttpCode(HttpStatus.OK)
  async syncS3() {
    return this.appService.syncS3ToDb();
  }
}
