#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo ""
echo "  MENTE VIVA - VPS Launcher"
echo "  ========================="
echo ""

# Kill existing PM2 processes
pm2 delete menteviva-backend 2>/dev/null || true
pm2 delete menteviva-frontend 2>/dev/null || true
pm2 flush

# Backend
echo "[1/2] Starting Backend (port 8080)..."
cd menteviva-backend
pm2 start "poetry run python -m app" --name "menteviva-backend" -o /dev/null -e /dev/null
cd ..

# Frontend
echo "[2/2] Starting Frontend (port 5173)..."
cd menteviva-frontend
pm2 start "npm run dev -- --host" --name "menteviva-frontend" -o /dev/null -e /dev/null
cd ..

echo ""
echo "  Backend:  http://localhost:8080"
echo "  Frontend: http://localhost:5173"
echo ""
echo "  Use:  bash logs-vps.sh     to see logs"
echo "  Use:  pm2 stop all         to stop"
echo ""
