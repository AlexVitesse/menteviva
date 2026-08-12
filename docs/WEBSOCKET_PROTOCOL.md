# Contrato WebSocket y matriz de acceso

## Conversación de producción

`GET ws(s)://<host>/api/conversation/{avatar_id}?ticket=<ticket>` requiere un
ticket opaco obtenido con `POST /api/auth/ws-ticket`. El ticket dura 45 segundos
por defecto, se consume de forma atómica una sola vez y representa el UID
Firebase; ningún campo de identidad enviado por el cliente es autoritativo.

### Cliente → servidor

| `type` | Campos | Límites |
|---|---|---|
| `init` | `session_vars?`, `level?` | campos extra prohibidos; `user_profile` se rechaza |
| `audio` | `audio`, `format` | base64 estricto; tamaño y MIME configurables |
| `audio_chunk` | `pcm` | base64 estricto; tamaño configurable; solo Gemini Live |
| `text` | `text` | no vacío; longitud configurable |
| `end_session` | ninguno | campos extra prohibidos |

Los modelos discriminados viven en `app/models/ws_protocol.py`. Tipo desconocido,
campo extra o forma inválida produce un evento `error` estable. Un payload que
excede el límite cierra con `1009`.

### Servidor → cliente

La unión TypeScript y su validador runtime viven en
`menteviva-frontend/src/types/wsProtocol.ts`.

| `type` | Campos principales |
|---|---|
| `status` | `status` |
| `user_message` | `content` |
| `assistant_token` | `content` |
| `assistant_audio_start` | `content?` |
| `assistant_audio_chunk` | `audio` |
| `assistant_audio_end` | — |
| `output_transcript` | `content` |
| `turn_complete`, `interrupted`, `closing_intent` | — |
| `session_end` | `metrics?`, `vocal_note?` |
| `error` | `code?`, `message?`, `error?` |

### Códigos de cierre

| Código | Semántica | Reconexión automática |
|---|---|---|
| `1000` | cierre normal/fin solicitado | no |
| `1008` | autenticación, cuota o política | no |
| `1009` | payload excesivo o inválido | no |
| `1011` | fallo interno transitorio | máximo dos intentos con backoff |
| `1006` | corte anormal observado por cliente | máximo dos intentos con backoff |

## Matriz de acceso REST/WS

| Recurso/endpoints | Acceso | Propiedad/autorización |
|---|---|---|
| `/health`, `/api/avatars*` | público | sin datos personales |
| `/api/me*`, `/api/session/{id}`, `/api/diagnostic/{id}` | Firebase | UID en la misma consulta SQL |
| `/api/user/{uid}*` legacy | Firebase | el path debe coincidir con el UID; responde 404 si no |
| `/api/auth/register`, `/api/auth/sync`, `/api/auth/ws-ticket` | Firebase | UID exclusivo del token |
| `/api/simli/session-token`, `/api/avatar/session` | Firebase | operación con costo atribuida al UID |
| `/api/conversation/{avatar}` | ticket WS | UID consumido server-side |
| `/api/chat*`, `/api/chat/voice/{avatar}` | operador | allowlist Firebase; token compartido solo durante migración |
| SPA y assets | público | sin escritura |

## Inventario de consumidores legacy

La búsqueda de consumidores frontend confirmó que la aplicación usa `/api/me`
y `/api/me/sessions`; no quedan llamadas de producto a `/api/user/{uid}*`. Las
rutas legacy se conservan únicamente para una ventana de compatibilidad y
validan igualdad estricta con el UID autenticado.

## Límites operativos iniciales

Los defaults configurables son: texto 8.000 caracteres, audio por turno 10 MiB,
chunk PCM 128 KiB, 100 turnos, 60 minutos, una conversación concurrente por UID,
20 inicios por hora, STT 45 s, LLM/TTS 60 s y análisis 120 s. Antes de aumentar
estos valores se deben contrastar los contadores y latencias de staging.
