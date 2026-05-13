import { Module } from '@nestjs/common'
import { AlbumsController } from './albums.controller'
import { AlbumsService } from './albums.service'
import { PrismaService } from '../prisma.service'

@Module({
  controllers: [AlbumsController],
  providers: [AlbumsService, PrismaService],
})
export class AlbumsModule {}
