# Auditoría de audio de la videollamada — 2026-09-23

Solo lectura, sin cambios en el código. Cubre captura, limpieza, transporte, STT, reproducción y robustez.
**[V]** = verificado en el código · **[S]** = sospecha que hay que probar en un navegador o dispositivo real.
Claude re-verificó A1 y M4 a mano.

Contexto: el `.env` local usa `REALTIME_PROVIDER=gemini`, `VITE_AVATAR_PROVIDER=oss` y `VITE_AVATAR_TRANSPORT=ws`,
así que en local corre `useOssAvatarWs`.

## Alta

| # | Hallazgo | Dónde | Impacto | Arreglo mínimo |
|---|---|---|---|---|
| A1 [V] | **Whisper y el LLM de Groq bloquean el event loop.** El cliente `Groq` es síncrono y se llama desde funciones `async`; `chat_stream` itera el stream con un `for` síncrono. | `groq_whisper.py:31`, `groq_llm.py:117,142`, `groq_pool.py:10` | Con 2 o más usuarios, el STT o el LLM de uno congela todos los WS del proceso (incluido el relay de audio de Gemini). El `wait_for` de timeout (`conversation_session.py:914`) no puede cortar la llamada. | `await asyncio.to_thread(...)` en Whisper; para el stream, el patrón `run_in_executor(_next_chunk)` que ya existe en `edge_tts.py:322-333`. |
| A2 [V] | **Sin filtro de alucinaciones de Whisper ni detección de silencio.** Solo se descarta el texto vacío. | `groq_whisper.py:31-36`, `conversation_session.py:929`; mínimo de 500 ms en `useAudioRecorder.ts:8` | "Gracias por ver el video" o "Subtítulos por la comunidad de Amara.org" entran como turno: el avatar responde y el análisis se ensucia. | `response_format="verbose_json"`: descartar si `no_speech_prob > 0.6` o `avg_logprob < -1`, más una lista negra con regex. |
| A3 [V] | **Diagnóstico (Groq): se corta al usuario a media frase.** `redemptionMs: 600` y el VAD pausado mientras el estado no es `ready`. | `Diagnostico.tsx:246,256` | Una pausa para pensar de más de 600 ms envía el turno; lo que se dice después se pierde y Sofía contesta a medias. | `redemptionMs` a 1200-1500; pausar el VAD solo mientras suena el audio (`isPlaying \|\| generating_audio`). |
| A4 [V lógica] | **`useOssAvatarWs`: el final de las respuestas largas no se reproduce a tiempo.** `playUtterance()` suelta solo el PCM acumulado al llegar el primer frame; lo que llega después espera al siguiente `speaking`. | `useOssAvatarWs.ts:158-163,185-192` | El final de la respuesta queda en silencio y luego se antepone al siguiente turno o se descarta con barge-in. | Encadenar con `audio.onended → playUtterance()`, o reproducir en `silent`/`endUtterance` sin exigir `armed`. Falta confirmar cuándo emite el servicio `speaking`/`silent`. |

## Media

| # | Hallazgo | Dónde | Arreglo |
|---|---|---|---|
| M1 [V] | Push-to-talk (Groq) no tiene barge-in: `ready` llega con `assistant_audio_end` y `startTalking` no detiene el audio del avatar. Las voces se enciman y el avatar queda grabado si falla la cancelación de eco. | `conversation_turn.py:148-155`, `Simulation.tsx:235-256` | `stopAudio()` al inicio de `startTalking`. |
| M2 [V] | Whisper tiene `language="es"` fijo, pero el setup del diagnóstico ofrece "English". | `groq_whisper.py:34`, `DiagnosticoSetup.tsx:15` | Pasar `idioma[:2]` desde `session_vars`. |
| M3 [V/S] | Safari graba `audio/mp4`, pero se envía siempre como `audio.webm`. | `useWebSocket.ts:266`, `Simulation.tsx:267` | Que el grabador devuelva el mimeType y enviar la extensión correcta. |
| M4 [V] | El VAD de Gemini queda en HIGH/HIGH/500 ms por defecto, pero la memoria registra LOW/800 ms como mitigación de eco. El `.env` no lo sobreescribe. | `config.py:95-97` | Decidir el default y fijarlo en el `.env` de producción. |
| M5 [V] | Gemini no maneja la desconexión del micrófono (sin `track.onended` ni `devicechange`): la UI sigue "en vivo" pero sorda. | `useGeminiLive.ts:358-436`, `useVoiceLab.ts:310-371` | `track.onended → stopMic(); startMic()` y un aviso en la UI. |
| M6 [V] | Reconexión: Gemini no reconecta; Groq reintenta, pero arranca con historial vacío (Sofía vuelve a saludar y el análisis cubre solo lo posterior al corte). | `useGeminiLive.ts:340-349`, `useWebSocket.ts:234-244`, `conversation_session.py:843` | No reconectar sin avisar: error + "Terminar", o reenviar el historial en `init`. |
| M7 [S] | iOS: el `AudioContext` del player PCM se crea fuera del gesto del usuario; `unlockAudio` desbloquea otro contexto. | `useGeminiLive.ts:218-224`, `useAudioPlayer.ts:227-265`, `TalkingHeadAvatar.tsx:47-50` | Crear o `resume()` el player dentro del click de "Iniciar", y `resume()` en `visibilitychange`. Probar en un iPhone. |
| M8 [V] | `useSoundEffects` crea un `AudioContext` por tono y nunca lo cierra (~6 por turno). iOS tiene un límite bajo de contextos. | `useSoundEffects.ts:12` | Un solo contexto compartido, perezoso. |
| M9 [S] | Firefox: `AudioContext({sampleRate:16000})` con un mic a 48 kHz puede lanzar `NotSupportedError`. Además, cualquier error se muestra como "revisa permisos". | `useGeminiLive.ts:374`, `useVoiceLab.ts:324`, `Simulation.tsx:133`, `Diagnostico.tsx:285` | Contexto a la tasa nativa y bajar a 16 kHz en el worklet; reusar `micErrorMessage`. |

## Baja

- **B1** Sonda de permiso con `{audio:true}` (`Diagnostico.tsx:344`, `VoiceLab.tsx:756`): el mic se abre dos veces, y en Bluetooth provoca un cambio extra a HFP.
- **B2** Limpieza de entrada: cancelación de eco, supresión de ruido y ganancia automática consistentes en todas las capturas reales. Solo vad-web usa `channelCount: 1`: agregarlo en las demás. No hay RNNoise, pasa-altos ni noise gate (salvo el echo-gate): **no hace falta todavía**.
- **B3** El TTS de Groq espera el MP3 completo (decisión por Safari) con `eleven_multilingual_v2`, el modelo más lento. Considerar `eleven_flash_v2_5`.
- **B4** `PCMStreamPlayer`: colchón inicial de 20 ms (quedan huecos por jitter) y `flush()` sin fade (clic). Subir a 80-150 ms y agregar un fade corto.
- **B5** Fugas menores de `AudioContext`: `useAudioRecorder.ts:81-87`, `useAudioPlayer.ts:236`, `useVoiceLab.ts:172`.
- **B6** El worklet hace `push` a un array JS en el hilo de audio (`pcm-capture-worklet.js:31`). Preasignar un `Int16Array`.
- **B7** El mute de Gemini no avisa fin de stream: el VAD del servidor se queda esperando.
- **B8** Código muerto: `VoiceButton`/`VoiceRecorder`, que registran `touch` y `mouse` a la vez.

## Lo que ya está bien

Constraints consistentes; mic pre-calentado (no se recortan las primeras palabras); grabación de 500 ms a 120 s con autoenvío;
mensajes de permiso claros en push-to-talk; límite de base64 en el backend; echo-gate con pre-roll y hold-over; saludo
con compuerta; remuestreo 24k→16k para Simli con anti-alias; barge-in en Simli (`ClearBuffer`) y en el player PCM (`flush`); `createObjectURL`
revocados; TTS en un executor; texto retenido hasta el audio (intencional).
