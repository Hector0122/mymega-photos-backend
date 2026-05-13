import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class AlbumsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.album.findMany({
      where: { userId },
      include: { _count: { select: { photos: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(userId: string, name: string) {
    return this.prisma.album.create({
      data: { name, userId },
    })
  }

  async delete(userId: string, albumId: string) {
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, userId },
    })
    if (!album) throw new NotFoundException('Album not found')
    await this.prisma.album.delete({ where: { id: albumId } })
  }

  async addPhotos(userId: string, albumId: string, photoIds: string[]) {
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, userId },
    })
    if (!album) throw new NotFoundException('Album not found')

    await this.prisma.album.update({
      where: { id: albumId },
      data: {
        photos: {
          connect: photoIds.map((id) => ({ id })),
        },
      },
    })
    return { added: photoIds.length }
  }

  async removePhotos(userId: string, albumId: string, photoIds: string[]) {
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, userId },
    })
    if (!album) throw new NotFoundException('Album not found')

    await this.prisma.album.update({
      where: { id: albumId },
      data: {
        photos: {
          disconnect: photoIds.map((id) => ({ id })),
        },
      },
    })
    return { removed: photoIds.length }
  }
}
