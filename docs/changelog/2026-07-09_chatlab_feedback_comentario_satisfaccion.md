# 2026-07-09 — ChatLab: comentario de dislike + encuesta de satisfacción del diagnóstico

**Rama:** `feature/chat-lab-prompt-bench`
**Origen:** petición del usuario — poder capturar *por qué* no gustó una respuesta
(retroalimentación cualitativa) y una encuesta de satisfacción al final del
diagnóstico, todo registrado con la conversación para evaluar la calidad.

## Qué se agregó

1. **Comentario del 👎 (por mensaje).** Al dar dislike a una respuesta del avatar
   aparece un ícono ℹ️ al lado de los pulgares. Al pulsarlo se abre un modal para
   escribir *por qué no gustó* (opcional). El comentario queda visible inline bajo
   el mensaje y el ícono se resalta (teal + "nota") cuando ya hay texto.
2. **Encuesta de satisfacción del diagnóstico.** Al cerrar el modal de diagnóstico
   (o desde un CTA "Calificar" dentro de él) se abre un modal con **estrellas 1–5**
   + **comentario opcional**. Si ya se calificó, el CTA muestra el resumen y permite
   editar.
3. **Persistencia end-to-end.** Ambos se guardan con la conversación del ChatLab en
   Postgres, además de exportarse en el Markdown del historial.

## Cambios

### Backend

- **`app/db.py`** — migración `v4`: `ALTER TABLE chatlab_conversations ADD COLUMN
  IF NOT EXISTS satisfaction_json TEXT`. El comentario por-mensaje NO necesita
  columna: viaja dentro de `conversation_json` (campo `feedback_comment` por mensaje).
- **`app/services/user_repo.py::save_chatlab_conversation`** — nuevo parámetro
  `satisfaction: dict | None`. Se serializa a `satisfaction_json`. El upsert usa
  `COALESCE(EXCLUDED.satisfaction_json, existente)` para **no borrar** una encuesta
  previa cuando un turno posterior guarda sin traerla.
- **`app/routers/chat_text.py::SaveConversationRequest`** — nuevos campos
  `feedback_comments: list[str|None]` (alineado por índice con `messages`) y
  `satisfaction: dict | None`. En el loop de guardado se incrusta `feedback_comment`
  por mensaje; `satisfaction` se pasa al repo.

### Frontend — `src/pages/ChatLab.tsx`

- `ChatMsg.feedbackComment?: string`; `ChatSession.satisfaction?: SatisfactionInfo`
  (`{rating, comment, submittedAt}`).
- Estado nuevo: `feedbackModalIndex`/`feedbackDraft` (modal del dislike) y
  `showSatisfaction`/`satRating`/`satHover`/`satComment` (encuesta).
- Handlers: `openFeedbackModal`, `saveFeedbackComment`, `submitSatisfaction`,
  `openSatisfaction`, `closeDiag` (encadena la encuesta al cerrar el diagnóstico
  si aún no se calificó).
- `saveConversation` ahora envía `feedback_comments` y `satisfaction` (snake_case
  `submitted_at`) al backend. Acepta `opts.satisfaction` para el guardado inmediato
  al enviar la encuesta.
- UI: ícono ℹ️ tras el 👎, comentario inline, dos modales nuevos, CTA de satisfacción
  dentro del modal de diagnóstico. `exportSession` incluye el comentario del dislike
  (blockquote) y la sección "Satisfacción del Diagnóstico" (★/5 + comentario).

## Verificación

- `npx tsc --noEmit` (frontend) → sin errores.
- `python -m py_compile` de los 3 módulos backend → OK.
- **Pendiente de prueba real:** correr el ChatLab, dar 👎 + comentario y enviar la
  encuesta; confirmar en BD (`chatlab_conversations.satisfaction_json` y
  `conversation_json[*].feedback_comment`). La migración v4 se aplica sola al
  arrancar el backend (`apply_migrations`).
