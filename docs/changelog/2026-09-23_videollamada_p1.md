# 2026-09-23 — Videollamada: arreglos P1 de la auditoría

Sigue a `2026-09-23_videollamada_p0.md`. Fuente: `docs/auditoria-videollamada-2026-09-23/README.md`, filas P1. Solo frontend.

| Hallazgo | Arreglo | Archivos |
|---|---|---|
| **UI 4**: si el análisis tardaba más de 10 s, el reporte decía "Sesión muy corta / necesitas más interacciones" (con 0 intercambios mal contados) | Espera de 30 s. Si vence, pantalla propia: "Tu reporte está tardando más de lo normal": la sesión quedó registrada y el puntaje aparece en el historial de Mi plan (el servidor guarda antes de intentar enviar, así que el análisis no se pierde). Botones Inicio / Ir a Mi plan. Los intercambios se cuentan como turnos del usuario. | `Simulation.tsx`, `Report.tsx` |
| **UI 5 / 6**: Simulation no decía cuándo hablar; nada se anunciaba a lectores de pantalla | `ConversationIndicator` sale de Diagnóstico a `components/voice/`, parametrizado por nombre del avatar y con `role="status" aria-live="polite"`. Estados: conectando/te va a saludar · te escucho (manos libres) · **tu turno** (push-to-talk, nuevo) · estás hablando · procesando · {avatar} está hablando · en pausa. Sustituye la píldora de estado de Simulation (fondo `bg-ink/75` para leerse sobre la cara del avatar en móvil). Acentos corregidos. El chat vacío en Gemini dice "Roberto te va a saludar…" hasta el primer turno. | `ConversationIndicator.tsx`, `Simulation.tsx`, `Diagnostico.tsx` |
| **Audio A3**: el diagnóstico cortaba a media frase | `redemptionMs` 600 → **1200**. **No** se aplicó la otra mitad de la sugerencia (dejar el VAD escuchando mientras se transcribe/piensa): el servidor atiende los turnos en fila, así que la continuación llegaría como segundo turno y Sofía respondería dos veces. | `Diagnostico.tsx` |
| **Audio M1**: en push-to-talk las voces se encimaban | `stopAudio()` al empezar a hablar (el backend habilita el turno con el último chunk, mientras el avatar aún suena). | `Simulation.tsx` |
| **Audio M4**: VAD de Gemini en HIGH/500 en vez de LOW/800 | **Sin cambio, a propósito.** `config.py` documenta que HIGH/HIGH/500 se eligió después ("para que no se quede callada esperando") y es tunable por `.env`. La memoria del asistente estaba desactualizada (corregida). La mitigación del eco pasa a ser el aviso de audífonos. | — |
| **UI 13**: briefing de ~2900 px en móvil, CTA al final y sin aviso | CTA `sticky` abajo en móvil con la línea "Te pediremos el micrófono. Usa audífonos para que Roberto no se escuche a sí mismo." | `Briefing.tsx` |
| **UI 12** (P2, mismo archivo) | `bg-surface` (no existe en Tailwind) → `bg-card`: las 6 tarjetas del briefing ya tienen fondo. | `Briefing.tsx` |
| Ortografía de paso | "1 intercambios" → singular/plural; "Iniciar simulación". | `Simulation.tsx`, `Briefing.tsx` |

## Verificación

`npm run build` limpio, `npm test` 35/35. Re-captura con el script de la auditoría (WS simulado, Gemini): indicador visible en escritorio y
móvil, reporte de respaldo nuevo a los 30 s, CTA fijo con aviso en el briefing a 390 px.

## Pendiente

- El historial de Mi plan muestra puntaje pero no abre el reporte completo de una sesión pasada (`GET /api/session/{id}` ya existe). Hace falta para que el respaldo de 30 s lleve al reporte y no solo al puntaje.
- P2 y P3 de la auditoría: tokens de marca en Simulation/Diagnóstico, errores accionables (429), semáforo 75/50 en Report, Safari mimeType, idioma de Whisper, `track.onended`, final de respuestas largas en `useOssAvatarWs`, fugas de `AudioContext`.
