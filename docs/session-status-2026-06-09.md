# Estado de la rama `feature/gemini-live-voice` — 2026-06-09

Documentación de **todo lo realizado** en esta rama: migración del loop de voz a
**Gemini Live API** (audio nativo) + **avatar fotorrealista Simli** (video WebRTC).
Plan original y comparativa de costo: `docs/plans/05_gemini_live_voice.md`.

> ⚠️ **Nada está commiteado todavía** — todo vive en el working tree (modificados +
> untracked). Ver §3 para el inventario y §8 para qué falta antes del piloto.

---

## 1. Resumen ejecutivo

Se reemplazó el pipeline de voz por turnos (STT Whisper + LLM gpt-oss + TTS
ElevenLabs, push-to-talk) por **Gemini Live** (una sola sesión bidireccional
speech-to-speech, audio nativo continuo con barge-in), bajo un flag de rollback.
El **análisis de fin de sesión sigue en Groq** (no se migró). Encima se integró el
avatar **Simli** (cara fotorrealista en video, lip-synced) como capa visual opcional.

| Fase | Estado |
|---|---|
| 1 — PoC Gemini Live (audio nativo, voces, personas) | ✅ validado |
| 2 — Proxy WebSocket en el backend | ✅ probado (script + UI) |
| 3 — Frontend streaming PCM + barge-in | ✅ funcionando |
| Re-tuning de prompt para voz (Sofia) | ✅ prompt conciso (~2k vs 26k) |
| Saludo proactivo + UX de espera | ✅ |
| Avatar Simli (video fotorrealista) | ✅ funcionando (fix livekit) |
| Reconexión para sesiones largas (~25 min) | ✅ resumption + compresión de contexto |
| Cierre por function-calling (reemplazo de `[CIERRE]`) | ✅ tool `finalizar_entrevista` |
| VAD responsivo + configurable por `.env` | ✅ HIGH/HIGH/500 default |
| Echo-gate local (anti-eco sin detección de hardware) | ✅ implementado (tunear en altavoz) |
| Evaluación de calidad del diagnóstico (tests de texto) | 🟡 parcial — ver §10 |

**Decisiones de producto tomadas:** audio 100% nativo de Gemini · proxy vía FastAPI ·
análisis se queda en Groq · voces aprobadas Sofia=`Kore`, Roberto=`Charon`,
Maria=`Aoede` · avatar Simli cara "Tina" para Sofia.

---

## 2. Arquitectura

### Loop de voz (modo `realtime_provider=gemini`)

```
Navegador
  ├─ mic: AudioWorklet 16kHz PCM16 ──┐
  │                                   │  WS /api/conversation/entrevistador
  │  audio del avatar (PCM24) ◀───────┤  (nuestro proxy)
  ▼                                   ▼
SimliAvatar (video)            FastAPI conversation.py (_run_gemini_conversation)
  ▲ video+voz lip-synced              │  google-genai live.connect()
  │  PCM24→16k (resampler)            ▼
  └────────── sink ◀────────── Gemini Live (gemini-2.5-flash-native-audio-latest)
                                       │  transcripts in/out → conversation_history
                                       ▼  end_session → análisis Groq (sin cambios)
```

- **Sin Simli:** el audio PCM24 del avatar suena por el reproductor local
  (`PCMStreamPlayer`) y mueve la boca del avatar 3D vía un `AnalyserNode`.
- **Con Simli (`VITE_SIMLI_AVATAR=1`):** el PCM se desvía a un *sink* que lo
  remuestrea 24→16 kHz y lo manda a Simli; la voz+video lip-synced salen por los
  `<video>`/`<audio>` de Simli. Si Simli falla, cae solo al 3D + player local.

### Token de Simli
El navegador **nunca** ve la `SIMLI_API_KEY`: pide un token efímero a
`POST /api/simli/session-token` (backend) y con él abre WebRTC directo contra Simli
(transporte **LiveKit**).

---

## 3. Inventario de archivos

### Nuevos (backend)
| Archivo | Rol |
|---|---|
| `app/services/gemini_live.py` | Servicio de sesión Gemini Live: voces por avatar, config (VAD, transcripción), `open_session`, `GeminiLiveSession` (send_text / send_audio_chunk / `events()` generator multi-turno / collect_turn), addendum de voz |
| `app/routers/simli.py` | `POST /api/simli/session-token` — emite token efímero de Simli (faceId "Tina" para entrevistador) |
| `scripts/test_gemini_live_smoke.py` | Smoke test Fase 1: conversación sintética de texto → audio nativo + transcripts, guarda WAV en `scripts/_out/` |
| `scripts/test_gemini_ws.py` | Test de integración del proxy WS (cliente WS sintético → audio + análisis) |
| `scripts/test_simli_token.py` | Test del endpoint de token de Simli |
| `scripts/test_diagnostico_texto.py` | Eval de calidad del diagnóstico en texto (Sofia=Gemini, candidato sintético, análisis Groq) |
| `scripts/test_diagnostico_escenarios.py` | Eval dirigida: 3 candidatos, cada uno con una brecha dominante (acepta `GEMINI_TEXT_MODEL` por env para esquivar la cuota por-modelo) |
| `scripts/test_diagnostico_replay.py` | Re-juega un transcript GUARDADO contra el análisis (Groq) — valida cambios al prompt de análisis SIN gastar cuota de Gemini |
| `scripts/probe_gemini_quota.py` | Sonda mínima: ¿hay cuota de Gemini hoy? (escribe a `logs/probe_gemini.txt`) |

### Nuevos (frontend)
| Archivo | Rol |
|---|---|
| `public/pcm-capture-worklet.js` | AudioWorklet: captura mic 16kHz → PCM16 por lotes de ~100ms |
| `src/utils/pcm.ts` | `int16BufferToBase64`/`base64ToInt16`, `PCMStreamPlayer` (cola Web Audio + barge-in + AnalyserNode para lip-sync), `Pcm24to16Resampler` (para Simli) |
| `src/hooks/useGeminiLive.ts` | Sesión Gemini en el cliente: WS + captura continua + playback PCM + barge-in + transcripts→store + `audioSink` (Simli) + `analyser` + `hasGreeted` + compuerta de saludo |
| `src/hooks/useSimliAvatar.ts` | Conexión Simli (token→WebRTC LiveKit), expone `sink`, `connect/disconnect`, `connected/failed`, refs de video/audio |
| `src/components/avatar/SimliAvatar.tsx` | Capa visual: `<video muted>` + `<audio>` que llena simli-client |
| `src/utils/simliFlag.ts` | Flag `getSimliFlag()` (`VITE_SIMLI_AVATAR` + override `?simli=1/0`) |

### Modificados
| Archivo | Cambio |
|---|---|
| `app/config.py` | settings `gemini_api_key`, `gemini_model_live`, `realtime_provider`, `simli_api_key`, `simli_max_session_seconds` |
| `app/main.py` | registra `simli.router` |
| `app/routers/conversation.py` | rama `_run_gemini_conversation` (proxy) bajo `realtime_provider`, `_finalize_and_analyze`, saludo proactivo; rama Groq intacta |
| `app/prompts/entrevistador.py` | `build_gemini_entrevistador_prompt()` (prompt conciso ~2k para voz) |
| `pyproject.toml` | `google-genai ^2.8`; `groq` subido `0.11→1.x` y `httpx→0.28.1` (ver §7) |
| `.env.example` (backend) | `GEMINI_API_KEY`, `SIMLI_API_KEY` |
| `src/pages/Diagnostico.tsx` | gate `IS_GEMINI`: sin VAD, useGeminiLive, useSimliAvatar, indicador de espera del saludo, mic-mute |
| `src/pages/Simulation.tsx` | gate `IS_GEMINI` (Roberto/Maria): captura continua, barge-in, `externalAnalyser` |
| `src/components/avatar/TalkingHeadAvatar.tsx` | prop `externalAnalyser` para lip-sync del 3D desde el player PCM |
| `.env.example` / `vite-env.d.ts` (frontend) | `VITE_REALTIME_PROVIDER`, `VITE_SIMLI_AVATAR` |
| `package.json` | dep `simli-client ^3.0.1` |

### Infra de prueba (nuevos, `docker/`)
Imagen única (FastAPI sirviendo el `dist/` del frontend) para probar Simli en
contenedor local en `:8001`, con Postgres del host vía `host.docker.internal:5433`.
`docker compose -f docker/docker-compose.yml up --build`.

---

## 4. Variables de entorno

**Backend** (`menteviva-backend/.env`):
```
REALTIME_PROVIDER=gemini          # "groq" para rollback al pipeline viejo
GEMINI_API_KEY=...                # aistudio.google.com (gratis; ver privacidad §8)
SIMLI_API_KEY=...                 # app.simli.com (factura por minuto)
# (GROQ_API_KEY/ELEVENLABS_API_KEY siguen necesarios: análisis y modo groq)
```
**Frontend** (`menteviva-frontend/.env`):
```
VITE_REALTIME_PROVIDER=gemini     # debe coincidir con el backend
VITE_SIMLI_AVATAR=1               # 1 = avatar video; vacío/0 = avatar 3D
```

---

## 5. Cómo correr en local

```bash
# 1. Postgres (contenedor)
docker compose -f docker-compose.dev.yml up -d         # menteviva-pg-dev :5433

# 2. Backend en modo gemini (puerto 8000 para que el proxy de Vite lo alcance)
cd menteviva-backend
REALTIME_PROVIDER=gemini MENTEVIVA_PORT=8000 MENTEVIVA_RELOAD=false poetry run python -m app

# 3. Frontend
cd menteviva-frontend
npm run dev            # :5173 (el proxy de Vite apunta a 127.0.0.1:8000)
```
Abrir http://localhost:5173 → flujo de diagnóstico (Sofia). **Usar audífonos**
(sin ellos el mic capta al avatar → falso barge-in que la corta).
Toggle del avatar video sin reiniciar: `?simli=1` / `?simli=0`.

---

## 6. Cómo probar (scripts)

```bash
cd menteviva-backend
poetry run python -m scripts.test_gemini_live_smoke            # Sofia, audio nativo → WAV
poetry run python -m scripts.test_gemini_live_smoke roberto    # otra voz
# Proxy WS (requiere backend en gemini levantado):
poetry run python -m scripts.test_gemini_ws roberto 8000
# Regresión del pipeline Groq (tras subir groq a 1.x):
PYTHONUTF8=1 poetry run python -m scripts.test_repetition
PYTHONUTF8=1 poetry run python -m scripts.test_roberto_condor
```
Para depurar Simli en aislamiento se usó una página temporal `/__simli-test`
(ya removida) manejada con un navegador headless.

---

## 7. Fixes y decisiones clave (el "por qué")

1. **Cadena de deps:** `google-genai 2.x` (transcripción) exige `httpx≥0.28.1`, que
   rompe `groq 0.11` (kwarg `proxies`). Solución: subir `groq→1.x`. Pipeline Groq
   re-validado (`test_repetition` limpio 0/7).
2. **Modelo Live:** `gemini-2.0-flash-live-001` NO existe en esta cuenta. Default
   correcto: `gemini-2.5-flash-native-audio-latest` (verificado con `models.list`).
3. **`receive()` por turno:** el SDK cede UN turno y termina → `events()` lo envuelve
   en `while True` re-llamando `receive()` (si no, el downstream moría tras el turno 1).
4. **Prompt acartonado/eco:** el maestro de 26k (afinado para texto) hace que Gemini
   repita lo que dice el usuario ("acuse de recibo obligatorio") → prompt conciso de ~2k.
5. **Sofia no iniciaba:** al stremear mic de inmediato, Gemini cree que el usuario
   tiene el turno → compuerta que retiene el audio hasta el 1er `turn_complete`, +
   indicador "Sofia te va a saludar" en la UI (no "te escucho").
6. **VAD / cortes:** `RealtimeInputConfig` con `START_SENSITIVITY_LOW` + 800ms de
   silencio reduce el falso barge-in por eco. **Audífonos siguen siendo necesarios.**
7. **Lip-sync del 3D en gemini:** el audio va por Web Audio (no por el `<audio>`),
   así que `TalkingHeadAvatar` recibe el `AnalyserNode` del player vía `externalAnalyser`.
8. **🔑 Simli "Conectando…" eterno:** `new SimliClient(...,null,...)` revienta con
   *"Ice Servers Required for P2P Mode"* porque el default compilado de `transport_mode`
   es `"p2p"` (exige iceServers). FIX: pasar `"livekit"` (6º arg) → sin ICE. Además el
   `<video>` debe ir `muted` (autoplay; la voz va por el `<audio>` aparte).

---

## 8. Gaps conocidos / TODO antes del piloto

- **Privacidad:** el free tier de Gemini **entrena con los datos**. Para usuarios reales
  → activar billing (paid). Lo mismo aplica a la calidad/cuota.
- **Sesiones largas (✅ implementado):** `context_window_compression` (sliding window) +
  `session_resumption` + bucle de reconexión en el proxy (al recibir `go_away` reabre la
  sesión Gemini con el handle, **transparente** para el navegador — solo un micro-hueco de
  audio). El reader del cliente persiste a través de reconexiones. *Pendiente de validar en
  una sesión real >15 min (el go_away solo dispara cerca del límite).*
- **Cierre (✅ implementado):** tool `finalizar_entrevista` declarada para el diagnóstico;
  el `tool_call` se mapea a `closing_intent` (frontend ya tiene el countdown). Reemplaza el
  marcador `[CIERRE]` (que en voz se pronunciaría). *Pendiente de ver al modelo llamarla en
  una entrevista completa.*
- **Calidad de transcripción:** el input_transcription se fragmenta con audio pobre;
  afecta el análisis de Groq. Mitiga con audífonos y hablar claro.
- **Costo Simli:** factura por minuto (free tier ~$10 + 50 min/mes). El avatar 3D es el
  fallback gratis.
- **Carlos:** no existe en `AVATARS` (su voz `Fenrir` y face quedan tentativas).
- **Robustez:** el throw del constructor de Simli quedaba fuera del try que setea
  `failed` (ya no truena con livekit, pero conviene blindarlo para caer al 3D ante
  cualquier fallo futuro).

---

## 9. Costo (resumen; detalle en `docs/plans/05_gemini_live_voice.md` §9b)

Gemini Live ≈ **5–8x más barato** por sesión que el pipeline de pago (Groq+ElevenLabs),
porque elimina ElevenLabs (la voz nativa de Gemini cuesta ~12x menos por minuto). Groq
es casi gratis a este volumen. Simli añade costo por minuto de video (opcional, apagable).

---

## 10. Avances 2026-06-09 (tarde): audio fino + calidad del diagnóstico

### 10.1 Afinado de audio
- **VAD configurable por `.env`** (`config.py`: `gemini_vad_start_sensitivity` / `end` /
  `silence_ms`). Tradeoff: `start HIGH` capta tu voz y responde rápido pero el eco puede
  cortar (audífonos); `start LOW` resiste el eco pero "se queda callada esperando".
  Default responsivo **HIGH/HIGH/500** (antes LOW/LOW/800 dejaba a Sofia muy paciente).
- **Echo-gate local** (`useGeminiLive.ts` + `pcm.ts::pcm16Rms`): mientras el avatar habla,
  gatea el mic por energía contra un "piso de eco" adaptativo — filtra el eco y conserva el
  barge-in real, **sin detectar hardware**. Con audífonos el piso queda ~0 (no estorba); en
  altavoz filtra. Razón: detectar "¿hay audífonos?" en el browser es poco fiable. *Constantes
  empíricas — tunear probando en altavoz.*

### 10.2 Evaluación de calidad del diagnóstico (tests de PURO TEXTO)
Scripts nuevos (Sofia = **Gemini texto** `gemini-2.5-flash` + prompt conciso real; candidato
sintético = Groq; análisis = Groq — sin tocar Live ni Simli):
- `scripts/test_diagnostico_texto.py` — un candidato con brechas conocidas, conversación + diagnóstico.
- `scripts/test_diagnostico_escenarios.py` — 3 candidatos, cada uno con UNA brecha dominante.

**Hallazgos:**
- ✅ **La entrevista (Gemini + prompt conciso) conduce BEI muy bien**: inicia sola, drilla
  *"¿qué hiciste TÚ?"* ante el "nosotros", pivota al agotar la historia, sin eco.
- ✅ **El análisis caza la externalización** (we/I "alta" + gap liderazgo + blind_spot +
  micro-práctica) y **no alucina** brechas sin evidencia.
- 🔧 **Fix aplicado:** el prompt conciso drillaba la *acción* (A de STAR) pero se saltó el
  *resultado/métrica* (R) → no cazaba candidatos "sin métricas". Se añadió el probe
  *"persigue el resultado: ¿cuánto?, ¿qué cambió?, ¿cómo lo mediste?"* en
  `build_gemini_entrevistador_prompt`.
- 🟡 **Pendiente:** validar las brechas "evita conflicto" y "salta a la solución", y
  re-correr "sin métricas" con el fix. **Bloqueado por cuota de Gemini free-tier agotada**
  (`429 RESOURCE_EXHAUSTED`) tras los tests del día → esperar reset diario o activar billing.

### 10.3 Pendientes vivos
- Re-correr `test_diagnostico_escenarios.py` cuando haya cuota (valida el fix de métricas + las
  2 brechas que faltaron).
- Validar reconexión (>15 min) y el tool de cierre en una sesión real.
- Activar billing de Gemini para el piloto (cuota + privacidad).

---

## 11. Auditoría 2026-06-09 (noche): texto, imagen, audio/voz y fidelidad de la evaluación

Se auditaron las 4 áreas pedidas por producto. **Hallazgos completos y plan priorizado en
[`docs/plans/06_mejoras_voz_video_eval.md`](plans/06_mejoras_voz_video_eval.md).** Resumen:

- 🔴 **Evaluación (E1/E2):** el análisis trunca la conversación a 8k chars (una entrevista de
  25 min son ~15-20k → se pierde la mitad central) y la regla "prohibido evidencia de
  ausencia" + `_drop_absence_gaps` chocan con las brechas de la §10 que SON ausencias
  ("procesos sin métrica") → explica el `gaps: []` del escenario `sin_metricas`.
- 🔴 **Toma de texto (T1/T2):** el último turno del usuario se PIERDE si presiona Terminar
  antes de la respuesta de Sofia (buffers locales del downstream se descartan), y el
  `user_message` aparece en el chat después de la respuesta de Sofia.
- 🟡 **Imagen Simli (V1):** video 512×512 con `object-cover` en panel ~2x → upscaling + crop
  (la "borrosidad"). Fix: `object-contain` con aspecto nativo + fondo blur.
- 🟡 **Audio (C1/C2):** resampler 24k→16k sin anti-alias (voz áspera en Simli) y caption de
  Sofia adelantado a su voz (se materializa al fin de generación, no de reproducción).
- ✓ Lo alineado: `SOFT_SKILLS_CATALOG` = §10 fiel; reglas 11.2 reforzadas en el prompt.

Orden de ejecución: Fase 1 (evaluación, solo backend, verificable con los scripts de texto en
cuanto haya cuota) → Fase 2 (no perder texto) → Fase 3 (video nítido + anti-alias + caption).

**Estado (misma noche): las 4 fases del plan 06 IMPLEMENTADAS** (solo E4a "resumen
ejecutivo" queda como decisión de producto). Verificación que falta:
1. Sesión de voz manual (texto a tiempo, video nítido, voz menos áspera, último turno
   entra al análisis, barge-in con pre-roll).
2. `GEMINI_TEXT_MODEL=gemini-2.0-flash poetry run python -m scripts.test_diagnostico_escenarios`
   tras el reset de cuota (valida fix de métricas + E3 + las 2 brechas pendientes).
   El fix del análisis ya quedó verificado sin Gemini con `scripts/test_diagnostico_replay.py`
   (pre-fix `gaps: []` → post-fix caza `orientacion_resultados` con cita).
