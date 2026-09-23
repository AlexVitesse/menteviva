# 2026-09-23 — Landing: cerebro narrador (plan 20, fases 0-3) + limpieza de plantilla + escala tipográfica

Plan: `docs/plans/20_landing_cerebro_narrador.md` (v2). Tres pasadas en el día: fases 0-2 (checkpoint), luego marcas de plantilla,
composición por acto y fase 3 tras el feedback de Eric, y al final navbar y tamaño de texto. Estado final al pie.

## Fase 0 — Preparación
- **GLB decimado**: `public/models/brain.glb` pasó de 205,701 → 68,119 vértices y de 2.57 MB → 0.95 MB
  (`gltf-transform simplify --ratio 0.3 --error 0.001` + `meshopt`, y se quitaron las texturas `baseColor` y
  `metallicRoughness`, que el material nuevo ya no usa; queda solo el `normalMap`).
  Original en `docs/landing-assets/brain-full.glb` (ignorado en git; también sigue en el historial).
- **`npm run shots -- <dir>`** (`menteviva-frontend/scripts/landing-shots.cjs`): capturas desk 1440×900 + mob 390×844.
  `SHOTS_GPU=1` usa la GPU real (en esta máquina headless sí la toma: Intel UHD / D3D11); sin eso, SwiftShader.
  `SHOTS_URL` para otra URL (p. ej. `?debug=brain`). Requiere `npm run dev`.
- **`src/lib/links.ts` → `DEMO_HREF`**: `VITE_DEMO_URL` o, si no existe, el `mailto`. Se reemplazaron los 4 mailto de demo
  (hero, navbar, for-teams, cta). El `mailto` del footer es de contacto y se queda.

## Fase 1 — Cerebro vivo + hero
- Material: violeta oscuro `#2B1B5E` con emisivo violeta y el `normalMap` del GLB (surcos visibles, sin textura de carne).
- Fresnel aditivo (`ShaderMaterial`) como **hijo de la malla** (hereda su transform y comparte geometría).
- Fuera `BrainAura`, el velo `from-ink via-ink/85`, `Float` y el `spotLight`/luz rosa. Luces según el plan.
- **Bug encontrado y corregido:** agregar el fresnel dentro de `root.traverse` hacía que traverse lo visitara y agregara otro,
  en bucle infinito (la página se colgaba). Ahora se juntan las mallas antes de modificarlas.
- **Póster** `public/landing/brain-poster.webp` (1200×1200, 28 KB), capturado con GPU real y sin contenido encima. Se muestra
  mientras carga el GLB y cuando no hay WebGL2; su posición en `vh` sale de `ACTS[1]` (el fov es vertical, así que vale
  para cualquier ancho). Si cambia la pose del acto 1 hay que volver a capturarlo.
- Hero: texto centrado abajo y cerebro arriba; sin stats ni palabra en gradiente; un solo CTA + link "o prueba una conversación gratis".

## Fase 2 — Motor de actos
- `acts.ts` (poses por acto + `mobile`), `use-act.ts` (`actRef` mutable + `IntersectionObserver` en la banda central),
  `act-section.tsx` (layout + velo del lado del texto; en móvil el texto va abajo con `pt-[42vh]`).
- `brain-scene.tsx`: `damp` hacia la pose del acto (posición, escala, rotación, fresnel, opacidad de sinapsis); `reduced-motion` → lambda 20
  y sin rotación idle. `?debug=brain`: `OrbitControls` (sin zoom, la rueda sigue haciendo scroll), esferas en `ANCHORS`, ejes y log del acto.
- `Landing.tsx`: Hero(1) · Problem(2) · Presión(3) · Respuesta(4) · Reporte(5) · Equipos(6) · Comparativa(7) · CTA(8).
  Los actos 3-5 son provisionales: el 3 muestra turnos reales de Roberto en texto (el audio llega en la fase 4); el 4 y el 5 solo tienen título.
- Se borraron `how-it-works.tsx` y `conversations.tsx`. `for-teams.tsx` quedó como texto (H2 + 4 líneas, sin bento).
- Navbar: `#presion`, `#reporte`, `#equipos`, `#comparativa`.
- Poses calibradas con capturas: el acto 1 bajó de `scale 1.3, y 0.9` a `1.0, 1.4` porque el cerebro tapaba el H1; en móvil el acto 1 queda en `0.6`
  y los actos 3-5 en `y 1.6` para que no queden detrás del navbar.

## Verificación
- `npm run build` y `eslint` limpios.
- Capturas en `docs/checkpoint-landing-fase2/` (desk_00-07, mob_00-08, `debug_brain.png`, `nowebgl_mob.png`).
  **Ojo:** `.gitignore` excluye `*.png`, así que las capturas no se suben; se comparten a mano.

## Pendiente (no bloquea el checkpoint)
- `ANCHORS` sin calibrar: en `debug_brain.png` las 5 esferas caen en una sola zona. Se calibran en la fase 3 con `?debug=brain`.
- CTA con la caja y el halo, y Comparativa sin cambios → fase 6.
- En los actos 6-7 (móvil), el cerebro atenuado queda detrás del H2; se revisa en la fase 7.

---

## Segunda pasada (mismo día) — marcas de plantilla, composición por acto y fase 3

Feedback de Eric tras el checkpoint: "ya tiene movimiento el cerebro, pero sigue pareciendo hecho por IA; no se aplicaron todos los hallazgos".
Tenía razón: el plan 20 no cubría varias marcas de plantilla de `HALLAZGOS.md` §2.1, y `ActSection` repetía la misma composición en todos los actos.

**Marcas de plantilla eliminadas**
- Navbar: de píldora de vidrio con logo en gradiente → barra plana a todo lo ancho, wordmark en Syne, botón crema.
- Fade-ups de framer-motion quitados de hero, comparativa y CTA (el único movimiento de la página es el cerebro).
- CTA: sin caja con borde en gradiente, sin halo, sin `ArrowRight`, sin segundo botón. Queda centrado sobre el cerebro encendido.
- Botones morados con gradiente → botón sólido crema (`bg-cream text-ink`) en toda la landing.
- Footer: sin el cuadrito "M" en gradiente.
- Texto largo de `text-muted` (60 %) a `text-cream/75` para subir el contraste.

**Una composición distinta por acto**
- Acto 2: frase grande en Syne + dos columnas bajo una línea vertical.
- Actos 3-4: formato de guion (quién habla a la izquierda en versalitas: ROBERTO en rojo, TÚ en teal). El acto 4 lleva un **borrador de respuesta de ejemplo** (etiquetado así en pantalla) para que Sophia lo corrija.
- Acto 5 (`report-act.tsx`): hoja de resultados con la rúbrica real de Roberto (las 4 habilidades con más peso en `analysis.py`) y la leyenda del semáforo. **Los puntajes salen como "—"**: no se inventa ningún número hasta tener la sesión con consentimiento (fase 5).
- Acto 6: "RH ve" frente a "RH no ve" (la promesa y el límite de privacidad, uno al lado del otro).
- Acto 7: los 3 diferenciadores en tres columnas con una regla gruesa arriba.

**Fase 3 — Zonas**
- `Zone` en `brain-scene.tsx`: sprite con degradado radial (sin bordes cuadrados, `depthTest: false`, así el brillo se ve a través de la corteza) + `pointLight` que tiñe la superficie; color e intensidad con `damp` hacia `ACTS[acto].zones`.
- La amígdala late en el acto 3 (seno lento; en la fase 4 se conecta a la amplitud del audio).
- Partículas: 140 (70 en móvil).
- `ANCHORS` recalibrados: en este modelo el frente del cerebro apunta a −x, no a +z como suponía el plan.
- Acto 8 subido a la pose del hero (`y 1.4`, `scale 1.0`) porque el cerebro tapaba el título del CTA.

Capturas en `docs/checkpoint-landing-v2/`. Build y eslint limpios.

**Sigue pendiente:** audio real (fase 4) y puntajes (fase 5), que esperan la sesión con consentimiento; la línea de prueba social (Cóndor); el link de calendario; la fase 7 (Lighthouse, OG image, reduced-motion verificado).

## Tercera pasada — navbar y tamaño de texto
Feedback: "el tamaño del texto no me convence; el navbar está encima del texto igual".
- Navbar opaco (`bg-ink`, antes `bg-ink/90`: el texto se transparentaba debajo al hacer scroll) y `scroll-padding-top: 5rem` en `html`, para que los anchors no caigan bajo la barra.
- Escala tipográfica única en `index.css` (`.lp-display`, `.lp-h2`, `.lp-h3`, `.lp-lead`, `.lp-quote`, `.lp-body`, `.lp-label`, `.lp-note`). Antes había 4 tamaños distintos de título (7xl, 6xl, 5xl, 5xl) y el cuerpo fijo en 18 px en cualquier pantalla.
  Ahora: H1/CTA 36→60 px, H2 30→44 px, lead 18→20 px, cuerpo 16→18 px, etiquetas 12→14 px. Todo se calibra en ese bloque de CSS.
Capturas en `docs/checkpoint-landing-v3/`.

---

## Estado al cierre del día (sin commit)

**Hecho:** fases 0-3 del plan 20; las marcas de plantilla de `HALLAZGOS.md` §2.1 (navbar píldora, gradiente en H1, fila de cifras,
bento, stepper, caja de CTA con halo, `ArrowRight`, fade-ups); una composición distinta por acto; escala tipográfica `.lp-*`.

**Validación de Eric:** el movimiento del cerebro, sí. El tamaño de texto de la tercera pasada quedó "de momento": falta
confirmar la dirección (títulos más chicos, cuerpo más grande o cambiar Syne). Se calibra en el bloque `.lp-*` de `index.css`.

**Pendiente, por bloqueo:**
| Qué | Bloquea | Quién |
|---|---|---|
| Audio de Roberto + `cues.json` + `AudioAct` (fase 4) | Sesión completa con consentimiento en `/chat-lab` | Eric / Brandon |
| Puntajes reales en el acto 5 (fase 5), hoy "—" | La misma sesión | Eric / Brandon |
| Respuesta de ejemplo del acto 4 (hoy borrador de Claude) | Revisión | Sophia |
| Copy del acto 2 (borrador) | Revisión | Brandon |
| Línea "Piloto con Ingeniería Cóndor" | Decisión §8.2 del plan | Eric |
| `VITE_DEMO_URL` (hoy cae a `mailto`) | Link de Cal.com/Calendly | Eric |
| Fase 7: Lighthouse móvil, `og:image` con el póster, reduced-motion verificado | Nada | Claude |

**Cosas a saber para retomar:**
- Si cambia la pose del acto 1 (`acts.ts`), hay que recapturar `public/landing/brain-poster.webp` y ajustar su `top`/`w` en `BrainPoster`.
- `?debug=brain` muestra las anclas de las zonas; `npm run shots -- <dir>` con `SHOTS_GPU=1` saca capturas con GPU real.
- Las capturas (`docs/checkpoint-landing-*`) están fuera de git por el `*.png` del `.gitignore`.
