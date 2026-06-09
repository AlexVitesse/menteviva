# 05 — Migrar el loop de voz a Gemini Live API

**Estado:** Fase 1 (PoC) ✅ validada en local — Fases 2/3 pendientes
**Fecha:** 2026-06-04 (PoC validado 2026-06-05)
**Decisiones tomadas (dueño de producto):**
1. **Audio 100% nativo de Gemini** — voces prebuilt de Google, máxima reducción de latencia, barge-in/interrupciones reales. Se acepta perder las voces ElevenLabs de marca.
2. **Proxy vía FastAPI** — browser ↔ nuestro WebSocket ↔ Gemini Live. API key server-side.
3. **Análisis se queda en Groq** — Gemini Live solo reemplaza el loop en tiempo real (STT+LLM+TTS). El análisis/diagnóstico de fin de sesión sigue en `analysis.py` sobre el transcript.

### Resultados del PoC (Fase 1) — `scripts/test_gemini_live_smoke.py`
- **Funciona en local:** sesión Live abierta, audio nativo PCM24 generado, transcripts (in/out) recibidos. WAVs en `scripts/_out/`.
- **Modelo:** `gemini-2.5-flash-native-audio-latest` (el id `gemini-2.0-flash-live-001` NO existe para esta cuenta; verificado con `client.models.list` → bidiGenerateContent).
- **Las personas se sostienen sin re-tuning:** Sofia (BEI), Roberto (comprador B2B seco) y Maria (negociadora) respondieron en personaje usando el `system_prompt` actual como `system_instruction`.
- **Voces aprobadas por escucha:** Sofia=`Kore`, Roberto=`Charon`, Maria=`Aoede`. (Carlos no existe en `AVATARS`; `Fenrir` queda tentativo.)
- **Gotcha de deps resuelto:** google-genai 2.x → httpx≥0.28.1 → groq subido 0.11→1.x. Pipeline Groq verificado intacto. Ver memoria `gemini-live-dep-chain`.

---

## 1. Qué reemplaza Gemini Live y qué NO

| Pieza actual | Archivo | ¿Reemplaza Gemini Live? |
|---|---|---|
| STT (Whisper) | `services/groq_whisper.py` | **Sí** — input de audio nativo |
| LLM streaming | `services/groq_llm.py` | **Sí** — razonamiento + generación |
| TTS (ElevenLabs) | `services/edge_tts.py` | **Sí** — audio nativo de salida |
| Análisis fin de sesión | `services/analysis.py` | **No** — sigue en Groq llama-3.3-70b |
| Diagnóstico (`generate_user_profile`) | `services/analysis.py` | **No** — sigue en Groq |
| Personas / system prompts | `prompts/scenarios.py`, `entrevistador*.md`, `roberto.py` | **Reutilizables** como `system_instruction`, pero requieren re-tuning (ver §6) |
| Persistencia (sesiones, diagnóstico, upsert user) | `services/*_repo.py` | **No** — intacto |

**Consecuencia clave:** seguimos necesitando el **transcript en texto** (input y output) para alimentar el análisis de Groq, las captions del frontend y la detección de cierre. Gemini Live lo entrega activando `input_audio_transcription` y `output_audio_transcription` en el setup de la sesión.

## 2. Arquitectura objetivo (proxy)

```
Browser (PCM 16kHz in / PCM 24kHz out)
   │  WS  /api/conversation/{avatar_id}   (nuestro protocolo, adaptado)
   ▼
FastAPI conversation.py
   │  WS  google-genai live.connect()      (API key server-side)
   ▼
Gemini Live  (gemini-2.5-flash native audio / 2.0-flash-live)
```

El proxy mantiene **dos WebSockets vivos en paralelo** por sesión y hace forwarding bidireccional:
- **upstream** (browser→Gemini): chunks PCM del mic conforme llegan.
- **downstream** (Gemini→browser): chunks PCM de audio + eventos de transcripción + señales de turno/interrupción.

Esto preserva: auth, inyección de `system_instruction`, captura de transcript para análisis, y la superficie de nuestro protocolo WS (con cambios, §4).

## 3. Backend — cambios

### 3.1 Dependencias y config
- Añadir `google-genai` a `pyproject.toml` (SDK oficial con soporte Live).
- `config.py`: nuevas settings
  - `gemini_api_key: str = ""`
  - `gemini_model_live: str = "gemini-2.5-flash-preview-native-audio-dialog"` (o el id vigente al implementar — **verificar en consola**, los ids de Live cambian seguido).
  - `realtime_provider: str = "gemini"` — flag para poder volver al pipeline Groq/ElevenLabs sin borrar código (rollback barato durante el piloto).
- `.env.example`: documentar `GEMINI_API_KEY`.

### 3.2 Nuevo servicio `services/gemini_live.py`
Encapsula la sesión Live para no ensuciar el router:
- `open_live_session(avatar_id, system_prompt, voice_name)` → context manager sobre `client.aio.live.connect(...)` con:
  - `system_instruction` = el prompt ensamblado por `get_system_prompt(...)` (igual que hoy).
  - `response_modalities=["AUDIO"]`.
  - `speech_config` con la voz prebuilt mapeada por avatar.
  - `input_audio_transcription={}` y `output_audio_transcription={}` activados.
  - Opcional: `tools=[closing_tool]` para el cierre (§6, reemplaza `[CIERRE]`).
- Helpers `send_audio_chunk(pcm_bytes)` y un async-generator `receive()` que normaliza los eventos de Gemini (audio data, transcript parcial/final input, transcript output, `turn_complete`, `interrupted`) a nuestro protocolo.
- Mapa `GEMINI_VOICES = {"roberto": "...", "maria": "...", "carlos": "...", "entrevistador": "..."}` (análogo a `AVATAR_VOICES` de ElevenLabs; elegir 4 voces distintas del set de Google, respetando género).

### 3.3 `routers/conversation.py` — bifurcación por provider
- Si `settings.realtime_provider == "gemini"`: rama nueva que NO espera mensajes `{type:"audio"}` con un blob por turno, sino chunks continuos `{type:"audio_chunk", pcm:<base64>}`. Lanza dos tareas asyncio (`upstream`, `downstream`) con un `TaskGroup`/`gather`.
- Mantener intacta la rama actual (Groq/ElevenLabs) bajo el flag para rollback.
- **Reusar tal cual:** `get_system_prompt`, `_send_sofia_greeting` (decisión de greeting en §6), `end_session` → `analyze_conversation`/`generate_user_profile`, persistencia. El `conversation_history` se va llenando desde los **transcripts** que emite Gemini (input final = turno usuario, output final = turno asistente), no desde Whisper/LLM locales.
- `end_session`: cerrar la sesión Live y correr el análisis Groq con el `conversation_history` reconstruido — **sin cambios** en `analysis.py`.

## 4. Protocolo WS — cambios

| Hoy | Con Gemini Live |
|---|---|
| Cliente: `{type:"audio", audio:<webm base64>}` (1 blob/turno) | Cliente: `{type:"audio_chunk", pcm:<base64 PCM16 16kHz>}` (streaming continuo) |
| Server: `assistant_token` (texto) | Server: `output_transcript` (texto parcial/final para caption) |
| Server: `assistant_audio_chunk` (MP3) | Server: `assistant_audio_chunk` (PCM24 base64) — **mismo nombre, otro formato** |
| `status: transcribing/thinking/generating_audio` | Mayormente desaparecen (es continuo); queda `ready`/`analyzing`. Añadir `user_speaking`/`assistant_speaking` si el UI los quiere. |
| `[CIERRE]` en texto | `closing_intent` vía **function call** de Gemini |
| (no existe) | `interrupted` — Gemini avisa barge-in; el cliente debe **cortar el playback** inmediatamente |

`end_session` y `session_end` quedan **iguales**.

## 5. Frontend — cambios (el grueso del trabajo)

El modelo push-to-talk con `MediaRecorder`→webm→base64 (un blob por turno) **no sirve** para Live; hay que pasar a streaming continuo de PCM.

- **Captura:** reemplazar `useAudioRecorder` por un `AudioWorklet` (o `ScriptProcessor` como fallback) que:
  - Capture a 16 kHz mono, convierta Float32 → PCM16, y emita chunks (~50–250 ms) por el WS de forma continua mientras el mic esté activo.
  - Mantener `echoCancellation/noiseSuppression/autoGainControl` (ya están).
- **Reproducción:** reemplazar `useAudioPlayer` (que reproduce un blob MP3) por un reproductor de cola PCM con Web Audio API:
  - Decodificar PCM24 → AudioBuffer y encolar para playback gapless.
  - En evento `interrupted`: **vaciar la cola y parar** (barge-in). Esto es nuevo y es lo que hace que la conversación se sienta natural.
- **`useWebSocket.ts`:**
  - Quitar la lógica de "no mostrar texto hasta `assistant_audio_*`" (`pendingTextRef`/`pendingAssistantTextRef`): con streaming continuo la caption se actualiza desde `output_transcript`. El comentario de CLAUDE.md sobre no romper esa sincronía aplica al pipeline viejo; aquí cambia el contrato.
  - Manejar `output_transcript`, `interrupted`, `closing_intent`.
- Los controles **mic-mute/pausa** (commit `750c494`) deben traducirse a "dejar de enviar chunks" en vez de parar un `MediaRecorder`.

## 6. Comportamiento que hay que recrear (no romper UX)

1. **Una sola pregunta por turno / no romper personaje** — vive en los system prompts (reusables), pero gpt-oss-20b y Gemini obedecen distinto. **Re-validar con scripts** (§8). Las penalizaciones anti-repetición (`frequency/presence_penalty`, temp 0.6) eran específicas de gpt-oss; Gemini Live no las expone igual — el control de repetición pasa a ser de prompt.
2. **Cierre `[CIERRE]`** → migrar a **function calling**: declarar una tool `finalizar_entrevista()` que el modelo invoca; el server la mapea a `closing_intent`. Más robusto que un marcador de texto que el modelo nativo podría **pronunciar en voz alta**.
3. **Saludo de Sofia (`_send_sofia_greeting`)** — hoy es un MP3 cacheado (costo cero). Opciones:
   - (a) Seguir reproduciendo el MP3 cacheado al inicio y *luego* abrir el turno de Gemini (mantiene costo/consistencia del saludo).
   - (b) Dejar que Gemini salude con un trigger inicial (más natural, pero variable y con costo).
   Recomendado para piloto: **(a)**.
4. **Fallbacks anti-mudez / re-enganche** (`_REENGAGE_FALLBACKS`) y el manejo de respuesta vacía/tool-glitch de gpt-oss **dejan de aplicar** (eran patológicos de gpt-oss-20b en Groq). Gemini Live tiene su propio manejo de turnos.

## 7. Riesgos y cosas a vigilar

- **Identidad de voz:** se pierden las voces ElevenLabs. Validar con el equipo (Sophia M. / Brandon) que las voces prebuilt de Google son aceptables para el piloto.
- **Costo:** Gemini Live se cobra por tokens de audio in/out (más caro que texto). Estimar costo por sesión de ~5 min y validar contra el presupuesto del piloto. Groq era free-tier; esto NO lo es.
- **Límites de sesión:** la Live API tiene tope de duración de conexión y de ventana de contexto; para sesiones largas hay que manejar reconexión/compresión de contexto. Las sesiones de práctica son cortas (minutos), debería caber, pero **verificar el límite vigente**.
- **Concurrencia:** límite de sesiones Live concurrentes por proyecto — relevante si el piloto mete varios usuarios a la vez. El round-robin de keys de Groq NO aplica; ver si Gemini necesita su propio pooling.
- **Deploy real:** el server del piloto (Debian, `space-user2`, sin sudo/systemd, nohup uvicorn :8100 + cloudflared) debe poder abrir WS salientes a Google. Verificar egress/firewall. Sumar `GEMINI_API_KEY` al `.env` de prod.
- **Latencia de red al proxy:** el doble salto (browser→FastAPI→Google) añade RTT vs conexión directa. Aceptable, pero medir.

## 8. Validación (convención del repo: scripts, no clics)

Seguir la convención de `scripts/test_*.py` que llaman al service con conversación sintética:
- `scripts/test_gemini_live_smoke.py` — abre una sesión Live, envía un WAV/PCM pregrabado de prueba, verifica que llegan audio + transcripts + `turn_complete`.
- Adaptar `scripts/test_repetition.py` para correr contra la rama Gemini (Jaccard turno-a-turno con la persona de Sofia).
- `scripts/test_roberto_condor.py` — re-correr los 3 casos calibrados contra Gemini para confirmar que la persona/objeciones se sostienen.
- Confirmar que el `conversation_history` reconstruido desde transcripts produce un análisis Groq válido (correr `analyze_conversation` con un transcript de Gemile y revisar el JSON del rubric).

## 9. Plan de implementación por fases

1. **Spike/PoC** (riesgo): `gemini_live.py` + `test_gemini_live_smoke.py`. Confirmar audio nativo + transcripts + function calling de cierre con una persona. Validar voces y latencia.
2. **Backend proxy**: rama Gemini en `conversation.py` bajo `realtime_provider`, reconstrucción de `conversation_history`, enganche con `end_session`/análisis (sin tocar Groq).
3. **Frontend streaming**: AudioWorklet (captura PCM) + reproductor PCM con cola + barge-in; adaptar `useWebSocket`, mic-mute/pausa.
4. **Paridad UX**: greeting cacheado, cierre por tool, captions desde transcript.
5. **Validación**: scripts de §8 + prueba end-to-end manual de una sesión completa de cada avatar.
6. **Deploy piloto**: `GEMINI_API_KEY` en prod, verificar egress, medir costo/latencia reales, dejar el flag para rollback a Groq/ElevenLabs.

## 9b. Comparativa de costo — Gemini Live vs pipeline de pago (Groq + ElevenLabs)

**Pregunta:** ¿es más barato Gemini Live, o el pipeline actual *si pagáramos* Groq + ElevenLabs?
**Respuesta corta:** Gemini Live es **~5–8x más barato**. El costo del pipeline actual lo domina ElevenLabs (≈98% del total); Groq es casi gratis en comparación.

### Precios usados (junio 2026, fuentes oficiales)
| Proveedor / modelo | Precio |
|---|---|
| Gemini 2.5 Flash native audio (Live) — audio in | $3.00 / 1M tok (≈ 32 tok/s de audio) |
| Gemini 2.5 Flash native audio (Live) — audio out | $12.00 / 1M tok (≈ 25 tok/s de audio ≈ $0.018/min) |
| Gemini — text in / out (system prompt, transcripts) | $0.50 / $2.00 por 1M tok |
| Groq gpt-oss-20b | $0.075 in / $0.30 out por 1M tok |
| Groq Whisper large v3 turbo (STT) | ~$0.04 / hora de audio |
| ElevenLabs multilingual v2 (TTS) | 1 char = 1 crédito; overage ≈ $0.24/1k chars (Pro) · $0.18 (Scale) · $0.12 (Business) |

### Modelo por sesión de práctica (~5 min)
Supuestos: usuario habla ~2 min, avatar habla ~1.5 min (≈1,350 caracteres, regla de "1 pregunta concisa por turno"), ~8 turnos, system prompt ~8.5k tok (entrevistador, peor caso).

**Gemini Live (audio nativo):**
| Componente | Cálculo | Costo |
|---|---|---|
| Audio in (usuario) | 120s × 32 tok × $3/M | $0.012 |
| Audio out (avatar) | 90s × 25 tok × $12/M | $0.027 |
| System prompt (text in) | 8,500 tok × $0.50/M | $0.004 |
| Transcripts (text out) | ~despreciable | ~$0.001 |
| **Total** | | **≈ $0.04–0.07 / sesión** |

**Pipeline de pago (Groq + ElevenLabs):**
| Componente | Cálculo | Costo |
|---|---|---|
| STT (Whisper turbo) | 120s ≈ 0.033h × $0.04/h | $0.001 |
| LLM (gpt-oss-20b) | ~76k tok in × $0.075/M + out | $0.006 |
| **TTS (ElevenLabs)** | 1,350 chars × $0.24/1k (Pro) | **$0.32** |
| **Total** | | **≈ $0.33 / sesión** (Pro) · ~$0.18 (Scale) · ~$0.13 (Business) |

### Por qué la diferencia
La voz es el costo dominante. El **mismo 1.5 min de audio del avatar**:
- ElevenLabs: ~1,350 chars × $0.24/1k ≈ **$0.32**
- Gemini audio out: 90s × $0.018/min ≈ **$0.027**

→ Gemini genera la voz **~12x más barato** que ElevenLabs por minuto hablado. Groq (STT+LLM) es ~$0.007/sesión en ambos análisis: irrelevante. **Toda la diferencia está en TTS.**

### Proyección mensual del piloto (ejemplo: 400 sesiones/mes)
- **Gemini Live:** ≈ **$20–28 / mes** (uso puro, sin suscripción mínima).
- **Pipeline de pago:** ≈ **$130 / mes** (ElevenLabs Pro $99 + overage de Groq+EL) — y a mayor volumen escala peor porque cada char de voz cuesta.

### Caveats que pueden mover los números
1. **Gemini Live es preview** — precio y rate limits pueden cambiar antes de GA. Re-verificar el id de modelo y la tabla al implementar.
2. **Re-procesamiento de contexto:** el estimado de Gemini asume que la sesión Live cachea contexto (no re-cobra todo el historial por turno). Si se cobra contexto acumulado, el costo sube algo, pero sigue acotado por tarifas de audio (mucho menores que EL).
3. **ElevenLabs escala con cuánto habla el avatar.** La regla "1 pregunta concisa por turno" lo contiene, pero sigue siendo el componente caro. Si las respuestas se alargan, el pipeline de pago empeora más rápido que Gemini.
4. **Groq no es el problema de costo** ni en free-tier ni de pago — es casi gratis a este volumen. El free-tier nos limita por *rate (TPM)*, no por dinero.
5. Costo ≠ calidad/identidad de voz: la decisión de audio nativo ya asume perder las voces de marca (ver §1).

**Conclusión:** migrar a Gemini Live **reduce el costo por voz ~12x** y el costo total por sesión **~5–8x**, además de simplificar a un solo proveedor para el tiempo real. El ahorro proviene de eliminar ElevenLabs, no de Groq.

## 10. Estimación gruesa de esfuerzo

- Backend (servicio + rama proxy): media.
- Frontend (PCM streaming + barge-in): **alta** — es el cambio más invasivo y el de mayor riesgo de regresión de UX.
- Prompts/validación: media (re-tuning + scripts).
- El análisis Groq y la persistencia: ~nulo (intactos).
