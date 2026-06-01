import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'

const MODELS_DIR = path.join(process.cwd(), 'models', 'face-api')
const BASE_URL =
  'https://raw.githubusercontent.com/vladmandic/face-api/master/model'

const MODELS = [
  'tiny_face_detector_model.bin',
  'tiny_face_detector_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_recognition_model.bin',
  'face_recognition_model-weights_manifest.json',
]

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            file.close()
            fs.unlinkSync(dest)
            downloadFile(redirectUrl, dest).then(resolve).catch(reject)
            return
          }
        }
        if (response.statusCode !== 200) {
          file.close()
          fs.unlinkSync(dest)
          reject(
            new Error(`HTTP ${response.statusCode} for ${url}`),
          )
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

async function main() {
  console.log('Downloading face-api models...')
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true })
  }

  for (const model of MODELS) {
    const dest = path.join(MODELS_DIR, model)
    if (fs.existsSync(dest)) {
      console.log(`  ${model} (exists)`)
      continue
    }
    const url = `${BASE_URL}/${model}`
    process.stdout.write(`  ${model}... `)
    await downloadFile(url, dest)
    console.log('done')
  }

  console.log(`\nModels downloaded to ${MODELS_DIR}`)
}

main().catch((err) => {
  console.error('Failed to download models:', err.message)
  process.exit(1)
})
