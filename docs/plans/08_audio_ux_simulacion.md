# Plan 08 — Recolección de audio + UX/UI de la Simulación (app principal)

**Rama:** `feature/chat-lab-prompt-bench` · **Fecha:** 2026-07-08
**Origen:** mientras se probaba el ChatLab (plan 07), se pidió trabajar áreas de
mejora de la app principal: recolección de audio, UX/UI y diseño. Incluye además
el diagnóstico de un incidente en vivo ("le digo Hola y no reacciona").

Leyenda de urgencia: 🔴 rompe la experiencia · 🟡 afecta percepción de calidad · 🟢 pulido.

---

## A. Hallazgos

### A1. Recolección de audio (modo Groq push-to-talk)

| # | Urg. | Hallazgo | Dónde |
|---|------|----------|-------|
| R1 | 🔴 | **Grabación pegada con clic rápido**: el botón de voz usaba un solo handler toggle en `mousedown`+`mouseup` con debounce de 250ms; un clic de <250ms se tragaba el `mouseup` y el mic quedaba grabando sin que el usuario lo supiera. | `Simulation.tsx` (handler `handleVoiceButton`, eliminado) |
| R2 | 🔴 | **Primeras palabras recortadas**: `getUserMedia` se pedía en CADA pulsación; mientras el stream resolvía (~100-300ms) el usuario ya estaba hablando. Además re-latencia y parpadeo del indicador de mic del navegador en cada turno. | `useAudioRecorder.ts` (versión anterior) |
| R3 | 🟡 | **Cero feedback de captura**: el `AudioVisualizer` es animación decorativa (barras fijas en loop), no refleja si el mic está captando de verdad. | `AudioVisualizer.tsx` |
| R4 | 🟡 | Sin tope de duración (blob ilimitado si el botón quedaba pegado por R1) y sin `timeslice` en `MediaRecorder.start()` (un solo blob gigante al final). | `useAudioRecorder.ts` |
| R5 | 🟢 | `isSecureOriginForMic()` existía pero no se usaba: en LAN sobre HTTP el error era genérico en vez de explicar el problema de secure context. | `utils/audio.ts:53` |

### A2. UX/UI de la Simulación

| # | Urg. | Hallazgo | Dónde |
|---|------|----------|-------|
| U1 | 🟡 | En móvil el tile "Tú" está oculto (`hidden sm:block`) → el único indicio de "grabando" era el color del botón. | `Simulation.tsx` |
| U2 | 🟡 | Los errores de audio (p.ej. "mantén presionado 0.5s") quedaban en pantalla hasta cierre manual, tapando controles. | `Simulation.tsx` (toast de errores) |
| U3 | 🟢 | Sin atajo de teclado para hablar en desktop. | — |
| U4 | 🟢 | "Silenciar" no liberaba el mic del navegador (el puntito de grabación de la pestaña seguía encendido) → mala señal de confianza. | `Simulation.tsx::handleToggleMicMute` |

### A3. Incidente en vivo: "le digo Hola pero no reacciona"

| # | Urg. | Hallazgo | Dónde |
|---|------|----------|-------|
| I1 | 🔴 | **Desajuste de provider realtime**: frontend con `VITE_REALTIME_PROVIDER=gemini` (streamea `audio_chunk` continuo) pero el `.env` del backend SIN `REALTIME_PROVIDER` → default `"groq"` (`config.py:62`), cuya rama del WS recibe los `audio_chunk` y los **ignora** (solo los loguea en DEBUG). Resultado: el avatar jamás responde. Comprobado end-to-end con una sesión de prueba: ~90s de chunks en el log sin que se abriera sesión Gemini. Los logs del 2026-06-09 muestran `Provider=gemini`, o sea la variable existió y se perdió en algún momento (probablemente al rehacer el `.env` durante el plan 07). | `.env` backend + `conversation.py:576` |

---

## B. Lo ejecutado (2026-07-08)

### Fase 1 — Reescritura de `useAudioRecorder.ts` ✅

- **Stream persistente** (R2): el mic se pide UNA vez (`initMic()`, llamado al montar
  la Simulación en modo Groq) y se reutiliza entre turnos con los tracks
  `enabled=false` (solo captura silencio). Cada pulsación arranca al instante.
  `releaseMic()` suelta todo (tracks + AudioContext) y el cleanup del hook lo
  llama al desmontar.
- **`AnalyserNode` expuesto** (R3): conectado al stream, `fftSize=256`; la UI lo
  usa para dibujar nivel de voz real.
- **Tope de 2 min con auto-envío** (R4): al llegar a `MAX_RECORDING_MS` la
  grabación se corta sola y el audio se entrega vía callback `onAutoStop`
  (la Simulación lo manda al WS igual que si el usuario hubiera soltado).
- **`mediaRecorder.start(250)`** (R4): chunks periódicos en vez de blob único.
- **Errores específicos** (R5): permiso denegado / sin micrófono / mic en uso /
  contexto no seguro (usa `isSecureOriginForMic()`), en español accionable.
- **API nueva** (retrocompatible: `VoiceRecorder.tsx` sigue compilando):
  `initMic`, `releaseMic`, `cancelRecording`, `recordingSeconds`, `analyser`,
  además de lo existente.

### Fase 2 — Push-to-talk robusto en `Simulation.tsx` ✅

- **R1 corregido**: pointer events (`onPointerDown/Up/Cancel`) con
  `setPointerCapture` — presionar graba, soltar envía, SIEMPRE, aunque el dedo
  se deslice fuera del botón. Se eliminó el debounce (los pointer events no
  tienen el "click sintético" duplicado del touch). `pressActiveRef` es la
  fuente de verdad síncrona (el estado de React puede llegar un render tarde
  en un press-release muy rápido).
- **Barra espaciadora como PTT** (U3): listeners globales `keydown/keyup`
  (ignora `repeat`, inputs y contenteditable).
- **`unlockAudio()` ya no se espera** antes de grabar: en iOS podía tardar
  segundos la primera vez y retrasaba el arranque (agravaba R2). Se dispara
  fire-and-forget dentro del gesto.

### Fase 3 — Feedback visual y confianza ✅

- **Píldora de grabación** (U1): flotante sobre el footer — punto rojo pulsante
  + timer `mm:ss` + **`MicLevelMeter`** (componente nuevo: barras movidas por el
  RMS real del mic vía rAF y DOM directo, cero re-renders) + hint "Suelta para
  enviar". Visible también en móvil.
- **Mute libera el mic** (U4): al silenciar se descarta la grabación en curso
  (`cancelRecording`) y se llama `releaseMic()` → el indicador del navegador se
  apaga. Al desmutear, `initMic()` re-calienta.
- **Errores de audio se auto-descartan a los 5s** (U2); el botón "Cerrar" del
  toast limpia ambos tipos de error.

Archivos tocados: `src/hooks/useAudioRecorder.ts` (reescrito),
`src/pages/Simulation.tsx`, `src/components/voice/MicLevelMeter.tsx` (nuevo).
Nada de esto altera el modo Gemini (guards `IS_GEMINI` intactos) ni el contrato
del WS (`sendAudio` base64 igual que antes).

### Fase 4 — Fix del incidente I1 ✅ (requiere reiniciar backend)

Se agregó al `.env` del backend (documentado con el porqué):

```
REALTIME_PROVIDER=gemini
```

**Debe coincidir siempre con `VITE_REALTIME_PROVIDER` del frontend.** Toma
efecto al reiniciar uvicorn. Sugerencia futura: loguear un WARNING en el WS
cuando lleguen `audio_chunk` en modo groq (síntoma inequívoco del desajuste).

---

## C. Verificación

- `npm run build` (tsc + vite) ✅ sin errores.
- Smoke en navegador aislado (chrome-devtools MCP) contra el dev server:
  `/simulation` monta sin errores de consola con avatar 3D en modo Gemini;
  layout, header, chat y controles OK. El flujo push-to-talk Groq (pointer
  capture, espaciadora, píldora, auto-stop) **queda pendiente de prueba humana
  con mic real** — el navegador automatizado no puede otorgar permiso de mic.
- Nota: el smoke creó el usuario `smoke-test-claude` en el Postgres dev local
  (upsert del WS) y ~90s de `audio_chunk` en el log del 2026-07-08 12:01-12:02.
  Inofensivo; borrar la fila si estorba.

## D. Pendientes / ideas siguientes

- 🟡 Probar en humano el PTT nuevo (desktop click corto/largo, espaciadora,
  móvil touch, mute a mitad de grabación).
- 🟡 Migrar los hex hardcodeados de `Simulation.tsx` (`#1a1a1a`, `#232323`…) a
  los tokens de `tailwind.config.js` (ink/deep/panel/card).
- 🟢 El tile "Tú" y el botón "Video" son decorativos (no hay cámara real):
  conectar `getUserMedia` de video o quitarlos para no prometer de más.
- 🟢 WARNING backend ante `audio_chunk` en modo groq (ver Fase 4).
