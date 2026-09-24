# Auditoría UI/UX de la videollamada — 2026-09-23

Solo lectura. Flujo revisado: Dashboard → Briefing → Simulation → Report, más VoiceLab y Diagnóstico.

**Cómo se capturó:** Playwright contra el Vite local. Firebase se sustituyó por un stub, el WebSocket se simuló y los eventos
(`status`, `user_message`, `error`, `onclose`) se inyectaron. Las capturas muestran el camino **Gemini** (manos libres), que es el
de producción: `.env.production` no define `VITE_REALTIME_PROVIDER`, así que hereda `gemini`.
No se pudo ver: el reporte con análisis real, la sesión viva de VoiceLab o Diagnóstico, ni audio real.
Claude re-verificó los hallazgos 1, 3 y 12.

## Alta

| # | Hallazgo | Dónde | Evidencia | Arreglo mínimo |
|---|---|---|---|---|
| 1 | **En móvil "Terminar" queda fuera de la pantalla**: 5 botones de ~72 px más `gap-4 px-6` suman ~470 px en una pantalla de 390, con `overflow-hidden`. El usuario no puede cerrar la sesión ni llegar al reporte. | `Simulation.tsx:543-659`, `Diagnostico.tsx:667` | `mob_09` | Móvil: `gap-1 px-2`; quitar "Video" (ver 7) y ocultar "Pausa" en Gemini. |
| 2 | **Una caída de conexión sigue pareciendo "en vivo"**: punto verde, micro "En vivo" y cronómetro corriendo; la píldora de estado se oculta justo en `disconnected`. Sin mensaje ni botón para reconectar. | `Simulation.tsx:363,412,562-583` | `desk_11` | Franja de desconexión como la de `Diagnostico.tsx:539-543` + "Reconectar"; punto y micro atados a `status`. |
| 3 | **Cerrar la pestaña o recargar pierde la sesión entera**: no hay `beforeunload`; el backend (Groq) solo finaliza con `end_session` y ante `WebSocketDisconnect` solo loguea. | `Simulation.tsx`, `conversation_session.py:1020` | código | `beforeunload` mientras haya mensajes sin reporte; en el backend, finalizar y guardar en el `finally` si hubo ≥ 2 intercambios. |
| 4 | **Un análisis lento se muestra como culpa del usuario**: a los 10 s se genera un reporte de respaldo con `total_exchanges = floor(messages/2)` (salió **0** con 1 intercambio real) → "Sesión muy corta". gpt-oss-120b puede tardar más de 10 s. | `Simulation.tsx:325-336`, `Report.tsx:76-104` | `desk_13` | Timeout de 25-30 s; con `is_fallback`: "No pudimos generar el análisis a tiempo" + reintento; contar los turnos del usuario. |
| 5 | **En Gemini, Simulation no indica cuándo hablar**: no usa `hasGreeted` y en `ready` no hay indicador. El chat vacío dice "Habla cuando quieras" antes de que Roberto salude. Diagnóstico ya lo resuelve con `ConversationIndicator`. | `Simulation.tsx`; `Diagnostico.tsx:469-494,865-945` | `desk_04` | Mover `ConversationIndicator` a `components/voice/` y reusarlo. |
| 6 | **Nada se anuncia a lectores de pantalla**: sin `aria-live`, `role="status"` ni `role="alert"`; "Silenciar" sin `aria-pressed`; etiquetas de 10 px. | Simulation, VoiceLab, Diagnóstico | código | `role="status" aria-live="polite"` en el estado, `role="alert"` en el toast, `aria-pressed`. |

## Media

| # | Hallazgo | Dónde | Arreglo |
|---|---|---|---|
| 7 | Controles falsos: "Video" no abre cámara (solo alterna un recuadro "Tú"); "Pausa" siempre deshabilitado en Gemini. | `Simulation.tsx:611,629-641` | Quitar "Video" y el recuadro "Tú"; ocultar "Pausa" en Gemini. |
| 8 | [S] El subtítulo puede mostrar la frase **anterior** mientras Roberto habla (`isSpeaking && lastAssistantMessage`, con el texto nuevo retenido). La retención es correcta; el efecto colateral no. | `Simulation.tsx:356-457` | En Gemini, no pintar subtítulo hasta que llegue el mensaje del turno actual. |
| 9 | Estética "Zoom" con hex crudos (`#1a1a1a`, `#232323`, `#2a2a3a`…) y `green-500`/`red-500` en vez de los tokens: la pantalla central parece de otra marca. | `Simulation.tsx:359,361,382,477,509,543`, Diagnóstico | `ink`/`deep`/`card` + `success`/`warning`/`danger`. |
| 10 | Toast de error genérico ("Error del servidor" + texto crudo "Rate limit (429)"), solo "Cerrar", tapa al avatar. | `Simulation.tsx:709-737` (`desk_10`) | Mensajes por código (429 → "Mucha demanda, espera 10 s") + reintentar. |
| 11 | El semáforo del reporte usa 80/60/40 con 4 colores; el spec dice > 75 / 50-75 / < 50. | `Report.tsx:55-67,332-337` | Un solo `scoreTone()` con 75/50. |
| 12 | `bg-surface` no existe en `tailwind.config.js`: las tarjetas del briefing salen sin fondo. | `Briefing.tsx` (6 usos), `desk_02` | `bg-card`. |
| 13 | Briefing en móvil mide 2833 px con el CTA al final; nada avisa que se pedirá el micrófono ni que conviene usar audífonos. | `Briefing.tsx`, `mob_02` | CTA `sticky` en móvil + "Te pediremos el micrófono. Usa audífonos." |
| 14 | El error de permiso de micro se autodescarta a los 5 s; el fallo de `startMic` en Gemini es genérico. | `Simulation.tsx:133,309-313` | Error persistente con "Reintentar micrófono". |

## Baja

- Ortografía: "desempeno", "Simulacion", "Sesion", "Analisis", "Proximos", "Conversacion", "Areas", "1 intercambios", "Sofia/microfono".
- Copy de desarrollador visible para el usuario: "Accede via un tunnel (ngrok, cloudflared)" (`Diagnostico.tsx:851-854`).
- Marcas de plantilla: favicon `/vite.svg`; icono `PersonStanding` (el de accesibilidad) como avatar en VoiceLab.
- Sin `MotionConfig reducedMotion="user"`: los pulsos infinitos ignoran `prefers-reduced-motion`.
- Etiquetas de 10 px y `text-white/30` por debajo de 4.5:1; el chat trunca a 100 caracteres sin forma de ver el texto completo.

## Lo que ya funciona

Push-to-talk con pointer capture, barra espaciadora, tope de 120 s y medidor de nivel real; mute que suelta el micro de verdad;
mensajes de permiso diferenciados. El Diagnóstico ya tiene todo lo que le falta a Simulation (indicador de turno, progreso,
franja de desconexión, cierre cancelable). Overlay de "Analizando" con bloqueo de doble clic. VoiceLab ya usa los tokens.

## Capturas

`desk_01`…`desk_14` (1440×900) y `mob_01`…`mob_11` (390×844) en esta carpeta. Los móviles terminan en el 11
porque "Terminar" no se puede pulsar (hallazgo 1).
