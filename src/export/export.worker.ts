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
const nodemailer = req('nodemailer');

interface ExportWorkerInput {
  exportId: string;
  userId: string;
  photos: { s3Key: string; filename: string }[];
  label: string;
  bucket: string;
  region: string;
  userEmail?: string;
}

async function run(input: ExportWorkerInput) {
  const { exportId, userId, photos, label, bucket, region, userEmail } = input;
  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    requestHandler: {
      requestTimeout: 300_000,
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

  sendProgress(0, photos.length, `Descargando fotos de S3…`);

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
    sendProgress(
      i + 1,
      photos.length,
      `Descargando foto ${i + 1} de ${photos.length}`,
    );
  }

  sendProgress(photos.length, photos.length, `Comprimiendo ZIP…`);
  await archive.finalize();
  await new Promise<void>((resolve, reject) => {
    output.on('finish', resolve);
    output.on('error', reject);
  });

  sendProgress(photos.length, photos.length, `Subiendo ZIP a la nube…`);
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
    sendProgress(photos.length, photos.length, `Enviando correo…`);
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || '587'),
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
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
  }

  parentPort?.postMessage({
    type: 'done',
    exportId,
    downloadUrl,
    message: `Exportación de ${label} completada.${smtpHost && userEmail ? ` Revisa tu correo en ${userEmail}` : ' Enlace generado.'}`,
  });
}

run(workerData as ExportWorkerInput).catch((err: Error) => {
  parentPort?.postMessage({
    type: 'error',
    exportId: (workerData as ExportWorkerInput).exportId,
    message: err.message,
  });
});
