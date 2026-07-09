# Plan 09 — ChatLab: pulido UX + higiene de prompt (texto plano) + failover de keys Gemini

**Rama:** `feature/chat-lab-prompt-bench` · **Fecha:** 2026-07-08
**Origen:** sesión de pruebas del ChatLab (planes 07/08) con feedback en vivo del
dueño de producto. El ChatLab lo van a usar personas no técnicas para evaluar la
conversación, así que se pidió: (1) limpiar la UX (esconder lo técnico, arreglar
detalles rotos) y (2) corregir fugas del prompt que se leían feo/raro en voz.
Incluye el diagnóstico de un incidente 429 de cuota de Gemini en vivo.

Leyenda de urgencia: 🔴 rompe la experiencia · 🟡 afecta percepción de calidad · 🟢 pulido.

---

## A. UX/UI del ChatLab (`menteviva-frontend/src/pages/ChatLab.tsx`)

| # | Urg. | Cambio | Detalle |
|---|------|--------|---------|
| C1 | 🟡 | **Ventana de datos fuera del chat** | El formulario "Antes de empezar" (nombre, correo, rol, industria, nivel) vivía embebido dentro del scroll del área de mensajes y se veía apretado/cortado. Ahora es un **modal centrado propio** (`fixed inset-0`, backdrop, `max-w-md`, `max-h-90vh overflow-y-auto`), con botón ✕ para cerrar y poder escribir a mano. Dentro del chat solo queda un placeholder. |
| C2 | 🟢 | **Skeletons en telemetría** | Los valores "Esperando…" / "No ejecutado" / "—" (carga del prompt, modelo activo, latencia) se reemplazaron por *skeletons* animados (`Skeleton`) hasta que hay datos reales tras la primera ejecución. |
| C3 | 🟡 | **Campos obligatorios gatean el arranque** | `nombre` + `rol_objetivo` marcados con `*` y validados (`.trim()`). Derivado `registroCompleto` deshabilita "Comenzar entrevista" (modal) y "Que Inicie el Avatar" (panel) hasta llenarlos, con pista de lo que falta. Evita diagnósticos genéricos / errores. |
| C4 | 🟡 | **Icono de enviar roto** | Usaba `w-4.5 h-4.5` — clases **inexistentes en Tailwind** → el SVG quedaba sin tamaño (gigante) y `rotate-45` lo dejaba torcido. Cambiado por el icono `Send` de `lucide-react` (`w-4 h-4`), sin rotación. |
| C5 | 🟡 | **Botón "Reintentar"** | Tras un error (típico: 429 de cuota) el turno del usuario queda sin respuesta. `lastCallRef` guarda la última llamada (`{history, greet}`) y `retryLast()` la reejecuta desde el banner de error, sin reescribir. Ideal para esperar el cooldown del 429 y reintentar. |
| C6 | 🟡 | **"Limpiar consola" ya no re-pide datos** | El modal de datos ahora solo aparece cuando **faltan** obligatorios (`showRegistroModal` exige `!registroCompleto`). Con datos cacheados, limpiar solo borra la conversación. |
| C7 | 🟢 | **Lo técnico, comprimido** | Componente `CollapsibleSection` (cerrado por defecto). Colapsadas: **Ficha técnica**, **Motor de Ejecución** (proveedor/modelo/nivel) y **Telemetría**. Visibles para el tester: lista de conversaciones (nav lateral), selector de avatar y botones de acción. |
| C8 | 🔴 | **Sofia no arrancaba desde cache** | Efecto colateral de C6: con datos cacheados el modal no salía, pero el placeholder solo ofrecía "Abrir ventana de datos" — faltaba forma de disparar el saludo. Ahora, si `registroCompleto`, el placeholder muestra **🚀 Comenzar entrevista** (`startWithGreeting`) + "Editar mis datos". |

**Componentes nuevos en el archivo:** `Skeleton`, `CollapsibleSection`.
**Estado nuevo:** `registroClosedFor` (sesión para la que se cerró el modal),
`lastCallRef`. **Derivados:** `registroCompleto`, `showRegistroModal`.

**Conversaciones múltiples:** ya existía "+ Nueva" (arriba de "Sesiones de
Prueba"); crea una sesión independiente visible en el nav lateral, con datos
cacheados (no re-pregunta). Es el mecanismo para abrir una charla nueva sin
perder la anterior.

---

## B. Higiene del prompt: solo diálogo hablado

El entrevistador se evalúa por voz; se detectaron dos fugas que se leían mal:

### B1. 🟡 Markdown literal en las respuestas
Síntoma: *"hablemos de **resolución de problemas**…"* — los `**` se leían como
"asterisco asterisco" en voz. Causa: los **ejemplos del propio prompt** usaban
`**negrita**` y el modelo copia el formato de los ejemplos (gotcha ya conocido
en `CLAUDE.md`).

Fix en `app/prompts/entrevistador_prompt.md`:
- Quitados los `**` de los 7 "ARRANQUES DE PIVOT" (ahora texto plano).
- Regla nueva **TEXTO PLANO HABLADO** en *FORMATO DE CADA RESPUESTA (INVIOLABLE)*:
  prohíbe markdown (asteriscos, viñetas, títulos, code, emojis).

### B2. 🟡 Acotaciones / narración escénica
Síntoma: Sofia decía en voz alta *"Silencio. El candidato necesita espacio para
procesar."* en vez de callarse. Causa: la línea *"Si titubea, guardas silencio o
repreguntas"* — pero el modelo **siempre produce un turno**, no puede callarse,
así que **narra** la acción.

Fix en `app/prompts/entrevistador_prompt.md`:
- Reescrita la línea: "guardas silencio" → dar espacio con una repregunta breve;
  nota explícita de que todo lo emitido se dice en voz alta.
- Regla nueva **SOLO DIÁLOGO, CERO ACOTACIONES**: prohíbe narrar acciones/estados
  (`Silencio.`, `(pausa)`, `*asiente*`, `El candidato necesita…`, tercera persona).

### B3. Espejo en la ruta de voz nativa
`GEMINI_VOICE_ADDENDUM` (`app/services/gemini_live.py`) añadió las reglas 5
(texto plano) y 6 (solo diálogo) para que apliquen también en Gemini Live audio,
donde el audio se genera del texto interno del modelo (no se puede limpiar
server-side; el prompt es el único lever).

---

## C. Incidente 429 de Gemini + failover de keys

### C1. Diagnóstico (del log `logs/menteviva.log`)
```
2026-07-08 15:30:17 | WARNING | [ChatText] 429 en gemini/gemini-2.5-flash:
429 RESOURCE_EXHAUSTED — Quota exceeded for metric:
  generativelanguage.googleapis.com/generate_content_free_tier_requests,
  limit: 20, model: gemini-2.5-flash
  quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier — retry in 43s
```
Dos causas:
1. **La petición se sirvió con una key en plan gratuito** (`free_tier_requests`,
   tope 20/día). Ese error solo aparece cuando el proyecto de la key **no tiene
   billing habilitado**.
2. **El pool hacía round-robin ciego, sin failover** (`_next_gemini_key`): con 2
   keys repartía 1 y 1, pero cuando una petición caía en la key agotada, fallaba
   en vez de reintentar con la otra. Por eso "no pasaba a la de pago".

### C2. 🟡 Fix de código: failover entre keys
`app/services/gemini_live.py`:
- `_num_gemini_keys()` y `_should_try_next_key(e)` (reintenta en 429/cuota/auth/5xx;
  NO en bloqueo de contenido, modelo inexistente ni request inválido → mismo
  resultado con cualquier key).
- `generate_text` ahora envuelve la llamada en un bucle: hasta N intentos (N =
  nº de keys); cada `_gemini_client()` avanza el round-robin, así N intentos
  prueban N keys distintas. La última excepción propaga.
- Efecto: una vez agotada la key gratuita, las peticiones caen en la de pago
  automáticamente.

> Pendiente en `open_session` (Gemini Live voz): el failover aún no cubre la
> apertura de sesión Live; el 429 se dio en la ruta de texto (ChatLab).

### C3. Acción pendiente del usuario (no es código)
- **Habilitar billing** en el proyecto de la key de pago (AI Studio / Google
  Cloud). Sin billing sigue en free tier (20/día); con failover solo se suman
  cuotas gratuitas (~40/día con 2 keys) y luego ambas fallan.
- Ojo: en `.env`, `GEMINI_API_KEY` empieza con `AQ.` (formato atípico, 53 chars)
  vs `GEMINI_API_KEY2` = `AIzaSy…` (estándar, 39 chars). Verificar cuál es la de
  pago con billing.

---

## D. Archivos tocados

| Archivo | Cambios |
|---|---|
| `menteviva-frontend/src/pages/ChatLab.tsx` | C1–C8: modal de datos, skeletons, obligatorios, icono `Send`, botón Reintentar, no re-pedir datos al limpiar, secciones colapsables, botón Comenzar desde cache |
| `menteviva-backend/app/prompts/entrevistador_prompt.md` | B1/B2: quitados `**` de ejemplos, reglas de texto plano y solo-diálogo, reescrita línea de "silencio" |
| `menteviva-backend/app/services/gemini_live.py` | B3: reglas 5/6 en `GEMINI_VOICE_ADDENDUM`. C2: `_num_gemini_keys`, `_should_try_next_key`, failover en `generate_text` |

---

## E. Cómo validar

- **UI:** `npm run dev` (o `./start.bat`) → `/chat-lab`, avatar Sofia
  (diagnóstico). Con datos cacheados debe salir "Comenzar entrevista" sin re-pedir
  datos; secciones técnicas colapsadas; icono de enviar limpio.
- **Type-check:** `cd menteviva-frontend && npm run build` (tsc). Verde tras estos cambios.
- **Prompt (texto plano / sin acotaciones):** `cd menteviva-backend &&
  poetry run python -m scripts.test_chatlab_smoke` — **cuando haya cuota/billing**
  (hoy la ruta Gemini estaba en 429; el fix de prompt no se pudo probar en vivo).
  Confirmar que no se cuelan `**`, emojis ni frases-acotación (`Silencio.`, etc.).
