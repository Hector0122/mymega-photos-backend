import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
globalThis.require = require

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = path.join(__dirname, '..', '..', 'models', 'face-api')

const FACE_DETECT_MAX_WIDTH = 1024

async function detect(imagePath) {
  const faceapi = await import('@vladmandic/face-api')
  const tf = faceapi.tf || (await import('@tensorflow/tfjs'))

  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_DIR)
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR)
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR)

  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(fs.readFileSync(imagePath))
    .resize(FACE_DETECT_MAX_WIDTH, FACE_DETECT_MAX_WIDTH, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const tensor = tf.tensor3d(data, [info.height, info.width, info.channels], 'int32')
  const input = tf.cast(tensor, 'float32')

  const detections = await faceapi
    .detectAllFaces(
      input,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 320,
        scoreThreshold: 0.1,
      }),
    )
    .withFaceLandmarks()
    .withFaceDescriptors()
    .run()

  tf.dispose(tensor)
  tf.dispose(input)

  return detections.map((d) => ({
    encoding: Array.from(d.descriptor),
    boxX: d.detection.box.x,
    boxY: d.detection.box.y,
    boxWidth: d.detection.box.width,
    boxHeight: d.detection.box.height,
  }))
}

async function main() {
  const imagePath = process.argv[2]
  if (!imagePath) {
    process.stderr.write('Usage: node face-detect.mjs <imagePath>\n')
    process.exit(1)
  }

  if (!fs.existsSync(imagePath)) {
    process.stderr.write(`File not found: ${imagePath}\n`)
    process.exit(1)
  }

  try {
    const faces = await detect(imagePath)
    process.stdout.write(JSON.stringify({ faces }))
  } catch (err) {
    process.stderr.write(err.message + '\n')
    process.stdout.write(JSON.stringify({ faces: [], error: err.message }))
  }
}

main()
