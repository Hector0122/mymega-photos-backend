# AI_PLAN — Organización inteligente de fotos + Subida masiva

## Visión general

Dos scripts que corren **localmente en tu laptop** (no en Railway, no en el celular):

1. **Subida masiva** — Volcar 100GB de fotos desde un disco duro externo directamente a R2
2. **Organización con AI** — Agrupar fotos por contexto y crear álbumes automáticos

Ninguno requiere cambios en la APK ni en Railway. Todo el cómputo pesado corre en tu Mac.

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

## Fase 2: Organización con AI (laptop)

### Qué hace

Un script que descarga las miniaturas de tus fotos desde R2, las agrupa por
similitud visual usando CLIP + clustering, y usa Ollama para ponerles nombre.
Crea álbumes en tu cuenta llamando a la API del backend.

### Cómo se ejecuta

```bash
cd PersonalProject
npm run organizar
```

### Arquitectura

```
Tu Mac:
┌─────────────────────────────────────────────────┐
│  npm run organizar                                │
│                                                   │
│  1. Descarga miniaturas de R2 (solo thumbs,      │
│     no originales)                                │
│                                                   │
│  2. CLIP (sentence-transformers) genera vector    │
│     numérico por foto (~50ms c/u)                 │
│                                                   │
│  3. Detecta duplicados exactos (mismo perceptual  │
│     hash) → los borra automático, conserva 1      │
│                                                   │
│  4. K-Means / DBSCAN agrupa vectores similares    │
│                                                   │
│  5. Dentro de cada grupo, detecta casi-duplicados │
│     (fotos casi iguales) → pregunta:              │
│     "¿Elimino 14 y dejo la mejor?"                │
│                                                   │
│  6. Para cada grupo final, Ollama recibe 1-2      │
│     fotos representativas + prompt → genera       │
│     nombre: "Visita a Cancún 2024", "Cena..."     │
│                                                   │
│  7. Crea álbumes en tu cuenta via API del backend │
│                                                   │
│  8. Te muestra resumen completo en terminal       │
└─────────────────────────────────────────────────┘
       ↓
  Railway (NestJS) → borra duplicados + crea álbumes en Supabase
```

### Limpieza de duplicados

El script ataca duplicados en **2 niveles**:

| Nivel                  | Criterio                                                                | Acción                                                                                 |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Duplicados exactos** | Mismo `perceptualHash` (64-bit)                                         | Se eliminan automáticamente, se conserva 1 copia (la de mejor resolución)              |
| **Casi duplicados**    | CLIP las agrupa juntas + distancia euclidiana muy baja entre embeddings | El script te pregunta: _"Estas N fotos son casi iguales, ¿borro N-1 y dejo la mejor?"_ |

El backend ya soporta esto:

- `perceptualHash` se calcula automáticamente al subir cada foto (`upload.worker.ts`)
- `GET /photos/duplicates` agrupa por hash
- `DELETE /photos/trash/:id` y `POST /photos/:id/restore` ya existen

### ¿Qué necesitas instalar?

```bash
# Una sola vez
brew install ollama                          # Ollama
pip install sentence-transformers scikit-learn  # Python libs
ollama pull gemma3:2b                        # Modelo chico para nombres
```

### ¿Cuánto tarda?

Para 100GB de fotos (~25,000-40,000 fotos):

| Paso                             | Tiempo estimado    |
| -------------------------------- | ------------------ |
| Descargar miniaturas de R2       | 2-5 minutos        |
| Generar embeddings (CLIP)        | 20-40 minutos      |
| Clustering                       | 10-30 segundos     |
| Ollama nombrando (~10-20 grupos) | 1-2 minutos        |
| **Total**                        | **~25-50 minutos** |

### Privacidad

- CLIP y Ollama corren 100% locales en tu Mac
- Las fotos NO salen de tu máquina
- Solo los embeddings numéricos viajan al backend (no son imágenes, no se pueden revertir)
- Los álbumes creados son tuyos en Supabase

---

## Fase 3: Integración con la app (futuro opcional)

### Botón "Organizar" en la app

Cuando la laptop esté en la misma red WiFi que el celular, podría aparecer
un botón "Organizar fotos" en la pantalla de Profile. Esto requeriría:

- Un pequeño servidor en la laptop que escuche peticiones
- La app detecta la laptop en la red local
- No es necesario para la Fase 1 y 2

### Opción VPS (24/7)

Si en el futuro quieres tener la organización disponible siempre sin depender
de la laptop:

- Hetzner CX22 ($4.35/mes): 2 vCPU, 4GB RAM, 40GB NVMe
- Corre el sidecar Python + Ollama permanentemente
- Railway lo llama cuando el usuario pulsa "Organizar"

---

## Costos

| Componente  | Hoy           | Con Fase 1+2  | Con VPS (Fase 3) |
| ----------- | ------------- | ------------- | ---------------- |
| Railway     | $0-5/mes      | $0-5/mes      | $0-5/mes         |
| Supabase    | $0            | $0            | $0               |
| R2 (100GB)  | ~$1.35/mes    | ~$1.35/mes    | ~$1.35/mes       |
| VPS Hetzner | —             | —             | $4.35/mes        |
| **Total**   | **~$1-6/mes** | **~$1-6/mes** | **~$5-10/mes**   |

Los scripts Fase 1 y 2 corren en tu laptop existente — **$0 extra**.

---

## Resumen de comandos

```bash
# Subir fotos del disco duro a la nube (salta duplicados automático)
npm run subir-masivo -- /ruta/al/disco

# Organizar fotos con AI + limpiar duplicados + crear álbumes
npm run organizar

# Solo previsualizar (no borra nada, no crea nada)
npm run organizar -- --preview

# Solo limpiar duplicados (sin organizar álbumes)
npm run organizar -- --clean-only
```

---

## Notas técnicas

### ¿Por qué CLIP + clustering y no un LLM de visión?

- CLIP genera un vector por foto en 50-100ms en M1
- Un LLM de visión (LLaVA, Gemma3 Vision) tarda 2-5s por foto describiéndola
- Para 30,000 fotos: CLIP = ~30 min vs LLM visión = ~24 horas
- CLIP es más preciso agrupando por similitud visual (playas, ciudades, comida)
- Ollama solo se usa al final para nombrar los grupos (~10 llamadas)

### Conexión a Supabase

El script se conecta directamente a tu Supabase para leer metadatos de fotos
(userId, s3Keys, etc.) usando la misma `DATABASE_URL` que tu backend.



#### Delete all data base
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"hpave954@gmail.com","password":"12345678"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])") && curl -s -X DELETE http://localhost:3000/photos/all -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"confirm":"DELETE_ALL"}'
