# 16 — Integración del avatar OSS self-hosted (trabajo en Mente Viva)

**Estado:** listo para implementar en paralelo
**Depende de:** `docs/plans/15_avatar_oss_selfhosted.md` (diseño general)
**Repos hermanos:**
- `AvatarAI/` → construye el **`avatar-service`** (MuseTalk + WebRTC) en RunPod/VPS. NO está en este repo.
- `Mente Viva/` (ESTE repo) → construye la **capa de integración** backend + frontend que consume ese servicio.

> **Objetivo de este documento:** que el trabajo en Mente Viva avance en PARALELO al
> `avatar-service`, construyendo contra un CONTRATO fijo. Casi todo se puede escribir,
> compilar y revisar sin que el servicio exista todavía; solo el E2E final espera al
> servicio.

---

## 0. Contexto (leer antes de tocar código)

Hoy el avatar de video es **Simli (SaaS de pago)**. Lo vamos a reemplazar por un
microservicio open-source self-hosted, PERO manteniendo intacto el pipeline de voz
(Gemini Live) y el patrón que ya existe.

El punto de integración ya está abstraído en el frontend: el avatar vive detrás de la
interfaz **`GeminiAudioSink`** (ver `src/hooks/useGeminiLive.ts` y su implementación
`src/hooks/useSimliAvatar.ts`):

```ts
interface GeminiAudioSink {
  isActive(): boolean;          // ¿el avatar está conectado y listo para recibir audio?
  sendPcm24k(b64: string): void;// cada chunk de audio del avatar (Gemini, PCM16 24kHz, base64)
  interrupt(): void;            // barge-in: descartar lo encolado
}
```

Simli es **una** implementación de ese contrato. Este trabajo consiste en crear
**otra** implementación (OSS) del MISMO contrato, seleccionable por configuración, sin
romper Simli (queda como fallback).

Archivos de referencia (el gemelo Simli, que vamos a espejar):
- Backend: `app/routers/simli.py`, `app/config.py` (`simli_api_key`, `simli_max_session_seconds`).
- Frontend: `src/hooks/useSimliAvatar.ts`, `src/components/avatar/SimliAvatar.tsx`,
  `src/utils/simliFlag.ts`, `src/pages/Diagnostico.tsx`.

---

## 1. EL CONTRATO (frontend ↔ backend ↔ avatar-service)

Esto es lo más importante: ambos equipos construyen contra esto. NO cambiar sin avisar
al lado de AvatarAI.

### 1.1 Creación de sesión (mediada por el backend, igual que Simli)

El navegador nunca habla directo con secretos: pide al backend una sesión efímera.

```
POST /api/avatar/session
body: { "avatar_id": "entrevistador" }
```

El backend, según `AVATAR_PROVIDER`, responde:

**Provider = simli** (comportamiento actual, sin cambios funcionales):
```json
{ "provider": "simli", "session_token": "...", "face_id": "..." }
```

**Provider = oss** (nuevo):
```json
{
  "provider": "oss",
  "session_id": "uuid",
  "signaling_url": "https://<avatar-service>/rtc/<session_id>",
  "ice_servers": [ { "urls": "stun:stun.l.google.com:19302" } ],
  "max_session_seconds": 1800
}
```
El backend obtiene esto llamando internamente a `POST {AVATAR_SERVICE_URL}/session`
(la URL del servicio vive en el backend, no en el navegador).

### 1.2 Señalización WebRTC (navegador ↔ avatar-service, directo)

Con `signaling_url`, el navegador negocia WebRTC directo contra el `avatar-service`
(igual que hoy con Simli vía LiveKit):

1. Frontend crea `RTCPeerConnection` con transceivers **recvonly** de video y audio.
2. Crea un **DataChannel** llamado `"audio-in"` (para mandar el audio de Gemini).
3. `POST {signaling_url}/offer` con el SDP offer → responde SDP answer.
4. El `avatar-service` emite por sus tracks: **video** (cara lip-synced) + **audio**
   (la voz de Gemini re-emitida y sincronizada).
5. Frontend pega los tracks a `<video>`/`<audio>` (igual que `SimliAvatar.tsx`).

### 1.3 Envío de audio (Gemini → avatar-service) por DataChannel

- Canal `"audio-in"`, binario.
- `sendPcm24k(b64)`: el frontend **decodifica base64 a bytes PCM16 24kHz y los manda
  TAL CUAL** por el DataChannel. **NO remuestrear en el frontend** — el servicio
  resamplea a 16kHz (lo que necesita Whisper de MuseTalk). Esto simplifica el frontend
  y quita del contrato el sample-rate interno del motor.
- `interrupt()`: mandar por el canal un mensaje de control **texto** `{"type":"interrupt"}`
  → el servicio limpia su buffer de audio (barge-in).
- `isActive()`: `pc.connectionState === "connected"` && `dataChannel.readyState === "open"`.

### 1.4 Cierre / límites

- El `avatar-service` corta la sesión al llegar a `max_session_seconds` o por idle
  (análogo a `simli_max_session_seconds` + `maxIdleTime`).
- El frontend cierra con `pc.close()` en `disconnect()`.

---

## 2. Trabajo en el BACKEND (`menteviva-backend`)

### 2.1 Config (`app/config.py`)
Agregar:
```python
avatar_provider: str = "simli"          # "simli" | "oss" | "none"
avatar_service_url: str = ""            # base URL del avatar-service OSS (server-side)
avatar_max_session_seconds: int = 1800  # espejo de simli_max_session_seconds
```
Mantener `simli_api_key`, `simli_max_session_seconds` como están.

### 2.2 Router unificado (`app/routers/avatar.py`, nuevo)
- Endpoint `POST /api/avatar/session` que despacha por `settings.avatar_provider`:
  - `simli` → reutiliza la lógica de `routers/simli.py` (mint token) y responde con el
    shape `provider:"simli"`.
  - `oss` → hace `POST {avatar_service_url}/session` con `{avatar_id, face_id, max_session_seconds}`
    y devuelve el shape `provider:"oss"`. Con `httpx.AsyncClient` (ver el patrón que ya
    usa `simli.py`).
  - `none` → responde `{ "provider": "none" }` (el frontend cae al avatar 2D).
- Manejo de errores igual que `simli.py` (502 si el servicio no responde, 503 si falta config).
- Registrar el router en `main.py` con `prefix="/api"` (convención del repo).
- **NO borrar `simli.py`** todavía: el router unificado puede importar su helper, o se
  deja el endpoint viejo activo hasta que el OSS esté validado en producción.

### 2.3 (Opcional, útil para paralelizar) Stub del avatar-service
Para probar el backend sin el servicio real, un endpoint de prueba o un pequeño script
que simule `POST /session` devolviendo un `session_id` y una `signaling_url` fake. Sirve
para validar el dispatch de `/api/avatar/session` con un test tipo `scripts/test_*.py`
(convención del repo: harness con conversación/flujo sintético, no click manual).

---

## 3. Trabajo en el FRONTEND (`menteviva-frontend`)

### 3.1 Selector de provider (`src/utils/avatarProvider.ts`, nuevo)
Generalizar `simliFlag.ts`: leer el provider efectivo (de `/api/avatar/session` o de una
env `VITE_AVATAR_PROVIDER`) y exponer `getAvatarProvider(): "simli" | "oss" | "none"`.
Mantener `simliFlag.ts` funcionando o migrarlo aquí.

### 3.2 Hook OSS (`src/hooks/useOssAvatar.ts`, nuevo) — el corazón
Gemelo de `useSimliAvatar.ts`, implementando el MISMO `GeminiAudioSink`, pero:
- `connect(avatarId)`: `POST /api/avatar/session` → si `provider==="oss"`, crea
  `RTCPeerConnection` con los `ice_servers`, agrega transceivers recvonly video+audio,
  crea el DataChannel `"audio-in"`, hace el intercambio SDP contra `signaling_url`, y
  pega `ontrack` a los refs `<video>`/`<audio>`.
- `sink.sendPcm24k(b64)`: `base64 → Uint8Array` y `dataChannel.send(bytes)` (SIN
  remuestrear; reutilizar `base64ToInt16` de `utils/pcm` solo para el decode, pero
  mandar 24k).
- `sink.interrupt()`: `dataChannel.send(JSON.stringify({type:"interrupt"}))`.
- `sink.isActive()`: `pc?.connectionState==="connected" && dc?.readyState==="open"`.
- `disconnect()`: `pc.close()`.
- Mismos estados que el hook Simli: `videoRef`, `audioRef`, `connected`, `failed`, `sink`.
- **Fallback**: si `failed`, `useGeminiLive` cae al player PCM local + avatar 2D (misma
  lógica que ya existe con Simli — ver el comentario en `useSimliAvatar.ts`).

### 3.3 Componente agnóstico de provider
`SimliAvatar.tsx` renderiza `<video>/<audio>` a partir de refs. Crear `OssAvatar.tsx`
equivalente, o refactorizar a un `VideoAvatar.tsx` que reciba el hook por prop. En
`Diagnostico.tsx`, elegir el hook según `getAvatarProvider()`.

### 3.4 (Opcional) Mock local del avatar-service
Un mini servidor `aiortc` que responda el SDP y emita un **video estático en loop**
(sin lip-sync real) permite probar TODO el plumbing de WebRTC + DataChannel del
frontend antes de que MuseTalk esté listo. Es la forma más limpia de paralelizar el
frontend. (Este mock puede vivir en `AvatarAI/`; coordinar.)

---

## 4. Rama y flujo local

```bash
# Estás en 'dev'. Crear la rama de feature:
git checkout dev && git pull
git checkout -b feature/avatar-oss

# Backend
cd menteviva-backend
# editar .env: AVATAR_PROVIDER=oss  y  AVATAR_SERVICE_URL=<url del servicio o del mock>
poetry run python -m app          # :8000  (SelectorEventLoop en Windows)

# Frontend (otra terminal)
cd menteviva-frontend
npm run dev                        # :5173
npm run build                      # tsc = type-check (no hay lint aparte)
```

- Con `AVATAR_PROVIDER=simli` todo debe seguir funcionando **idéntico a hoy** (regresión cero).
- Con `AVATAR_PROVIDER=oss` y el mock/servicio arriba, se prueba el camino nuevo.
- Con `AVATAR_PROVIDER=none`, avatar 2D (sin video) — útil si no hay servicio.

---

## 5. Qué se puede hacer YA (paralelo) vs qué espera al servicio

**Ya, sin el avatar-service:**
- §2.1 config, §2.2 router `avatar.py` (camino simli 100%, camino oss contra stub).
- §3.1 selector, §3.2 hook `useOssAvatar` (contra el contrato), §3.3 componente.
- §2.3 / §3.4 stubs/mocks.
- Regresión: confirmar que `AVATAR_PROVIDER=simli` no cambia nada.

**Espera al `avatar-service` real (lo entrega AvatarAI):**
- E2E: latencia real, calidad de lip-sync, barge-in de punta a punta, límites de sesión.
- Ajuste fino del formato/tamaño de chunk de audio si el servicio lo pide.

---

## 6. Definition of Done (de esta rama)

1. `AVATAR_PROVIDER=simli` → comportamiento idéntico al actual (regresión cero). ✅ obligatorio.
2. `AVATAR_PROVIDER=oss` → `useOssAvatar` conecta por WebRTC contra el contrato §1,
   renderiza video, manda audio por DataChannel, interrumpe en barge-in, y cae a 2D si falla.
3. `npm run build` (tsc) limpio; backend levanta sin error con las 3 opciones de provider.
4. Sin secretos en el navegador (la `AVATAR_SERVICE_URL` y cualquier token viven en el backend).
5. `simli.py` intacto como fallback hasta validar OSS en producción.

---

## 7. Nota de contenido / rostros

Los rostros de los avatares deben ser **sintéticos (persona inexistente)** o con
**consentimiento firmado** — NUNCA la imagen (ni una versión "generada con IA") de una
persona real identificable (derechos de imagen + idoneidad del producto). El
`avatar-service` cargará esos rostros ya validados; el frontend solo referencia
`avatar_id`.
