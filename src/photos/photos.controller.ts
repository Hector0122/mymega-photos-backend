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
  UnprocessableEntityException,
  UnauthorizedException,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  Res,
  Req,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipAuth } from '../auth/skip-auth.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import * as jwt from 'jsonwebtoken';
import { PhotosService } from './photos.service';
import { AnalysisService } from '../analysis/analysis.service';

const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
];

const uploadTmpDir = path.join(os.tmpdir(), 'vaulta-uploads');
if (!fs.existsSync(uploadTmpDir))
  fs.mkdirSync(uploadTmpDir, { recursive: true });

@Controller()
@UseGuards(JwtAuthGuard)
export class PhotosController {
  constructor(
    private readonly photosService: PhotosService,
    private readonly analysisService: AnalysisService,
  ) {}

  @Get('photos')
  async getPhotos(
    @CurrentUser() user: { id: string },
    @Query('pageToken') pageToken?: string,
    @Query('maxKeys') maxKeys?: string,
    @Query('q') query?: string,
    @Query('favorites') favorites?: string,
    @Query('blurry') blurry?: string,
    @Query('private') privateOnly?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.photosService.getPhotos(
      user.id,
      pageToken,
      maxKeys ? parseInt(maxKeys, 10) : 50,
      query,
      favorites === 'true',
      blurry === 'true',
      privateOnly === 'true',
      dateFrom,
      dateTo,
    );
  }

  @Post('photos/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadTmpDir,
        filename: (_req, file, cb) => {
          const uniqueName = `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      limits: { fileSize: 500 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new UnprocessableEntityException(
              `Formato no soportado: ${file.mimetype}`,
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadFile(
    @CurrentUser() user: { id: string },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    const batchId = await this.photosService.startBatchUpload(user.id, [file]);
    return { batchId };
  }

  @Post('photos/upload-batch')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      storage: diskStorage({
        destination: uploadTmpDir,
        filename: (_req, file, cb) => {
          const uniqueName = `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      limits: { fileSize: 500 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new UnprocessableEntityException(
              `Formato no soportado: ${file.mimetype}`,
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadBatch(
    @CurrentUser() user: { id: string },
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0)
      throw new BadRequestException('No files provided');

    const batchId = await this.photosService.startBatchUpload(user.id, files);
    return { batchId };
  }

  @Get('photos/this-day')
  async getThisDayPhotos(@CurrentUser() user: { id: string }) {
    return this.photosService.getThisDayPhotos(user.id);
  }

  @Get('photos/stats')
  async getPhotoStats(@CurrentUser() user: { id: string }) {
    return this.photosService.getStats(user.id);
  }

  @Get('photos/trash')
  async getTrash(@CurrentUser() user: { id: string }) {
    return this.photosService.getTrash(user.id);
  }

  @Get('photos/duplicates')
  async getDuplicates(@CurrentUser() user: { id: string }) {
    return this.analysisService.getDuplicates(user.id);
  }

  @SkipAuth()
  @Get('photos/:id/stream')
  async streamPhoto(
    @Param('id') id: string,
    @Res() res: any,
    @Req() req: any,
    @Query('token') token?: string,
  ) {
    let userId: string;
    const authHeader = req.headers?.authorization;
    if (authHeader) {
      const payload = jwt.verify(
        authHeader.replace('Bearer ', ''),
        process.env.JWT_SECRET || 'mymega-secret-key',
      ) as any;
      userId = payload.sub || payload.id;
    } else if (token) {
      const payload = jwt.verify(
        token,
        process.env.JWT_SECRET || 'mymega-secret-key',
      ) as any;
      userId = payload.sub || payload.id;
    } else {
      throw new UnauthorizedException();
    }
    const { stream, contentType, contentLength } =
      await this.photosService.getPhotoStream(userId, id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', contentLength);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
  }

  @Get('photos/:id')
  async getPhotoById(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return { url: await this.photosService.getPhotoUrl(user.id, id) };
  }

  @Get('photos/:id/share')
  async getShareLink(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const url = await this.photosService.getShareLink(
      user.id,
      id,
      expiresIn ? parseInt(expiresIn, 10) : 604800,
    );
    return { url };
  }

  @Patch('photos/:id/favorite')
  @HttpCode(HttpStatus.OK)
  async toggleFavorite(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const favorite = await this.photosService.toggleFavorite(user.id, id);
    return { favorite };
  }

  @Patch('photos/:id/private')
  @HttpCode(HttpStatus.OK)
  async togglePrivate(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const isPrivate = await this.photosService.togglePrivate(user.id, id);
    return { private: isPrivate };
  }

  @Post('photos/:id/tags')
  @HttpCode(HttpStatus.OK)
  async addTag(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    if (!tag || typeof tag !== 'string')
      throw new BadRequestException('tag is required');
    const tags = await this.photosService.addTag(user.id, id, tag);
    return { tags };
  }

  @Delete('photos/:id/tags')
  @HttpCode(HttpStatus.OK)
  async removeTag(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    if (!tag || typeof tag !== 'string')
      throw new BadRequestException('tag is required');
    const tags = await this.photosService.removeTag(user.id, id, tag);
    return { tags };
  }

  @Get('photos/:id/albums')
  async getPhotoAlbums(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.photosService.getPhotoAlbums(user.id, id);
  }

  @Delete('photos/:id')
  @HttpCode(HttpStatus.OK)
  async deletePhoto(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    await this.photosService.softDeletePhoto(user.id, id);
    return { deleted: true };
  }

  @Post('photos/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restorePhoto(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    await this.photosService.restorePhoto(user.id, id);
    return { restored: true };
  }

  @Delete('photos/trash/:id')
  @HttpCode(HttpStatus.OK)
  async permanentlyDeletePhoto(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    await this.photosService.permanentlyDeletePhoto(user.id, id);
    return { deleted: true };
  }
}
