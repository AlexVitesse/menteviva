# 2026-09-23 — Pendientes del plan original y plan 22 (rutas adaptativas)

Sesión de planeación, sin código. Eric preguntó "del plan original, ¿qué nos falta implementar?"
y aclaró que se refería a las **rutas** (roadmap adaptativo), no a la landing.

## 1. Pendientes de la landing (plan 20), por si se retoma

Verificado contra el código:

| Qué | Estado | Bloquea |
|---|---|---|
| Fase 4: audio de Roberto (`gen_landing_audio.py`, mp3, `cues.json`, `audio-act.tsx`) | No existe `public/audio/landing/` | Sesión con consentimiento |
| Fase 5: reporte real (`gen_landing_report.py`, `report.json`) | `report-act.tsx` sigue con "—" | Misma sesión |
| Fase 6: link de calendario (`VITE_DEMO_URL`) y línea "Piloto con Cóndor" | `links.ts` cae a `mailto` | Decisión de Eric |
| Fase 7: `og:image`, recaptura del póster, `dpr` 1.25 en móvil, Lighthouse, reduced-motion verificado | Nada hecho | Nada (Claude) |

## 2. Qué falta del plan original de producto (rutas)

Comparación de `MenteViva_DocumentoFuncional_v2.docx` §4 y del spec del prototipo contra el código:

| Del spec | Estado |
|---|---|
| Ruta recalculada tras cada sesión | ❌ El perfil queda congelado en el diagnóstico |
| Reglas de nivel (> 75 ×2 sube, < 50 baja, 3 sin mejora → refuerzo) | ❌ |
| Ruta de 4-8 semanas con "¿por qué este orden?" | ❌ Solo hay un `recommended_next_scenario` |
| Catálogo de habilidades unificado | ❌ El diagnóstico usa 10 habilidades; cada avatar tiene sus 6 KPI |
| Progreso visible (barras, fortalezas confirmadas, siguiente reto) | ❌ |
| Metas del manager, vista P-13/P-14, organizaciones y equipos | ❌ No hay tablas |
| Catálogo de 8 categorías / 40+ escenarios | ❌ 3 avatares de práctica (Roberto, María, Celeste); solo Roberto y Celeste con niveles |
| Rehacer diagnóstico desde `/mi-plan` | ✅ Ya existía |
| Editar registro | ❌ No hay `PATCH` |

## 3. Plan 22

`docs/plans/22_rutas_adaptativas.md`. Todo lo ejecuta Claude (decisión de Eric: nada de reparto entre agentes).

- **Decisión central:** el plan se **deriva** con una función pura
  `compute_plan(registro, diagnostico, sesiones, metas)` en cada request. No se guarda, no hay merge al perfil y no usa LLM.
- **Mapa KPI → habilidad** (`SKILL_MAP`) para unir las rúbricas de los avatares con el catálogo de 10 sin tocar el analizador. Borrador para Sophia.
- Hallazgos que el plan cubre: los análisis de menos de 4 intercambios traen **puntajes aleatorios** (`_demo_analysis`) y el motor debe descartarlos;
  autoconciencia, trabajo en equipo y gestión de prioridades no las entrena ningún avatar; Celeste tiene niveles
  en el backend pero `Briefing.tsx::AVATARS_WITH_LEVELS` solo incluye a Roberto; la última migración es la 7.
- Fases: 1 motor (1 d) · 2 UI con checkpoint (1.5 d) · 3 editar registro (0.5 d) · 4 equipos y manager (3 d) · 5 catálogo (1.5 d + contenido).

## Decisiones pendientes (plan 22 §6)

Umbrales del doc tal cual · línea base inferida del diagnóstico · ¿el manager ve puntajes individuales? (Cristina) ·
invitación por código vs magic link · siguiente escenario a construir.

## 4. Auditoría de la videollamada (audio + UI/UX)

Pedido de Eric: "evalúa la plataforma de videollamada y recepción de audios, si hay limpieza, UX y UI".
Dos auditorías en paralelo, solo lectura. Resultado en `docs/auditoria-videollamada-2026-09-23/`
(`README.md` con prioridades, `AUDIO.md`, `UI_UX.md`, 25 capturas con WS simulado en modo Gemini).

- La limpieza de audio está bien (cancelación de eco, supresión de ruido y ganancia automática consistentes); no hace falta RNNoise.
- **P0:** las llamadas síncronas a Groq bloquean el event loop con usuarios simultáneos (verificado: `from groq import Groq`) ·
  Whisper sin filtro de alucinaciones · "Terminar" fuera de pantalla a 390 px (verificado en `mob_09`) · caída o cierre de pestaña
  que pierde la sesión sin avisar (verificado: no hay `beforeunload`).
- Además: `bg-surface` no existe en Tailwind (verificado) y el VAD de Gemini sigue en HIGH/500 ms, no en el LOW/800 ms acordado (verificado).
- P0 + P1 ≈ 1.5 días. Sin código tocado.
