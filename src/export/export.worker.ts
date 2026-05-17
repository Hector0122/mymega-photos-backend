import { parentPort, workerData } from 'worker_threads';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';
const req = createRequire(__filename);

interface ExportWorkerInput {
  exportId: string;
  userId: string;
  photos: { s3Key: string; filename: string }[];
  label: string;
  bucket: string;
  region: string;
  r2AccountId?: string;
  userEmail?: string;
}

async function run(input: ExportWorkerInput) {
  const { exportId, userId, photos, label, bucket, region, r2AccountId, userEmail } = input;
  const r2Endpoint = r2AccountId
    ? `https://${r2AccountId}.r2.cloudflarestorage.com`
    : undefined;
  const s3 = new S3Client({
    region: r2Endpoint ? 'auto' : region,
    endpoint: r2Endpoint,
    forcePathStyle: !!r2Endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY!,
    },
    requestHandler: {
      requestTimeout: 600_000,
    },
  });

  const sendProgress = (completed: number, total: number, message: string) => {
    parentPort?.postMessage({
      type: 'progress',
      exportId,
      completed,
      total,
      message,
    });
  };

  const zipKey = `exports/${userId}/${Date.now()}.zip`;
  const tmpPath = path.join(
    os.tmpdir(),
    `mymega-export-${userId}-${Date.now()}.zip`,
  );

  const { ZipArchive } = req('archiver');
  const output = fs.createWriteStream(tmpPath);
  const archive = new ZipArchive({ zlib: { level: 5 } });
  archive.pipe(output);

  sendProgress(0, photos.length, `Descargando fotos…`);

  for (let i = 0; i < photos.length; i++) {
    try {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: photos[i].s3Key }),
      );
      if (response.Body) {
        archive.append(response.Body as any, { name: photos[i].filename });
      }
    } catch {
      /* ignore */
    }
    sendProgress(i + 1, photos.length, `Foto ${i + 1} de ${photos.length}`);
  }

  sendProgress(photos.length, photos.length, `Comprimiendo ZIP…`);
  await archive.finalize();
  await new Promise<void>((resolve, reject) => {
    output.on('finish', resolve);
    output.on('error', reject);
  });

  sendProgress(photos.length, photos.length, `Subiendo ZIP…`);
  const zipBuffer = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: zipKey,
      Body: zipBuffer,
      ContentType: 'application/zip',
    }),
  );

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: zipKey }),
    { expiresIn: 86400 },
  );

  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost && userEmail) {
    try {
      sendProgress(photos.length, photos.length, `Enviando correo…`);
      const nodemailer = req('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587'),
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 60000,
      });
      const safeUrl = downloadUrl.replace(/&/g, '&amp;');
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@mymega.com',
        to: userEmail,
        subject: `Exportación de ${label} - MyMega Photos`,
        html: `
          <h2>Exportación completada</h2>
          <p>Tu exportación de ${label} con ${photos.length} foto(s) está lista.</p>
          <p>Haz clic aquí para descargar (válido por 24 horas):</p>
          <p><a href="${safeUrl}" style="display:inline-block;padding:14px 32px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:8px;font-size:16px">Descargar ZIP</a></p>
          <p>O copia este enlace en tu navegador:</p>
          <p style="word-break:break-all;font-size:12px;color:#666">${safeUrl}</p>
          <p>Saludos,<br>El equipo de MyMega Photos</p>
        `,
      });
    } catch (e) {
      parentPort?.postMessage({
        type: 'smtp_error',
        exportId,
        message: (e as Error).message,
      });
      sendProgress(photos.length, photos.length, `Correo omitido: ${(e as Error).message}`);
    }
  }

  parentPort?.postMessage({
    type: 'done',
    exportId,
    downloadUrl,
    message: `Exportación de ${label} completada.${smtpHost && userEmail ? ' Revisa tu correo.' : ''}`,
  });
}

run(workerData as ExportWorkerInput).catch((err: Error) => {
  parentPort?.postMessage({
    type: 'error',
    exportId: (workerData as ExportWorkerInput).exportId,
    message: err.message,
  });
});
