# Plan 12 — ChatLab: fixes de la revisión (reparto multi-agente Claude / Gemini / OpenCode)

**Rama:** `feature/chat-lab-prompt-bench` · **Fecha:** 2026-07-08
**Origen:** revisión de código del ChatLab (frontend `ChatLab.tsx` + router
`chat_text.py`) posterior al plan 11. Se detectó 1 bug de corrupción de datos,
varias carreras menores de estado, y mejoras de valor ya priorizadas (una de
ellas era "pendiente" explícito del plan 11: costo en la UI).

Leyenda de urgencia: 🔴 rompe la experiencia/datos · 🟡 afecta percepción/decisión · 🟢 pulido.

**Reparto:** lo más complejo (estado React con carreras + instrumentación de
costos end-to-end en 3 servicios) → **Claude**; tareas medianas y autocontenidas
→ **Gemini CLI**; pulido mecánico de bajo riesgo → **OpenCode**.

---

## ⚠️ Coordinación entre agentes (leer antes de empezar)

Los tres bloques tocan `ChatLab.tsx`. Para evitar conflictos de merge, el orden
de ejecución es **secuencial, no paralelo**:

1. **Claude** (bloques A y B) — primero, porque reestructura el estado de
   sesión/telemetría del que dependen los demás.
2. **Gemini** (bloques C y D) — después de que A/B estén commiteados.
3. **OpenCode** (bloque E) — al final; es pulido sobre el código ya asentado.

Cada agente commitea su bloque completo antes de que arranque el siguiente.
Si un agente encuentra que otro ya resolvió parte de su tarea, lo salta y lo
anota en el commit — no lo re-implementa distinto.

**Verificación (convención del repo — scripts sintéticos, no clicks):**
- Frontend: `cd menteviva-frontend && npm run build` (tsc limpio; no hay lint aparte).
- Backend: `poetry run python -m py_compile` de los módulos tocados +
  `poetry run python -m scripts.test_chatlab_smoke` (exit 0). Ojo: pega a APIs
  reales — un 429 al re-correr es cuota agotada, no un bug.
- Los scripts escriben su salida a `logs/*.txt` (stdout se lo traga la consola).

---

## Bloque A · 🔴 Carreras de estado cross-sesión — **CLAUDE** ✅ HECHO (2026-07-08)

### A1 🔴 «Reintentar» corrompe otra sesión

`error` y `lastCallRef` son estado global del componente, no por sesión
(`ChatLab.tsx:218`, `ChatLab.tsx:244`). Si falla una llamada en la sesión A,
el usuario cambia a la sesión B y pulsa «Reintentar», `retryLast()` ejecuta
`callChat` con el **historial de A** contra el **avatar/proveedor/modelo de B**,
y el resultado sobrescribe los mensajes de B vía `updateActiveSession`.

| # | Cambio | Dónde |
|---|--------|-------|
| A1.a | Guardar `sessionId` dentro de `lastCallRef` (`{ sessionId, history, greet }`). | `ChatLab.tsx` |
| A1.b | Al cambiar `activeSessionId`: limpiar `setError(null)` y descartar `lastCallRef` si `lastCallRef.current.sessionId !== nuevoId` (efecto sobre `activeSessionId`). | `ChatLab.tsx` |
| A1.c | `retryLast()` no ejecuta si `lastCallRef.current.sessionId !== activeSessionId` (cinturón y tirantes). | `ChatLab.tsx` |
| A1.d | Toda escritura asíncrona de `callChat` debe ir dirigida a la sesión que originó la llamada, no a la activa: `updateSession(sessionId, updates)` genérico (el `updateActiveSession` actual pasa a ser un wrapper). | `ChatLab.tsx` |

### A2 🟡 Feedback 👍/👎 perdido durante llamada en vuelo

Si el usuario califica un mensaje mientras `loading`, la respuesta que llega
sobrescribe `messages` con el `history` capturado **antes** del rating.

| # | Cambio | Dónde |
|---|--------|-------|
| A2.a | En el callback de éxito de `callChat`, hacer el merge dentro del updater de estado: tomar los `messages` **actuales** de la sesión y anexar solo la respuesta del avatar (no reemplazar con la copia capturada). Conservar `feedback` existente por índice. | `ChatLab.tsx` |

### A3 🟡 `saveInfo` del diagnóstico es global

El banner «✓ Guardado (diagnostic_id=…)» puede mostrarse en la sesión equivocada.

| # | Cambio | Dónde |
|---|--------|-------|
| A3.a | Mover `saveInfo` dentro de `ChatSession` (junto a `diagnostico`), persistido en localStorage como el resto. | `ChatLab.tsx` |

**Criterio de aceptación A:** reproducir mentalmente (o con un test manual
rápido) los 3 escenarios: (1) error en A → cambiar a B → el banner desaparece y
no hay botón de retry aplicable a B; (2) rating durante loading sobrevive a la
respuesta; (3) el banner de guardado corresponde a la sesión activa.
`npm run build` limpio.

---

## Bloque B · 🟡 Costo y tokens por turno en la UI — **CLAUDE** ✅ HECHO (2026-07-08)

Pendiente explícito del plan 11: hoy el costo solo vive en `logs/menteviva.log`
(`llm_costs.log_llm_cost`). Objetivo: verlo por turno y acumulado por sesión en
el ChatLab, para la comparación costo-vs-calidad que pidió el dueño de producto.

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| B1 | 🟡 | Los 3 servicios devuelven `usage` además del texto: `chat_complete` (Groq, `response.usage`), `generate_text` (Gemini, `usage_metadata`; output = candidates + thoughts), `chat_complete_openai` (`usage`). Forma común: `{"input_tokens": int, "output_tokens": int}` o `None` si el proveedor no lo dio. **No tocar `chat_stream` (hot path de voz).** Cuidar los callers existentes (conversation.py, scripts) — cambiar la firma de forma retro-compatible o con función/flag nuevo. | `groq_llm.py`, `gemini_live.py`, `openai_llm.py` |
| B2 | 🟡 | `llm_costs.py`: además de loguear, exponer `estimate_cost(model, in_tok, out_tok) -> float | None` reutilizando `price_for()`. | `llm_costs.py` |
| B3 | 🟡 | `ChatResponse` gana `input_tokens`, `output_tokens`, `cost_usd` (opcionales, `None` si no hubo usage). El router los llena para los 3 proveedores. | `chat_text.py` |
| B4 | 🟡 | Frontend: `ChatMsg` guarda `inputTokens/outputTokens/costUsd` del turno; telemetría muestra «Costo últ. turno / acumulado sesión»; la lista lateral de sesiones muestra el acumulado (`~$0.0123`) junto al badge de proveedor. Sesiones viejas sin costo → mostrar «—». | `ChatLab.tsx` |
| B5 | 🟢 | Incluir el costo acumulado en `exportSession` (línea en el encabezado del Markdown). *(Si Gemini llega antes al export en el bloque D, respetar su estructura.)* | `ChatLab.tsx` |

**Criterio de aceptación B:** `test_chatlab_smoke.py` extendido con una
aserción de que `/api/chat` devuelve `cost_usd > 0` con Groq (el motor barato);
`npm run build` limpio; un turno real muestra costo en telemetría.

---

## Bloque C · 🟡 Guard de acceso al banco de pruebas — **GEMINI** ✅ HECHO (2026-07-08)

`/api/chat`, `/api/chat/diagnostico` y `/api/chat/conversation` no tienen auth,
y el deploy del piloto va por tunnel público de Cloudflare: cualquiera con la
URL puede quemar cuota de Groq/Gemini/OpenAI eligiendo modelo a placer
(`req.model` es libre). Guard mínimo sin fricción para el equipo:

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| C1 | 🟡 | Setting `chatlab_token: str = ""` en `config.py` + entrada documentada en `.env.example` (`CHATLAB_TOKEN=`). | `config.py`, `.env.example` |
| C2 | 🟡 | Dependencia FastAPI en el router `chat_text`: si `settings.chatlab_token` está vacío → passthrough (dev local sin fricción); si está seteado → exigir header `X-ChatLab-Token` igual al token, si no `401`. Aplicar a los 4 endpoints del router (incluido GET /avatars). | `chat_text.py` |
| C3 | 🟡 | Frontend: campo «Token de acceso» en la sección técnica colapsable (⚙️), persistido en `localStorage["chatlab_token"]`; `apiFetch` del ChatLab manda el header si hay valor. Ante un 401, el banner de error debe decir claramente que falta/expiró el token. | `ChatLab.tsx` |
| C4 | 🟢 | Nota en el docstring del router y en el plan de deploy: en prod setear `CHATLAB_TOKEN` (el piloto está en tunnel público). | `chat_text.py` |

**Criterio de aceptación C:** con `CHATLAB_TOKEN` vacío todo funciona igual que
hoy; con token seteado, curl sin header → 401, con header → 200. `py_compile`
limpio, `npm run build` limpio. **No** tocar el estado de sesiones ni la
telemetría (eso es de Claude, bloque A/B — ya estará commiteado).

---

## Bloque D · 🟡 Export completo de sesión — **GEMINI** ✅ HECHO (2026-07-08)

`exportSession` (`ChatLab.tsx`) exporta solo el historial: no incluye el
`registro` (quién era el candidato) ni el **diagnóstico generado**, que es justo
lo que se comparte con Brandon/Cris al comparar motores.

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| D1 | 🟡 | Encabezado del Markdown gana el registro efectivo (nombre, rol objetivo, industria, nivel, duración) cuando la sesión es de diagnóstico. | `ChatLab.tsx` |
| D2 | 🟡 | Si `session.diagnostico` existe, anexar sección `## Diagnóstico` con: resumen ejecutivo, competencias foco, fortalezas (skill/evidencia/por qué), gaps (skill/evidencia/impacto/micro-práctica), punto ciego, pregunta de reflexión, nota del coach, patrones verbales y siguiente práctica sugerida. Formato legible para no-técnicos (es para producto). | `ChatLab.tsx` |
| D3 | 🟢 | Si los mensajes traen costo (bloque B ya mergeado), incluir «Costo estimado de la sesión» en el encabezado. | `ChatLab.tsx` |

**Criterio de aceptación D:** exportar una sesión con diagnóstico produce un
`.md` con las 3 partes (metadatos+registro, historial, diagnóstico);
`npm run build` limpio.

---

## Bloque E · 🟢 Pulido mecánico — **OPENCODE** ✅ HECHO (2026-07-08, revisado por Claude)

Cambios pequeños, autocontenidos y de bajo riesgo. **Ejecutar al final.**

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| E1 | 🟢 | Docstring de `ChatRequest.provider` dice `"groq" \| "gemini"`; falta `"chatgpt"`. | `chat_text.py` |
| E2 | 🟢 | El manejo de `[CIERRE]` está triplicado en las 3 ramas de proveedor → helper `_extract_closing(reply) -> tuple[str, bool]`. | `chat_text.py` |
| E3 | 🟢 | `onKeyDown` del textarea: no enviar si `e.nativeEvent.isComposing` (IME). | `ChatLab.tsx` |
| E4 | 🟢 | Envolver los `localStorage.setItem` de `updateActiveSession`/`setSessions` en try/catch (un `QuotaExceededError` hoy revienta dentro del updater de React). Log a `console.warn`, la app sigue con estado en memoria. | `ChatLab.tsx` |
| E5 | 🟢 | ~~`saveConversation` persiste `modelName` atrasado~~ **✅ ya resuelto por el bloque A** (`saveConversation` ahora recibe `res.model_name` explícito) — OpenCode: saltar. | `ChatLab.tsx` |
| E6 | 🟢 | Nombres de sesión nueva pueden colisionar tras borrar (`Sesión ${sessions.length + 1}`) → derivar del máximo sufijo numérico existente + 1. | `ChatLab.tsx` |

**Criterio de aceptación E:** `npm run build` + `py_compile` limpios; cero
cambios de comportamiento visibles salvo los descritos.

---

## Fuera de alcance (anotado para después)

- Partir `ChatLab.tsx` (1619+ líneas) en componentes (modales de registro y
  diagnóstico son los candidatos naturales) — refactor grande, mejor como plan
  propio cuando el banco se estabilice.
- Botón «Cancelar» con `AbortController` para llamadas lentas (Gemini ~12 s) —
  útil pero requiere tocar `apiFetch` compartido; evaluar tras el bloque B.
- Instrumentar `chat_stream` (voz realtime) con `include_usage` — pendiente
  heredado del plan 11, sigue fuera para no tocar el hot path.

## Archivos tocados (esperado)

**Frontend:** `menteviva-frontend/src/pages/ChatLab.tsx` (A, B4-B5, C3, D, E3-E6)
**Backend:** `app/routers/chat_text.py` (B3, C2, C4, E1-E2), `app/config.py` (C1),
`.env.example` (C1), `app/services/{groq_llm,gemini_live,openai_llm,llm_costs}.py` (B1-B2)
**Tests:** `menteviva-backend/scripts/test_chatlab_smoke.py` (B, C)

---

## ✅ Cierre del plan (2026-07-08) — los 5 bloques HECHOS

Ejecución real: **Claude (A+B) → OpenCode (E) → Gemini (C+D)** — E se adelantó a
C/D sin conflicto porque era pulido independiente. Claude revisó los bloques de
los otros dos agentes contra el diff real.

### Cómo quedó implementado (decisiones que difieren o precisan el plan)

- **A**: además de lo planeado, `callChat`/`generateDiagnostico` capturan la
  sesión de ORIGEN completa al despachar; el merge de la respuesta se hace sobre
  el estado vivo vía `sessionsRef` (espejo en ref), y si la consola se limpió en
  vuelo la respuesta huérfana se DESCARTA (antes reaparecía). El error de una
  llamada solo se muestra si su sesión sigue activa. `saveConversation(session,
  msgs, opts)` recibe la sesión explícita + `model` real de la corrida (esto
  resolvió E5 de paso).
- **B**: `return_usage=True` opcional en los 3 servicios (retro-compatible: los
  scripts que esperan `str` no se tocaron). En Groq el usage se ACUMULA entre
  reintentos (se pagan todos los intentos). `cost_usd` redondeado a 6 decimales.
  Provider `chatgpt` mapea a la tabla `openai` de PRICING. Telemetría muestra
  además «Tokens últ. (in/out)».
- **C**: la dependencia va en el constructor del router
  (`APIRouter(dependencies=[Depends(verify_chatlab_token)])`) → cubre los 4
  endpoints. CORS ya permitía el header (`allow_headers=["*"]`). Test dedicado
  `scripts/test_chatlab_security.py` (TestClient, sin APIs reales, 4 casos).
- **D**: el export además mapea `experience_level` a etiqueta legible.
- **E**: E5 saltado (resuelto por A). E1-E4, E6 como se especificó.

### Hallazgos de la revisión cruzada (corregidos en el momento)

1. Export D1: el mapeo de nivel solo cubría junior/mid/senior — `entry`/`lead`/
   `executive` exportaban «N/A». → mapa completo con fallback al valor crudo.
2. `localStorage.setItem` del token sin try/catch (regla E4). → envuelto.

### Verificación (todo re-corrido de forma independiente en la revisión)

- `npm run build` (tsc + vite) limpio tras cada bloque.
- `py_compile` de los módulos backend tocados: OK.
- `scripts/test_chatlab_smoke.py`: exit 0, con la nueva aserción `cost_usd > 0`
  (Groq). Costos reales medidos por turno del entrevistador (~7k tok input):
  Groq gpt-oss-20b **$0.0002** · gpt-5.4-mini **$0.0056** · Gemini 3.5-flash
  **$0.0165** — confirma la recomendación del plan 11 (Groq ~30-80× más barato).
- `scripts/test_chatlab_security.py`: 4 asserts OK (sin header → 401, token
  malo → 401, token bueno → 200, vacío → passthrough).

### Pendientes que deja este plan

- ⚠️ **Deploy**: setear `CHATLAB_TOKEN` en el `.env` del server Debian del
  piloto (tunnel público de Cloudflare) — sin eso el guard es passthrough.
- Nit conocido: el campo «Token de acceso» re-dispara `GET /avatars` por cada
  tecla (dep del efecto en `chatlabToken`). Inofensivo (endpoint barato, sin
  LLM) y sirve de auto-retry; debounce si molesta.
- Los «Fuera de alcance» de arriba siguen vigentes (split de ChatLab.tsx,
  AbortController, `include_usage` en voz).
