# Imagen unica que corre el piloto de Mente Viva (backend FastAPI que ademas
# sirve el dist/ del frontend ya buildeado). Pensada para PROBAR EN LOCAL la
# integracion de Simli antes de tocar el server. Build context = raiz del repo.
#
#   docker compose -f docker/docker-compose.yml up --build
#
# Layout dentro de la imagen (importante: main.py calcula DIST_DIR como
# parent.parent.parent/menteviva-frontend/dist, asi que respetamos esa ruta):
#   /app/menteviva-backend/...      <- codigo + secrets
#   /app/menteviva-frontend/dist    <- bundle estatico servido por FastAPI

# ---------- Stage 1: build del frontend (Vite) ----------
FROM node:20-slim AS frontend
WORKDIR /build
COPY menteviva-frontend/package.json menteviva-frontend/package-lock.json ./
RUN npm ci
COPY menteviva-frontend/ ./
# El provider/transport se fijan al construir el bundle de Vite. Los defaults
# conservan el despliegue Simli actual; el overlay RunPod usa oss + ws.
ARG VITE_AVATAR_PROVIDER=simli
ARG VITE_AVATAR_TRANSPORT=webrtc
ARG VITE_SIMLI_AVATAR=1
ENV VITE_AVATAR_PROVIDER=${VITE_AVATAR_PROVIDER} \
    VITE_AVATAR_TRANSPORT=${VITE_AVATAR_TRANSPORT} \
    VITE_SIMLI_AVATAR=${VITE_SIMLI_AVATAR}
RUN npm run build

# ---------- Stage 2: backend (FastAPI + uvicorn) ----------
FROM python:3.11-slim AS backend

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    POETRY_VERSION=1.8.5 \
    POETRY_VIRTUALENVS_CREATE=false

# Deps del sistema: build-essential por si algun wheel necesita compilar.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install "poetry==${POETRY_VERSION}"

WORKDIR /app/menteviva-backend

# Instalar deps primero (capa cacheable). Instalamos TODOS los grupos: httpx
# (que usa routers/simli.py) vive en el grupo dev del pyproject, asi que un
# --without dev dejaria el backend sin httpx y reventaria al importar.
COPY menteviva-backend/pyproject.toml menteviva-backend/poetry.lock ./
RUN poetry install --no-interaction --no-root

# Codigo del backend (incluye secrets/firebase-admin.json para auth).
COPY menteviva-backend/ ./

# Bundle del frontend ya buildeado, en la ruta que espera main.py.
COPY --from=frontend /build/dist /app/menteviva-frontend/dist

EXPOSE 8000

# python -m app fija el SelectorEventLoop (no-op en Linux) y arranca uvicorn.
# Host/puerto/reload se controlan por env (ver docker-compose.yml).
CMD ["python", "-m", "app"]
