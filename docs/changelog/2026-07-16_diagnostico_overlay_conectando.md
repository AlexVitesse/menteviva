# 2026-07-16 — Diagnostico: overlay de "Conectando" + botón anti-doble-click

## Motivación
Reporte del usuario: "le doy al botón de iniciar la entrevista y se queda
colgado". Además de los fixes de robustez en `useOssAvatarWs` (timeout + guard de
reentrancia), faltaba **feedback de carga** y **bloqueo del botón** durante la
conexión: el overlay de permiso desaparecía apenas se concedía el micrófono
(`sessionStarted=true`), aunque el avatar y Gemini seguían conectando — ventana
sin feedback donde se percibía "colgado" y se podía re-disparar el arranque.

## Cambios (`src/pages/Diagnostico.tsx`)
- **Fase `preparing`**: derivada de `sessionStarted && !gemini.hasGreeted && …`.
  Va desde que se concede el mic hasta que Sofía saluda. Es **acotada**:
  `useGeminiLive` marca `hasGreeted` por fallback en ≤6 s aunque el saludo tarde.
- **Overlay durante `preparing`**: se mantiene el overlay (antes se ocultaba en
  `sessionStarted`) mostrando **spinner + "Conectando con Sofía…"** y **sin botón
  de inicio** → no se puede re-disparar el arranque (evita el doble-connect).
- **Escape de seguridad**: si `preparing` dura >10 s, aparece "Entrar de todas
  formas" (`forceEnter`) para no bloquear indefinidamente jamás.
- **Guard en `handleStartSession`**: `if (requestingPermission || sessionStarted)
  return;` corta cualquier doble-invocación (el botón ya se deshabilita por
  `requestingPermission`; esto es defensa en profundidad). `disabled:cursor-not-allowed`
  para dejar claro que está bloqueado.

## Verificación
- `npm run build` (tsc + vite) → **limpio**.
- Flujo: click → botón deshabilitado con "Pidiendo permiso…" → mic concedido →
  overlay "Conectando con Sofía…" (spinner, sin botón) → Sofía saluda (o ≤6 s
  fallback / 10 s escape) → overlay se cierra y arranca la conversación.
- **Pendiente de confirmación visual** en `/diagnostico` (requiere login + mic).
