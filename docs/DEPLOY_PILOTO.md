# Deploy Piloto — Servidor empresa + Cloudflare Tunnel + Neon

**Stack:** Ubuntu/Debian · uvicorn sirve API + frontend `dist/` · Cloudflare Tunnel (cloudflared) hacia subdominio del dominio empresa · **Postgres managed en Neon** (prod) / Docker (dev local).

## 1. Arquitectura

```
Internet (HTTPS, anycast edge global)
       │
       ▼
Cloudflare edge  ──►  cloudflared (outbound)  ──►  http://127.0.0.1:8000  ──►  uvicorn (FastAPI)
                                                                              ├─ /api/*  (routers existentes)
                                                                              ├─ /health
                                                                              └─ /       (StaticFiles → frontend/dist + SPA fallback)
                                                                                          │
                                                                                          ▼ (TLS)
                                                                              Neon Postgres serverless (us-east-2)
                                                                              ep-xxx.us-east-2.aws.neon.tech:5432
```

- **Un solo puerto local** (`:8000`) y **un solo tunnel** Cloudflare → la URL pública sirve todo.
- HTTPS termina en el edge de Cloudflare; el origin local sigue siendo HTTP.
- WebSocket `/api/conversation/{avatar_id}` pasa transparente (cloudflared soporta WS por default).
- **Sin límite de conexiones simultáneas** ni bandwidth (vs ngrok que cobra por concurrencia).
- Requisito: un dominio (propio o subdominio de uno) en Cloudflare DNS.

## 2. Prerequisitos en el servidor

```bash
sudo apt update && sudo apt install -y \
  python3.11 python3.11-venv python3-pip \
  nodejs npm \
  postgresql-client \
  git curl ca-certificates
# Poetry
curl -sSL https://install.python-poetry.org | python3 -
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
# cloudflared (Cloudflare Tunnel agent)
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

> **NO instalamos Postgres server en el server-empresa.** La DB de prod corre managed en **Neon** (serverless Postgres con scale-to-zero, free tier 500MB, branching). El server solo necesita `postgresql-client` (`psql`, `pg_dump`) para tareas operativas: smoke checks, restores manuales, debugging directo a la DB cloud.

Verificar versiones:
- Python ≥ 3.11
- Node ≥ 20
- Poetry ≥ 1.7
- cloudflared ≥ 2024.x
- psql ≥ 15 (cliente)

## 3. Primer despliegue

### 3.1 Clonar y configurar

```bash
sudo mkdir -p /opt/menteviva && sudo chown $USER:$USER /opt/menteviva
cd /opt/menteviva
git clone <repo-url> .
```

### 3.2 Backend

```bash
cd /opt/menteviva/menteviva-backend
poetry install --no-dev
cp .env.example .env
# Editar .env con:
#   GROQ_API_KEY=...
#   OPENAI_API_KEY=...                              # para TTS (ver pendiente #4)
#   ELEVENLABS_API_KEY=...                          # fallback si TTS_PROVIDER=elevenlabs
#   DEBUG=false
#   FIREBASE_SERVICE_ACCOUNT_PATH=secrets/firebase-admin.json
#   CORS_ORIGINS=["https://piloto.menteviva.com"]   # tu subdominio CF
#   # Connection string de Neon (dashboard → Connection details → Pooled connection)
#   DATABASE_URL=postgresql+psycopg://<user>:<password>@ep-xxx-pooler.us-east-2.aws.neon.tech/menteviva?sslmode=require
nano .env
# Copiar secrets/firebase-admin.json al servidor (NUNCA al repo):
mkdir -p secrets
scp local:firebase-admin.json /opt/menteviva/menteviva-backend/secrets/
chmod 600 secrets/firebase-admin.json .env
```

### 3.3 Frontend (build estático)

```bash
cd /opt/menteviva/menteviva-frontend
npm ci
# En producción el frontend NO usa proxy de Vite — apunta a la misma URL del backend.
# Como el backend va a servir el dist/, las llamadas /api van al mismo origen.
# Por eso VITE_API_URL queda vacío (relativo) y VITE_WS_URL relativo también.
cat > .env.production << 'EOF'
VITE_API_URL=
VITE_WS_URL=
# Firebase Web SDK config (mismo del .env actual)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
EOF
npm run build
# Genera /opt/menteviva/menteviva-frontend/dist/
```

### 3.4 Cambio en backend para servir el dist/

Agregar al final de `menteviva-backend/app/main.py` (después de `include_router`):

```python
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

DIST_DIR = Path(__file__).parent.parent.parent / "menteviva-frontend" / "dist"

if DIST_DIR.exists():
    # Servir assets (JS/CSS/fonts/imgs) bajo /assets, /vad/, /avatars/, etc.
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")
    for sub in ("vad", "avatars"):
        sub_dir = DIST_DIR / sub
        if sub_dir.exists():
            app.mount(f"/{sub}", StaticFiles(directory=sub_dir), name=sub)

    # SPA fallback: cualquier ruta no matcheada por /api o /health devuelve index.html.
    # IMPORTANTE: registrar DESPUES de todos los routers para que /api/* gane.
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Excluir explícitamente /api y /health (defensa en profundidad)
        if full_path.startswith("api/") or full_path == "health":
            return {"detail": "Not Found"}, 404
        return FileResponse(DIST_DIR / "index.html")
```

> Esta sección NO está implementada todavía en `main.py`. Aplicarla como parte del primer despliegue.

## 4. Cloudflare Tunnel — subdominio empresa

### 4.1 Prerrequisito DNS

El dominio que vamos a usar (`menteviva.com` o un subdominio empresa) debe tener sus **nameservers apuntando a Cloudflare**. En el dashboard Cloudflare → "Add a site" → seguir el wizard. Es gratis y no requiere cambiar registrar.

### 4.2 Login + crear tunnel

```bash
# Autenticar el CLI con tu cuenta CF (abre browser)
cloudflared tunnel login
# Crea ~/.cloudflared/cert.pem

# Crear el tunnel (se guarda con un UUID + credentials)
cloudflared tunnel create menteviva-piloto
# Output: Tunnel ID = abcd1234-...
# Genera ~/.cloudflared/<uuid>.json (credentials)

# Asociar el subdominio al tunnel (crea CNAME automáticamente)
cloudflared tunnel route dns menteviva-piloto piloto.menteviva.com
```

### 4.3 Config

`/etc/cloudflared/config.yml`:

```yaml
tunnel: menteviva-piloto
credentials-file: /etc/cloudflared/menteviva-piloto.json

ingress:
  # HTTP + WebSocket al backend local
  - hostname: piloto.menteviva.com
    service: http://127.0.0.1:8000
    originRequest:
      # Necesario para que upgrades a WS pasen sin timeout
      noTLSVerify: false
      connectTimeout: 30s
      # Sin caps de bandwidth aquí — CF edge ya maneja el escalado.
  # Catch-all (404 para hostnames que no apunten al tunnel)
  - service: http_status:404
```

Copiar credentials al destino seguro:

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/*.json /etc/cloudflared/menteviva-piloto.json
sudo chown root:menteviva /etc/cloudflared/menteviva-piloto.json
sudo chmod 640 /etc/cloudflared/menteviva-piloto.json
```

### 4.4 Smoke tunnel

```bash
sudo cloudflared tunnel --config /etc/cloudflared/config.yml run
# En otra terminal:
curl https://piloto.menteviva.com/health   # → 200 {"status":"ok"}
```

## 5. Firebase Auth — autorizar dominio

En Firebase Console → Authentication → Settings → Authorized domains, agregar:
- `piloto.menteviva.com` (el subdominio Cloudflare)

Sin esto, `signInWithEmailAndPassword` falla con `auth/unauthorized-domain` desde el sitio público.

## 6. systemd — backend + tunnel como servicios

### 6.1 `/etc/systemd/system/menteviva-backend.service`

```ini
[Unit]
Description=Mente Viva backend (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=menteviva
WorkingDirectory=/opt/menteviva/menteviva-backend
EnvironmentFile=/opt/menteviva/menteviva-backend/.env
# --workers 4 para sacar provecho del multi-core (4 procesos paralelos
# manejando WS + STT + LLM + TTS). Postgres (Neon) NO tiene lock issues
# con multi-worker (cosa que sí pasaría con SQLite).
ExecStart=/home/menteviva/.local/bin/poetry run uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/menteviva/backend.log
StandardError=append:/var/log/menteviva/backend.err.log

[Install]
WantedBy=multi-user.target
```

### 6.2 `/etc/systemd/system/menteviva-tunnel.service`

```ini
[Unit]
Description=Mente Viva Cloudflare Tunnel
After=menteviva-backend.service network-online.target
Wants=menteviva-backend.service network-online.target

[Service]
Type=simple
User=cloudflared
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel --config /etc/cloudflared/config.yml run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

> El package `cloudflared` crea el user `cloudflared` durante el install. Si no, `sudo useradd -r -s /usr/sbin/nologin cloudflared`.

### 6.3 Enable y start

```bash
sudo useradd -r -s /usr/sbin/nologin menteviva
sudo chown -R menteviva:menteviva /opt/menteviva
sudo mkdir -p /var/log/menteviva && sudo chown menteviva:menteviva /var/log/menteviva
sudo systemctl daemon-reload
sudo systemctl enable --now menteviva-backend menteviva-tunnel
sudo systemctl status menteviva-backend menteviva-tunnel
```

## 7. Postgres — Neon (prod) + Docker (dev local)

### 7.1 Dev local: Postgres en Docker

Cada dev corre un Postgres dedicado en su máquina vía Docker. Crear `docker-compose.dev.yml` en la **raíz del repo** (commit al repo):

```yaml
# docker-compose.dev.yml — Postgres local para desarrollo.
# Levantar con:  docker compose -f docker-compose.dev.yml up -d
# Detener con:   docker compose -f docker-compose.dev.yml down
services:
  postgres:
    image: postgres:16-alpine
    container_name: menteviva-pg-dev
    environment:
      POSTGRES_USER: menteviva
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: menteviva
    ports:
      - "5433:5432"     # 5433 host -> 5432 container (5433 evita choques con otros Postgres locales)
    volumes:
      - pgdata-dev:/var/lib/postgresql/data
    restart: unless-stopped
volumes:
  pgdata-dev:
```

En `menteviva-backend/.env` para dev local:

```
DATABASE_URL=postgresql+psycopg://menteviva:dev@127.0.0.1:5433/menteviva
```

Run:

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps    # verificar healthy
poetry run python -m app.db.migrate up         # aplicar schema
```

### 7.2 Prod: crear proyecto Neon

1. **Neon Console** ([console.neon.tech](https://console.neon.tech)) → **Create project**.
   - Name: `menteviva-piloto`
   - Postgres version: 16
   - Region: us-east-2 (o la más cercana a tu server-empresa)
   - Compute size: 0.25 CU (free tier, suficiente para piloto)
2. **Database**: en Settings, renombrar la default `neondb` → `menteviva` (o crear nueva).
3. **Roles**: el role default es el owner; opcionalmente crear un `menteviva_app` con permisos mínimos solo a `menteviva` DB.
4. **Connection string**: dashboard → **Connection Details** → copiar la **Pooled connection** (PgBouncer) — esa es la URL que va al `.env` del server.

> **Pooled connection vs direct**: usar siempre la pooled (`-pooler` en el hostname). Soporta más conexiones simultáneas que la directa (que se cierra cuando el compute hiberna).

Ejemplo de URL:

```
postgresql+psycopg://menteviva:<password>@ep-cool-thunder-12345-pooler.us-east-2.aws.neon.tech/menteviva?sslmode=require
```

### 7.3 Driver Python

```bash
cd /opt/menteviva/menteviva-backend
poetry add psycopg[binary]
```

> El driver `psycopg[binary]` viene compilado, no requiere `libpq-dev` en el sistema. Ideal para deploy en server sin compilar.

### 7.4 Migraciones iniciales

Sobre la DB de prod (Neon), desde el server o local con la URL apuntando a Neon:

```bash
poetry run python -m app.db.migrate up
# Verificar
psql "$DATABASE_URL" -c '\d'
```

Los archivos SQL (`001_initial.sql`, etc.) son los mismos que en SQLite porque ya están diseñados portable (sin `AUTOINCREMENT`, sin `INTEGER PRIMARY KEY` rowid magic).

### 7.5 DB branching para staging / PRs (ventaja Neon)

Cada PR puede tener su propia DB clone instantánea, sin copiar datos:

```bash
# Crear branch desde main (heredando schema + datos en COW)
neonctl branches create --project-id <id> --name pr-42

# Output: una connection string nueva apuntando al branch
# Usarla en .env.test del CI o en un preview deploy
# Borrar al cerrar el PR
neonctl branches delete pr-42
```

Útil para probar migraciones destructivas o features con datos reales sin tocar prod.

### 7.6 Backups

Neon hace **point-in-time recovery** automático (PITR) hasta 7 días en free tier, 30 días en paid. No necesitas configurar nada — restauras desde el dashboard.

Para backup offline manual (semanal a tu bucket S3/local, por paranoia):

```bash
# Cron en el server, dominate lunes 3 AM
0 3 * * 1 pg_dump "$DATABASE_URL" -F c -f /var/backups/menteviva/neon-weekly-$(date +\%F).dump && find /var/backups/menteviva -name 'neon-weekly-*.dump' -mtime +90 -delete
```

Restore manual:

```bash
pg_restore -d "$DATABASE_URL_TARGET" --clean --if-exists /var/backups/menteviva/neon-weekly-2026-05-15.dump
```

## 8. Procedimiento de update (push → deploy)

```bash
cd /opt/menteviva
git pull
# Backend
cd menteviva-backend && poetry install --no-dev && cd ..
# Frontend rebuild
cd menteviva-frontend && npm ci && npm run build && cd ..
# Reload
sudo systemctl restart menteviva-backend
# ngrok no necesita restart salvo cambios en config
```

Idealmente automatizar con un script `deploy.sh` o un git hook post-receive.

## 9. Checklist de smoke post-deploy

- [ ] `curl https://piloto.menteviva.com/health` → 200 `{"status":"ok"}`
- [ ] `psql "$DATABASE_URL" -c '\d'` → muestra tablas creadas por el migrator
- [ ] Abrir el sitio → ver landing
- [ ] Click "Crear cuenta" → registro completa → /diagnostico/setup
- [ ] Iniciar diagnóstico → Sofia saluda con audio (TTS)
- [ ] Hablar → transcripción funciona (no 401 de Groq)
- [ ] Terminar entrevista → reporte
- [ ] Logout → /login
- [ ] `psql -c "SELECT count(*) FROM practice_sessions;"` muestra row tras la sesión

## 9.5 Logs — rotación y retención

Sin rotación, `backend.log` crece sin tope y satura disco en pocas semanas. logrotate corre por cron diariamente.

`/etc/logrotate.d/menteviva`:

```
/var/log/menteviva/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 640 menteviva menteviva
    sharedscripts
    copytruncate
    # copytruncate = trunca el archivo en uso en vez de renombrar +
    # SIGHUP a uvicorn. Más simple y uvicorn nunca para. Pierdes <1ms de
    # lines en la rotación, aceptable.
}
```

Cloudflared tiene su propia rotación interna (`/var/log/cloudflared.log` o similar según la versión). Postgres rota por default vía `log_rotation_age = 1d` en `postgresql.conf` — verificar que esté activo.

Logs del backend ya rotan en código: `menteviva-backend/app/main.py` usa `RotatingFileHandler(maxBytes=5MB, backupCount=5)`. logrotate del SO es una capa extra de seguridad por si algún proceso side-channel (uvicorn access log a stdout → systemd journal → /var/log) crece sin tope.

Comando manual para forzar rotación (test):

```bash
sudo logrotate -f /etc/logrotate.d/menteviva
ls -la /var/log/menteviva/   # ver los .1, .2.gz, etc.
```

## 10. Seguridad / hardening

- `.env`, `secrets/firebase-admin.json` → permisos 600, owner `menteviva`.
- Neon DB: connection string contiene password + ya viene con TLS (`sslmode=require`). NO commitear la URL. Habilitar **IP Allow** en el dashboard de Neon (paid feature) para que solo el server-empresa pueda conectar.
- Cloudflare Tunnel es outbound-only: el server **NO** abre ningún puerto entrante. Firewall puede tener `ufw default deny incoming`.
- Cloudflare **Access** (gratis hasta 50 usuarios): poner gate de email/SSO encima del subdominio para que solo invitados al piloto entren. Configurar en CF Dashboard → Zero Trust → Access → Applications.
- WAF rules en CF: bloquear scrapers, rate limit por IP (1000 req/min default es razonable).
- Rotar `GROQ_API_KEY`, `OPENAI_API_KEY` y `ELEVENLABS_API_KEY` antes y después del piloto.
- Neon: crear un role dedicado `menteviva_app` con permisos solo sobre la DB `menteviva`, no usar el owner directamente desde la app.

## 10.5 Estrategia de ramas (dev local → main prod)

Trabajamos con dos ramas largas-vivas:

```
                     ┌──────────────────┐
                     │  feature/<algo>  │  (corta vida, una por tarea)
                     └────────┬─────────┘
                              │ PR + review
                              ▼
       ┌──────────────────────────────────┐
       │              dev                 │  ← desarrollo local; aquí probamos
       │  (default branch en GitHub)      │     todo antes de pasar a prod
       └────────────────┬─────────────────┘
                        │ PR + smoke local OK
                        ▼
       ┌──────────────────────────────────┐
       │             main                 │  ← lo que está deployado
       │  protegida, sólo merge desde dev │
       └────────────────┬─────────────────┘
                        │ git pull en server
                        ▼
                  ┌──────────┐
                  │  Server  │  (rama main checkout)
                  └──────────┘
```

### Reglas

- **`main`** = lo que corre en producción. Nunca commitear directo. Protegida en GitHub: requiere PR desde `dev`, status checks verdes.
- **`dev`** = default branch. Aquí mergeamos features tras review. El equipo prueba el flujo end-to-end en local apuntando al backend local.
- **`feature/*`** = ramas de tarea, corta vida (1 feature, 1 rama). PR a `dev` cuando termine.

### Flujo de promote dev → main

```bash
# Una vez que dev pasa la smoke local (capítulo 9 del plan, sobre localhost)
git checkout main
git pull
git merge --no-ff dev
# Tag opcional: marca cada deploy
git tag -a "v$(date +%Y.%m.%d-%H%M)" -m "deploy piloto"
git push origin main --tags

# En el server
ssh menteviva@<server>
cd /opt/menteviva
git pull origin main
# Backend + frontend rebuild + restart (ver §8)
./deploy.sh   # script wrapper que automatiza
```

### Setup inicial del repo

```bash
# Desde la rama actual de trabajo
git checkout -b dev
git push -u origin dev
# En GitHub: Settings → Branches:
#   - Default branch = dev
#   - Protected: main (require PR from dev, no force-push, no deletes)
```

### Hotfix urgente en prod (excepción)

Si hay bug crítico y dev tiene cambios no probados:

```bash
git checkout main
git checkout -b hotfix/<descripcion>
# arreglar
git commit -m "hotfix: ..."
# PR rápido a main + cherry-pick a dev para que no se pierda
git checkout dev && git cherry-pick <sha>
```

## 11. Rollback

```bash
cd /opt/menteviva
git log --oneline -10        # identificar el commit previo estable
git checkout <sha>
cd menteviva-backend && poetry install --no-dev && cd ..
cd menteviva-frontend && npm ci && npm run build && cd ..
sudo systemctl restart menteviva-backend
```

## 12. Pendientes técnicos antes del deploy

1. **Agregar StaticFiles + SPA fallback** a `app/main.py` (código en sección 3.4).
2. **Verificar migrator Postgres-ready**: confirmar que `app/db/` respeta `DATABASE_URL` (lee env o sigue hardcoded a `sqlite:///data/menteviva.db`). Si está hardcoded, abrir issue y parchear antes del deploy.
3. **Añadir driver Postgres**: `poetry add psycopg[binary]` en `pyproject.toml` y commitearlo.
4. **TTS swap a OpenAI**: el módulo actual `app/services/edge_tts.py` está atado a ElevenLabs (`elevenlabs` SDK). Cambiarlo a OpenAI TTS:
   - `poetry add openai` (ya estará si usamos también para otros endpoints)
   - Reescribir `text_to_speech()` para llamar `client.audio.speech.create(model="tts-1", voice="alloy", input=text)` y devolver bytes MP3.
   - Mantener firma del módulo y el mapping `AVATAR_VOICES` (cambiar a voces OpenAI: `alloy/echo/fable/onyx/nova/shimmer`).
   - `OPENAI_API_KEY` en `.env` (separado del Groq).
   - Razón: ~6× más barato que EL ($0.015/1k chars vs $0.10/1k) y concurrency tier-based sin caps rígidos. Calidad suficiente para piloto.
   - Plan B: dejar `TTS_PROVIDER` env (`openai|elevenlabs`) para poder fallback rápido si la calidad no convence en pruebas.
5. **CORS_ORIGINS**: actualizar `.env.example` con placeholder del subdominio Cloudflare.
6. **Dominio en Cloudflare**: confirmar que el dominio (o subdominio empresa) ya está agregado en Cloudflare DNS. Si no, hacer ese paso primero (~24h propagación si nameservers se cambian).
7. **Firebase Authorized Domains**: agregar el subdominio antes de probar login.
8. **Versión Python**: confirmar `python3.11` o `3.12` matchea `pyproject.toml`.
9. **Decisión piloto**: arrancar con DB limpia o importar datos previos del SQLite local. Si conservar, hacer `pgloader sqlite:///data/menteviva.db postgresql://menteviva@127.0.0.1/menteviva` antes del primer arranque.
10. **Estrategia de ramas**: crear rama `dev` (default), proteger `main`, ajustar GitHub Settings (sección 10.5).
11. **deploy.sh**: script wrapper en raíz del repo que automatiza `git pull && poetry install && npm ci && npm run build && systemctl restart menteviva-backend`. Idempotente.

## 13. Variables a definir (rellenar antes de iniciar)

| Variable | Valor |
|---|---|
| Dominio Cloudflare | _________________ |
| Subdominio piloto | `piloto._________________` |
| URL final del piloto | `https://piloto._________________` |
| Cloudflare Tunnel name | `menteviva-piloto` |
| Server hostname / IP | _________________ |
| User systemd (`menteviva`) creado | sí / no |
| Password Postgres user `menteviva` | (guardado en password manager) |
| Logs path | `/var/log/menteviva/` |
| DB | `postgresql://menteviva@127.0.0.1:5432/menteviva` |
| Backups path | `/var/backups/menteviva/` |
