# 2026-08-27 — Deploy a prod: Celeste en labs + landing B2B pública

Despliegue de `9cac768` en la VM del piloto. Sube dos cosas que venían separadas:
el avatar **Celeste** (ver `2026-08-26_avatar_celeste_ventas.md`) y los 7 commits
del **rediseño de la landing B2B** que llevaban sin publicar desde el 19-ago.

Prod estaba en `7e11be3` (ese es el punto de rollback).

## Resultado

| Qué | Estado |
|---|---|
| Backend | Recargado solo por el watcher, `/health` OK, schema Neon v7 |
| Frontend | Rebuild a las 11:08 — landing B2B, página Legal y `brain.glb` (2.5 MB) en `dist/` |
| `lab_only` | Verificado en prod: `/api/avatars` → `roberto, maria` · `/api/chat/avatars` → `entrevistador, roberto, celeste, maria` |
| Acceso público | Túnel nuevo: **https://solved-bid-tribunal-sonic.trycloudflare.com** |

Pendiente al cierre: dar de alta `solved-bid-tribunal-sonic.trycloudflare.com`
(sin `https://`) en Firebase → Authentication → Settings → Authorized domains.
Sin eso el backend responde pero el login falla.

## Cuatro tropiezos y qué se aprendió

### 1. El pull abortó por `package-lock.json` modificado en el server

Alguien había corrido un `npm install` suelto allá y el lockfile quedó sucio
(195 inserciones / 110 borrados). No era el gotcha de simli-client documentado:
era el bump de `@esbuild/*` de 0.28.1 a 0.28.2 — **el mismo** que el repo ya
traía en un commit posterior, reproducido a mano. Se descartó con
`git checkout --` y el pull pasó.

Lección: mirar el diff antes de descartar, pero el lockfile lo manda el repo.

### 2. `npm ci` no funciona en ese server

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync.
npm error Missing: @emnapi/runtime@1.11.3 from lock file
npm error Missing: esbuild@0.28.2 from lock file
```

**No es un lockfile roto.** Es desfase de versiones de npm: el lockfile lo genera
npm **11.6.2** (la máquina de Eric) y el server tiene npm **10.8.2**, que resuelve
distinto las dependencias opcionales de plataforma y las lee como faltantes. Un
`npm ci --dry-run` en local pasa sin quejarse — el mismo archivo, dos lectores.

El build salió igual porque `npm run build` se ejecutó sobre el `node_modules`
que ya estaba (2661 módulos, mismo tamaño que el build local). Pero **hoy ese
server no puede hacer una instalación limpia**, solo reconstruir sobre lo que
tiene: si alguien borra `node_modules`, el frontend no se puede levantar.

Arreglo pendiente: `npm install -g npm@11` dentro del env conda `deepseek` (no
necesita sudo). Hasta entonces, en ese server: `npm run build` **sin** el
`npm ci` previo, y nunca borrar `node_modules`.

### 3. Túnel zombie, cuarta vez

`~/tunnel.log` repetía `Unauthorized: Tunnel not found` en bucle: el proceso
vivo, el quick tunnel reciclado por Cloudflare. Diagnóstico por log, nunca por
`pgrep` (el proceso existe y da falso verde).

Se relanzó, pero el `kill` del zombie falló primero (se pegó el placeholder
`<PID>` literal) y quedaron **dos** cloudflared apuntando al 8005 escribiendo al
mismo `tunnel.log`. Se mató el viejo (1814784). Estado final correcto: dos
procesos, el del 8005 y el del **5001 que es de otro proyecto y no se toca**.

### 4. El `CHATLAB_TOKEN` rompió el VoiceLab — revertido

Se detectó que los labs están **abiertos** en el túnel público: el `.env` de prod
no tiene `APP_ENVIRONMENT`, `CHATLAB_TOKEN` ni `CHATLAB_OPERATORS`, y los
defaults de `config.py` son `development` y `""`, así que `verify_chatlab_token`
queda en passthrough. Cualquiera con el link puede pegarle a `/api/chat` y quemar
la cuota de Groq/Gemini.

Se probó el token compartido y **rompió el VoiceLab**:

- `chatLabFetch` (ChatLab) envuelve `apiFetch` y añade `X-ChatLab-Token`. Funciona.
- VoiceLab usa `apiFetch` pelado: solo manda el `Authorization` de Firebase. Como
  `chatlab_operators` está vacío, la primera rama de `verify_chatlab_token` no
  aplica y cae al 401. VoiceLab pega a `/api/chat/avatars`, `/api/chat/diagnostico`
  y `/api/chat/conversation`: los tres cerrados.

Confirmado con `curl -H "Authorization: Bearer fake" .../api/chat/avatars` → 401,
y revertido (línea fuera del `.env` + restart). El agujero queda como estaba.

**El arreglo correcto es `CHATLAB_OPERATORS`**, no el token: `apiFetch` ya manda
el `Authorization` en los dos labs, así que esa vía cubre ambos sin tocar el
frontend. Requiere sacar los UID de Firebase del equipo de la tabla `users` en
Neon y probar ChatLab y VoiceLab antes y después. Tarea aparte, con calma.

## Comandos del deploy (para la próxima)

```bash
cd ~/menteviva
git rev-parse --short HEAD            # rollback
git pull --ff-only origin main

cd ~/menteviva/menteviva-frontend
npm run build                          # SIN npm ci en este server (ver #2)

curl -s http://127.0.0.1:8005/health
curl -s http://127.0.0.1:8005/api/avatars | grep -o '"id":"[a-z]*"'
tail -5 ~/tunnel.log                   # el log, no pgrep
```

El `.env` no lo recarga el watcher: cambiarlo exige
`kill $(lsof -ti:8005)` y relanzar el nohup. Los `.py` sí se recargan solos.
