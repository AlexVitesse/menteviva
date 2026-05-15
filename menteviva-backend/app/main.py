import logging
import sys
from pathlib import Path
from datetime import datetime
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from app.config import settings
from app.db import init_db, close_pool
from app.routers import auth, conversation, avatars, profiles, sessions

# ============ CONFIGURAR LOGGING ============

# Crear carpeta de logs si no existe
LOG_DIR = Path(__file__).parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

# Formato del log
LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# Configurar logger principal
logger = logging.getLogger("menteviva")
logger.setLevel(logging.DEBUG if settings.debug else logging.INFO)

# Handler para archivo (con rotación - max 5MB, 5 archivos)
file_handler = RotatingFileHandler(
    LOG_DIR / "menteviva.log",
    maxBytes=5 * 1024 * 1024,  # 5 MB
    backupCount=5,
    encoding="utf-8"
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))

# Handler para consola (coloreado)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))

# Agregar handlers
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# También capturar logs de uvicorn
logging.getLogger("uvicorn.access").handlers = [file_handler, console_handler]

# ============ CREAR APP ============

app = FastAPI(title=settings.app_name)

logger.info("=" * 60)
logger.info(f"Iniciando {settings.app_name}")
logger.info(f"Debug mode: {settings.debug}")
logger.info(f"Log file: {LOG_DIR / 'menteviva.log'}")
logger.info("=" * 60)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(avatars.router, prefix="/api", tags=["avatars"])
app.include_router(conversation.router, prefix="/api", tags=["conversation"])
app.include_router(profiles.router, prefix="/api", tags=["profiles"])
app.include_router(sessions.router, prefix="/api", tags=["sessions"])
app.include_router(auth.router, prefix="/api", tags=["auth"])


@app.on_event("startup")
async def startup_db():
    await init_db()


@app.on_event("shutdown")
async def shutdown_db():
    await close_pool()


@app.get("/health")
async def health():
    return {"status": "ok"}


# ============ SERVIR FRONTEND dist/ (SPA con fallback) ============
#
# En prod (un solo proceso) uvicorn sirve el `dist/` del frontend. Cualquier
# ruta que no sea /api/* ni /health cae al index.html para que React Router
# maneje rutas client-side (/dashboard, /diagnostico, etc.).
#
# Importante: este bloque va AL FINAL del archivo. FastAPI evalua rutas en
# orden de declaracion — los routers /api/* y /health ya estan registrados
# antes, asi que el catch-all no los pisa.
#
# main.py vive en:  menteviva-backend/app/main.py
# dist/ vive en:    menteviva-frontend/dist/
DIST_DIR = Path(__file__).resolve().parent.parent.parent / "menteviva-frontend" / "dist"


class CachedStaticFiles(StaticFiles):
    """StaticFiles con Cache-Control inmutable. Vite emite filenames con hash
    en /assets/* asi que son safe para cachear long-lived. El index.html (SPA
    fallback) NO debe usar esta clase — siempre se quiere fresh."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
    logger.info(f"[StaticFiles] Sirviendo SPA desde {DIST_DIR}")

    # Assets con hash en el nombre (Vite emite index-AbC123.js, etc.) -> cache largo.
    app.mount(
        "/assets",
        CachedStaticFiles(directory=DIST_DIR / "assets"),
        name="assets",
    )

    # Subdirs sin hash (los nombres son estables). Cache moderado por default
    # del StaticFiles (sin header explicito, el browser hace conditional GET).
    for sub in ("vad", "avatars"):
        sub_dir = DIST_DIR / sub
        if sub_dir.exists():
            app.mount(f"/{sub}", StaticFiles(directory=sub_dir), name=sub)

    # SPA fallback (catch-all). FastAPI evalua en orden, asi que esta ruta
    # solo gana cuando ningun router /api/* hizo match antes.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # Defensa-en-profundidad: si alguien pega un /api/* que no esta
        # registrado, devolvemos 404 explicito en lugar del index.html (que
        # confundiria al cliente).
        if full_path.startswith("api/") or full_path == "health":
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # Archivos sueltos del dist root (favicon, vite.svg, manifest, etc.)
        candidate = DIST_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        # Cualquier otra ruta -> index.html, sin cache para que el browser
        # siempre vea el bundle nuevo tras un deploy.
        return FileResponse(
            DIST_DIR / "index.html",
            media_type="text/html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
else:
    logger.warning(
        f"[StaticFiles] dist/ no existe en {DIST_DIR} — modo API-only "
        f"(probablemente estamos en dev con Vite sirviendo el frontend en :5173)."
    )
