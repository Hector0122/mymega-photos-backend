import * as faceapi from '@vladmandic/face-api'
import * as tf from '@tensorflow/tfjs-node'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = path.join(__dirname, '..', '..', '..', 'models', 'face-api')

const FACE_DETECT_MAX_WIDTH = 1024

async function detect(imagePath) {
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_DIR)
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR)
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR)

  const buffer = fs.readFileSync(imagePath)
  const tensor = tf.node.decodeImage(buffer, 3)
  const [h, w] = tensor.shape

  let input = tensor
  if (Math.max(w, h) > FACE_DETECT_MAX_WIDTH) {
    const scale = FACE_DETECT_MAX_WIDTH / Math.max(w, h)
    input = tf.image.resizeBilinear(tensor, [
      Math.round(h * scale),
      Math.round(w * scale),
    ])
  }

  const detections = await faceapi
    .detectAllFaces(
      input,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: 0.5,
      }),
    )
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
