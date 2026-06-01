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
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { FacesService } from './faces.service'
import { UpdateFaceDto } from './dto/update-face.dto'
import { DetectBatchDto } from './dto/detect-batch.dto'
import { MergePeopleDto } from './dto/merge-people.dto'
import { sanitize } from '../common/sanitize'

@Controller('faces')
@UseGuards(JwtAuthGuard)
export class FacesController {
  constructor(private readonly facesService: FacesService) {}

  @Post('detect/:photoId')
  @HttpCode(HttpStatus.OK)
  async detectFaces(
    @CurrentUser() user: { id: string },
    @Param('photoId') photoId: string,
  ) {
    const count = await this.facesService.detectAndSave(photoId, user.id)
    return { facesFound: count }
  }

  @Post('detect-batch')
  @HttpCode(HttpStatus.OK)
  async detectBatch(
    @CurrentUser() user: { id: string },
    @Body() dto: DetectBatchDto,
  ) {
    return this.facesService.detectBatch(user.id, dto.photoIds)
  }

  @Post('detect-all')
  @HttpCode(HttpStatus.OK)
  async detectAll(@CurrentUser() user: { id: string }) {
    return this.facesService.detectAll(user.id)
  }

  @Get('unconfirmed')
  async getUnconfirmed(@CurrentUser() user: { id: string }) {
    return this.facesService.getUnconfirmed(user.id)
  }

  @Get('people')
  async getPeople(@CurrentUser() user: { id: string }) {
    return this.facesService.getPeople(user.id)
  }

  @Get('photos')
  async getPhotosByPerson(
    @CurrentUser() user: { id: string },
    @Query('person') person: string,
    @Query('pageToken') pageToken?: string,
    @Query('maxKeys') maxKeys?: string,
  ) {
    if (!person || typeof person !== 'string')
      throw new BadRequestException('person query param is required')
    const sanitized = sanitize(person, 50)
    if (!sanitized)
      throw new BadRequestException('person is empty after sanitization')
    return this.facesService.getPhotosByPerson(
      user.id,
      sanitized,
      pageToken,
      maxKeys ? parseInt(maxKeys, 10) : 50,
    )
  }

  @Get('this-day')
  async getThisDayByPerson(
    @CurrentUser() user: { id: string },
    @Query('person') person: string,
  ) {
    if (!person || typeof person !== 'string')
      throw new BadRequestException('person query param is required')
    const sanitized = sanitize(person, 50)
    if (!sanitized)
      throw new BadRequestException('person is empty after sanitization')
    return this.facesService.getThisDayByPerson(user.id, sanitized)
  }

  @Get('stats')
  async getStats(@CurrentUser() user: { id: string }) {
    return this.facesService.getStats(user.id)
  }

  @Get('photo/:photoId')
  async getFacesByPhoto(
    @CurrentUser() user: { id: string },
    @Param('photoId') photoId: string,
  ) {
    return this.facesService.getFacesByPhoto(photoId, user.id)
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updateFace(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateFaceDto,
  ) {
    const result = await this.facesService.updateFace(id, user.id, dto)
    if (!result) throw new BadRequestException('Face not found')
    return result
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteFace(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    await this.facesService.deleteFace(id, user.id)
    return { deleted: true }
  }

  @Post('confirm-all')
  @HttpCode(HttpStatus.OK)
  async confirmAll(
    @CurrentUser() user: { id: string },
    @Body('personName') personName: string,
  ) {
    if (!personName || typeof personName !== 'string')
      throw new BadRequestException('personName is required')
    const count = await this.facesService.confirmAllForPerson(
      user.id,
      sanitize(personName, 50),
    )
    return { confirmed: count }
  }

  @Post('merge')
  @HttpCode(HttpStatus.OK)
  async mergePeople(
    @CurrentUser() user: { id: string },
    @Body() dto: MergePeopleDto,
  ) {
    const count = await this.facesService.mergePeople(
      user.id,
      sanitize(dto.fromPerson, 50),
      sanitize(dto.toPerson, 50),
    )
    return { merged: count }
  }
}
