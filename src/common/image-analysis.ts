import sharp from 'sharp';

export interface BlurResult {
  blurred: boolean;
  score: number;
}

export async function computeBlurScore(buffer: Buffer): Promise<BlurResult> {
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
      let dx = 0,
        dy = 0;
      if (x > 0) dx = Math.abs(data[idx] - data[idx - 1]);
      if (y > 0) dy = Math.abs(data[idx] - data[idx - info.width]);
      sum += dx + dy;
      count++;
    }
  }
  const score = sum / count;
  return { blurred: score < 10, score: Math.round(score * 100) / 100 };
}

export async function computePerceptualHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(8, 8, { fit: 'cover' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const hash = Array.from(data)
    .map((v) => (v > avg ? '1' : '0'))
    .join('');
  return BigInt('0b' + hash)
    .toString(16)
    .padStart(16, '0');
}
