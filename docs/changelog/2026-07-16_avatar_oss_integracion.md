# 2026-07-16 — Capa de integración del avatar OSS self-hosted (feature/avatar-oss)

Implementa el trabajo del lado **Mente Viva** del plan
`docs/plans/16_avatar_oss_integracion.md`: la capa backend + frontend que
consume el `avatar-service` OSS (MuseTalk + WebRTC, repo hermano `AvatarAI/`),
construida contra el **contrato §1** para poder avanzar en PARALELO al servicio.
Solo se implementó lo que NO depende del servicio (§5 del plan); el E2E real
(latencia, lip-sync, barge-in de punta a punta) queda pendiente del servicio.

## Contexto

El avatar de video hoy es **Simli (SaaS de pago)**. Se agrega un proveedor
alternativo OSS self-hosted seleccionable por config, **sin romper Simli**
(queda como fallback). El punto de integración ya estaba abstraído tras la
interfaz `GeminiAudioSink`; Simli era una implementación y ahora hay otra (OSS)
del mismo contrato.

## Cambios

### Backend (`menteviva-backend`)
- **`app/config.py`**: nuevas settings `avatar_provider` (`"simli"` default →
  regresión cero), `avatar_service_url` (solo backend), `avatar_max_session_seconds`.
- **`app/routers/simli.py`**: se extrajo `mint_simli_session(avatar_id)` como
  helper reutilizable. El endpoint legacy `POST /api/simli/session-token` queda
  **intacto** (solo delega al helper) — no se borra hasta validar OSS en prod.
- **`app/routers/avatar.py`** (nuevo): `POST /api/avatar/session` despacha por
  `settings.avatar_provider`:
  - `simli` → `mint_simli_session` → `{provider:"simli", session_token, face_id}`.
  - `oss` → `POST {avatar_service_url}/session` (httpx async) →
    `{provider:"oss", session_id, signaling_url, ice_servers, max_session_seconds}`.
    Inyecta STUN público por default si el servicio no manda `ice_servers`.
  - `none` → `{provider:"none"}` (el frontend cae al avatar 2D).
  - Errores: 503 sin config, 502 si el servicio no responde/responde mal
    (mismo patrón que `simli.py`).
- **`app/main.py`**: router registrado con `prefix="/api"`.
- **`scripts/test_avatar_session.py`** (nuevo): harness que valida el despacho
  (none / oss contra un stub de httpx / oss-sin-URL→503 / provider inválido→503),
  sin necesitar el servicio real ni uvicorn. **Pasa.**
- **`.env.example`**: documentadas `AVATAR_PROVIDER`, `AVATAR_SERVICE_URL`,
  `AVATAR_MAX_SESSION_SECONDS`.

### Frontend (`menteviva-frontend`)
- **`src/utils/avatarProvider.ts`** (nuevo): `getAvatarProvider()` →
  `"simli" | "oss" | "none"`. Fuente: `?avatar=` (persistido en localStorage) >
  `VITE_AVATAR_PROVIDER` > **fallback a `getSimliFlag()`** (compat con el viejo
  `VITE_SIMLI_AVATAR` → regresión cero).
- **`src/hooks/useOssAvatar.ts`** (nuevo): gemelo de `useSimliAvatar`,
  implementa el MISMO `GeminiAudioSink` pero por WebRTC contra el contrato:
  `POST /api/avatar/session` → `RTCPeerConnection` (transceivers recvonly
  video+audio) → DataChannel `"audio-in"` → intercambio SDP contra
  `signaling_url/offer`. `sendPcm24k` manda PCM16 **24k tal cual** (el servicio
  resamplea a 16k, §1.3, **sin** remuestrear en el front); `interrupt()` manda
  `{"type":"interrupt"}` por el canal; `isActive()` = `pc connected && dc open`.
- **`src/components/avatar/VideoAvatar.tsx`** (nuevo): capa visual agnóstica del
  proveedor (mismo markup que el antiguo `SimliAvatar`: `<video>/<audio>` +
  fondo blur). Reemplaza a `SimliAvatar.tsx`, que se **elimina** (nadie más lo
  importaba; el hook `useSimliAvatar` se conserva).
- **`src/pages/Diagnostico.tsx`**: instancia ambos hooks (`useSimliAvatar` +
  `useOssAvatar`, reglas de hooks) y selecciona el activo por
  `getAvatarProvider()`; solo conecta el que corresponde (el inactivo es no-op).
  El sink activo se pasa a `useGeminiLive`; render con `VideoAvatar`.

## Verificación
- `poetry run python -m scripts.test_avatar_session` → **OK** (4 casos).
- Backend importa sin error con `AVATAR_PROVIDER` = `simli` / `oss` / `none` y
  la ruta `/api/avatar/session` queda registrada en los tres.
- `npm run build` (tsc + vite) → **limpio**.
- Regresión cero: sin `VITE_AVATAR_PROVIDER`/`AVATAR_PROVIDER`, el selector cae
  a `getSimliFlag()` y el provider default es `simli` → comportamiento idéntico.

## Pendiente (espera al `avatar-service` real — AvatarAI)
- E2E: latencia real, calidad de lip-sync, barge-in de punta a punta, límites
  de sesión.
- Canal de "speaking" del servicio para el indicador "Sofia está hablando" en
  modo OSS (hoy `onSpeakingChange` del hook OSS queda cableado pero sin emisor).
- Ajuste fino de formato/tamaño de chunk de audio si el servicio lo pide.

## Nota de contenido (§7)
Los rostros del avatar deben ser **sintéticos** o con **consentimiento firmado**
— nunca una persona real identificable. El `avatar-service` carga esos rostros
validados; el frontend solo referencia `avatar_id`.
