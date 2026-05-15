#!/usr/bin/env bash
# Deploy script para el server piloto (Linux). Asume:
# - El repo esta clonado en /opt/menteviva (o ajustar REPO_DIR).
# - systemd unit `menteviva-backend.service` corre uvicorn (ver DEPLOY_PILOTO.md).
# - El user que ejecuta esto puede `sudo systemctl restart`.
#
# Uso:    ./deploy.sh
# Logs:   tail -f /opt/menteviva/menteviva-backend/logs/menteviva.log
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/menteviva}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-menteviva-backend.service}"

echo "==> [$(date -Iseconds)] Deploy iniciado (branch=$BRANCH, dir=$REPO_DIR)"

cd "$REPO_DIR"

echo "==> git pull origin $BRANCH"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> backend: poetry install (sin dev deps)"
cd "$REPO_DIR/menteviva-backend"
poetry install --without dev --no-root

echo "==> backend: aplicar migraciones (idempotente)"
# init_db() corre al startup del backend, pero ejecutarlo aqui da feedback
# explicito en el deploy y deja la DB lista antes del restart.
poetry run python -m scripts.test_db_migrator

echo "==> frontend: npm ci + build"
cd "$REPO_DIR/menteviva-frontend"
npm ci --omit=dev
npm run build

echo "==> systemctl restart $SERVICE"
sudo systemctl restart "$SERVICE"

# Smoke quick: el backend deberia responder /health en pocos segundos.
sleep 3
if curl -sf --max-time 5 http://127.0.0.1:8000/health > /dev/null; then
    echo "==> /health OK"
else
    echo "==> WARN: /health no respondio. Revisar 'systemctl status $SERVICE' y los logs."
    exit 1
fi

echo "==> [$(date -Iseconds)] Deploy completo"
