# 2026-07-09 — Diagnóstico: Sofia gana reloj, señalización de avance y cierre por tiempo

**Rama:** `feature/chat-lab-prompt-bench`
**Origen:** evaluación del usuario — "ChatGPT te va guiando ('última pregunta...');
Gemini 2.5/3.5 no lo hace pese a los cambios de prompt por tiempos. ¿Está bien
ese enfoque y cómo mejoramos el diagnosta?"

## Diagnóstico

La política de duración (changelog `2026-07-09_diagnostico_duracion_diferenciada`)
arregló la *cobertura* (piso de competencias por duración) pero no el *ritmo ni
la guía*, por una razón estructural: **el LLM es stateless y no tiene reloj**.
El prompt le pedía "administra el tiempo para lograrlo" — una instrucción
imposible de cumplir: en cada turno el modelo ve el historial, nunca cuánto
tiempo pasó ni en qué punto de la sesión va.

Evidencia comparada:

- **North-star (`conversacionconCHATGPT.txt`)**: ChatGPT señaliza posición todo
  el tiempo ("antes de entrar en las preguntas de experiencia...", "Con esto
  tengo muy buen material. Déjame hacerte una **última pregunta** antes de
  cerrar") y su pregunta final de reflexión produjo el material del blind spot.
- **Gemini 3.5 (BD dev, sesión real de 25 min)**: BEI competente (drill-STAR,
  pivotes explícitos) pero tras 10 turnos: cero señales de avance, cero "última
  pregunta", cero `[CIERRE]`. La barra de progreso completable por esfuerzo
  (changelog `2026-07-09_chatlab_tiempo_errores_barra_progreso`) era un parche
  de UI a este mismo síntoma.

Además, el umbral `competencias_min` prohibía cerrar sin excepción de tiempo:
bloqueaba el cierre prematuro (bien) pero nada forzaba el cierre al agotarse la
sesión, y los LLM ante la duda siguen preguntando.

## Qué se cambió

### 1. NOTA DEL SISTEMA de ritmo — el reloj (`app/prompts/entrevistador.py`)

Nueva `build_session_state_note(minutos, elapsed_seconds, exchanges,
cierre_como_tool)`: genera una nota `[NOTA DEL SISTEMA — ... va el minuto ~X de
Y (Z% de la sesión). <guía>]` que se anexa al último turno del usuario SOLO para
la llamada al LLM (nunca entra al historial que ve el usuario ni al análisis).

- Avance = `max(pct_tiempo, pct_intercambios)`: quien llegue primero (reloj o
  esfuerzo) empuja hacia el cierre. `target_exchanges()` va en espejo con
  `targetExchanges()` del frontend → cuando la barra llega a 100%, Sofia también
  entra en modo cierre (barra y avatar ya no se contradicen).
- Bandas de guía: <40% apertura/historias · 40-75% profundización BEI · 75-90%
  "anuncia el último tema" · ≥90% **TIEMPO AGOTADO**: anunciar última pregunta →
  pregunta de reflexión → despedida + cierre, aunque falten competencias.
- `cierre_como_tool` cambia la instrucción final: `[CIERRE]` (prompt maestro) vs
  `finalizar_entrevista` (voz / prompt conciso).

### 2. Prompts: señalización + excepción por tiempo

- **Maestro (`entrevistador_prompt.md`)**: nueva sección "NOTA DEL SISTEMA (TU
  RELOJ) Y SEÑALIZACIÓN DE AVANCE" (la nota es su reloj interno, prohibido
  mencionarla; anunciar el último tema y la última pregunta como un
  entrevistador humano) y "EXCEPCIÓN POR TIEMPO" en CIERRE: el piso de
  competencias solo bloquea el cierre ANTICIPADO; con el tiempo agotado, cierra
  con lo que tenga. Ambas secciones se redactaron COMPACTAS a propósito — ver
  el hallazgo del TPM abajo.
- **Conciso de voz (`_GEMINI_DIAGNOSTICO_TEMPLATE`)**: bloque "RITMO Y
  SEÑALIZACIÓN" equivalente + la misma excepción en la línea de CIERRE.

### 3. ChatLab texto (`chat_text.py` + `ChatLab.tsx`)

- `ChatRequest.elapsed_seconds` (nuevo): el frontend manda el cronómetro real de
  la sesión en cada `/api/chat` (solo diagnóstico).
- El router inyecta la nota al último turno del usuario cuando el avatar es
  diagnóstico (no con `greet`); `exchanges` se cuenta del historial recibido.

### 4. Voz (`conversation.py` + `gemini_live.py`)

- **Rama Gemini Live**: `GeminiLiveSession.send_context_note()` — envía la nota
  como contexto (`send_client_content` con `turn_complete=False` → NO dispara
  respuesta; el modelo la ve en su siguiente turno). El proxy la inyecta en la
  frontera de turno (ventana segura, nadie habla) al cruzar umbrales del tiempo
  de sesión: 50%, 75%, 90% + recordatorios 100%/115% por si ignora el del 90%.
  Cada umbral una sola vez; sobrevive reconexiones (vive en `state`).
- **Rama Groq (voz clásica)**: `_history_with_pacing_note()` — copia del
  historial con la nota anexada al último turno del usuario en ambos call sites
  de `chat_stream` (audio y texto). No muta `conversation_history` (el
  transcript y el análisis quedan limpios).
- En voz el avance se calcula SOLO por tiempo (`exchanges=None`): los turnos
  hablados son cortos/frecuentes y contarlos empujaría el cierre demasiado pronto.

## Verificación

Nuevo `scripts/test_pacing_policy.py`:

```bash
poetry run python -m scripts.test_pacing_policy            # incluye 2 llamadas live a Groq
poetry run python -m scripts.test_pacing_policy --offline  # solo determinista
```

- **Parte determinista (19 checks, TODO OK)**: bandas por %, `max(tiempo,
  esfuerzo)`, variante tool vs [CIERRE], fallbacks (minutos inválidos → 25,
  tope 100%), y que ambos prompts rendericen las secciones nuevas sin
  placeholders rotos.
- **Parte live (Groq llama-3.3-70b)**: conversación sintética con nota al 92% →
  asserts: Sofia señaliza el cierre o cierra en el turno 1, emite `[CIERRE]` a
  más tardar en el turno 2, y nunca menciona la nota. Resultado real (TODO OK):
  turno 1 = "Con esto tengo muy buen material... una última pregunta antes de
  cerrar: ¿qué historia te movió más al recordarla?" · turno 2 = "Gracias, fue
  un gusto conocerte. [CIERRE]" — exactamente la conducción del north-star.
- `scripts/test_duracion_policy`: sigue TODO OK (exit 0).
- `npm run build` (tsc + vite): limpio.
- `py_compile` de los 4 módulos backend tocados: OK.

Salida en `logs/pacing_policy.txt`.

## ⚠️ Hallazgo colateral: el prompt maestro ya NO cabe en gpt-oss free tier

Al correr la parte live se descubrió que **`openai/gpt-oss-20b` y `-120b` en el
free tier de Groq tienen límite de 8,000 TPM** y el prompt maestro renderizado
(~29k chars ≈ 8k tokens) lo excede **incluso en el turno 1** (413: "Limit 8000,
Requested 8180"). La nota vieja de memoria decía que gpt-oss aguantaba el prompt
de ~8.5k tokens — ya no: o Groq bajó el límite del tier o el prompt creció con
los últimos cambios (política de duración + esta señalización).

Mitigación en este cambio: las secciones nuevas se compactaron para volver al
tamaño previo (~28-29k chars, al filo). Aún así, **cualquier sesión Groq con el
prompt maestro y algo de historial va a 413 en el free tier**. Opciones reales:
usar `llama-3.3-70b-versatile` (12k TPM, acepta el prompt completo — verificado)
para el banco con Groq, pagar Dev Tier, o adelgazar el prompt maestro (~1.5k
tokens) como trabajo aparte. El test live usa llama-3.3-70b por esto.

## Notas / pendientes

- La inyección en voz (Gemini Live) usa `send_client_content` con
  `turn_complete=False`; queda pendiente validarla con una sesión de voz real
  (cuota Gemini: 20 req/día por key por modelo).
- La UI del ChatLab no cambió más allá de mandar `elapsed_seconds`: el botón
  "Terminar y generar diagnóstico" sigue como escape, pero ahora al llegar la
  barra a 100% Sofia debería cerrar sola (mismo umbral).
- El saludo pre-grabado y `_GREET_NUDGE` no llevan nota (la sesión apenas
  arranca).
