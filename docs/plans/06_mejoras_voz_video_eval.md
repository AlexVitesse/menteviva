# Plan 06 — Mejoras: toma de texto, imagen del avatar, coordinación audio/voz y fidelidad de la evaluación

**Rama:** `feature/gemini-live-voice` · **Fecha:** 2026-06-09
**Origen:** auditoría de código de las 4 áreas pedidas por producto sobre el pipeline
Gemini Live + Simli + análisis Groq. Cada hallazgo tiene archivo:línea verificado.

Leyenda de urgencia: 🔴 afecta datos/resultado del piloto · 🟡 afecta percepción de calidad · 🟢 pulido.

---

## A. Hallazgos

### A1. Toma de texto (transcripts → chat + historial del análisis)

| # | Urg. | Hallazgo | Dónde |
|---|------|----------|-------|
| T1 | 🔴 | **El último turno del usuario se puede PERDER.** Los fragmentos de `input_transcription` se acumulan en variables locales (`cur_user`) de `_gemini_downstream` y solo se materializan al `turn_complete` del turno de Sofia. Si el usuario habla y presiona *Terminar* antes de que Sofia conteste, la task se cancela y ese turno **no entra al análisis**. Igual se pierden parciales al reconectar por `go_away`. | `conversation.py:294-326` |
| T2 | 🔴 | **El mensaje del usuario aparece tarde en el chat**: se emite `user_message` hasta el `turn_complete` del modelo, así que tu frase aparece *después* de que Sofia ya respondió. | `conversation.py:313-320` |
| T3 | 🟡 | **Barge-in ensucia el historial**: al interrumpir, `cur_asst` ya acumuló texto que el usuario nunca escuchó (el cliente hizo flush del audio), pero se materializa igual como mensaje de Sofia → el análisis cree que Sofia dijo cosas cortadas. | `conversation.py:309-312` + `useGeminiLive.ts:188-192` |
| T4 | 🟢 | **El echo-gate se come el inicio del barge-in**: descarta chunks completos bajo el gate; el arranque (baja energía) de tu voz se pierde → la transcripción puede perder la primera sílaba. | `useGeminiLive.ts:267-278` |

### A2. Calidad de imagen del avatar (Simli)

| # | Urg. | Hallazgo | Dónde |
|---|------|----------|-------|
| V1 | 🟡 | **Upscaling + crop del video 512×512**: Simli entrega 512×512 y el `<video>` usa `object-cover` en un panel `md:flex-1` (≈800-1000px) → escala ~2x y recorta. Causa #1 de la imagen "borrosa". | `SimliAvatar.tsx:24` |
| V2 | 🟡 | No se pide resolución/calidad en el compose token (solo faceId, maxSessionLength, maxIdleTime, handleSilence). Consultar si el plan de Simli permite mayor resolución. | `simli.py:53-60` |
| V3 | 🟢 | **Pre-conectar Simli durante el overlay** "Listo para empezar" eliminaría el "Conectando video..." inicial (ojo con `maxIdleTime=300`). | `Diagnostico.tsx:224-246` |

### A3. Coordinación audio ↔ voz

| # | Urg. | Hallazgo | Dónde |
|---|------|----------|-------|
| C1 | 🟡 | **Resampler 24k→16k sin filtro anti-alias** (interpolación lineal pura): el contenido 8-12 kHz de la voz de Gemini se aliasea en el stream de 16 kHz que recibe Simli → aspereza/metalicidad audible. Fix: low-pass (~7.2 kHz) antes de decimar. | `pcm.ts::Pcm24to16Resampler` |
| C2 | 🟡 | **Caption del avatar adelantado a la voz**: el mensaje se materializa en `turn_complete` (fin de *generación*) pero el audio sigue *sonando* varios segundos. Retener hasta `onSpeakingChange(false)` / `silent` de Simli (paridad con la decisión del modo Groq). | `useGeminiLive.ts:194-208` |
| C3 | 🟢 | **Echo-gate con latencia de estado en Simli**: el gate depende de `status === "generating_audio"` que fijan los eventos `speaking/silent` de Simli (con latencia) → ventanas donde el eco pasa. Fix: hold-over ~300ms tras `silent` + activar al primer `assistant_audio_chunk`. | `useGeminiLive.ts:113-118` |

### A4. Fidelidad de la evaluación vs `entrevistador_prompt.md` (§10-11)

Lo alineado ✓: `SOFT_SKILLS_CATALOG` es copia fiel de la §10; las reglas de oro 11.2
(evidencia citable, conducta-no-etiqueta, máx 3, micro-práctica, blind spot con sentinel)
están reforzadas incluso más que el doc. Desviaciones:

| # | Urg. | Hallazgo | Dónde |
|---|------|----------|-------|
| E1 | 🔴 | **Truncado a 8,000 chars mata entrevistas de 25 min**: una sesión de voz real produce ~15-20k chars → se descarta la mitad central (donde están las historias profundizadas). gpt-oss-120b tiene 131k de contexto; subir a ~24,000. | `analysis.py:372` (`_format_conversation`) |
| E2 | 🔴 | **Tensión "prohibido evidencia de ausencia" vs señales de brecha §10**: la §10 define brechas que SON ausencias ("procesos sin métrica", "minimiza el componente humano"), pero la regla 1 del prompt de análisis + `_drop_absence_gaps` las vetan → el LLM sobre-cauteloso devuelve `gaps: []` (visto en el escenario `sin_metricas`: Laura sin una sola métrica y cero gaps). Fix: aclarar en el prompt que **una cita de resultado vago SÍ es evidencia citable** ("el cliente quedó muy satisfecho", "lo dejé pasar", "se resolvió solo"). | `analysis.py:609-621` + `_drop_absence_gaps` |
| E3 | 🟡 | **El prompt conciso de Gemini ignora `competencias` y `minutos` del setup**: solo usa nombre/rol/tono/idioma; si el usuario eligió competencias foco en `/diagnostico/setup`, la Sofia de voz no las prioriza (el maestro sí tiene `{{competencias}}`). | `entrevistador.py::build_gemini_entrevistador_prompt` |
| E4 | 🟢 | Falta el **Resumen ejecutivo** (§11.1 punto 1) en el schema `Diagnostico` (decisión de producto), y la regla "sin comparaciones" (§11.2.6) en el prompt de análisis (1 línea). | `user_profile.py::Diagnostico`, `analysis.py` |

---

## B. Plan de ejecución (urgentes primero)

### Fase 1 — 🔴 Evaluación fiel — ✅ HECHA Y VERIFICADA (2026-06-09)

1. ✅ **E1 — truncado**: `_format_conversation(max_chars=24_000)` (antes 8,000).
2. ✅ **E2 — "EVIDENCIA POR CITA VAGA"** añadida a la regla 1 del
   `USER_PROFILE_PROMPT_TEMPLATE` (citar "salió bien" / "lo dejé pasar" / "era lo
   lógico" SÍ es evidencia de brecha) + `_drop_absence_gaps` ya no descarta gaps
   cuyo evidence contiene una cita textual (`_QUOTE_MARKERS`).
3. ✅ **E4b** — regla "SIN COMPARACIONES" añadida al prompt de análisis.
4. ✅ **Verificación sin gastar Gemini**: `scripts/test_diagnostico_replay.py` (nuevo)
   re-juega el transcript GUARDADO de `sin_metricas` contra `generate_user_profile`.
   Resultado: la corrida pre-fix dio `gaps: []`; post-fix detecta
   `orientacion_resultados` citando *"el proyecto se completó sin contratiempos y el
   cliente quedó muy satisfecho"* con micro-práctica de métricas. **El fix funciona.**
5. **Hallazgo de cuota**: el free tier limita **20 req/DÍA por modelo** en
   `gemini-2.5-flash` (la corrida completa usa ~21 → infranqueable sin billing).
   Mitigación: `test_diagnostico_escenarios.py` ahora acepta
   `GEMINI_TEXT_MODEL=gemini-2.0-flash` para usar otro bucket — **pero hoy
   (2026-06-09) ese bucket también devolvió 429**: la cuota diaria del proyecto
   está agotada en todos los modelos de texto. Pendiente: re-correr los 3
   escenarios tras el reset diario (o con billing):
   `GEMINI_TEXT_MODEL=gemini-2.0-flash poetry run python -m scripts.test_diagnostico_escenarios`.

### Fase 2 — 🔴 No perder texto del usuario — ✅ IMPLEMENTADA (2026-06-09)

5. ✅ **T1 — flush de parciales**: los buffers `cur_user`/`cur_asst` ahora viven en el
   dict `state` compartido (sobreviven reconexiones por `go_away` sin código extra) y
   `_flush_partial_transcripts(state, history)` los vuelca al historial antes de
   `_finalize_and_analyze` → el último turno hablado SÍ entra al análisis aunque el
   usuario presione Terminar antes de la respuesta de Sofia.
6. ✅ **T2 — user_message temprano**: `_flush_user()` materializa el turno del usuario
   (history + `user_message` al cliente) apenas llega el PRIMER `audio`/`output_text`
   de la respuesta de Sofia (= fin real del habla), en vez de esperar su
   `turn_complete`. En `turn_complete` solo se flushean restos tardíos.
7. 🟡 **Verificación pendiente (manual, requiere sesión de voz)**: decir algo y
   Terminar de inmediato → el diagnóstico debe incluir esa última frase; el chat debe
   mostrar tu mensaje antes de la respuesta de Sofia. (Import/compile verificado; el
   modo texto no ejercita `input_transcription`, así que no hay script posible.)

### Fase 3 — 🟡 Lo más visible/audible — ✅ IMPLEMENTADA (2026-06-09)

8. ✅ **V1 — render nítido del video** (`SimliAvatar.tsx`): el video principal se
   muestra a su aspecto NATIVO 1:1 (`aspect-square object-contain`, centrado, sin
   crop) y el panel se rellena con el MISMO MediaStream desenfocado de fondo
   (`blur-2xl scale-110 opacity-50`, estilo TV) — segundo `<video>` compartiendo
   `srcObject`, costo extra ~nulo.
9. ✅ **V2 — consulta API Simli (2026-06-09)**: el endpoint `/compose/token` NO
   acepta parámetros de resolución/calidad/bitrate (solo faceId, apiVersion,
   handleSilence, maxSessionLength, maxIdleTime, startFrame, audioInputFormat).
   El 512×512 es fijo → V1 es la única palanca de nitidez disponible.
10. ✅ **C1 — anti-alias en el resampler** (`pcm.ts`): cascada de 2 biquads
    low-pass RBJ a 7.2 kHz (~24 dB/oct) con estado persistente entre chunks,
    aplicada ANTES de la decimación lineal 24k→16k + clamp int16. Elimina el
    aliasing de 8-12 kHz que hacía sonar áspera/metálica la voz vía Simli.
11. ✅ **C2 — caption sincronizado** (`useGeminiLive.ts`): los mensajes de Sofia
    completados en `turn_complete` se RETIENEN en `pendingAssistantMsgsRef`
    mientras su voz sigue sonando y se materializan en la transición
    hablando→silencio (status del store, cubre player local Y Simli). Flush de
    seguridad en `session_end`, `onclose` y `disconnect` para no perder mensajes.

Verificación: `npm run build` (tsc) pasa. La validación perceptual (nitidez, voz
menos áspera, texto a tiempo) es manual en una sesión de voz con Simli activo.

### Fase 4 — 🟢 Pulido — ✅ IMPLEMENTADA (2026-06-09, salvo E4a)

12. ✅ **T3 — marca de interrupción** (`conversation.py`): los turnos de Sofia
    cortados por barge-in se materializan con el sufijo
    `[...el usuario interrumpio y no escucho el final]` para que el análisis no
    asuma que el usuario oyó todo el transcript generado.
13. ✅ **T4 — pre-roll del echo-gate** (`useGeminiLive.ts`): los últimos 2 chunks
    (~200 ms) descartados por el gate se retienen y se envían ANTES del primer
    chunk que pasa — el arranque (baja energía) del barge-in ya no se pierde.
    Si el avatar calla sin que llegara voz real, el pre-roll se descarta (era eco).
14. ✅ **C3 — hold-over del echo-gate**: el gate se enciende desde el PRIMER
    `assistant_audio_chunk` (no espera el evento speaking, que llega con latencia)
    y permanece activo 300 ms tras el silencio (eco de cola). `ECHO_HOLDOVER_MS=300`.
15. ✅ **V3 — pre-conexión de Simli** (`Diagnostico.tsx`): `simli.connect()` arranca
    al hacer click en "Iniciar entrevista", EN PARALELO al permiso de mic (no al
    montar, para no quemar `maxIdleTime` si el usuario se queda en el overlay).
    El connect del effect posterior es no-op (guard interno).
16. ✅ **E3 — competencias/minutos al prompt conciso** (`entrevistador.py`): si el
    setup eligió competencias foco se inyectan como PRIORITARIAS (lista o string;
    NO se usa `v["competencias"]` porque el builder del maestro stringifica la
    lista); `minutos` acota el ritmo ("la sesión apunta a unos N minutos").
    ⚠️ Cambia el prompt validado en los tests de texto → la re-corrida pendiente
    de `test_diagnostico_escenarios.py` cubre también esta re-validación.
17. ⏸️ **E4a — resumen ejecutivo** (§11.1 punto 1) en el schema `Diagnostico`:
    PENDIENTE de decisión de producto (toca schema + prompt + UI del perfil).

Verificación Fase 4: `npm run build` (tsc) pasa; backend importa; E3 verificado
con builder (default / lista / string). T3/T4/C3/V3 requieren sesión de voz manual.

### Notas

- Fase 1 es solo backend/prompt (no toca voz) y se puede verificar con los scripts de
  texto existentes en cuanto haya cuota de Gemini.
- Fase 2 toca el proxy WS; el riesgo es bajo porque la rama Groq no comparte ese código.
- E3 quedó en Fase 4 a propósito: cambiar el prompt conciso invalida la calibración
  validada en los tests de texto — hacerlo junto con una re-corrida completa.
