import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AlbumsService } from './albums.service';
import { sanitize } from '../common/sanitize';

@UseGuards(JwtAuthGuard)
@Controller('albums')
export class AlbumsController {
  constructor(private albums: AlbumsService) {}

  @Get()
  async list(@CurrentUser() user: { id: string }) {
    return this.albums.list(user.id);
  }

  @Get('vault')
  async getVault(@CurrentUser() user: { id: string }) {
    const [mainVault, vaultAlbums] = await Promise.all([
      this.albums.getVault(user.id),
      this.albums.listVaultAlbums(user.id),
    ]);
    return { mainVault, vaultAlbums };
  }

  @Post()
  async create(
    @CurrentUser() user: { id: string },
    @Body() body: { name: string; vault?: boolean },
  ) {
    const name = sanitize(body.name, 100);
    if (!name) throw new BadRequestException('Invalid album name');
    return this.albums.create(user.id, name, body.vault);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { name?: string; coverPhotoId?: string | null },
  ) {
    const sanitized: any = {};
    if (body.name !== undefined) {
      const name = sanitize(body.name, 100);
      if (!name) throw new BadRequestException('Invalid album name');
      sanitized.name = name;
    }
    if (body.coverPhotoId !== undefined) {
      sanitized.coverPhotoId = body.coverPhotoId;
    }
    return this.albums.update(user.id, id, sanitized);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    await this.albums.delete(user.id, id);
    return { deleted: true };
  }

  @Get(':id/photos')
  async getPhotos(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('pageToken') pageToken?: string,
    @Query('maxKeys') maxKeys?: string,
  ) {
    return this.albums.getPhotos(
      user.id,
      id,
      pageToken,
      maxKeys ? parseInt(maxKeys, 10) : 50,
    );
  }

  @Post(':id/photos')
  @HttpCode(HttpStatus.OK)
  async addPhotos(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { photoIds: string[] },
  ) {
    return this.albums.addPhotos(user.id, id, body.photoIds);
  }

  @Delete(':id/photos')
  @HttpCode(HttpStatus.OK)
  async removePhotos(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { photoIds: string[] },
  ) {
    return this.albums.removePhotos(user.id, id, body.photoIds);
  }
}
