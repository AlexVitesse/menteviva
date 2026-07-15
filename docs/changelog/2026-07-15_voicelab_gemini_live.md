# 2026-07-15 — VoiceLab: ChatLab de voz con Gemini Live

**Rama:** `feature/chat-lab-prompt-bench`
**Origen:** Extensión del ChatLab de texto para soportar simulación de entrevistas guiadas por voz en tiempo real con Gemini Live (audio nativo bidireccional, sin video ni avatar Simli).

## Qué se agregó

1. **Ruta WS Proxy de Voz (`/api/chat/voice/{avatar_id}`):**
   - Nueva ruta WebSocket en el backend que actúa como proxy de audio y transcripciones en tiempo real.
   - Requiere validación del token `X-ChatLab-Token` mediante el query parameter `?token=`.
   - Utiliza `finalize=False` en `_run_gemini_conversation` para omitir análisis automáticos del lado del servidor y evitar la duplicidad de logs, permitiendo que la persistencia y el diagnóstico se coordinen desde el cliente usando las APIs REST existentes.

2. **Hook de Voz en Tiempo Real (`useVoiceLab.ts`):**
   - Hook callback-driven para el manejo de WebSocket, inicialización del micrófono (`getUserMedia`), control de mute/unmute, y reproducción local de PCM24.
   - Monitoreo del volumen (RMS) y detección de interrupciones (barge-in / echo-gate).

3. **Página `VoiceLab.tsx`:**
   - Interfaz con diseño de llamada limpia (emoji de avatar con pulsos de audio y captions en scroll).
   - Panel de control lateral: botón de silencio (mute), terminar llamada, cronómetro de sesión y barra de progreso de turnos.
   - Integración con el flujo de cierre por intención (`closing_intent`) con un banner de cuenta regresiva de 5 segundos.
   - Disparo del diagnóstico REST (`POST /api/chat/diagnostico`) y posterior renderizado de los modales de diagnóstico, feedback cualitativo en mensajes 👍/👎 y encuesta de satisfacción 1-5 estrellas.

4. **Extracción de Componentes a `src/pages/chatlab/`:**
   - Modularización de tipos, persistencia de payloads, exportador a Markdown y modales de feedback/satisfacción/diagnóstico para ser compartidos entre `ChatLab.tsx` y `VoiceLab.tsx` sin duplicación de lógica.

5. **Configuración y Documentación:**
   - Notas en `.env.example` para la rotación round-robin de llaves de Gemini (`GEMINI_API_KEY_2/3/4`), aclaración de passthrough en local para el `CHATLAB_TOKEN`, e indicación de que el VoiceLab corre Gemini Live incondicionalmente sin usar el flag `realtime_provider`.
   - Guía y checklist de QA manual (`docs/plans/14_voicelab_qa.md`).

## Cambios

### Backend
- **`menteviva-backend/app/routers/conversation.py`** — Incorporación del parámetro `finalize: bool = True` en `_run_gemini_conversation` y registro del nuevo endpoint WebSocket `/chat/voice/{avatar_id}` con protección del token del lab.
- **`menteviva-backend/.env.example`** — Actualización de comentarios en la sección de Gemini Live API y ChatLab token guard.

### Frontend
- **`menteviva-frontend/src/hooks/useVoiceLab.ts`** — Hook especializado de audio y socket bidireccional.
- **`menteviva-frontend/src/pages/VoiceLab.tsx`** — Nueva página `/voice-lab` de tipo llamada por voz.
- **`menteviva-frontend/src/pages/chatlab/`** — Creación del directorio con subarchivos `types.ts`, `helpers.ts`, `components.tsx` y `export.ts` compartidos.
- **`menteviva-frontend/src/App.tsx`** — Registro de la nueva ruta para `/voice-lab`.

---

## Verificación Realizada
- Compilación y validación de tipos del frontend exitosa (`npm run build` / `tsc`).
- Documentación y variables de entorno validadas con la especificación funcional.
- Guía de QA manual redactada y almacenada para su uso en la etapa de testing integrada (C4).
