# 2026-07-15 — Deploy VPS: pin de simli-client y causa del build roto

## Contexto

Durante el deploy en el VPS (backend :8005 + quick tunnel de Cloudflare
apuntando a `localhost:8005`, con el backend sirviendo el SPA desde
`menteviva-frontend/dist/`), las rutas `/chat-lab` y `/voice-lab` daban
pantalla en negro. El `dist/` del VPS era viejo (compilado antes de que
existieran esas páginas) y todos los intentos de `npm run build` / `vite build`
fallaban.

## Causa raíz (dos capas)

1. **`simli-client@3.0.2` está roto en Linux.** Su `dist/index.js` hace
   `require("./Client")` pero el paquete publica `dist/client.js` (minúscula).
   En filesystems case-sensitive (el VPS Debian) rollup falla con
   `Could not resolve "./Client"`. En Windows no se nota porque el FS es
   case-insensitive. En el VPS se instaló la 3.0.2 al correr
   `npm install simli-client` a mano (el caret `^3.0.1` la permitía y ese
   comando ignora el lockfile, que sí pineaba 3.0.1).
2. **El error quedó oculto**: el último build en el VPS se corrió como
   `npx vite build 2>/dev/null`, que tragó el error de rollup. Se interpretó
   "1869 modules transformed" como éxito, pero un build exitoso imprime la
   lista de archivos `dist/...` y `✓ built in Xs`. El `dist/` nunca se regeneró.

## Cambio

- `menteviva-frontend/package.json`: `"simli-client": "^3.0.1"` → `"3.0.1"`
  (pin exacto) + lockfile sincronizado. Commit `9bda110` en `dev`.

## Resultado (deploy verificado 2026-07-15 ~22:48)

Con el pin en su lugar, en el VPS: `git checkout -- package.json
package-lock.json` + `git checkout main` + `git pull origin main`, `sed -i
'/^VITE_API_URL/d' .env`, `npm ci` (instaló 3.0.1), `npm run build` → `✓ built
in 4.66s` con lista de assets, reinicio del backend con nohup. Verificado:
`/health` → `{"status":"ok"}` y `/chat-lab` devuelve el HTML del SPA. ChatLab y
VoiceLab accesibles vía túnel.

## Estado final del VPS

- Repo `~/menteviva` en rama **main** (antes estaba en dev; `main` se fusionó
  con dev en `5a6a998` y ambas quedaron equivalentes ese día).
- Backend: `nohup poetry run python -m app > backend.log 2>&1 &` en
  `~/menteviva/menteviva-backend`, puerto **8005** (via `PORT=8005` en el
  `.env` del backend → `settings.port`). Corre con reloader de uvicorn
  (WatchFiles), así que un `git pull` de código backend se recarga solo; el
  frontend NO — requiere `npm run build`.
- Frontend: NO corre Vite; el backend sirve `menteviva-frontend/dist/`
  (StaticFiles, mismo origen → API relativa y WS `wss://` del mismo host).
- Túnel: quick tunnel de cloudflared (`~/cloudflared`, sin cuenta) →
  `cloudflared tunnel --no-autoupdate --url http://localhost:8005`. La URL
  `*.trycloudflare.com` es efímera: cambia en cada relanzamiento.
- Reinicio del backend: `kill $(lsof -ti:8005); sleep 1; nohup poetry run
  python -m app > backend.log 2>&1 &`.

## Notas de deploy que quedaron de la sesión

- El `.env` del frontend en el VPS NO debe tener `VITE_API_URL`: con la
  variable vacía el bundle usa URLs relativas y WS del mismo host, que es lo
  correcto cuando el backend sirve el `dist/` por el túnel. Un
  `VITE_API_URL=http://localhost:8005` horneado en el build apunta al
  localhost del visitante y rompe todo.
- Receta de rebuild en el VPS: restaurar `package.json`/`package-lock.json`
  (los mutó el `npm install simli-client`), `git pull origin dev`, `npm ci`,
  `npm run build` SIN redirigir stderr, y reiniciar el backend.
