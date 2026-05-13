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
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JwtAuthGuard } from './auth/jwt-auth.guard'
import { CurrentUser } from './auth/current-user.decorator'
import { AppService } from './app.service'

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
  ) {
    return this.appService.getPhotos(
      user.id,
      pageToken,
      maxKeys ? parseInt(maxKeys, 10) : 50,
      query,
      favorites === 'true',
    )
  }

  @UseGuards(JwtAuthGuard)
  @Patch('photos/:id/favorite')
  @HttpCode(HttpStatus.OK)
  async toggleFavorite(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const favorite = await this.appService.toggleFavorite(user.id, id)
    return { favorite }
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/:id/tags')
  @HttpCode(HttpStatus.OK)
  async addTag(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    if (!tag || typeof tag !== 'string') throw new BadRequestException('tag is required')
    const tags = await this.appService.addTag(user.id, id, tag)
    return { tags }
  }

  @UseGuards(JwtAuthGuard)
  @Delete('photos/:id/tags')
  @HttpCode(HttpStatus.OK)
  async removeTag(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    if (!tag || typeof tag !== 'string') throw new BadRequestException('tag is required')
    const tags = await this.appService.removeTag(user.id, id, tag)
    return { tags }
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/geo')
  async getGeotaggedPhotos(@CurrentUser() user: { id: string }) {
    return this.appService.getGeotaggedPhotos(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/:id')
  async getPhotoById(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return { url: await this.appService.getPhotoUrl(user.id, id) }
  }

  @UseGuards(JwtAuthGuard)
  @Post('photos/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async uploadPhoto(
    @CurrentUser() user: { id: string },
    @UploadedFile() file: Express.Multer.File,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided')
    const url = await this.appService.uploadPhoto(
      user.id,
      file.buffer,
      file.originalname,
      lat ? parseFloat(lat) : undefined,
      lng ? parseFloat(lng) : undefined,
    )
    return { url }
  }

  @UseGuards(JwtAuthGuard)
  @Get('photos/:id/share')
  async getShareLink(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const url = await this.appService.getShareLink(
      user.id, id, expiresIn ? parseInt(expiresIn, 10) : 604800,
    )
    return { url }
  }

  @UseGuards(JwtAuthGuard)
  @Delete('photos/:id')
  @HttpCode(HttpStatus.OK)
  async deletePhoto(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    await this.appService.deletePhoto(user.id, id)
    return { deleted: true }
  }

  @Post('photos/migrate-thumbnails')
  @HttpCode(HttpStatus.OK)
  async migrateThumbnails() {
    return this.appService.generateMissingThumbnails()
  }

  @Post('photos/migrate-folders')
  @HttpCode(HttpStatus.OK)
  async migrateFolders() {
    return this.appService.migrateToFolders()
  }

  @Post('photos/sync-s3')
  @HttpCode(HttpStatus.OK)
  async syncS3() {
    return this.appService.syncS3ToDb()
  }
}
