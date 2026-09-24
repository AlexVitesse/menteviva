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

## Orden de arreglo propuesto

| Prioridad | Qué | Hallazgos | Esfuerzo |
|---|---|---|---|
| **P0** | Llamadas a Groq fuera del event loop (`to_thread` / executor) | Audio A1 | 1 h |
| **P0** | "Terminar" visible en móvil: quitar "Video", ocultar "Pausa" en Gemini, compactar el footer | UI 1, 7 | 1 h |
| **P0** | Filtro de alucinaciones de Whisper (`verbose_json` + `no_speech_prob` + lista negra) | Audio A2 | 1-2 h |
| **P0** | Desconexión visible + "Reconectar"; `beforeunload`; guardar la sesión en el `finally` del backend | UI 2, 3; Audio M6 | 3 h |
| **P1** | Reporte de respaldo honesto (timeout 25-30 s, "no pudimos generar el análisis") | UI 4 | 1 h |
| **P1** | `ConversationIndicator` compartido en Simulation (cuándo hablar) + `aria-live` | UI 5, 6 | 2 h |
| **P1** | Diagnóstico: `redemptionMs` 1200-1500 y VAD pausado solo mientras suena el avatar | Audio A3 | 30 min |
| **P1** | Barge-in en push-to-talk (`stopAudio()` al hablar); VAD de Gemini fijado en `.env` de prod | Audio M1, M4 | 1 h |
| **P1** | Aviso de audífonos y micrófono en el Briefing; CTA sticky en móvil | UI 13 | 30 min |
| **P2** | Tokens de marca en Simulation y Diagnóstico, `bg-surface` → `bg-card`, semáforo 75/50 | UI 9, 11, 12 | 2-3 h |
| **P2** | Mensajes de error accionables; error de micro persistente con reintento | UI 10, 14; Audio M9 | 2 h |
| **P2** | Safari: mimeType real al enviar; idioma de Whisper desde `session_vars`; `track.onended` | Audio M2, M3, M5 | 2 h |
| **P2** | `useOssAvatarWs`: reproducir el final de respuestas largas (confirmar en vivo) | Audio A4 | 1-2 h |
| **P3** | `AudioContext` único en `useSoundEffects`, fugas, iOS `resume()`, colchón PCM y fade, ortografía, favicon, `MotionConfig` | resto | 3-4 h |

P0 + P1 ≈ 1.5 días. Pendiente de probar en dispositivos reales: iPhone (Audio M7) y Firefox (M9).
