# 2026-07-15 — Señal vocal experimental en VoiceLab (tono/nervios via Gemini nativo)

## Contexto

Propuesta evaluada: enriquecer el diagnóstico con lectura de emociones desde el
audio (nervios, energía). En vez de sumar un modelo de emociones dedicado, se
explota que Gemini ya entiende audio nativamente. **Scope: solo VoiceLab** — es
un experimento para observar si la señal aporta al diagnóstico antes de decidir
si se lleva a producción (y ahí sí, ponerle checkbox de on/off; hoy NO hay
checkbox, a propósito).

## Cómo funciona

1. El proxy WS de voz (`conversation.py::_run_gemini_conversation`) bufferea el
   PCM16 16 kHz **del usuario** (no el de Sofia) en `state["user_audio"]`,
   **solo cuando `finalize=False`** (VoiceLab). Producción nunca aloca el buffer.
2. Al recibir `end_session`, se llama `gemini_live.analyze_vocal_tone(audio)`:
   UNA llamada `generate_content` (mismo `gemini_model_text`, cero modelos
   nuevos) con el audio como WAV inline y un prompt que pide describir **solo el
   tono** (ritmo, pausas, firmeza, temblor), nunca el contenido. Best-effort:
   si falla o hay <3s de audio, devuelve `None` y el cierre sigue igual.
3. La nota viaja en el `session_end` del WS como `vocal_note`; el frontend la
   guarda en la sesión (`ChatSession.vocalNote`), la muestra en el panel de
   Telemetría y la reenvía en el POST a `/api/chat/diagnostico`.
4. `generate_user_profile` (analysis.py) la inyecta al prompt del analizador
   como sección `## SEÑAL VOCAL (EXPERIMENTAL)` marcada como señal de APOYO:
   nunca única evidencia de strength/gap, la regla de cita textual del
   transcript sigue aplicando, y si contradice el contenido gana el contenido.

## Guardas (fixes de la revisión post-implementación)

- **WAV, no PCM crudo**: `generateContent` no acepta `audio/pcm` (eso es solo de
  la Live API); el audio se envuelve en header WAV de 44 bytes
  (`_pcm16_to_wav`) y se manda como `audio/wav`. Sin esto la señal salía
  siempre `None` en silencio (400 tragado por el best-effort).
- **Ventana deslizante en caliente**: el buffer se recorta a los últimos 180 s
  (`VOCAL_TONE_MAX_BYTES` ≈ 5.7 MB) conforme llegan chunks — sin recorte, una
  sesión de 60 min acumulaba ~115 MB de RAM.
- **Timeout de cierre**: `asyncio.wait_for(30 s)` alrededor de la llamada; con
  rotación de N keys el peor caso era N×20 s con el cliente colgado esperando
  el `session_end`. Si expira, se cierra sin nota.

## Costo / cuota

Cada sesión de VoiceLab con ≥3 s de audio gasta **1 request extra** contra
`gemini_model_text` — compite con la cuota free-tier (20 req/día/modelo/key).
Si aparecen 429 más seguido en el lab, bajar `_VOCAL_TONE_MAX_SECONDS` o
gatearlo (el futuro checkbox).

## Detalle conocido (aceptable en lab)

Entre presionar Terminar y recibir el `session_end` pueden pasar hasta ~30 s
(la llamada de tono). Si el usuario genera el diagnóstico en esa ventana, sale
sin `vocal_note` (la nota igual aparece en Telemetría al llegar).

## Archivos

- `menteviva-backend/app/services/gemini_live.py` — `analyze_vocal_tone`,
  `_pcm16_to_wav`, `VOCAL_TONE_MAX_BYTES`, `_VOCAL_TONE_PROMPT`.
- `menteviva-backend/app/routers/conversation.py` — buffer gated por
  `finalize=False`, recorte en caliente, `vocal_note` en `session_end`.
- `menteviva-backend/app/routers/chat_text.py` — `DiagnosticoRequest.vocal_note`.
- `menteviva-backend/app/services/analysis.py` — `{vocal_note_section}` en
  `USER_PROFILE_PROMPT_TEMPLATE` (vacío para todo caller que no la pase).
- `menteviva-frontend/src/hooks/useVoiceLab.ts` — `onEnded(vocalNote?)`.
- `menteviva-frontend/src/pages/VoiceLab.tsx` — estado, POST diagnóstico, UI
  en Telemetría.
- `menteviva-frontend/src/pages/chatlab/types.ts` — `ChatSession.vocalNote`.

## Verificación

- `npm run build` limpio; import-check de los 4 módulos backend OK.
- Header WAV validado con `wave` de stdlib (1 ch, 16 kHz, 16 bit).
- Pendiente: prueba en navegador con sesión real (consume cuota Gemini).
