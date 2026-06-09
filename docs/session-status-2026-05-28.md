# Snapshot de sesión — 2026-05-28

Rama: `dev` · Commit base: `a7738b5` · Cambios **sin commitear** (working tree)

> Snapshot de lo realizado hoy. Para el roadmap estratégico ver `roadmap.md`.

---

## ✅ Hecho en esta sesión

### 1. Repetitividad de Sofia (entrevistador) — bug principal

**Síntoma:** Sofia repetía preguntas casi textuales en turnos seguidos y a veces
se quedaba muda ("se limita"). Confirmado en `logs/menteviva.log` (p.ej. dos
turnos seguidos con *"¿Cuándo la definición no fue clara entre tú y quien te…"*).

**Causas raíz:**
1. El modelo **copiaba los ejemplos literales del propio system prompt**
   (`entrevistador_prompt.md` tenía esa frase como ejemplo "BUENO").
2. `temperature=0.4` — demasiado determinista.
3. Sin `frequency_penalty` / `presence_penalty` en la llamada a Groq.
4. `gpt-oss-20b` a veces "razona" y devuelve **contenido vacío** en turnos de
   baja señal (usuario evasivo) → Sofia muda.

**Cambios (`app/services/groq_llm.py`):**
- Añadidos `frequency_penalty=0.5` + `presence_penalty=0.4` en `_build_stream`.
- `temperature` 0.4 → **0.6** (en `chat_stream` y `chat_complete`).
- **Red anti-vacío:** si el modelo no emite texto, reintenta el **mismo
  `gpt-oss-20b`** a temp 0.85; si aún así nada, emite una pregunta de
  re-enganche rotada (`_REENGAGE_FALLBACKS`) → Sofia nunca queda muda.
- **Eliminado el fallback a `llama-3.1-8b-instant`** (en `chat_stream` y
  `chat_complete`). Motivo: el system prompt del entrevistador (~8.5k tokens)
  supera el límite de **6k TPM** de llama en el free tier de Groq → daba **413**
  siempre. Ahora todos los reintentos van al primario, que sí tiene cupo.
  Constante `FALLBACK_MODEL` borrada y docstring del módulo actualizado.

**Cambios (`app/prompts/entrevistador_prompt.md`):**
- Nota al inicio: los ejemplos son ilustrativos, **nunca** copiarlos textualmente.

**Verificación (`scripts/test_repetition.py`, nuevo):** conversación sintética de
candidato evasivo → mide similitud Jaccard entre turnos consecutivos. Run limpio:
**0/7 parejas repetidas, respuestas variadas, `[CIERRE]` correcto.** (Re-correr el
test agota la cuota free-tier → 429; es esperado, no es bug.)

### 2. Controles de audio en la simulación

- **Limpiar audio** (`useAudioRecorder.ts`): el mic ahora pide
  `echoCancellation` + `noiseSuppression` + `autoGainControl` → menos ruido,
  mejor transcripción de Whisper.
- **Botón de pausa** (`Simulation.tsx`): nuevo botón Pausa/Reanudar para la voz
  del avatar (usa `pauseAudio`/`resumeAudio`). Se resetea en cada turno nuevo.
- **Mutear mi micrófono** (`Simulation.tsx`): toggle Silenciar/Muteado tipo Zoom;
  mientras está muteado se deshabilita el push-to-talk y se muestra
  "● Mic silenciado".

### 3. Code review (high effort) + fixes de las prioridades

Revisión multi-agente del diff. Hallazgos arreglados:

| # | Hallazgo | Fix |
|---|---|---|
| 1 | Mutear mientras grabas dejaba la grabación colgada y el **mic abierto** | Al mutear con grabación en curso, `stopRecording()` la cancela (libera mic, no envía) |
| 2 | El reintento del LLM **enmascaraba errores reales** (401/429/bugs) con re-enganche | El `except` del reintento ahora **propaga** el error; re-enganche solo para vacío sin excepción |
| 3 | Pausar **ocultaba los subtítulos** (rompía la función de pausa) | Transcripción visible con `(isSpeaking \|\| isPaused)` |
| 4 | `resumeAudio()` sin `.catch` → unhandled rejection | Añadido `.catch` con warning (`useAudioPlayer.ts`) |
| 5 | `chat_complete` aún caía a llama → 413 en scripts de test | Alineado con `chat_stream`: reintenta el mismo modelo |
| 6 | Lag visual del botón mute (esperaba a `unlockAudio`) | El estado se actualiza **antes** del `await` |

**No arreglados (a propósito):**
- Un turno nuevo descarta el clip pausado: bajo y razonable (si hablas por
  encima del avatar pausado, descartar el clip viejo es lo sensato).
- El re-enganche entra al historial: *tradeoff* deliberado de "nunca quedar
  muda"; solo dispara en el doble-vacío (raro).

---

## 📂 Archivos tocados

**Backend:**
- `app/services/groq_llm.py` — penalties, temp 0.6, retry mismo modelo,
  re-enganche, sin llama.
- `app/prompts/entrevistador_prompt.md` — nota anti-copia de ejemplos.
- `scripts/test_repetition.py` — **nuevo** (medición de repetición).

**Frontend:**
- `src/hooks/useAudioRecorder.ts` — supresión de ruido del mic.
- `src/hooks/useAudioPlayer.ts` — `.catch` en `resumeAudio`.
- `src/pages/Simulation.tsx` — botones pausa + mute, fixes de review.

---

## 🔎 Verificación

- Backend: `poetry run python -c "import app.services.groq_llm"` → OK.
- Frontend: `npm run build` (tsc) → limpio (solo el warning preexistente de
  tamaño de chunk).
- Test de repetitividad: 0/7 en el run limpio.

## ⚠️ Notas / pendientes

- **Modelos en uso:** LLM `openai/gpt-oss-20b` (Groq) · STT
  `whisper-large-v3-turbo` · análisis de cierre `openai/gpt-oss-120b` · TTS
  ElevenLabs.
- Para que los cambios del LLM tomen efecto hay que **reiniciar el backend**
  (`./stop.bat` + `./start.bat`).
- Cuota free-tier de Groq: re-correr tests seguido da 429 (TPM agotado).
- Cambios aún **sin commitear**.
