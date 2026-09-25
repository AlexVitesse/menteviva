# Auditoría de la videollamada — 2026-09-23

Detalle en [AUDIO.md](AUDIO.md) (captura, limpieza, STT y reproducción) y [UI_UX.md](UI_UX.md) (pantallas, estados y accesibilidad).
Capturas `desk_*` / `mob_*` en esta carpeta.

## Veredicto

- **Limpieza de audio: bien.** Cancelación de eco, supresión de ruido y ganancia automática consistentes en todas las capturas reales. RNNoise o
  filtros extra no se justifican hoy. El eco depende de usar audífonos (el producto no lo pide en ningún lado).
- **Lo que rompe:** el backend se congela con usuarios simultáneos, Whisper inventa frases sobre el silencio, en móvil no se puede terminar la
  sesión y una caída o cierre de pestaña pierde todo sin avisar.
- **UI:** la pantalla de simulación va por detrás del Diagnóstico, que ya resolvió indicador de turno, desconexión y cierre. Usa
  colores fuera de la marca y tiene dos botones falsos.

## Orden de arreglo y estado (actualizado 2026-09-25)

| Prioridad | Qué | Hallazgos | Estado |
|---|---|---|---|
| **P0** | Llamadas a Groq fuera del event loop (`to_thread` / executor) | Audio A1 | ✅ `ec44d23` |
| **P0** | "Terminar" visible en móvil: quitar "Video", ocultar "Pausa" en Gemini, compactar el footer | UI 1, 7 | ✅ `ec44d23` |
| **P0** | Filtro de alucinaciones de Whisper (`verbose_json` + `no_speech_prob` + lista negra) | Audio A2 | ✅ `ec44d23` |
| **P0** | Desconexión visible + "Reconectar"; `beforeunload`; guardar la sesión sin `end_session` en el backend | UI 2, 3; Audio M6 | ✅ `ec44d23` (reconectar reinicia la conversación y lo dice; no reenvía historial) |
| **P1** | Reporte de respaldo honesto (30 s, "tu reporte está tardando") | UI 4 | ✅ `c400214` |
| **P1** | `ConversationIndicator` compartido en Simulation (cuándo hablar) + `aria-live` | UI 5, 6 | ✅ `c400214` |
| **P1** | Diagnóstico: `redemptionMs` 1200 | Audio A3 | ✅ `c400214` (VAD sigue pausado al procesar a propósito: evita doble respuesta) |
| **P1** | Barge-in en push-to-talk | Audio M1 | ✅ `c400214` |
| **P1** | VAD de Gemini en `.env` de prod | Audio M4 | ⏭️ No se cambia: HIGH/500 es decisión documentada en `config.py`; el eco lo cubre el aviso de audífonos |
| **P1** | Aviso de audífonos y micrófono en el Briefing; CTA sticky en móvil | UI 13 | ✅ `c400214` |
| **P2** | Tokens de marca en Simulation y Diagnóstico, `bg-surface` → `bg-card`, semáforo 75/50 | UI 9, 11, 12 | ✅ `c400214` + `04058a9` (textos `red-400`/`green-400` se quedan por contraste) |
| **P2** | Mensajes de error accionables; error de micro persistente | UI 10, 14; Audio M9 (mensaje) | ✅ `04058a9` |
| **P2** | Safari: mimeType real al enviar; idioma de Whisper desde `session_vars`; `track.onended` | Audio M2, M3, M5 | ✅ `04058a9` |
| — | Reporte completo desde el historial de Mi plan (hallazgo nuevo) | — | ✅ `04058a9` |
| **P2** | `useOssAvatarWs`: reproducir el final de respuestas largas | Audio A4 | ⏳ Pendiente: hay que confirmarlo con el servicio OSS en vivo |
| **P3** | `AudioContext` único en `useSoundEffects` | Audio M8 | ✅ `04058a9` |
| **P3** | Fugas menores de `AudioContext`, iOS `resume()` (M7), Firefox 16 kHz (M9 captura), colchón PCM y fade, worklet, mute de Gemini, código muerto, favicon, `MotionConfig`, contraste de etiquetas de 10 px, chat truncado a 100 caracteres, copy "ngrok" en Diagnóstico | Audio M7, M9, B1-B8; UI bajas | ⏳ Pendiente |
| — | Subtítulo que puede mostrar la frase anterior en Gemini | UI 8 | ⏳ Pendiente (sospecha, hay que reproducirlo con audio real) |

Bitácoras: `docs/changelog/2026-09-23_videollamada_p0.md`, `…_p1.md`, `2026-09-25_videollamada_p2.md`.
Pendiente de probar en dispositivos reales: iPhone (Audio M7), Firefox (M9) y desconexión de Bluetooth (M5).
