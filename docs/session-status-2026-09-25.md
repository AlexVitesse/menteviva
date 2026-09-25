# Estado de sesión — 2026-09-23/25

Cuatro frentes encadenados: (1) **qué falta del plan original**, que resultó ser el roadmap adaptativo y no la
landing, (2) el **plan 22 de rutas adaptativas**, (3) una **auditoría de la videollamada** (audio + UI/UX) y
(4) los **arreglos P0, P1 y P2** de esa auditoría, desplegados a producción en tres tandas.

---

## 1. Resumen ejecutivo

| Trabajo | Descripción | Estado |
|---|---|---|
| **Pendientes de la landing** (plan 20) | Fases 4-5 bloqueadas por la sesión con consentimiento; la fase 7 (og:image, póster, Lighthouse, dpr móvil) no depende de nadie. | 📋 Inventariado, sin tocar |
| **Qué falta del plan original** | El motor de rutas del Documento Funcional §4 está casi todo sin hacer: el perfil queda congelado tras el diagnóstico. | 📋 Inventariado |
| **Plan 22 — rutas adaptativas** | `docs/plans/22_rutas_adaptativas.md`. Todo lo ejecuta Claude. 5 fases, ~7.5 días; las fases 1-3 (~3 días) cierran el bloqueador del piloto. | 📝 Escrito, sin empezar |
| **Auditoría de la videollamada** | `docs/auditoria-videollamada-2026-09-23/`: AUDIO.md, UI_UX.md, README con prioridades, 25 capturas + `despues_*`. | ✅ Hecha |
| **P0** | Groq fuera del event loop, filtro de Whisper, sesión sin `end_session` guardada, desconexión visible, "Terminar" en móvil. | ✅ En prod (`ec44d23`) |
| **P1** | Indicador de turno compartido, reporte de respaldo honesto, pausas de 1.2 s en el diagnóstico, barge-in, aviso de audífonos. | ✅ En prod (`c400214`) |
| **P2** | Reporte desde el historial, semáforo 75/50 único, paleta de marca, errores de micro accionables, Safari, idioma de Whisper, reconexión del micro, `AudioContext` único. | ✅ En prod (`04058a9`) |
| **Pendientes del servidor** | `kill 4006219` (túnel zombi) y dar de alta el dominio del túnel en Firebase. | ⏳ Eric, a mano |

---

## 2. "¿Qué nos falta del plan original?"

Primero se leyó como la landing (plan 20). Eric aclaró: **las rutas**. Contra `MenteViva_DocumentoFuncional_v2.docx` §4 y el
spec del prototipo, lo único hecho es el diagnóstico con una recomendación única (`recommended_next_scenario`), los 3
niveles de Roberto y rehacer el diagnóstico. Falta: ruta recalculada tras cada sesión, reglas de nivel (75 ×2 / 50 / 3 sin
mejora), horizonte de 4-8 semanas, catálogo de habilidades unificado, progreso visible, metas del manager, P-13/P-14,
organizaciones y equipos, catálogo de 8 categorías y editar el registro.

Detalle: `docs/changelog/2026-09-23_rutas_adaptativas_plan.md`.

## 3. Plan 22 — decisiones clave

- **El plan se deriva, no se guarda:** `compute_plan(registro, diagnóstico, sesiones, metas)`, función pura, sin LLM.
  Se recalcula en cada request, así que corregir una regla corrige el plan de todos sin migrar datos.
- **`SKILL_MAP` KPI → habilidad** une las rúbricas de los avatares con el catálogo de 10 sin tocar el analizador (borrador para Sophia).
- Se descartan los análisis `is_demo`: tienen **puntajes aleatorios**.
- Hueco real: autoconciencia, trabajo en equipo y gestión de prioridades no las entrena ningún avatar → define el escenario de la fase 5.
- Decisiones pendientes de Eric (§6 del plan): umbrales, línea base inferida, si el manager ve puntajes individuales (Cristina), invitación por código, siguiente escenario.

## 4. Videollamada: qué se arregló

| Tanda | Commit | Lo más importante |
|---|---|---|
| P0 | `ec44d23` | Con 2+ usuarios, el STT/LLM/análisis de uno congelaba a todos → `asyncio.to_thread`. Whisper descarta segmentos sin voz y alucinaciones ("gracias por ver el video"). Cerrar la pestaña o caerse la red con ≥ 4 intercambios ya no pierde la sesión: se analiza y guarda en segundo plano sin retener el cupo. Franja "Se perdió la conexión · Reconectar". "Terminar" cabe en 390 px (se quitaron los botones falsos Video/Pausa). |
| P1 | `c400214` | `ConversationIndicator` compartido con `aria-live`: "Tu turno", "Te escucho", "Roberto está hablando"… El respaldo de 30 s dice "tu reporte está tardando" en vez de "sesión muy corta". Diagnóstico tolera pausas de 1.2 s. Push-to-talk corta al avatar. Briefing: CTA fijo y aviso de audífonos; `bg-surface` inexistente → `bg-card`. |
| P2 | `04058a9` | Historial de Mi plan → reporte completo. `scoreTone()` con > 75 / 50-75 / < 50. Paleta de marca en la llamada. Errores de micro que distinguen permiso / sin micro / ocupado. Safari manda `audio.mp4`. Whisper en el idioma de la sesión. Gemini reabre el micro si se desconectan los audífonos. |

**Decisiones de criterio tomadas (no son olvidos):**
- VAD de Gemini: se queda en HIGH/500 (decisión documentada en `config.py`); la memoria que decía LOW/800 estaba vieja y se corrigió.
- El VAD del diagnóstico sigue pausado mientras Sofía procesa: dejarlo abierto provocaría dos respuestas seguidas.
- "Reconectar" reinicia la conversación y lo dice; no se reenvía el historial al servidor.
- Textos `red-400`/`green-400` en la llamada se quedan: el token `danger` no da contraste suficiente en 10 px.

**Tests:** backend 95 → **106** (filtro de Whisper, sesión caída con/sin turnos suficientes, finalizer sin socket, idioma de STT).
Frontend 35/35, `tsc` y build limpios en cada tanda.

## 5. Pendiente

| Qué | Bloquea | Quién |
|---|---|---|
| Probar en iPhone (audio muteado, M7), Firefox (captura a 16 kHz, M9) y desconexión Bluetooth (M5) | Nada | Eric / equipo |
| `useOssAvatarWs`: final de respuestas largas (A4) | Confirmar en vivo con el servicio OSS | Claude |
| P3 restantes (fugas menores, colchón PCM, favicon, `MotionConfig`, contraste de 10 px, copy "ngrok") | Nada | Claude |
| Plan 22 fase 1 (motor de rutas) | Nada (las decisiones de §6 no la bloquean) | Claude |
| Landing fase 7 (og:image, póster, Lighthouse) | Nada | Claude |
| `kill 4006219` y dominio del túnel en Firebase | Permisos | Eric |
| `CLAUDE.md` decía que no había suite de pytest | — | ✅ Corregido |
