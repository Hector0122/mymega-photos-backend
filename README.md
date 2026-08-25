<p align="center"><img src=".github/logo/vaulta-icon.png" width="72" alt="Vaulta" /></p>

# Vaulta — Backend

API para Vaulta, una app de fotos privadas para Android. Capturas y descripción completa: **[vaulta_frontend](https://github.com/Hector0122/vaulta_frontend)**.

## Stack

| | |
|---|---|
| Framework | NestJS 11 |
| ORM / DB | Prisma + PostgreSQL (Neon) |
| Storage | Cloudflare R2 (S3-compatible) |
| Miniaturas / video | sharp · ffmpeg |
| Reconocimiento facial | face-api.js + TensorFlow |
| Notificaciones / email | Firebase · Mailgun |

Desplegado en Railway.

## Arquitectura

- **Auth** — JWT con rotación de refresh tokens
- **Photos** — el módulo más grande: subida, miniaturas, streaming con byte-range, papelera con soft delete
- **Albums** — álbumes normales + "Caja Fuerte" protegida
- **Faces** — detección y agrupación de rostros
- **Analysis** — detección de duplicados por hash perceptual
- **Export** — exportación de fotos/álbumes a ZIP por email

## Cómo está resuelto

- La **detección de rostros corre en un proceso hijo separado** (no dentro del proceso principal de Nest) porque la librería de reconocimiento facial y su runtime de ML no conviven bien con el resto del framework — mantiene el servidor principal responsivo mientras se procesan miles de fotos.
- La **subida de fotos corre en un worker thread**: sube a R2, genera miniaturas y calcula un hash perceptual sin bloquear el hilo principal.
- El **proveedor de almacenamiento es intercambiable** — el mismo código habla con Cloudflare R2 o con AWS S3 según la variable de entorno configurada, sin ramas de código separadas.
- Los rostros se agrupan por **distancia euclidiana sobre descriptores de 128 dimensiones**, no por comparación exacta de imagen.

## Licencia

MIT — ver [LICENSE](LICENSE)
