# 2026-07-16 — VoiceLab: selector de duración (25/40/60) en la UI

## Contexto
El usuario notó que VoiceLab, a diferencia de ChatLab, no dejaba elegir la
duración de la conversación.

## Hallazgo
La lógica de duración **ya estaba cableada** en VoiceLab; solo faltaba el control
en la UI. `session.durationMin` ya alimentaba:
- el objetivo de progreso `targetExchanges(durationMin)` (`VoiceLab.tsx:604`),
- el cronómetro `targetSeconds = durationMin * 60` (`:616`),
- y `session_vars: { minutos: durationMin }` que se manda al backend al abrir la
  sesión Live y en el análisis (`:725`, `:880`, `:929`).

Pero `durationMin` quedaba fijo en `DEFAULT_DURATION` (25) porque no había botones
para cambiarlo.

## Cambio
`menteviva-frontend/src/pages/VoiceLab.tsx`:
- Importa `DURATIONS` de `./chatlab/types`.
- Agrega un selector de duración (25 / 40 / 60 min) en la pantalla previa a la
  llamada, entre el selector de avatar y el registro. Usa `updateSession({ durationMin })`,
  mismo estilo visual que el picker de avatar.
- Incluye una nota: Gemini Live puede cerrar la sesión de voz cerca de los ~15 min
  (límite técnico del native-audio; el rango 25/40/60 se ofrece por consistencia
  con ChatLab, no porque la voz garantice 60 min continuos).

## Verificación
- `npx tsc --noEmit` → exit 0.
- Cambio solo de UI; reutiliza el pipeline de duración ya existente, así que no
  toca backend.

## Nota
Sesiones de VoiceLab ya guardadas en `localStorage` conservan su `durationMin`
previo; el selector aplica desde la próxima interacción.
