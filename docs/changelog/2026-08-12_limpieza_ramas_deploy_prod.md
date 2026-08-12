# 2026-08-12 — Consolidación de ramas, archivado y deploy prod

## Contexto

El repo acumulaba ramas históricas sin limpiar y `feature/avatar-oss` +
`codex/roberto-sales-cases` estaban vivas con cambios pendientes de integrar.
Se limpió el árbol de ramas, se integró trabajo pendiente en `dev`/`main` y se
desplegó en el VPS de producción (`condor-ia`, backend `:8005`).

## Qué se hizo

### 1. Limpieza de ramas (`main`/`dev` quedaron como únicas ramas locales)

| Rama | Estado | Acción |
|------|--------|--------|
| `master` | 10 commits MVP original (2026-02-26), ancestro de main | documentada + borrada |
| `feature/elevenlabs-tts` | tip `ea2061c` (04-23), ancestro de main | documentada + borrada |
| `feature/avatar-talkinghead` | tip `bbd4f14` (05-14), ancestro de main | documentada + borrada |
| `feature/gemini-live-voice` | tip `6e5956f` (06-10), ancestro de main | documentada + borrada |
| `feature/avatar-oss` | 11 adelante / 6 atrás de main | merge → `dev` + borrada |
| `codex/roberto-sales-cases` | 9 commits de retros Roberto/Sofía | merge → `dev` + borrada |

Las 4 ramas archivadas estaban **100% contenidas en main** (su tip era ancestro
de `main`/`dev`), así que borrarlas no perdió historia. Su aporte quedó
registrado en `docs/changelog/2026-08-12_archivo_ramas_integradas.md`.

`codex/roberto-sales-cases` estaba ligada a un **worktree** external
(`…/Mente Viva-roberto-sales-cases`); se removió con `git worktree remove`.

### 2. Integración de `feature/avatar-oss` en `dev`

- Se commitearon cambios pendientes en `feature/avatar-oss`
  (`fe928ed`, 19 archivos; incluye reset de contraseña, integración RunPod,
  CORS de tunnel prod, docs de changelog).
- `.env.bak-avatarai` se agregó a `.gitignore` (`.env.bak*` en
  `menteviva-backend/.gitignore:25`) — backup de secrets que no debía versionarse.
- Merge fast-forward → `dev` (`fe928ed`).

### 3. Integración de `codex/roberto-sales-cases` en `dev` (con conflicto)

Merge `b975725`. Hubo 1 conflicto en `menteviva-backend/app/routers/conversation.py`:

- **Causa estructural**: `codex` modificó el router viejo (1161 líneas); `dev`
  ya lo había refactorizado a una fachada de 13 líneas que delega en
  `services/conversation_session.py` (`sys.modules[__name__] = _session`).
- **Resolución**: se tomó la versión de `dev` (fachada) y se portó el único
  cambio semántico de `codex` — pasar `sales_case=(session_vars or {}).get("roberto_case")`
  a `analyze_conversation` — a `services/conversation_finalizer.py`, que es el
  flujo equivalente en la nueva arquitectura para todos los proveedores.

### 4. Merge en cadena a `main` y push

```
dev → main  (7e11be3, merge ort, sin conflictos, 138 archivos)
main → origin/main  (9fbb663..7e11be3)
dev → origin/dev    (6682baf..b975725)
```

### 5. Deploy en prod (VPS condor-ia, backend :8005)

Pasos en el server (`~/menteviva`, rama main):

```bash
git pull origin main
# backend: reinicio con receta nohup documentada en changelog 07-15
kill $(lsof -ti:8005); sleep 1
nohup poetry run python -m app > backend.log 2>&1 &
# frontend: build del dist/ que sirve el backend por StaticFiles
cd ~/menteviva/menteviva-frontend
sed -i '/^VITE_API_URL/d' .env   # URLs relativas, nunca API absoluta horneada
npm ci
npm run build
```

`/health` → `{"status":"ok"}`. **Importante**: el backend corre con reloader
(WatchFiles), así que un `git pull` de código backend se recarga solo; el
frontend NO, requiere `npm run build`.

#### Incidente: `npm ci` falló en el VPS

- **Síntoma**: `npm error EUSAGE … Missing: esbuild@0.28.2 … @esbuild/*@0.28.1
  does not satisfy 0.28.2`.
- **Causa**: el `package-lock.json` del repo quedó desincronizado tras el merge
  de avatar-oss (pin `esbuild 0.28.1` vs `package.json 0.28.2`; faltaban
  `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`).
- **Workaround en el server**: `npm install` (regenera lockfile) + `npm run build`.
- **Fix permanente en repo**: `npm install` local → lockfile sincronizado
  (102+/78-) → commit `2d7be41` → push a `origin/main`. Con eso `npm ci` vuelve
  a funcionar limpio en el VPS.

## Estado final

- Ramas locales: solo `main` y `dev`.
- `origin/main` = `2d7be41`, `origin/dev` = `b975725`.
- Prod desplegado con el `dist/` nuevo; backend recargado en `:8005`.

## Pendientes (del changelog 08-11, sigue sin hacerse)

`nohup` sin supervisor: si muere el backend o el tunnel de cloudflared, el
acceso público cae hasta reiniciar a mano y la URL `*.trycloudflare.com`
cambia (hay que re-agregarla en Firebase → Authorized domains). Recomendado:
`systemd --user` con `Restart=always` + `loginctl enable-linger`.