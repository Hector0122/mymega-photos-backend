import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
} from '@nestjs/common'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { PrismaService } from '../prisma.service'
import { S3_CLIENT } from '../common/s3.provider'
import * as faceapi from '@vladmandic/face-api'
import * as tf from '@tensorflow/tfjs-node'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'

const MODELS_DIR = path.join(process.cwd(), 'models', 'face-api')
const FACE_DETECT_MAX_WIDTH = 1024
const MATCH_THRESHOLD = 0.6

interface DetectedFace {
  encoding: number[]
  boxX: number
  boxY: number
  boxWidth: number
  boxHeight: number
}

@Injectable()
export class FacesService implements OnModuleInit {
  private readonly logger = new Logger(FacesService.name)
  private _ready = false

  constructor(
    private prisma: PrismaService,
    @Inject(S3_CLIENT) private s3: S3Client,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureModelsExist()
      await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_DIR)
      await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR)
      await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR)
      this._ready = true
      this.logger.log('Face detection models loaded successfully')
    } catch (err) {
      this.logger.warn(
        `Face detection models not available: ${(err as Error).message}. Face features disabled.`,
      )
    }
  }

  get ready(): boolean {
    return this._ready
  }

  private async ensureModelsExist() {
    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true })
    }

    const BASE_URL =
      'https://raw.githubusercontent.com/vladmandic/face-api/master/model'

    const MODELS = [
      { file: 'tiny_face_detector_model.bin', shard: false },
      { file: 'tiny_face_detector_model-weights_manifest.json', shard: false },
      { file: 'face_landmark_68_model.bin', shard: false },
      { file: 'face_landmark_68_model-weights_manifest.json', shard: false },
      { file: 'face_recognition_model.bin', shard: false },
      { file: 'face_recognition_model-weights_manifest.json', shard: false },
    ]

    for (const { file } of MODELS) {
      const dest = path.join(MODELS_DIR, file)
      if (fs.existsSync(dest)) continue

      const url = `${BASE_URL}/${file}`
      this.logger.log(`Downloading face model: ${file}`)
      await this.downloadFile(url, dest)
    }
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      https
        .get(url, (response) => {
          if (
            response.statusCode === 302 ||
            response.statusCode === 301
          ) {
            const redirectUrl = response.headers.location
            if (redirectUrl) {
              file.close()
              fs.unlinkSync(dest)
              this.downloadFile(redirectUrl, dest)
                .then(resolve)
                .catch(reject)
              return
            }
          }
          if (response.statusCode !== 200) {
            file.close()
            fs.unlinkSync(dest)
            reject(new Error(`HTTP ${response.statusCode} for ${url}`))
            return
          }
          response.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
        })
        .on('error', (err) => {
          file.close()
          if (fs.existsSync(dest)) fs.unlinkSync(dest)
          reject(err)
        })
    })
  }

  private async getImageBuffer(s3Key: string): Promise<Buffer> {
    const bucket =
      process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET || ''

    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
    )

    const chunks: Uint8Array[] = []
    if (!response.Body) throw new Error('Empty response from S3')
    const stream = response.Body as NodeJS.ReadableStream
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }

    return Buffer.concat(chunks)
  }

  async detectFaces(photoId: string, userId: string): Promise<DetectedFace[]> {
    if (!this._ready) {
      this.logger.warn('Face detection not ready, skipping')
      return []
    }

    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      select: { s3Key: true, mimeType: true, userId: true },
    })

    if (!photo || photo.userId !== userId) {
      throw new Error('Photo not found')
    }

    const isVideo = photo.mimeType.startsWith('video/')
    if (isVideo) {
      return []
    }

    try {
      const buffer = await this.getImageBuffer(photo.s3Key)

      const tensor = tf.node.decodeImage(buffer, 3) as tf.Tensor3D
      const [h, w] = tensor.shape

      let input: tf.Tensor3D | tf.Tensor4D = tensor
      if (Math.max(w, h) > FACE_DETECT_MAX_WIDTH) {
        const scale = FACE_DETECT_MAX_WIDTH / Math.max(w, h)
        input = tf.image.resizeBilinear(tensor, [
          Math.round(h * scale),
          Math.round(w * scale),
        ])
      }

      const detections = await faceapi
        .detectAllFaces(input as unknown as HTMLCanvasElement, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptors()
        .run()

      tf.dispose(tensor)
      if (input !== tensor) tf.dispose(input)

      return detections.map((d) => ({
        encoding: Array.from(d.descriptor),
        boxX: d.detection.box.x,
        boxY: d.detection.box.y,
        boxWidth: d.detection.box.width,
        boxHeight: d.detection.box.height,
      }))
    } catch (err) {
      this.logger.error(
        `Face detection failed for photo ${photoId}: ${(err as Error).message}`,
      )
      return []
    }
  }

  async detectAndSave(photoId: string, userId: string): Promise<number> {
    const faces = await this.detectFaces(photoId, userId)

    if (faces.length === 0) return 0

    await this.prisma.face.deleteMany({ where: { photoId } })

    await this.prisma.face.createMany({
      data: faces.map((f) => ({
        photoId,
        encoding: f.encoding,
        boxX: f.boxX,
        boxY: f.boxY,
        boxWidth: f.boxWidth,
        boxHeight: f.boxHeight,
      })),
    })

    const existingNames = await this.prisma.face.findMany({
      where: { personName: { not: null }, confirmed: true },
      select: { personName: true, encoding: true },
      distinct: ['personName'],
    })

    if (existingNames.length > 0) {
      const newFaces = await this.prisma.face.findMany({
        where: { photoId, personName: null, ignored: false },
      })

      for (const face of newFaces) {
        const encoding = face.encoding as number[]
        let bestMatch = ''
        let bestDistance = Infinity

        for (const existing of existingNames) {
          if (!existing.personName) continue
          const existingEncoding = existing.encoding as number[]
          const dist = this.euclideanDistance(encoding, existingEncoding)
          if (dist < MATCH_THRESHOLD && dist < bestDistance) {
            bestDistance = dist
            bestMatch = existing.personName
          }
        }

        if (bestMatch) {
          await this.prisma.face.update({
            where: { id: face.id },
            data: { personName: bestMatch },
          })
        }
      }
    }

    return faces.length
  }

  async detectBatch(userId: string, photoIds: string[]): Promise<{ processed: number; facesFound: number; failed: number }> {
    let processed = 0
    let facesFound = 0
    let failed = 0

    for (const photoId of photoIds) {
      try {
        const count = await this.detectAndSave(photoId, userId)
        processed++
        facesFound += count
      } catch (err) {
        this.logger.error(`Failed to detect faces for ${photoId}: ${(err as Error).message}`)
        failed++
      }
    }

    return { processed, facesFound, failed }
  }

  async detectAll(userId: string): Promise<{ processed: number; facesFound: number; failed: number }> {
    const photos = await this.prisma.photo.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, mimeType: true, _count: { select: { faces: true } } },
    })

    const photoIds = photos
      .filter((p) => !p.mimeType.startsWith('video/') && p._count.faces === 0)
      .map((p) => p.id)

    if (photoIds.length === 0) return { processed: 0, facesFound: 0, failed: 0 }

    return this.detectBatch(userId, photoIds)
  }

  async getPeople(userId: string): Promise<{ name: string; faceCount: number; photoCount: number; thumbnailPhotoId: string | null }[]> {
    const faces = await this.prisma.face.findMany({
      where: {
        photo: { userId, deletedAt: null },
        personName: { not: null },
        confirmed: true,
        ignored: false,
      },
      select: {
        personName: true,
        photoId: true,
        photo: { select: { id: true, thumbS3Key: true, s3Key: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const byPerson = new Map<string, { faceCount: number; photoIds: Set<string>; firstPhoto: typeof faces[0]['photo'] | null }>()

    for (const f of faces) {
      if (!f.personName) continue
      let entry = byPerson.get(f.personName)
      if (!entry) {
        entry = { faceCount: 0, photoIds: new Set(), firstPhoto: null }
        byPerson.set(f.personName, entry)
      }
      entry.faceCount++
      entry.photoIds.add(f.photoId)
      if (!entry.firstPhoto) entry.firstPhoto = f.photo
    }

    return Array.from(byPerson.entries())
      .map(([name, data]) => ({
        name,
        faceCount: data.faceCount,
        photoCount: data.photoIds.size,
        thumbnailPhotoId: data.firstPhoto?.id ?? null,
      }))
      .sort((a, b) => b.photoCount - a.photoCount)
  }

  async getUnconfirmed(userId: string): Promise<{ id: string; photoId: string; photoUri: string | null }[]> {
    const faces = await this.prisma.face.findMany({
      where: {
        photo: { userId, deletedAt: null },
        confirmed: false,
        ignored: false,
      },
      select: {
        id: true,
        photoId: true,
        photo: { select: { id: true, thumbS3Key: true, s3Key: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const bucket = process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET || ''

    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
    const results = await Promise.all(
      faces.map(async (f) => {
        const thumbKey = f.photo.thumbS3Key || f.photo.s3Key
        const uri = await getSignedUrl(
          this.s3,
          new GetObjectCommand({ Bucket: bucket, Key: thumbKey }),
          { expiresIn: 604800 },
        )
        return { id: f.id, photoId: f.photoId, photoUri: uri }
      }),
    )

    return results
  }

  async getPhotosByPerson(
    userId: string,
    personName: string,
    cursor?: string,
    maxKeys = 50,
  ): Promise<{ photos: any[]; nextToken: string | null }> {
    const facePhotoIds = await this.prisma.face.findMany({
      where: {
        photo: { userId, deletedAt: null, private: false },
        personName,
        confirmed: true,
        ignored: false,
      },
      select: { photoId: true },
      distinct: ['photoId'],
    })

    const photoIds = facePhotoIds.map((f) => f.photoId)

    if (photoIds.length === 0) return { photos: [], nextToken: null }

    const dbPhotos = await this.prisma.photo.findMany({
      where: {
        id: { in: photoIds },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      take: maxKeys,
      orderBy: { createdAt: 'desc' },
    })

    const bucket = process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET || ''
    const PRESIGN_EXPIRY = 604800
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

    const results = await Promise.all(
      dbPhotos.map(async (photo) => {
        const thumbKey = photo.thumbS3Key || photo.s3Key
        const uri = await getSignedUrl(
          this.s3,
          new GetObjectCommand({ Bucket: bucket, Key: thumbKey }),
          { expiresIn: PRESIGN_EXPIRY },
        )
        return {
          uri,
          date: photo.createdAt.toISOString().slice(0, 10),
          id: photo.id,
          favorite: photo.favorite,
          tags: photo.tags,
          blurred: photo.blurred,
          private: photo.private,
          mimeType: photo.mimeType,
        }
      }),
    )

    const nextToken =
      dbPhotos.length === maxKeys ? dbPhotos[dbPhotos.length - 1].id : null

    return { photos: results, nextToken }
  }

  async getThisDayByPerson(userId: string, personName: string) {
    const today = new Date()
    const month = today.getMonth() + 1
    const day = today.getDate()

    const photos = await this.prisma.$queryRaw<
      Array<{
        id: string
        createdAt: Date
        s3Key: string
        thumbS3Key: string | null
        filename: string
      }>
    >`
      SELECT p.id, p."createdAt", p."s3Key", p."thumbS3Key", p.filename
      FROM "Photo" p
      INNER JOIN "Face" f ON f."photoId" = p.id
      WHERE p."userId" = ${userId}
        AND p."deletedAt" IS NULL
        AND p."private" = false
        AND f."personName" = ${personName}
        AND f."confirmed" = true
        AND f."ignored" = false
        AND EXTRACT(MONTH FROM p."createdAt") = ${month}::int
        AND EXTRACT(DAY FROM p."createdAt") = ${day}::int
        AND EXTRACT(YEAR FROM p."createdAt") != ${today.getFullYear()}::int
      ORDER BY p."createdAt" DESC
    `

    const grouped = new Map<number, typeof photos>()
    for (const p of photos) {
      const year = new Date(p.createdAt).getFullYear()
      const existing = grouped.get(year) || []
      existing.push(p)
      grouped.set(year, existing)
    }

    const bucket = process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET || ''
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

    return Promise.all(
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
          return {
            year,
            uri,
            id: photo.id,
            filename: photo.filename,
            person: personName,
            count: yearPhotos.length,
            yearsAgo: today.getFullYear() - year,
          }
        }),
    )
  }

  async getStats(userId: string): Promise<{ totalFaces: number; peopleCount: number; byPerson: { name: string; faceCount: number; photoCount: number }[] }> {
    const [totalFaces, peopleResult, allPersonData] = await Promise.all([
      this.prisma.face.count({
        where: { photo: { userId, deletedAt: null }, ignored: false },
      }),
      this.prisma.face.groupBy({
        by: ['personName'],
        where: {
          photo: { userId, deletedAt: null },
          personName: { not: null },
          confirmed: true,
          ignored: false,
        },
        _count: { id: true },
      }),
      this.prisma.face.findMany({
        where: {
          photo: { userId, deletedAt: null },
          personName: { not: null },
          confirmed: true,
          ignored: false,
        },
        select: { personName: true, photoId: true },
        distinct: ['personName', 'photoId'],
      }),
    ])

    const photoCounts = new Map<string, Set<string>>()
    for (const f of allPersonData) {
      if (!f.personName) continue
      let set = photoCounts.get(f.personName)
      if (!set) {
        set = new Set()
        photoCounts.set(f.personName, set)
      }
      set.add(f.photoId)
    }

    const byPerson = peopleResult
      .filter((p) => p.personName)
      .map((p) => ({
        name: p.personName!,
        faceCount: p._count.id,
        photoCount: photoCounts.get(p.personName!)?.size ?? 0,
      }))
      .sort((a, b) => b.photoCount - a.photoCount)

    return { totalFaces, peopleCount: byPerson.length, byPerson }
  }

  async updateFace(
    faceId: string,
    userId: string,
    data: { personName?: string; confirmed?: boolean; ignored?: boolean },
  ) {
    const face = await this.prisma.face.findUnique({
      where: { id: faceId },
      select: { id: true, photo: { select: { userId: true } } },
    })

    if (!face || face.photo.userId !== userId) return null

    return this.prisma.face.update({
      where: { id: faceId },
      data: {
        ...(data.personName !== undefined ? { personName: data.personName } : {}),
        ...(data.confirmed !== undefined ? { confirmed: data.confirmed } : {}),
        ...(data.ignored !== undefined ? { ignored: data.ignored } : {}),
      },
    })
  }

  async deleteFace(faceId: string, userId: string) {
    const face = await this.prisma.face.findUnique({
      where: { id: faceId },
      select: { id: true, photo: { select: { userId: true } } },
    })

    if (!face || face.photo.userId !== userId) throw new Error('Face not found')

    await this.prisma.face.delete({ where: { id: faceId } })
  }

  async confirmAllForPerson(
    userId: string,
    personName: string,
  ): Promise<number> {
    const result = await this.prisma.face.updateMany({
      where: {
        photo: { userId },
        personName,
        confirmed: false,
        ignored: false,
      },
      data: { confirmed: true },
    })

    return result.count
  }

  async mergePeople(
    userId: string,
    fromPerson: string,
    toPerson: string,
  ): Promise<number> {
    const result = await this.prisma.face.updateMany({
      where: {
        photo: { userId },
        personName: fromPerson,
      },
      data: { personName: toPerson },
    })

    return result.count
  }

  async getFacesByPhoto(photoId: string, userId: string) {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      select: { userId: true },
    })

    if (!photo || photo.userId !== userId) return []

    return this.prisma.face.findMany({
      where: { photoId, ignored: false },
      select: {
        id: true,
        boxX: true,
        boxY: true,
        boxWidth: true,
        boxHeight: true,
        personName: true,
        confirmed: true,
      },
    })
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0
    for (let i = 0; i < a.length && i < b.length; i++) {
      sum += (a[i] - b[i]) ** 2
    }
    return Math.sqrt(sum)
  }
}
