# Plan: Servir frontend dist/ desde uvicorn (StaticFiles + SPA fallback)

**Motivacion:** En el piloto vamos a tener **un solo proceso** uvicorn corriendo backend + frontend. No necesitamos un nginx separado ni dos tunnels Cloudflare. uvicorn sirve el `dist/` del frontend como archivos estaticos, y cualquier ruta que no sea `/api` ni `/health` cae al `index.html` de la SPA (para que React Router maneje rutas client-side como `/dashboard`, `/diagnostico`, etc.).

## Estado actual

`menteviva-backend/app/main.py` solo registra routers `/api/*` y un endpoint `/health`. No sirve nada del frontend. Hoy en dev, Vite sirve el frontend en :5173 y proxea `/api` al :8000 — ese setup es solo para HMR de desarrollo. En prod queremos un solo origen.

## Diseño

```
GET /api/...                  -> routers (auth, conversation, avatars, ...)
GET /health                   -> {"status":"ok"}
GET /assets/*  /vad/*  /avatars/*  /icon-*.png  /vite.svg
                              -> StaticFiles (servir del dist/)
GET cualquier otra ruta       -> dist/index.html  (SPA fallback)
WS  /api/conversation/...     -> WebSocket router (igual que ahora)
```

El catch-all SPA va **al final** del orden de rutas para que `/api/...` siga ganando.

## Pasos de implementacion

### Paso 1 — Verificar estructura del build de Vite

Tras `cd menteviva-frontend && npm run build`, el `dist/` tipico:

```
dist/
├── index.html
├── assets/
│   ├── index-xxxx.js
│   ├── index-xxxx.css
│   └── ... (chunks, sourcemaps, fonts)
├── vad/                  ← assets de @ricky0123/vad-react copiados via vadAssetsPlugin
│   ├── *.wasm  *.mjs  *.onnx
├── avatars/              ← public/avatars/* (PNGs + GLBs + anims)
│   ├── *.png  *.glb
│   └── anims/*.fbx
├── icon-*.png            ← opcional, si hay favicons
└── vite.svg
```

### Paso 2 — Modificar `app/main.py`

Agregar al final del archivo (despues de `include_router(...)` y antes / despues de los endpoints `/health` actuales):

```python
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

# Path del dist/ relativo al main.py (asumiendo layout monorepo).
# main.py vive en: menteviva-backend/app/main.py
# dist/ vive en:   menteviva-frontend/dist/
# Asi que subimos 2 niveles desde main.py y entramos al frontend.
DIST_DIR = Path(__file__).resolve().parent.parent.parent / "menteviva-frontend" / "dist"

if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
    logger.info(f"[StaticFiles] Servir SPA desde {DIST_DIR}")

    # 1. Mounts de subdirectorios con cache-busting de Vite (los nombres
    #    incluyen hash, asi que podemos cachear long-lived).
    app.mount(
        "/assets",
        StaticFiles(directory=DIST_DIR / "assets"),
        name="assets",
    )

    # 2. Otros subdirs estaticos sin hash (servir tal cual).
    for sub in ("vad", "avatars"):
        sub_dir = DIST_DIR / sub
        if sub_dir.exists():
            app.mount(f"/{sub}", StaticFiles(directory=sub_dir), name=sub)

    # 3. SPA fallback (catch-all). REGISTRARSE AL FINAL.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # /api/* nunca debe caer aqui porque los routers ya estan registrados
        # antes. Pero por defensa-en-profundidad, devolver 404 explicito.
        if full_path.startswith("api/") or full_path == "health":
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        index = DIST_DIR / "index.html"
        return FileResponse(index, media_type="text/html")
else:
    logger.warning(
        f"[StaticFiles] dist/ no existe en {DIST_DIR} — modo API-only "
        f"(probablemente estamos en dev y Vite sirve el frontend en :5173)."
    )
```

### Paso 3 — Verificar orden de routers

En `app/main.py` el orden tiene que ser:

```python
# 1. Middleware (CORS, logging)
# 2. Routers /api/* (avatars, conversation, profiles, sessions, auth)
app.include_router(...)

# 3. /health
@app.get("/health") ...

# 4. WebSocket (si esta registrado por separado — aqui no, va dentro del
#    router conversation.router)

# 5. StaticFiles + SPA fallback  <-- AL FINAL
```

El catch-all `/{full_path:path}` tiene que registrarse **al final** para que FastAPI lo evalue ultimo. FastAPI usa orden de declaracion para resolver rutas.

### Paso 4 — Frontend `.env.production`

Cuando el backend sirve el dist, el frontend hace fetch a la misma URL del host (es same-origin). Por eso:

```
# menteviva-frontend/.env.production
VITE_API_URL=        # vacio = URLs relativas. fetch("/api/...") apunta al mismo host
VITE_WS_URL=         # vacio = same-origin WS. new WebSocket("/api/...") usa wss://<host>/api/...

# Firebase Web SDK (el frontend lo carga via Web SDK, no a traves del backend)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Verificar `src/lib/api.ts` y `src/hooks/useWebSocket.ts`: ambos usan `VITE_API_URL` y `VITE_WS_URL` respectivamente. Si vienen vacios, deben caer a paths relativos. Buscar:

```ts
const API_URL = import.meta.env.VITE_API_URL || ""; // OK
const WS_URL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
```

Si `WS_URL` no construye automaticamente el `wss://<host>`, hay que ajustarlo. Validar en codigo antes del deploy.

### Paso 5 — Build y test local

```bash
cd menteviva-frontend
npm run build
# Verificar dist/ contiene index.html + assets/ + vad/ + avatars/

cd ../menteviva-backend
# Arrancar uvicorn con dist disponible
poetry run uvicorn app.main:app --port 8000

# En otra terminal
curl http://127.0.0.1:8000/health           # {"status":"ok"}
curl -I http://127.0.0.1:8000/              # 200, content-type: text/html
curl -I http://127.0.0.1:8000/dashboard     # 200, content-type: text/html (SPA fallback)
curl -I http://127.0.0.1:8000/assets/index-xxxx.js  # 200, content-type: application/javascript
curl http://127.0.0.1:8000/api/avatars      # JSON con avatars
```

Abrir http://127.0.0.1:8000 en el browser:
- ✅ Carga el landing
- ✅ Login funciona (firebase + sync con backend)
- ✅ `/dashboard` carga via SPA fallback
- ✅ `/diagnostico` carga
- ✅ Audio + WS funcionan (TTS, transcription)

### Paso 6 — Build-on-deploy en el server

Modificar `deploy.sh` (root del repo) para que el build del frontend forme parte del flujo:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd /opt/menteviva
git pull origin main

# Backend deps
cd menteviva-backend
poetry install --no-dev

# Frontend build
cd ../menteviva-frontend
npm ci
npm run build

# Restart
sudo systemctl restart menteviva-backend
echo "Deploy completo: $(date)"
```

### Paso 7 — Headers cache

`StaticFiles` de FastAPI por default no setea `Cache-Control`. Para assets con hash en el nombre (Vite los emite asi: `index-AbC123.js`), podemos cachear agresivamente. Para el `index.html` SPA fallback, NO cachear (siempre fresh).

Implementacion opcional (anadir middleware o subclase):

```python
from fastapi import Response

# Decorador para anadir cache headers a /assets/*
class CachedStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            # Vite emite filenames con hash, son inmutables
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

app.mount("/assets", CachedStaticFiles(directory=DIST_DIR / "assets"), name="assets")
```

Para el SPA fallback:

```python
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    ...
    return FileResponse(
        DIST_DIR / "index.html",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
```

Beneficio: revisitas al sitio cargan instant (assets cached) + HTML siempre fresh (para que React app vea el nuevo bundle tras un deploy).

## Checklist final

- [ ] `app/main.py` actualizado con el bloque StaticFiles + SPA fallback.
- [ ] `menteviva-frontend/.env.production` con `VITE_API_URL=` y `VITE_WS_URL=` vacios.
- [ ] `src/hooks/useWebSocket.ts` o equivalente construye URL relativa para WS cuando `VITE_WS_URL` esta vacio.
- [ ] Smoke local: `npm run build && uvicorn` + abrir http://127.0.0.1:8000 -> todo funciona end-to-end sin Vite.
- [ ] `deploy.sh` incluye `npm run build`.
- [ ] (Opcional) Cache-Control headers para `/assets/*`.

## Esfuerzo estimado

- Codigo + test local: **30 min**
- Validacion smoke end-to-end (login, diagnostico, audio): **20 min**
- `deploy.sh`: **10 min**

**Total: ~1 hr.**
