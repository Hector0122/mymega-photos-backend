import { Injectable, OnApplicationBootstrap, NotFoundException } from '@nestjs/common'
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'
import { PrismaService } from './prisma.service'

@Injectable()
export class AppService implements OnApplicationBootstrap {

  async onApplicationBootstrap() {
    try {
      const { synced } = await this.syncS3ToDb()
      if (synced > 0) console.log(`Synced ${synced} existing S3 photos to demo user`)
    } catch {
      // fail silently — e.g. no S3 configured, or no demo user yet
    }
  }

  private s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  })

  constructor(private prisma: PrismaService) {}

  private baseName(key: string): string {
    return key.replace('uploads/', '').replace('thumbnails/', '')
  }

  async getPhotos(
    userId: string,
    cursor?: string,
    maxKeys: number = 50,
    query?: string,
    favoritesOnly?: boolean,
  ): Promise<{
      photos: { uri: string; date: string; id: string; favorite: boolean; tags: string[] }[]
    nextToken: string | null
  }> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const dbPhotos = await this.prisma.photo.findMany({
      where: {
        userId,
        ...(favoritesOnly ? { favorite: true } : {}),
        ...(query
          ? {
              OR: [
                { filename: { contains: query, mode: 'insensitive' } },
                { tags: { has: query } },
              ],
            }
          : {}),
      },
      take: maxKeys,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    })

    const results = await Promise.all(
      dbPhotos.map(async (photo) => {
        const base = this.baseName(photo.s3Key)
        const thumbKey = `thumbnails/${base}`
        let uri: string
        try {
          await this.s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: thumbKey }),
          )
          uri = await getSignedUrl(
            this.s3,
            new GetObjectCommand({ Bucket: bucket, Key: thumbKey }),
            { expiresIn: 3600 },
          )
        } catch {
          uri = await getSignedUrl(
            this.s3,
            new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }),
            { expiresIn: 3600 },
          )
        }
        return { uri, date: photo.createdAt.toISOString().slice(0, 10), id: photo.id, favorite: photo.favorite, tags: photo.tags }
      }),
    )

    const nextToken =
      dbPhotos.length === maxKeys ? dbPhotos[dbPhotos.length - 1].id : null
    return { photos: results, nextToken }
  }

  async uploadPhoto(userId: string, buffer: Buffer, filename: string, lat?: number, lng?: number): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const timestamp = Date.now()
    const fullKey = `uploads/${userId}/${timestamp}-${filename}`

    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fullKey,
        Body: buffer,
        ContentType: 'image/jpeg',
      }),
    )

    const thumbKey = `thumbnails/${userId}/${timestamp}-${filename}`
    const thumbBuffer = await sharp(buffer)
      .resize(300)
      .jpeg({ quality: 70 })
      .toBuffer()
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: 'image/jpeg',
      }),
    )

    const url = `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fullKey}`

    await this.prisma.photo.create({
      data: {
        s3Key: fullKey,
        url,
        filename,
        mimeType: 'image/jpeg',
        size: buffer.length,
        userId,
        ...(lat !== undefined ? { lat } : {}),
        ...(lng !== undefined ? { lng } : {}),
      },
    })

    return url
  }

  async getPhotoUrl(userId: string, photoId: string): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } })
    if (!photo || photo.userId !== userId) throw new NotFoundException()

    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }),
      { expiresIn: 3600 },
    )
  }

  async getShareLink(userId: string, photoId: string, expiresIn: number = 604800): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } })
    if (!photo || photo.userId !== userId) throw new NotFoundException()

    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }),
      { expiresIn },
    )
  }

  async deletePhoto(userId: string, photoId: string): Promise<void> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } })
    if (!photo || photo.userId !== userId) throw new NotFoundException()

    const base = this.baseName(photo.s3Key)
    const thumbKey = `thumbnails/${base}`

    await Promise.allSettled([
      this.s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: photo.s3Key }),
      ),
      this.s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: thumbKey }),
      ),
    ])

    await this.prisma.photo
      .deleteMany({ where: { userId, id: photoId } })
      .catch(() => {})
  }

  async toggleFavorite(userId: string, photoId: string): Promise<boolean> {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } })
    if (!photo || photo.userId !== userId) throw new NotFoundException()

    const updated = await this.prisma.photo.update({
      where: { id: photoId },
      data: { favorite: !photo.favorite },
    })
    return updated.favorite
  }

  async addTag(userId: string, photoId: string, tag: string): Promise<string[]> {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } })
    if (!photo || photo.userId !== userId) throw new NotFoundException()

    const normalized = tag.trim().toLowerCase()
    if (!normalized) return photo.tags
    if (photo.tags.includes(normalized)) return photo.tags

    const updated = await this.prisma.photo.update({
      where: { id: photoId },
      data: { tags: { push: normalized } },
    })
    return updated.tags
  }

  async removeTag(userId: string, photoId: string, tag: string): Promise<string[]> {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } })
    if (!photo || photo.userId !== userId) throw new NotFoundException()

    const updated = await this.prisma.photo.update({
      where: { id: photoId },
      data: { tags: { set: photo.tags.filter((t) => t !== tag.toLowerCase()) } },
    })
    return updated.tags
  }

  async getGeotaggedPhotos(userId: string) {
    const photos = await this.prisma.photo.findMany({
      where: { userId, lat: { not: null }, lng: { not: null } },
      select: { id: true, url: true, filename: true, lat: true, lng: true, s3Key: true },
      orderBy: { createdAt: 'desc' },
    })
    return photos
  }

  async generateMissingThumbnails(): Promise<{ generated: number }> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const command = new ListObjectsV2Command({ Bucket: bucket })
    const response = await this.s3.send(command)
    const fullKeys = (response.Contents || [])
      .map((obj) => obj.Key!)
      .filter((key) => {
        if (!key) return false
        if (key.startsWith('thumbnails/')) return false
        if (key.startsWith('thumb-')) return false
        return true
      })

    let generated = 0
    for (const key of fullKeys) {
      const base = this.baseName(key)
      const thumbKey = `thumbnails/${base}`
      try {
        await this.s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: thumbKey }),
        )
      } catch {
        const obj = await this.s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        )
        const buffer = await obj.Body!.transformToByteArray()
        const thumbBuffer = await sharp(Buffer.from(buffer))
          .resize(300)
          .jpeg({ quality: 70 })
          .toBuffer()
        await this.s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: thumbKey,
            Body: thumbBuffer,
            ContentType: 'image/jpeg',
          }),
        )
        generated++
      }
    }
    return { generated }
  }

  async migrateToFolders(): Promise<{ moved: number }> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const command = new ListObjectsV2Command({ Bucket: bucket })
    const response = await this.s3.send(command)
    const keys = (response.Contents || []).map((obj) => obj.Key!).filter(Boolean)

    let moved = 0
    for (const key of keys) {
      if (key.startsWith('uploads/') || key.startsWith('thumbnails/')) continue

      if (key.startsWith('thumb-')) {
        const base = key.slice(6)
        const dest = `thumbnails/${base}`
        try {
          await this.s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: dest }),
          )
        } catch {
          await this.s3.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: `/${bucket}/${key}`,
              Key: dest,
            }),
          )
          moved++
        }
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        )
      } else {
        const dest = `uploads/${key}`
        try {
          await this.s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: dest }),
          )
        } catch {
          await this.s3.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: `/${bucket}/${key}`,
              Key: dest,
            }),
          )
          moved++
        }
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        )
      }
    }
    return { moved }
  }

  async syncS3ToDb(): Promise<{ synced: number }> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const demoUser = await this.prisma.user.findUnique({
      where: { email: 'demo@mymega.com' },
    })
    if (!demoUser) throw new Error('Default user (demo@mymega.com) not found')

    let continuationToken: string | undefined
    let synced = 0

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      })
      const response = await this.s3.send(command)

      const fullKeys = (response.Contents || [])
        .map((obj) => ({
          key: obj.Key!,
          size: obj.Size || 0,
          lastModified: obj.LastModified,
        }))
        .filter(({ key }) => {
          if (!key) return false
          if (key.startsWith('thumbnails/')) return false
          if (key.startsWith('thumb-')) return false
          return true
        })

      for (const { key, size, lastModified } of fullKeys) {
        const existing = await this.prisma.photo.findUnique({
          where: { s3Key: key },
        })
        if (existing) continue

        const base = this.baseName(key)
        const lastPart = base.includes('/') ? base.split('/').pop()! : base
        const ts = parseInt(lastPart.split('-')[0], 10)
        const createdAt = !isNaN(ts) && ts > 0 ? new Date(ts) : lastModified || new Date()
        const filename = lastPart.split('-').slice(1).join('-') || lastPart
        const url = `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`

        await this.prisma.photo.create({
          data: {
            s3Key: key,
            url,
            filename,
            mimeType: 'image/jpeg',
            size,
            createdAt,
            userId: demoUser.id,
          },
        })
        synced++
      }

      continuationToken = response.NextContinuationToken
    } while (continuationToken)

    return { synced }
  }
}
