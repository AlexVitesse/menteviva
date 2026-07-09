# Plan 11 — ChatLab: modelos actualizados, lock de modelo en conversación, aislamiento entre usuarios y logueo de costos

**Rama:** `feature/chat-lab-prompt-bench` · **Fecha:** 2026-07-08
**Origen:** continuación de los planes 07/09/10. El dueño de producto pidió tres
cosas y, en una segunda ronda, el logueo de costos por proveedor para decidir
"cuál genera menos costo y mejores resultados".

Leyenda de urgencia: 🔴 rompe la experiencia · 🟡 afecta percepción/decisión · 🟢 pulido.

Verificación (convención del repo: probar cambios de LLM con scripts sintéticos,
no clicks): `menteviva-frontend` → `npm run build` (tsc) limpio; backend →
`py_compile` de los módulos tocados; `scripts/test_chatlab_smoke.py` (exit 0,
las 4 partes) + validaciones directas contra las APIs reales de los 3 motores.

---

## A. 🟡 Modelos de Gemini y ChatGPT desactualizados

Los IDs del selector del ChatLab (`PROVIDER_MODELS`) eran de generaciones viejas
(`gpt-4o`/`gpt-4.1`, `gemini-2.5-*`/`gemini-2.0-flash`). A 2026-07 lo vigente:

- **OpenAI:** `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`.
- **Gemini:** `gemini-3.5-flash` (GA), `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite`.

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| A1 | 🟡 | Dropdown `PROVIDER_MODELS.gemini` y `.chatgpt` con la familia actual. | `ChatLab.tsx` |
| A2 | 🟡 | Defaults del backend: ChatGPT → `gpt-5.5` (Sofía) / `gpt-5.4-mini` (resto); `gemini_model_text` → `gemini-3.5-flash`. | `chat_text.py`, `config.py` |
| A3 | 🟡 | Textos de UI que citaban `gpt-4o` actualizados a `gpt-5.x`; default de `selectedModel` de Gemini → `gemini-3.5-flash` (sesión inicial y `createNewSession`). | `ChatLab.tsx` |

**⚠️ Gotcha crítico resuelto (`openai_llm.py`):** la familia GPT-5 (razonamiento)
**rechaza** `temperature≠1` y usa `max_completion_tokens` en vez de `max_tokens`.
Cambiar solo el dropdown habría reventado en runtime. `chat_complete_openai`
ahora detecta modelos de razonamiento (`_is_reasoning_model`: `gpt-5*`, `o1/o3/o4*`)
y manda `max_completion_tokens=2000` + `reasoning_effort="low"` (holgura para que
el razonamiento no vacíe el budget y devuelva `""`; esfuerzo bajo para que siga
siendo un chat, no una deliberación). Los `gpt-4o/4.1` mantienen `temperature=0.6`
+ `max_tokens=500` como antes.

Verificado: `gpt-5.4-mini` respondió correcto (~2-4s) y `gpt-4o-mini` (ruta legacy)
también, ambos contra la API real.

---

## B. 🟡 Modelos legacy re-agregados (siguen disponibles en la API)

Confirmado en las páginas oficiales: **GPT-4o y GPT-4.1 solo se retiraron de la UI
de ChatGPT, no de la API**; **Gemini 2.5 sigue disponible**. Se re-agregaron al
selector marcados "Legacy":

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| B1 | 🟢 | Gemini: `gemini-2.5-pro`, `gemini-2.5-flash-lite` (además de `2.5-flash`). | `ChatLab.tsx` |
| B2 | 🟢 | ChatGPT: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`. | `ChatLab.tsx` |

---

## C. 🟡 No permitir cambiar de modelo a mitad de conversación

Antes, cambiar avatar/proveedor/modelo/nivel hacía `updateActiveSession({ ...,
messages: [] })` → **borraba la conversación en silencio**. Ahora esos 4 selectores
se **bloquean** una vez que hay mensajes.

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| C1 | 🟡 | Flag `convStarted = messages.length > 0`. Con él, `disabled` + `disabled:opacity-50 disabled:cursor-not-allowed` + `title`/`LOCKED_HINT` en: select de avatar, select de proveedor, select de modelo y botones de nivel. | `ChatLab.tsx` |
| C2 | 🟢 | Nota bajo el selector de modelo cambia a "🔒 Bloqueado durante la conversación. Limpia la consola o crea una sesión nueva…". | `ChatLab.tsx` |

La **duración** (25/40/60) queda editable a propósito: solo afecta el ritmo/meta de
progreso, no el prompt ni el motor. Para cambiar de modelo: «Limpiar Consola» o
«+ Nueva» sesión.

---

## D. 🔴 Aislamiento de conversaciones entre usuarios

**Bug real:** en `chatlab_conversations` la PRIMARY KEY es `session_id`, y el
frontend arrancaba con `"session-default"` **hardcodeado e idéntico para todos los
navegadores**. Dos usuarios distintos hacían `upsert` sobre la MISMA fila → se
pisaban. (El frontend solo lee de `localStorage`, así que no hay ruta de lectura
que filtre en la UI; el daño era a nivel de datos en BD.)

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| D1 | 🔴 | `CLIENT_ID` aleatorio y persistente por navegador (`localStorage["chatlab_client_id"]`, generado una vez a nivel de módulo). | `ChatLab.tsx` |
| D2 | 🔴 | El `session_id` que se persiste en BD va namespaced: `` `${CLIENT_ID}:${activeSessionId}` `` en `saveConversation`. Cada navegador tiene sus propias filas y nunca ve/pisa la conversación de otro. | `ChatLab.tsx` |

Nota: como ChatLab no tiene login, el límite de aislamiento es **por navegador**
(dos personas compartiendo el mismo perfil de navegador comparten `localStorage`).
Un flujo con auth real podría sustituir `CLIENT_ID` por el uid del usuario. No se
tocó el backend: `save_chatlab_conversation` guarda el `session_id` que reciba.

---

## E. 🟡 Logueo de costos por turno (Groq + Gemini + OpenAI)

Objetivo: comparar en logs **cuánto cuesta cada turno** por motor/modelo, para
decidir costo vs. calidad.

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| E1 | 🟡 | **Módulo compartido** `llm_costs.py`: tablas `PRICING` (USD/1M tok, input/output) para los 3 motores + `price_for()` (match exacto o por prefijo más largo, tolera sufijos de fecha) + `log_llm_cost()` (loguea `in/out` tok y costo estimado; no-fatal). | `services/llm_costs.py` (nuevo) |
| E2 | 🟡 | Groq `chat_complete` (ruta del ChatLab): tras la respuesta, loguea con `response.usage` (`prompt_tokens`/`completion_tokens`). | `services/groq_llm.py` |
| E3 | 🟡 | Gemini `generate_text`: loguea con `resp.usage_metadata` (`prompt_token_count`; output = `candidates_token_count` + `thoughts_token_count`, porque Google factura el "thinking" como output). | `services/gemini_live.py` |
| E4 | 🟡 | OpenAI `chat_complete_openai`: refactor para usar `llm_costs` (se eliminó la tabla local duplicada `_OPENAI_PRICING`). | `services/openai_llm.py` |

Formato en `logs/menteviva.log` (aparece con el backend corriendo; el file handler
se adjunta en `main.py`, no en los scripts standalone):

```
[costo][groq]   modelo=openai/gpt-oss-20b in=7202 out=120 tok -> ~$0.000576 USD ($0.075/$0.3 por 1M)
[costo][gemini] modelo=gemini-3.5-flash   in=7330 out=676 tok -> ~$0.017079 USD ($1.5/$9.0 por 1M)
[costo][openai] modelo=gpt-5.4-mini       in=7138 out=42  tok -> ~$0.005543 USD ($0.75/$4.5 por 1M)
```

No se instrumentó `chat_stream` (ruta de **voz** en tiempo real) para no tocar el
hot path de producción; requeriría `stream_options={"include_usage": True}`.

### Tarifas cargadas (USD por 1M tok, on-demand, input / output — verificadas 2026-07)

**Groq:** gpt-oss-20b `0.075/0.30` · gpt-oss-120b `0.15/0.60` · llama-3.3-70b `0.59/0.79` · llama-3.1-8b `0.05/0.08`
**Gemini:** 3.5-flash `1.50/9.00` · 3.1-pro-preview `2.00/12.00` · 3.1-flash-lite `0.25/1.50` · 2.5-flash `0.30/2.50` · 2.5-pro `1.25/10.00` · 2.5-flash-lite `0.10/0.40` (Pro = tramo ≤200k)
**OpenAI:** 5.5 `5/30` · 5.4 `2.50/15` · 5.4-mini `0.75/4.50` · 5.4-nano `0.20/1.25` · 4o `2.50/10` · 4o-mini `0.15/0.60` · 4.1 `2/8` · 4.1-mini `0.40/1.60` · 4.1-nano `0.10/0.40`

Fuentes: OpenAI/Groq/Gemini pricing pages. No incluye descuentos por batch/cache
(es el on-demand, peor caso).

### Comparación costo vs. resultados (turno del entrevistador, input ≈7.2k tok)

| Modelo | ~$/turno | Latencia | Calidad (roleplay + reglas) |
|---|--:|--:|---|
| **Groq gpt-oss-20b** (default) | **$0.0006** | ~1.3s | Alta — validado en prod |
| OpenAI gpt-4o-mini | $0.0012 | ~1-2s | Media-alta |
| Groq gpt-oss-120b | $0.0012 | ~2s | Alta |
| Gemini 3.1-flash-lite | $0.002 | ~3s | Media-alta |
| Gemini 2.5-flash | $0.0025 | ~4s | Alta |
| OpenAI gpt-5.4-mini | $0.006 | ~4s | Muy alta (razonamiento) |
| Gemini 3.5-flash | $0.017 | ~12s | Muy alta (pero verboso) |
| OpenAI gpt-5.5 | ~$0.04 | ~5-8s | Máxima |

**Recomendación "menos costo + buenos resultados": Groq `gpt-oss-20b`** — ~30×
más barato que Gemini 3.5-flash, ~10× que gpt-5.4-mini, menor latencia, y ya es la
elección validada en prod por seguir bien las reglas del prompt. Siguiente escalón
de calidad sin dispararse: `gpt-5.4-mini` o `gemini-2.5-flash`.

Matices:
1. **El costo lo domina el input**: el banco es *stateless* y re-manda el prompt
   maestro (~7k tok) cada turno. En modelos caros, *prompt caching* recorta ese
   input 75-90% (la palanca real de ahorro).
2. **Gemini 3.5-flash salió caro también por verboso** (676 tok salida vs. 42 de
   OpenAI) sobre output a $9/1M; un prompt que lo obligue a ser breve lo baja.
3. La columna de calidad es evaluación + historial del repo, no medición dura.
   Con el costo ya en logs + ratings 👍/👎 y diagnóstico por sesión, se puede
   medir costo-por-sesión contra calidad empíricamente.

---

## Archivos tocados

**Frontend:** `menteviva-frontend/src/pages/ChatLab.tsx`
**Backend:** `menteviva-backend/app/services/llm_costs.py` (nuevo),
`app/services/openai_llm.py`, `app/services/groq_llm.py`,
`app/services/gemini_live.py`, `app/routers/chat_text.py`, `app/config.py`
**Tests:** `menteviva-backend/scripts/test_chatlab_smoke.py` (parte D: ChatGPT/gpt-5)

## Pendientes / ideas
- Costo acumulado por sesión persistido en BD/UI del ChatLab (sumar turnos) para
  verlo sin abrir logs.
- Instrumentar `chat_stream` (voz) con `include_usage` si se quiere costo en el
  flujo realtime.
- Actualizar tarifas en `llm_costs.PRICING` cuando cambien (los gpt-4.x son legacy).
