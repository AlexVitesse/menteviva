import logging
import sys
from pathlib import Path
from datetime import datetime
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db import init_db
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


@app.get("/health")
async def health():
    return {"status": "ok"}
