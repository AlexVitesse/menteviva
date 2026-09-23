# 2026-09-23 — Landing: propuesta "el cerebro como ambiente" (plan 21) + diagnóstico del copy

Sesión posterior a `2026-09-23_landing_fases0-2.md`. Feedback de Eric sobre la v3: "el landing no me gusta, se ve
básico; se han hecho correcciones pero no me gusta. Hazme una propuesta, pero quiero que se use ese 3D".
Tres pasos en el día: diagnóstico + prototipo (§1-3), diagnóstico del copy (§4) y, tras el "me late la dirección" de
Eric, **port a React del plan 21 con el copy nuevo** (§7). Sin commit.

## 1. Diagnóstico de por qué se veía básico

Se revisaron `docs/checkpoint-landing-v3/desk_00..07.png` contra el código:

| Síntoma | Causa |
|---|---|
| El cerebro parece un icono grande, no un ambiente | ~300 px de alto en 1440; la cámara nunca se mueve, solo el objeto (`ACTS[n].pos/scale`). |
| Se ve de plástico | `MeshStandardMaterial` sin mapa de entorno: cero reflejos. |
| El fondo es negro plano | Nada del 3D toca la página: sin derrame de luz, sin grano, sin viñeta. |
| Las zonas no brillan | Sprites aditivos sin bloom. |
| El texto siempre está *al lado* del cerebro | `ActSection` reparte 50/50 en todos los actos; nunca hay texto sobre la corteza. |

Conclusión: el plan 20 hizo que el cerebro *reaccione* al scroll; lo que faltaba era *presencia*.

## 2. Prototipo (fuera del repo)

Se construyó un prototipo navegable en HTML + three.js 0.166 (mismo `brain.glb` decimado, mismos `ANCHORS`) y se
publicó como artifact privado para que Eric lo viera con GPU real. **El artifact se borró a pedido de Eric** después
de aprobarlo ("me gusta"). La copia vive en `docs/landing-assets/proto-cerebro-ambiente/` (`index.html`, `shots.cjs`,
capturas `desk_*.png` / `mob_*.png` de la primera pasada; las `.png` están fuera de git por el `.gitignore`).

Lo que hace el prototipo, en orden de impacto:

1. **Escala y encuadre.** Hero con el cerebro a 1.1 pantallas de alto, recortado arriba, titular encima del tercio inferior.
2. **La cámara se mueve, no el objeto.** Cerebro fijo en el origen; cada acto define `cam` + `look`. En "la presión" la
   cámara hace *dolly* a 2.5 unidades y la corteza llena la pantalla; en "sostenerla" el cerebro gira ~80° para dar la cara.
3. **Derrame de luz sobre la página.** Degradado radial CSS (`mix-blend-mode: screen`) cuyo centro se proyecta por frame
   desde el 3D (`--bx/--by`), color por acto (rojo / teal / violeta).
4. **Material + bloom.** `MeshPhysicalMaterial` (clearcoat 0.45, iridiscencia 0.18, `envMapIntensity` 0.4) con
   `RoomEnvironment` procedural, y `UnrealBloomPass` con umbral 0.62.
5. **Grano + viñeta** fijos (SVG `feTurbulence`, opacidad 0.07).
6. **Latido por línea.** Cada línea del guion que aparece dispara un `kick` en la amígdala (acto 3) o la corteza
   prefrontal (acto 4); en la fase 4 del plan 20 lo disparará la amplitud del audio.

**Calibración que hubo que hacer tras la primera captura:** el material salió cromado (`envMapIntensity` 0.9 → 0.4,
clearcoat 0.7 → 0.45), y en los actos 3, 4 y 8 el bloom + derrame tapaban el texto (amígdala 2.6 → 1.5, derrame rojo
0.30 → 0.16, bloom del CTA 1.3 → 0.95). Se agregó un velo del lado del texto en los actos laterales (0.92 → 0.6 → 0 en
el 62 % del ancho) y desde abajo en móvil.

**Detalle técnico del artifact:** los artifacts no sirven `.glb`; se empaquetó en base64 dentro de `models/brain.js`
(`window.BRAIN_B64`) y se cargó con `GLTFLoader.parse`. Irrelevante para el port a React, que sigue usando `useGLTF`.

## 3. Plan 21

`docs/plans/21_landing_cerebro_ambiente.md`: diagnóstico, guion por acto, tabla de port a React archivo por archivo
(`acts.ts` pasa de `pos/scale` a `cam/look`; `use-act.ts` pasa de acto discreto a `sample()` continua por scroll;
única dependencia nueva `@react-three/postprocessing`, o 25 líneas con `UnrealBloomPass` si no se quiere la dep),
decisiones pendientes y lo que no cambia. Estimación: 1.5 días.

## 4. Feedback de Eric y diagnóstico del copy

Eric aprobó la dirección visual y rechazó el texto: **"no me termina de convencer el texto; yo en lo personal no
entiendo qué quieres comunicar"**.

Diagnóstico: los ocho titulares eran frases de ambiente ("La conversación que estás evitando", "Así suena la presión",
"Y esto es lo que queda", "Ve el reporte antes de decidir"). Ninguna dice qué es Mente Viva ni qué gana el comprador;
el producto solo se explicaba en el lead del hero. Con el cerebro poniendo ya el tono, dos capas de "mood" dejan al
lector sin información. Además Roberto se presentaba como persona ("Sesión real del piloto") y no como avatar.

**Regla nueva** (guardada en memoria): cada H2 se lee solo, sin la escena 3D, y responde qué es / qué hace / para
quién. El drama lo pone el 3D. Copy nuevo en `docs/plans/21_landing_cerebro_ambiente.md` §7; Eric aprobó la dirección
y **se aplicó en el mismo port** (§7 abajo). Sigue siendo borrador para Brandon.

## 5. Memoria actualizada

- `landing_cerebro_narrador_estado.md`: estado del plan 20/21, artifact borrado, aprobación visual y rechazo del copy.
- `feedback_copy_landing_directo.md` (nueva): la regla de titulares directos.

## 6. Pendiente (antes del port)

Eric respondió "si me late la dirección, métele en local" y el port se hizo en la misma sesión (§7). Lo abierto está al
final de §7.

## 7. Port a React (misma sesión)

Corre en el Vite de siempre (`npm run dev`, :5173). `npm run build` (tsc) y `eslint` limpios. **Cero dependencias
nuevas**: bloom, entorno y passes salen de `three/examples/jsm`, que ya estaba instalado. Capturas con GPU real en
`docs/checkpoint-landing-v4/` (desk_00-07, mob_00-09; fuera de git por el `*.png`).

| Archivo | Qué cambió |
|---|---|
| `acts.ts` | `ActState` pasa de `pos/scale` a `cam/look/rot/fresnel/synapses/bloom/zones/bleed`. Cerebro fijo en el origen. Valores copiados del prototipo. Colores de zona del acto 5 son de marca (violeta/teal/rojo), no semáforo, hasta tener puntajes. |
| `use-act.ts` | `samplePose(aspect)` escribe en `pose` (objeto mutable de módulo) la interpolación continua por scroll entre los centros de dos `[data-act]`; en móvil (`aspect < 1`) centra en x, baja el `look` 0.85 y aleja la cámara ×1.75. El `IntersectionObserver` se queda para marcar `.in` (revelado) y programar `kicks[zona]` (un golpe de luz por línea `.lp-r`, 550 ms entre líneas). |
| `brain-scene.tsx` | `MeshPhysicalMaterial` (clearcoat 0.45, iridiscencia 0.18, `envMapIntensity` 0.4); `Environment` = `RoomEnvironment` + `PMREMGenerator`; `Post` = `EffectComposer` + `UnrealBloomPass` (0.8 / 0.55 / 0.62) + `OutputPass` con `useFrame(..., 1)` (R3F deja de renderizar solo); la cámara persigue `pose.cam/look` con `damp` (λ 4.5; 30 con reduced-motion); el derrame escribe `--bx/--by/--bc` en `<html>` proyectando el centro o la zona activa. Tone mapping ACES, exposición 1.05, fov 40. El póster se apaga cuando `Brain` dibujó su primer frame (`onReady`), no al terminar la descarga: en móvil quedaba un hueco mientras compilaban los shaders. `?debug=brain` conserva `OrbitControls` (la cámara no se toca en debug) y las anclas. |
| `act-section.tsx` | Velo del lado del texto más denso (`from-ink/95 via-ink/60`, 62 % del ancho); prop `kick` → `data-kick`. `min-h-[100svh]`, `pt-[44svh]` en móvil. |
| `Landing.tsx` | Tres capas fijas nuevas (`.lp-bleed`, `.lp-vignette`, `.lp-grain`); `Transcript` con `.lp-r` y `--i`; actos 3-4 con `kick`. Copy nuevo. |
| `hero.tsx`, `problem.tsx`, `report-act.tsx`, `for-teams.tsx`, `comparison.tsx`, `cta.tsx` | Copy de §7 del plan 21. `report-act`: puntos `.lp-dot` con color por zona que se encienden con `.in`. CTA a `100svh`. |
| `navbar.tsx` | De barra opaca a degradado (`from-ink via-ink/80 to-transparent`), sin borde: la barra opaca cortaba el cerebro del hero. `scroll-padding-top` sigue evitando que los anchors caigan debajo. |
| `index.css` | `.lp-display` sube a 68 px en `lg` (y 34 px en móvil); nuevas `.lp-r`, `.lp-dot`, `.lp-bleed`, `.lp-vignette`, `.lp-grain` + `prefers-reduced-motion`. |

**Ajustes tras la primera captura del port:** en móvil el hero salía sin cerebro (póster apagado antes del primer frame:
corregido con `onReady`) y los actos 2/5 empujaban el cerebro fuera por la derecha (corregido centrando en x).

**Pendiente**

| Qué | Bloquea | Quién |
|---|---|---|
| Ver en un teléfono real (las capturas son Playwright 390×844 con GPU de escritorio); rendimiento del bloom en móvil real | Nada | Eric |
| Corregir el copy nuevo (borrador) y la respuesta de ejemplo | Revisión | Brandon / Sophia |
| Recapturar `public/landing/brain-poster.webp` con el encuadre nuevo (hoy se reusa el viejo, estirado a 104vh) | Nada | Claude |
| Audio de Roberto (fase 4: el `kick` pasa a la amplitud), puntajes reales (fase 5: zonas en semáforo), link de calendario, línea "Piloto con Cóndor" | Sesión con consentimiento / decisiones | Eric / Brandon |
| Lighthouse móvil, `og:image`, reduced-motion verificado (fase 7 del plan 20) | Nada | Claude |
| Commit: todo sin commitear (fases 0-3 + plan 21 + docs) | Decisión | Eric |
