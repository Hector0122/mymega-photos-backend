# AI_PLAN — Subida masiva de fotos

## Visión general

Un script que corre **localmente en tu laptop** (no en Railway, no en el celular):

1. **Subida masiva** — Volcar 100GB de fotos desde un disco duro externo directamente a R2

No requiere cambios en la APK ni en Railway. Todo el cómputo pesado corre en tu Mac.

---

## Fase 1: Subida masiva (disco duro → R2)

### Qué hace

Un script Node.js que lee todas las fotos de una carpeta en tu disco externo y las sube
a tu backend de Railway usando el mismo endpoint `POST /photos/upload-batch` que usa el
celular. Las fotos se procesan igual (thumbnail, blur detection, hash perceptual) y
quedan en R2 + Supabase.

### Cómo se ejecuta

```bash
cd PersonalProject
npm run subir-masivo -- /Volumes/DiscoExterno/fotos
```

### Flujo

```
Disco externo → script Node.js → Railway (NestJS) → R2 + Supabase
                                        ↓
                                  thumbnails, blur, hash
```

### Detalles

- Escanea recursivamente la carpeta buscando `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.mp4`
- Usa autenticación JWT (necesitas un token de tu cuenta)
- Sube en lotes para no saturar Railway
- Barra de progreso en terminal
- **Detección de duplicados**: antes de subir, compara perceptual hash de cada foto contra las que ya están en la DB — si existe exactamente igual, la salta
- Reporte final: cuántas subió, cuántas fallaron, cuántos duplicados saltados

---

## Costos

| Componente  | Hoy        | Con Fase 1 |
| ----------- | ---------- | ---------- |
| Railway     | $0-5/mes   | $0-5/mes   |
| Supabase    | $0         | $0         |
| R2 (100GB)  | ~$1.35/mes | ~$1.35/mes |
| **Total**   | **~$1-6/mes** | **~$1-6/mes** |

El script corre en tu laptop existente — **$0 extra**.

---

## Resumen de comandos

```bash
# Subir fotos del disco duro a la nube (salta duplicados automático)
npm run subir-masivo -- /ruta/al/disco
```

---

## Notas técnicas

### Conexión a Supabase

El script se conecta directamente a tu Supabase para leer metadatos de fotos
(userId, s3Keys, etc.) usando la misma `DATABASE_URL` que tu backend.



#### Delete all data base
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"hpave954@gmail.com","password":"12345678"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])") && curl -s -X DELETE http://localhost:3000/photos/all -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"confirm":"DELETE_ALL"}'
