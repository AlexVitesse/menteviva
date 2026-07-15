# Plan 14 — VoiceLab: ChatLab de voz con Gemini Live (sin video)

**Rama:** `feature/chat-lab-prompt-bench` · **Fecha:** 2026-07-15
**Tipo:** prospectivo (división de trabajo entre agentes: Claude / OpenCode / Gemini)

---

## Contexto

El **ChatLab** (`/chat-lab`, `menteviva-frontend/src/pages/ChatLab.tsx` + `menteviva-backend/app/routers/chat_text.py`) es un banco de pruebas de prompts **solo texto**: sesiones en localStorage + BD, telemetría por turno, feedback 👍/👎 con comentario, diagnóstico end-to-end, encuesta de satisfacción, cronómetro, registro de errores y export a Markdown.

Se quiere **la misma herramienta conducida por voz** con **Gemini Live** (audio nativo bidireccional) **sin video** (sin el avatar Simli): hablar con Sofia por micrófono, ver captions en el chat y, al terminar, obtener el mismo diagnóstico y bitácora que hoy da el ChatLab de texto — para iterar la **conducción de la entrevista** escuchándola de verdad.

### Decisiones de diseño
1. **Página nueva `/voice-lab`** que reusa el shell del ChatLab; el ChatLab de texto queda intacto. Botón en el header alterna Texto ↔ Voz.
2. **Solo Sofia / diagnóstico** (`entrevistador`). El prompt conciso de voz + `GEMINI_VOICE_ADDENDUM` solo existe para el entrevistador; Roberto/Maria en native-audio hacen eco (documentado en CLAUDE.md).
3. **Ruta WS dedicada `/api/chat/voice/{avatar_id}`** que siempre corre Gemini Live y exige `X-ChatLab-Token` (vía query param en WS). Producción (`/api/conversation`) y el flag global `realtime_provider` quedan sin tocar.

### Insight que simplifica la implementación
El frontend ya recibe los transcripts en vivo (`user_message` / `output_transcript` / `turn_complete`), así que reconstruye el mismo `ChatMsg[]` que hoy arma el ChatLab. Por lo tanto la ruta WS de voz es **solo un proxy de audio + transcripts** (sin análisis ni persistencia server-side); el diagnóstico y el guardado se disparan desde el frontend **reusando los endpoints REST existentes** (`/api/chat/diagnostico`, `/api/chat/conversation`). Cero duplicación de la lógica de análisis.

### Limitación conocida
Gemini Live audio **no reporta tokens/costo/latencia por turno**. El VoiceLab conserva: duración, nº de intercambios, transcripts, feedback, satisfacción, errores y diagnóstico. Los campos de costo/tokens quedan `undefined` (la UI ya lo tolera). Se documenta en el changelog.

---

## División de tareas por capacidad

> **Regla:** Claude toma lo más complejo/riesgoso (async/concurrency, audio en tiempo real, refactor delicado). OpenCode toma construcción de UI acotada sobre patrones existentes. Gemini toma trabajo mecánico/documental de bajo riesgo.

### 🔴 Claude — núcleo complejo y de riesgo

| ID | Tarea | Archivos |
|----|-------|----------|
| **C1** | **Backend: ruta WS proxy de voz.** Añadir `finalize: bool = True` a `_run_gemini_conversation` (con `finalize=False` no llama `_finalize_and_analyze`; emite `session_end` sin metrics y retorna). Nueva ruta WS `/chat/voice/{avatar_id}` con token guard por query param (`close(1008)` si no coincide con `settings.chatlab_token`), que corre Gemini **incondicionalmente**. No toca `/api/conversation`. | `menteviva-backend/app/routers/conversation.py` |
| **C2** | **Hook de voz en tiempo real** callback-driven (hermano de `useGeminiLive.ts`, no lo modifica). Reusa `PCMStreamPlayer`/`int16BufferToBase64`/`pcm16Rms` de `utils/pcm.ts` + worklet existente. Echo-gate, audio-gate, barge-in, playback PCM24 **local** (sin Simli). Callbacks en vez de store. URL con `?token=`. | `menteviva-frontend/src/hooks/useVoiceLab.ts` (nuevo) |
| **C3** | **Módulo compartido `src/pages/chatlab/`** (tipos, helpers, `exportSession`, y los componentes `CollapsibleSection`/`Skeleton`/`DiagnosticoModal`/`SatisfactionModal`/`FeedbackModal`). **Decisión de riesgo:** `ChatLab.tsx` se dejó INTACTO (no se refactorizó para importar del módulo) — el banco de texto no se toca, a cambio de una duplicación temporal de tipos. El módulo compartido es la fuente canónica para VoiceLab. | `menteviva-frontend/src/pages/chatlab/{types,helpers,export,components}` (nuevos) |
| **C4** | **Integración final + verificación e2e.** Cablear `VoiceLab.tsx` ↔ `useVoiceLab` ↔ REST; resolver sincronía/persistencia; correr verificación. *(Bloqueada hasta O1/O2.)* | — |

### 🟡 OpenCode — UI acotada sobre patrones existentes

| ID | Tarea | Archivos |
|----|-------|----------|
| **O1** | **Página `VoiceLab.tsx`**: vista tipo "llamada" adaptada de `Diagnostico.tsx` (`ConversationIndicator`, Mic/Mute/Terminar, captions) **sin** Simli/video. Reusa el modelo de sesión del ChatLab y los componentes extraídos (C3). Flujo: Iniciar → permiso mic (`isSecureOriginForMic`) → `connect()`+`startMic()`; mensajes → `messages[]` + `saveConversation()` (`provider:"gemini"`); `onClosingIntent` → countdown; "Terminar y generar diagnóstico" → `POST /api/chat/diagnostico` → modal + satisfacción. Reusa feedback/export. **Depende de C2 y C3.** | `menteviva-frontend/src/pages/VoiceLab.tsx` (nuevo) |
| **O2** | **Ruteo y navegación**: `<Route path="/voice-lab">` sin `OnboardingGuard`; botón Texto ↔ Voz 🎙️ en ambos headers. | `menteviva-frontend/src/App.tsx`, `ChatLab.tsx`, `VoiceLab.tsx` |

### 🟢 Gemini — mecánico / documental, bajo riesgo

| ID | Tarea | Archivos |
|----|-------|----------|
| **G1** | **Documentación**: plan prospectivo (este doc si hace falta ampliarlo) + changelog retrospectivo al cerrar. | `docs/plans/`, `docs/changelog/` |
| **G2** | **Config**: notas en `.env.example` (recordatorio `CHATLAB_TOKEN` para el guard del WS del lab; keys `GEMINI_API_KEY_2/3/4`); documentar que el lab de voz **no** usa `realtime_provider`. | `menteviva-backend/.env.example` |
| **G3** | **Checklist de QA manual**: guion paso a paso (permiso mic, HTTPS/tunnel, saludo, ritmo/cierre, diagnóstico, export) + notas de cuota (20 req/día por key por modelo). Insumo para C4. | (doc) |

---

## Estado de implementación (Claude, 2026-07-15)

- ✅ **C1** — ruta WS `/api/chat/voice/{avatar_id}` + parámetro `finalize` en `_run_gemini_conversation`. Verificado con `python -m py_compile`.
- ✅ **C2** — `src/hooks/useVoiceLab.ts` creado. Verificado con `npm run build` (tsc).
- ✅ **C3** — `src/pages/chatlab/{types,helpers,export,components}.ts(x)` creados. `ChatLab.tsx` **sin cambios** (ver decisión de riesgo arriba). Verificado con `npm run build` (tsc).
- ✅ **C4** — integración verificada:
  - `npm run build` (tsc) OK con VoiceLab integrado.
  - Ruta WS `/api/chat/voice/{avatar_id}` registrada (y `/api/conversation` intacta).
  - Token guard probado in-process (TestClient): token malo/ausente → `close 1008`; avatar inexistente → `error "Avatar not found"`. Ambos caminos cierran **antes** de abrir Gemini (cero cuota).
  - **Bugs de integración corregidos** en `VoiceLab.tsx`: (a) `onError` ahora registra en `session.errorLog` (paridad de telemetría/`error_count` con ChatLab); (b) el `ws.onclose` de un cierre intencional (Terminar/cierre de Sofia/reset) ya no dispara el falso banner "Conexión perdida" (flag `endingRef`).
  - ⏳ **Pendiente (manual):** sesión de voz real con micrófono sobre HTTPS/tunnel + cuota Gemini (no ejecutable headless). Guion en la sección de verificación.
- ✅ **O1, O2** — completados (OpenCode).
- ✅ **G1, G2, G3** — completados (Gemini).

**Para OpenCode (O1/O2):** el hook `useVoiceLab` y el módulo `src/pages/chatlab/*` ya están listos y type-checkean. En O2, el botón de navegación en `ChatLab.tsx` es una adición mínima (no requiere el refactor de C3).

---

## Orden de ejecución y handoffs
1. **Claude C1** (backend WS) — desbloquea pruebas de conexión.
2. **Claude C2 + C3** — definen las interfaces que consume OpenCode.
3. **OpenCode O1 + O2** — una vez existan el hook y los componentes extraídos.
4. **Gemini G1–G3** — en paralelo desde el inicio (no bloquea código).
5. **Claude C4** — integración final + verificación cuando O1/O2 estén listos.

---

## Interfaces de contrato (para desacoplar a OpenCode de Claude)

**Hook `useVoiceLab` (C2) — firma que O1 puede asumir:**
```ts
interface UseVoiceLabOptions {
  avatarId: string | undefined;          // "entrevistador"
  chatlabToken: string;                  // de localStorage["chatlab_token"]
  initPayload?: { user_profile?: UserProfile; session_vars?: Record<string, unknown> };
  onUserMessage?: (text: string) => void;
  onAssistantMessage?: (text: string) => void;
  onStatusChange?: (status: string) => void;   // ready | generating_audio | thinking | analyzing | disconnected
  onClosingIntent?: () => void;
  onError?: (msg: string) => void;
  onEnded?: () => void;
}
// return: { connect, startMic, stopMic, setMicMuted, endSession, disconnect, analyser, hasGreeted }
```

**Componentes extraídos (C3) — módulo `src/pages/chatlab/`:** `types` (`ChatMsg`, `ChatSession`, `Diagnostico`, `RegistroInput`, `SaveInfo`, `SatisfactionInfo`, `SessionError`, `Provider`, `DURATIONS`, `PROVIDER_BADGE`), `helpers` (`fmtUsd`, `fmtDuration`, `targetExchanges`, `userTurns`, `freqBadge`, `CLIENT_ID`), `components` (`CollapsibleSection`, `Skeleton`, `DiagnosticoModal`, `SatisfactionModal`, `FeedbackModal`), `export` (`exportSession`), `persistence` (builder del payload de `/api/chat/conversation`).

---

## Verificación (end-to-end)
1. Backend: `poetry run python -m app` (Win: `MENTEVIVA_PORT=8001`, DB→Neon); `GET /docs` lista la ruta WS.
2. Type-check: `npm run build` (tsc); `npm run dev` (:5173).
3. Token guard: WS sin `?token=` con `CHATLAB_TOKEN` seteado → close 1008; con token → conecta.
4. Sesión real (mic requiere HTTPS/localhost; usar tunnel cloudflared): Sofia saluda sola (PCM24 local) + caption; al hablar → `user_message` + respuesta audio/caption sincronizados; notas de ritmo; `finalizar_entrevista` → `closing_intent` → countdown; "Terminar y generar diagnóstico" → mismo diagnóstico que texto + persistencia `chatlab:<slug>` + satisfacción; cronómetro/feedback/export ok.
5. Regresión: `/chat-lab` texto sin cambios.
6. Persistencia: la sesión de voz aparece en la lista con badge `Gemini`.

*(Cuota: Gemini free = 20 req/día por key por modelo; un 429 al re-probar es cuota, no bug.)*
