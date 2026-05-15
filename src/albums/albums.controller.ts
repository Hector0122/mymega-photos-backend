import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AlbumsService } from './albums.service';

@UseGuards(JwtAuthGuard)
@Controller('albums')
export class AlbumsController {
  constructor(private albums: AlbumsService) {}

  @Get()
  async list(@CurrentUser() user: { id: string }) {
    return this.albums.list(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: { id: string },
    @Body() body: { name: string },
  ) {
    return this.albums.create(user.id, body.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    await this.albums.delete(user.id, id);
    return { deleted: true };
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
