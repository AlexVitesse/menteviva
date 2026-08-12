# 2026-08-12 — Archivado de ramas integradas en main

## Contexto

Cuatro ramas históricas quedaron **100% contenidas en `main`** (su tip es
ancestro de `main`/`dev`, 0 commits pendientes de mergear). Su trabajo ya vive
en la historia principal del repo, así que la rama es redundante como puntero.
Para mantener el repositorio limpio se documenta aquí qué aportó cada una y se
eliminan.

## Ramas archivadas

| Rama                       | Último commit | Aportó |
|----------------------------|---------------|--------|
| `master`                   | `74f4fca`     | Línea base del MVP original (Edge TTS, rotación de API keys Groq, DEMO badge, spinner de análisis) |
| `feature/elevenlabs-tts`   | `ea2061c`     | Migración a ElevenLabs TTS + streaming de audio, fase de diagnóstico BEI, fix iOS Safari, Sofia 1-pregunta |
| `feature/avatar-talkinghead` | `bbd4f14`    | Avatares 3D/RPM con animación idle + Y dinámico por género, escenario Roberto-Cóndor, dashboard Mi Plan, Postgres, test scripts de operación |
| `feature/gemini-live-voice` | `6e5956f`    | Gemini Live audio nativo + avatar Simli, evaluación fiel con transcripts robustos + calidad AV, resumen ejecutivo narrativo-espejo |

Todas comparten el ancestro común del MVP inicial (`ed40bc5`, 2026-02-26) y
fueron absorbidas en `main` a través de la línea `dev`.

## Detalle por rama

### master (2026-02-26)

Línea base del producto. 10 commits del MVP:

- `ed40bc5` Initial commit — Mente Viva MVP
- `633e36b` session timer + sound effects
- `1afa97a` tunnel URLs para remote sharing
- `6b69cf6` DEMO badge en header
- `f30a602` demo analysis para sesiones cortas
- `1df87cb` rotación de API keys Groq (concurrencia)
- `f298271` avatar pregunta UNA sola cosa por respuesta
- `8dc9f21` análisis timeout 2s → 10s
- `de3949f` spinner "analyzing"
- `74f4fca` + retries Edge TTS para evitar voice fallback equivocada

### feature/elevenlabs-tts (2026-04-21 .. 04-23, tip `ea2061c`)

Migración de TTS y la fase de diagnóstico (entrevista BEI):

- `11fd360` diagnostic phase (BEI interview) + integración ElevenLabs TTS
- `ece8d76` voz entrevistador en AVATAR_VOICES
- `ea44462` vozes propias para Sofia y Carlos
- `78586cb` streaming TTS desde ElevenLabs vía MediaSource
- `73be9b8` drop MediaSource → playback cross-browser
- `5d47a16` + para iOS Safari audio unlock
- `87ac90e` iOS audio + flujo de permisos + doble-trigger en mic
- `0929760` usar `convert_as_stream` (`.stream()` no existe)
- sofia: cached greeting, auto-close, cap follow-ups a 3, usuarios no
  cooperativos y sesiones inconclusas (`ea2061c`)

### feature/avatar-talkinghead (2026-04-27 .. 05-14, tip `bbd4f14`)

La cara "talkinghead" de los avatares y el backend alrededor:

- `eaaeabf` avatares 3D + escenario Roberto-Cóndor + 6 KPIs + gpt-oss-20b
- `35ffb3d` Roberto 3 niveles (Principiante/Intermedio/Avanzado) + selector
- `f63afd5` dashboard /mi-plan + persistencia de sesiones en SQLite
- `36f9c26` Firebase Auth + schema migrator Postgres-ready
- `8cb83fb` RPM idle animation + dynamic Y offset + per-gender
- `a6e5fff` diagnostico Zoom-style layout + mute button
- `90fd713` fix gpt-oss-20b tool_choice glitch + vite proxy IPv4
- `26a79eb` + `bbd4f14` plan de deploy piloto (Cloudflare Tunnel + Neon) y
  operational test scripts

### feature/gemini-live-voice (2026-05-28 .. 06-10, tip `6e5956f`)

Voz y evaluación de la fase VoiceLab/diagnóstico:

- `750c494` mic-mute/pausa + fallback de LLM endurecido
- `87d97f4` fix redirección a /registro + manejo de fallo /auth/sync
- `3f29a97` Gemini Live audio nativo + avatar Simli (fase 2/3 testing)
- `e91eaab` evaluación fiel + transcripts robustos + calidad AV (plan 06)
- `6e5956f` resumen ejecutivo narrativo-espejo en el reporte

## Estado tras el archivado

- `main` y `dev` comparten `9fbb663` y la línea `dev` continúa desde el merge
  de `feature/avatar-oss` (`fe928ed`) y `codex/roberto-sales-cases`
  (`b975725`).
- Las ramas `feature/avatar-oss` y `codex/roberto-sales-cases` se conservan
  (siguen vivas para desarrollo activo).
- Documentación en `docs/` versionada; el estado final queda reflejado aquí.