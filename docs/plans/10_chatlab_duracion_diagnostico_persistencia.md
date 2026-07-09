# Plan 10 — ChatLab: duración/progreso, diagnóstico visual + coach_note, guardrail de acotaciones, ratings y persistencia en BD

**Rama:** `feature/chat-lab-prompt-bench` · **Fecha:** 2026-07-08
**Origen:** continuación de la sesión del plan 09, con más feedback en vivo del
dueño de producto probando el ChatLab con Sofia (diagnóstico) sobre Gemini.
Cubre: duración de práctica (25/40/60), barra de progreso, rediseño visual del
diagnóstico + nota "coach", guardrail server-side contra acotaciones habladas,
ratings por respuesta, badge de LLM por sesión y persistencia de conversaciones
en Postgres.

Leyenda de urgencia: 🔴 rompe la experiencia · 🟡 afecta percepción de calidad · 🟢 pulido.

---

## A. Duración de práctica + barra de progreso

Referencia: el GPT de Brandon (Elena) ofrece práctica de **25/40/60 min**. El
backend ya tenía `minutos` como `session_var` (default 25) que marca el ritmo del
entrevistador, pero **el ChatLab no la enviaba ni la exponía**.

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| D1 | 🟡 | Selector **25/40/60 min** en el onboarding + **botón en el header** del chat, cambiable en cualquier momento. | `ChatLab.tsx` (`DURATIONS`, `durationMin` en `ChatSession`) |
| D2 | 🟡 | Se envía `session_vars: { minutos }` en `/api/chat` y `/api/chat/diagnostico` (antes se ignoraba → siempre 25). | `ChatLab.tsx` (`callChat`, `generateDiagnostico`) |
| D3 | 🟢 | **Barra de progreso** hacia el diagnóstico (solo Sofia, ya iniciada): % = intercambios del usuario / meta derivada de la duración (`targetExchanges = max(4, round(min/3))`). Al marcar cierre salta a 100% verde con hint de "Generar Diagnóstico". | `ChatLab.tsx` (header del chat) |

---

## B. Diagnóstico: rediseño visual + nota del coach

Se comparó nuestro diagnóstico contra el de ChatGPT (`conversacionconCHATGPT.txt`).
Estructuralmente ya coincidíamos (resumen, strengths ev.+por qué, gaps ev.+impacto+
micro-práctica, blind spot, pregunta). **Lo único que faltaba: la "Observación
adicional como coach"** (nota cálida que cita una frase del usuario).

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| B1 | 🟡 | **`coach_note`** end-to-end: campo en el modelo + instrucción en el prompt del analizador (con regla de NO inventar calidez genérica) + render con estilo propio (💛 "Una nota de tu coach"). Optional/retrocompatible. | `models/user_profile.py`, `services/analysis.py`, `ChatLab.tsx` |
| B2 | 🟢 | **Modal de diagnóstico visual**: hero con nombre + chips de competencias foco + 3 tiles de conteo (Fortalezas/A mejorar/Competencias); strengths y gaps con badge numerado y barra de acento; micro-práctica como callout 🎯; patrones verbales como **chips semáforo** (`freqBadge`: alta=rojo/media=amarillo/baja=verde); verbos vagos como etiquetas. | `ChatLab.tsx` |

**Aclaración de arquitectura (para evaluar "a Gemini"):** en el ChatLab, Gemini
**solo conduce la entrevista**; el **diagnóstico lo genera SIEMPRE Groq
(gpt-oss-120b)** vía `analysis.py`. Así que "el diagnóstico le falta" = material
que sacó la entrevista + prompt del analizador (Groq), no Gemini. Para evaluar la
conducción de Gemini hace falta un transcript Gemini (botón 📥 de exportar).

---

## C. 🟡 Guardrail: acotaciones escénicas habladas ("Silencio.")

Síntoma recurrente: Sofia emitía como texto *"Silencio. El candidato necesita
espacio para procesar."* en vez de callarse. El fix por prompt (plan 09) NO bastó
porque **Gemini ignora la regla dentro del maestro de 26k**.

Fix: **sanitizador server-side** `_strip_stage_directions()` en `chat_text.py`,
aplicado al `reply` de todos los motores antes de devolverlo:
- Quita `*asiente*`, `(pausa/silencio/…)`, `"Silencio."`, `"El candidato
  necesita…"`, `"Espero su respuesta…"`.
- **Conservador**: no toca diálogo real (`"necesito silencio para concentrarme"`
  se conserva). Validado con la frase exacta + casos límite.
- Si el turno entero era una acotación, queda `""` → cae al manejo de respuesta
  vacía (aviso + botón Reintentar).
- La voz nativa de Gemini NO pasa por aquí (su audio se genera del texto interno);
  ahí sigue dependiendo del prompt.

---

## D. Ratings + identificación del motor por sesión

| # | Urg. | Cambio | Dónde |
|---|------|--------|-------|
| E1 | 🟢 | **Like/dislike** (👍/👎) en cada respuesta del avatar (como los chats de LLM). Toggle, persiste en localStorage + BD, y va en el export a Markdown (👍/👎 junto al turno). | `ChatLab.tsx` (`ChatMsg.feedback`, `setMessageFeedback`) |
| E2 | 🟢 | **Badge de LLM por sesión** en el panel lateral: proveedor (Gemini/Groq/GPT con color) + modelo específico bajo el nombre. | `ChatLab.tsx` (`PROVIDER_BADGE`) |

---

## E. Persistencia de conversaciones en Postgres

**Antes:** solo el *diagnóstico* (con su conversación) llegaba a BD al generarlo;
las conversaciones en curso vivían solo en `localStorage`.

**Ahora:** cada conversación del ChatLab se **auto-guarda en Postgres** tras cada
turno y cada rating.

| Pieza | Dónde | Notas |
|---|---|---|
| Tabla `chatlab_conversations` | `db.py` (migración **v3**) | PK `session_id` (id del frontend). Sin FK a `users` (el banco usa ids `chatlab:*`). `conversation_json` incluye el feedback por mensaje |
| `save_chatlab_conversation(...)` | `services/user_repo.py` | Upsert idempotente por `session_id` |
| `POST /api/chat/conversation` | `routers/chat_text.py` (`SaveConversationRequest`) | Persistencia no-fatal (si BD falla, `saved:false`, la UI sigue con localStorage) |
| Auto-guardado | `ChatLab.tsx` (`saveConversation`) | Fire-and-forget tras cada turno y cada rating |

**Semántica (documentada para el usuario):**
- No guarda estado vacío → al **"Limpiar Consola"** la BD conserva lo previo.
- "Limpiar" **reutiliza el mismo `session_id`**: si empiezas otra charla en ese
  slot, sobreescribe su fila. **Para conservar la anterior, usar "+ Nueva"**
  (nuevo `session_id` → fila nueva).
- El `user_id` se deriva del nombre (`chatlab:<slug>`), consistente con el
  diagnóstico.

> ⚠️ Requiere **reiniciar el backend** para aplicar la migración v3 (crea la
> tabla) y exponer el endpoint. En el log de arranque: "[migrate v3] OK".

---

## F. Aclaraciones dadas (no fueron bugs)

- **"¿Ya no usa el maestro?"** → Sí lo usa. ChatLab + Gemini + Sofia usa
  `get_system_prompt` (maestro, ~26k, `prompt=26732 chars` en el log). El prompt
  conciso de voz es opt-in (`use_voice_prompt=true`), que el ChatLab nunca manda.
- **"El de 25 min cortó cosas / ya no explica de qué va"** → No es regresión: el
  backend ya usaba `minutos=25` por default. "Explicar de qué va" = **Fase 2
  (Encuadre)** del maestro, que ocurre tras el rapport. El mapa de fases es por
  **porcentaje** (10/5/25/50/10), no elimina el encuadre; Gemini simplemente lo
  omite (adherencia débil al maestro de 26k). Sugerencia: probar 40 min.
- **Seguridad:** `TESTDECLAVES.txt` (sin trackear) contiene API keys reales
  (Anthropic, Google Maps, Brave, ElevenLabs) → borrar/mover y **rotar** las keys.

---

## G. Archivos tocados

| Archivo | Cambios |
|---|---|
| `menteviva-frontend/src/pages/ChatLab.tsx` | Duración (modal+header), `session_vars`, barra de progreso, modal de diagnóstico visual + `coach_note`, like/dislike, badge de LLM, auto-guardado en BD |
| `menteviva-backend/app/routers/chat_text.py` | `_strip_stage_directions`, `session_vars` pass-through, `POST /api/chat/conversation` |
| `menteviva-backend/app/services/analysis.py` | `coach_note` en prompt + guía |
| `menteviva-backend/app/models/user_profile.py` | campo `coach_note` |
| `menteviva-backend/app/db.py` | migración v3 (`chatlab_conversations`) |
| `menteviva-backend/app/services/user_repo.py` | `save_chatlab_conversation` |

---

## H. Cómo validar

- **UI:** `npm run dev` → `/chat-lab`, Sofia. Verifica: botón de duración en el
  header, barra de progreso, like/dislike, badge de LLM por sesión, modal de
  diagnóstico con hero/chips/tiles.
- **Type-check:** `cd menteviva-frontend && npm run build` (tsc). Verde.
- **BD:** reiniciar backend → log "[migrate v3] OK"; charlar en el ChatLab y
  confirmar filas en `chatlab_conversations` (con feedback en `conversation_json`).
- **Prompt (coach_note, sin acotaciones):** `scripts/test_diagnostico_replay.py`
  (analizador = Groq, cero Gemini) valida `coach_note` sin gastar cuota Gemini.
  El guardrail de acotaciones ya está validado con casos unitarios de regex.
  **Pendiente de correr en vivo** (no se ejecutó por cuota).
