# 2026-07-16 — Avatar OSS: transporte WebSocket (interino para RunPod)

## Contexto
Para probar el `avatar-service` OSS contra **RunPod HOY**: el NAT de RunPod no
deja pasar WebRTC sin un TURN server, así que se agrega un **transporte
alternativo por WebSocket** al provider OSS. Es **interino**; producción sigue
siendo **WebRTC en el VPS** (`useOssAvatar`, contrato §1 intacto). Aditivo: solo
se activa con `VITE_AVATAR_TRANSPORT=ws`.

## Cambios (frontend, `menteviva-frontend`)

- **`src/utils/avatarTransport.ts`** (nuevo): `getAvatarTransport()` →
  `"webrtc" | "ws"`. Fuente: `?transport=` (persistido en localStorage) >
  `VITE_AVATAR_TRANSPORT` > **default `"webrtc"`**. Ortogonal al provider: solo
  aplica cuando el provider es `oss`. El default garantiza que NO se toca el
  path WebRTC salvo activación explícita.
- **`src/hooks/useOssAvatarWs.ts`** (nuevo): gemelo de `useOssAvatar`, mismo
  `GeminiAudioSink` y misma forma de retorno (`videoRef/audioRef/connect/
  disconnect/connected/failed/sink`), pero SIN WebRTC:
  - `connect(avatarId)`: `POST /api/avatar/session` (igual que WebRTC) → de la
    `signaling_url` deriva `wss://<host>/ws/demo`. Abre `WebSocket`
    (`binaryType="arraybuffer"`).
  - Recepción: frame **binario** = JPEG → `createImageBitmap` → `<canvas>`
    oculto; el `<video>` se alimenta con `canvas.captureStream(25)` (reusa
    `VideoAvatar` sin cambios; `connected` se enciende en el primer frame, como
    el evento `start` de Simli). Frame **texto** `{"type":"speaking"|"silent"}`
    → `onSpeakingChange`.
  - `sink.sendPcm24k(b64)`: manda el PCM16 24k TAL CUAL por el WS y además lo
    **acumula** por locución.
  - `sink.endUtterance()` / `sink.interrupt()`: `ws.send(JSON {type})`. El
    interrupt además corta el `<audio>` y descarta el PCM acumulado (barge-in).
  - `sink.isActive()`: `ws.readyState === OPEN`.
  - **Audio**: el endpoint WS solo emite VIDEO. La voz de Gemini se reproduce en
    LOCAL: al llegar `{"type":"speaking"}` se arma un WAV con el PCM24k acumulado
    y se suena por el `<audio>` (queda ~sincronizado con el arranque del video,
    ambos disparados por "speaking"). Evita el doble audio: en modo sink el
    player PCM local de `useGeminiLive` no suena.
- **`src/utils/pcm.ts`**: helpers nuevos `concatInt16()` y
  `pcm16ToWavBlob(pcm, sampleRate)` (RIFF/WAV mono LE) para el audio local.
- **`src/pages/Diagnostico.tsx`**: se instancia también `useOssAvatarWs`
  (reglas de hooks) y se elige la variante OSS activa por `getAvatarTransport()`
  (`ws` → `ossWs`, si no `oss`). El sink activo va a `useGeminiLive`; render con
  `VideoAvatar` sin cambios. `disconnect` de los tres avatares en el cleanup.
- **`.env`** (gitignored): `VITE_AVATAR_PROVIDER=oss` + `VITE_AVATAR_TRANSPORT=ws`.
  (WS es un TRANSPORTE del provider `oss`, no un provider — `provider=ws` sería
  inválido y caería a Simli.)

## Verificación
- `npm run build` (tsc + vite) → **limpio**.
- Vite levanta con el nuevo flag; provider=oss + transport=ws → monta `useOssAvatarWs`.
- Contrato WebRTC §1 y path Simli **sin tocar** (aditivo, tras el flag).

## Pendiente (E2E contra RunPod — AvatarAI)
- URL del servicio RunPod en `AVATAR_SERVICE_URL` (backend) y confirmar que
  expone `POST /session` (contrato) + `WS /ws/demo` (frames JPEG binarios +
  control speaking/silent en texto).
- Ajuste fino: fps/tamaño de frame JPEG, y timing del "speaking" respecto al PCM
  acumulado (si el servicio hace lip-sync en streaming, quizá reproducir en
  `end_utterance` en vez de en "speaking").
