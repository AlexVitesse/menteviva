# 2026-07-16 — Avatar OSS v2: `bye` al cerrar + 409 como "servicio lleno"

Adecúa la capa Mente Viva al `avatar-service` v2 (multi-sesión + cierre limpio).
Contrato completo en `AvatarAI/docs/02_servicio_y_contrato.md`.

## 1. `bye` al terminar (libera el cupo de sesión de inmediato)
Con varias sesiones compartiendo GPU, esperar el timeout de ICE para liberar el
cupo es caro. Ahora se manda un mensaje de control `{"type":"bye"}` ANTES de
cerrar, por el mismo canal de audio.

- **`src/hooks/useOssAvatar.ts`** (WebRTC): en `disconnect()`, si el DataChannel
  `audio-in` está `open`, `dc.send(JSON {type:"bye"})` antes de `dc.close()` /
  `pc.close()`. Además, `useEffect` que:
  - registra `beforeunload` → manda `bye` best-effort (cierre de pestaña),
  - en su cleanup (unmount) llama `disconnect()` (que ya manda `bye`).
- **`src/hooks/useOssAvatarWs.ts`** (transporte WS): equivalente — `bye` por el
  WebSocket antes de `ws.close()`, + `beforeunload` + cleanup en unmount.
  (En WS el `close` ya libera el socket server-side; el `bye` es consistencia.)

Cobertura de los 3 disparadores pedidos: (a) fin de conversación / colgar y
(b) unmount van por `disconnect()`; (c) `beforeunload` como best-effort.

## 2. 409 = "servicio lleno" (MAX_SESSIONS), no "una a la vez"
`POST /session` ya es multi-sesión; un 409 significa que se alcanzó el máximo de
sesiones concurrentes (capacidad temporal).

- **`app/routers/avatar.py`** (`_oss_session`): ante un 409 se **reintenta con
  backoff corto** (`_CAP_BACKOFFS = (0.4, 0.8)` s, 2 reintentos). Si persiste,
  se devuelve **503** ("El avatar-service está lleno…") en vez del 502 genérico.
  Otros no-200 siguen siendo 502; error de red 502.
- **Frontend**: sin cambios de lógica — un 503/no-ok en `/api/avatar/session`
  hace que el hook marque `failed` y `Diagnostico` **caiga al fallback 2D/Simli**
  que ya existe (con el overlay "Conectando…" cubriendo la espera + reintentos).
- **`scripts/test_avatar_session.py`**: +2 casos — 409 persistente → 503 (tras
  agotar reintentos, backoff parcheado a 0 en el test) y 409 transitorio → 200
  (se recupera). **Pasa** (6 casos).

## No cambió (idéntico al contrato previo)
Señalización WebRTC (§1), `end_utterance`, `interrupt`, y los eventos
`speaking`/`silent`.

## Verificación
- `npm run build` (tsc + vite) → **limpio**.
- `poetry run python -m scripts.test_avatar_session` → **OK (6 casos)**.
- Backend importa/recarga sin error con el nuevo `avatar.py`.
