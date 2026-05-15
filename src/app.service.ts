import { Injectable, OnApplicationBootstrap, NotFoundException, BadRequestException } from '@nestjs/common'
import * as crypto from 'crypto';
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
const nodemailer = require('nodemailer')
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { PrismaService } from './prisma.service'

@Injectable()
export class AppService implements OnApplicationBootstrap {

  async onApplicationBootstrap() {
    if (process.env.AUTO_SYNC_S3 !== 'true') return
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
    blurryOnly?: boolean,
  ): Promise<{
      photos: { uri: string; date: string; id: string; favorite: boolean; tags: string[]; blurred: boolean }[]
    nextToken: string | null
  }> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const dbPhotos = await this.prisma.photo.findMany({
      where: {
        userId,
        ...(favoritesOnly ? { favorite: true } : {}),
        ...(blurryOnly ? { blurred: true } : {}),
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

    const presignExpiry = 604800

    const results = await Promise.all(
      dbPhotos.map(async (photo) => {
        const thumbKey = photo.thumbS3Key
        const uri = await getSignedUrl(
          this.s3,
          new GetObjectCommand({
            Bucket: bucket,
            Key: thumbKey || photo.s3Key,
          }),
          { expiresIn: presignExpiry },
        )
        return { uri, date: photo.createdAt.toISOString().slice(0, 10), id: photo.id, favorite: photo.favorite, tags: photo.tags, blurred: photo.blurred }
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

    const [blurResult, pHash] = await Promise.all([
      this.computeBlurScore(buffer),
      this.computePerceptualHash(buffer),
    ]);

    await this.prisma.photo.create({
      data: {
        s3Key: fullKey,
        thumbS3Key: thumbKey,
        url,
        filename,
        mimeType: 'image/jpeg',
        size: buffer.length,
        blurred: blurResult.blurred,
        blurScore: blurResult.score,
        perceptualHash: pHash,
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
      { expiresIn: 604800 },
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

    const s3Keys = [photo.s3Key]
    if (photo.thumbS3Key) s3Keys.push(photo.thumbS3Key)

    await Promise.allSettled(
      s3Keys.map((key) =>
        this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      ),
    )

    await this.prisma.photo.delete({ where: { id: photoId } })
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
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const photos = await this.prisma.photo.findMany({
      where: { userId, lat: { not: null }, lng: { not: null } },
      select: { id: true, url: true, filename: true, lat: true, lng: true, s3Key: true },
      orderBy: { createdAt: 'desc' },
    })

    return Promise.all(
      photos.map(async (photo) => {
        const url = await getSignedUrl(
          this.s3,
          new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }),
          { expiresIn: 604800 },
        )
        return { id: photo.id, url, filename: photo.filename, lat: photo.lat, lng: photo.lng }
      }),
    )
  }

  async getThisDayPhotos(userId: string) {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const today = new Date()
    const month = today.getMonth()
    const day = today.getDate()

    const photos = await this.prisma.photo.findMany({
      where: { userId },
      select: { id: true, createdAt: true, s3Key: true, thumbS3Key: true, filename: true },
    })

    const matching = photos.filter(p => {
      const d = new Date(p.createdAt)
      return d.getMonth() === month && d.getDate() === day && d.getFullYear() !== today.getFullYear()
    })

    const grouped = new Map<number, typeof matching>()
    for (const p of matching) {
      const year = new Date(p.createdAt).getFullYear()
      const existing = grouped.get(year) || []
      existing.push(p)
      grouped.set(year, existing)
    }

    const result = await Promise.all(
      Array.from(grouped.entries())
        .sort(([a], [b]) => b - a)
        .map(async ([year, yearPhotos]) => {
          const photo = yearPhotos[0]
          const thumbKey = photo.thumbS3Key || photo.s3Key
          const uri = await getSignedUrl(
            this.s3,
            new GetObjectCommand({ Bucket: bucket, Key: thumbKey }),
            { expiresIn: 604800 },
          )
          return { year, uri, id: photo.id, filename: photo.filename, count: yearPhotos.length, yearsAgo: today.getFullYear() - year }
        }),
    )

    return result
  }

  async getStats(userId: string) {
    const [photoCount, albumCount, favoriteCount, blurryCount] = await Promise.all([
      this.prisma.photo.count({ where: { userId } }),
      this.prisma.album.count({ where: { userId } }),
      this.prisma.photo.count({ where: { userId, favorite: true } }),
      this.prisma.photo.count({ where: { userId, blurred: true } }),
    ]);
    return { photoCount, albumCount, favoriteCount, blurryCount };
  }

  private async computeBlurScore(buffer: Buffer): Promise<{ blurred: boolean; score: number }> {
    const { data, info } = await sharp(buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sum = 0;
    let count = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = y * info.width + x;
        let dx = 0, dy = 0;
        if (x > 0) dx = Math.abs(data[idx] - data[idx - 1]);
        if (y > 0) dy = Math.abs(data[idx] - data[idx - info.width]);
        sum += dx + dy;
        count++;
      }
    }
    const score = sum / count;
    return { blurred: score < 10, score: Math.round(score * 100) / 100 };
  }

  private async computePerceptualHash(buffer: Buffer): Promise<string> {
    const { data, info } = await sharp(buffer)
      .resize(8, 8, { fit: 'cover' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const hash = Array.from(data).map(v => (v > avg ? '1' : '0')).join('');
    return BigInt('0b' + hash).toString(16).padStart(16, '0');
  }

  async analyzePhoto(photoId: string) {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required');

    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException();

    const response = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }));
    const buffer = await response.Body?.transformToByteArray();
    if (!buffer) throw new Error('Empty response body');

    const buf = Buffer.from(buffer);
    const [blurResult, pHash] = await Promise.all([
      this.computeBlurScore(buf),
      this.computePerceptualHash(buf),
    ]);

    await this.prisma.photo.update({
      where: { id: photoId },
      data: {
        blurred: blurResult.blurred,
        blurScore: blurResult.score,
        perceptualHash: pHash,
      },
    });

    return { blurred: blurResult.blurred, blurScore: blurResult.score, perceptualHash: pHash };
  }

  async analyzeAllPhotos(userId: string): Promise<{ analyzed: number }> {
    const photos = await this.prisma.photo.findMany({
      where: { userId, perceptualHash: null },
    });

    let analyzed = 0;
    for (const photo of photos) {
      try {
        await this.analyzePhoto(photo.id);
        analyzed++;
      } catch { /* skip failed */ }
    }
    return { analyzed };
  }

  async getDuplicates(userId: string) {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new Error('AWS_S3_BUCKET env variable is required')

    const photos = await this.prisma.photo.findMany({
      where: { userId, perceptualHash: { not: null } },
      select: { id: true, s3Key: true, thumbS3Key: true, filename: true, perceptualHash: true, blurred: true, blurScore: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const presigned = await Promise.all(
      photos.map(async (p) => {
        const uri = await getSignedUrl(
          this.s3,
          new GetObjectCommand({ Bucket: bucket, Key: p.thumbS3Key || p.s3Key }),
          { expiresIn: 604800 },
        )
        return { id: p.id, url: uri, filename: p.filename, perceptualHash: p.perceptualHash, blurred: p.blurred, blurScore: p.blurScore, createdAt: p.createdAt }
      }),
    )

    const hashGroups = new Map<string, typeof presigned>();
    for (const p of presigned) {
      if (!p.perceptualHash) continue;
      const existing = hashGroups.get(p.perceptualHash) || [];
      existing.push(p);
      hashGroups.set(p.perceptualHash, existing);
    }

    const duplicates = Array.from(hashGroups.values()).filter(g => g.length > 1);
    return duplicates;
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
    const thumbMap = new Map<string, string>()

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      })
      const response = await this.s3.send(command)

      const entries = (response.Contents || [])
        .map((obj) => ({
          key: obj.Key!,
          size: obj.Size || 0,
          lastModified: obj.LastModified,
        }))

      for (const { key, size, lastModified } of entries) {
        if (key.startsWith('thumbnails/')) {
          const base = this.baseName(key)
          thumbMap.set(base, key)
          continue
        }
        if (key.startsWith('thumb-')) continue

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
            thumbS3Key: thumbMap.get(base) || undefined,
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

  async exportAllPhotos(userId: string): Promise<{ message: string }> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) throw new NotFoundException('AWS_S3_BUCKET not configured')

    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')

    const photos = await this.prisma.photo.findMany({
      where: { userId },
      select: { s3Key: true, filename: true },
    })

    if (photos.length === 0) throw new BadRequestException('No hay fotos para exportar')

    const zipKey = `exports/${userId}/${Date.now()}.zip`
    const tmpPath = path.join(os.tmpdir(), `mymega-export-${userId}-${Date.now()}.zip`)

    const { ZipArchive } = await import('archiver') as any
    const output = fs.createWriteStream(tmpPath)
    const archive = new ZipArchive({ zlib: { level: 5 } })
    archive.pipe(output)

    for (const photo of photos) {
      try {
        const response = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: photo.s3Key }))
        if (response.Body) {
          archive.append(response.Body as any, { name: photo.filename })
        }
      } catch { /* skip individual failures */ }
    }

    await archive.finalize()
    await new Promise<void>((resolve, reject) => {
      output.on('finish', resolve)
      output.on('error', reject)
    })

    const zipBuffer = fs.readFileSync(tmpPath)
    fs.unlinkSync(tmpPath)

    await this.s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: zipKey,
      Body: zipBuffer,
      ContentType: 'application/zip',
    }))

    const downloadUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: zipKey }),
      { expiresIn: 86400 },
    )

    const smtpHost = process.env.SMTP_HOST
    if (smtpHost) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587'),
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      })

      const safeUrl = downloadUrl.replace(/&/g, '&amp;')
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@mymega.com',
        to: user.email,
        subject: 'Tus fotos de MyMega Photos están listas',
        html: `
          <h2>Exportación completada</h2>
          <p>Hola ${user.name},</p>
          <p>Tu exportación con ${photos.length} foto(s) está lista.</p>
          <p>Haz clic aquí para descargar (válido por 24 horas):</p>
          <p><a href="${safeUrl}" style="display:inline-block;padding:14px 32px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:8px;font-size:16px">Descargar ZIP</a></p>
          <p>O copia este enlace en tu navegador:</p>
          <p style="word-break:break-all;font-size:12px;color:#666">${safeUrl}</p>
          <p>Saludos,<br>El equipo de MyMega Photos</p>
        `,
      })
    }

    return { message: `Exportación completada. ${smtpHost ? `Revisa tu correo en ${user.email}` : 'Enlace generado.'}` }
  }
}
