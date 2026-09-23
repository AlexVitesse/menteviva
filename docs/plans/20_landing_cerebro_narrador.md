# 20 - Landing: el cerebro como narrador (v2, ejecutable)

**Fecha:** 2026-09-22 (v1) · 2026-09-23 (v2: tareas por archivo, recortes, adiciones)
**Estado (2026-09-23):** fases 0-3 hechas, más limpieza de plantilla y escala tipográfica que este plan no cubría (ver `docs/changelog/2026-09-23_landing_fases0-2.md`). Fases 4-5 bloqueadas por la sesión con consentimiento; fase 6 absorbida en la segunda pasada; fase 7 pendiente.
**Hallazgos que lo motivan:** `docs/auditoria-landing-2026-09-22/HALLAZGOS.md`
**Relación con el plan 19:** el 19 fue *Redesign-Preserve* ("B2B no quiere Awwwards, quiere claridad"). Quedó claro pero genérico y Eric lo rechazó. Este plan cambia de postura: el 3D pasa a ser el concepto de la página. Se conservan paleta, titular y los 3 diferenciadores.
**Audiencia:** comprador B2B (RH / L&D). El practicante aparece como prueba: "esto es lo que va a vivir tu equipo".

**Qué cambió en la v2:** cada fase lista archivos, funciones y valores concretos; se recortan las tres piezas más caras de la v1 (líneas 3D→DOM, red de 7 cerebros, curvas de sinapsis antes del checkpoint); se agregan siete cosas que la v1 no tenía (§7).

---

## 0. Estado verificado del código (2026-09-23)

| Qué | Dato | Consecuencia |
|---|---|---|
| `public/models/brain.glb` | **1 malla, 1 primitive, 205,701 vértices**, material con `baseColor` + `normalTexture` + metallicRoughness, 3 texturas WebP, 2.5 MB | No se segmenta (anclas, no regiones). Hay que decimar: el fresnel duplica draw calls y móvil no aguanta 205k. |
| `brain-scene.tsx` | `useScroll` de framer reparte todo el movimiento en ~5700 px (`Brain3D`, líneas 135-141). `BrainAura` = esfera `BackSide` opacidad 0.06. Velo `from-ink via-ink/85` sobre el canvas. 220 puntos al azar. | Todo eso se reemplaza en fases 1-2. |
| Deps ya instaladas | `three 0.166`, `@react-three/fiber 8`, `@react-three/drei 9`, `framer-motion 11`, `zustand 4`, `@playwright/test` | **Cero dependencias nuevas** en fases 1-6. |
| `analysis.analyze_conversation(avatar_id, conversation, duration_seconds, sales_case)` | Si la conversación tiene **< 4 intercambios devuelve `_demo_analysis`** (puntajes inventados). Output: `overall_score`, `skills[{id,name,weight,score,feedback,moment,...}]`, `key_moments`. | El reporte del acto 5 tiene que salir de una **sesión completa**, no del intercambio suelto de los actos 3-4. Ver §3.5. |
| `edge_tts.text_to_speech(text, avatar_id) -> bytes` (MP3) | `AVATAR_VOICES`: roberto `uPc5TJmLHicJAPs7qpif`, maria/celeste `m7yTemJqdIqrcNleANfX`. | El script de audio solo llama esa función. |
| `chatlab_conversations` | `session_id, user_id, name, avatar_id, provider, model, minutos, conversation_json, closed, created_at, updated_at` | Fuente de la objeción real y de la sesión completa para el reporte. |
| `mailto:` de demo | `hero.tsx:53`, `navbar.tsx:7`, `for-teams.tsx`, `cta.tsx` (4 lugares, `CONTACTO` de `pages/Legal.tsx`) | Se centraliza en un solo `DEMO_HREF` (§3.6). |
| Script de capturas | En scratchpad de una sesión anterior (`shots.cjs`, Playwright + SwiftShader, 1440×900 y 390×844) | Se mueve al repo (§7.6). |

---

## 1. Idea central

*Mente Viva* entrena habilidades bajo presión y las mide. El cerebro **muestra** eso mientras se baja por la página: se tensa cuando el avatar presiona, se ordena cuando la persona responde bien y termina pintado con el semáforo del reporte.

Deja de ser fondo y pasa a ser **el narrador**. Cada sección es un "acto" y el cerebro cambia de pose, luz y zonas activas en cada uno.

## 2. Guion de actos

| # | Acto | Cerebro (3D) | Contenido (HTML) | `id` / navbar |
|---|---|---|---|---|
| 1 | **Hero** | Centrado, arriba del texto, grande, con brillo propio: fresnel violeta, sinapsis encendidas, rotación lenta. Sin textura de carne. | H1 "La conversación que estás evitando." + subtítulo actual + **un solo** CTA principal (demo) + link de texto "Probar gratis". Sin fila de cifras, sin palabra en gradiente. | `#inicio` |
| 2 | **El problema** | Se aleja a la derecha; las sinapsis se apagan a gris. | 2-3 líneas del brief §2: los cursos no ponen a prueba, el roleplay con colegas no da feedback, nadie practica la conversación difícil antes de tenerla. | — |
| 3 | **La presión** (sustituye "Esto es lo que vas a oír") | Se acerca a la izquierda; la **amígdala** se enciende en rojo (`danger`) y pulsa con la amplitud del audio. | Reproductor: Roberto dice su objeción más dura **con su voz real** (mp3 pregenerado). Transcripción sincronizada por cues, una línea a la vez. | `#presion` ("La presión") |
| 4 | **La respuesta** | El rojo baja; la **corteza prefrontal** se enciende en teal. | Respuesta de ejemplo (etiquetada "respuesta de ejemplo"), audio + texto. | — |
| 5 | **La evidencia** | 3-4 zonas toman el color del semáforo de su habilidad. | Reporte real: 3-4 habilidades con puntaje, la cita `moment` como evidencia y el punto del semáforo del **mismo color que su zona**. | `#reporte` ("El reporte") |
| 6 | **Para equipos** | Se aleja al fondo, se atenúa; alrededor aparecen 6 sprites de glow pequeños de colores distintos (el equipo). | Lo que ve RH: reporte agregado, quién practicó, sin instalar nada, privacidad (RH ve el agregado, no la transcripción). Una sola composición, sin bento. | `#equipos` ("Para equipos") |
| 7 | **Por qué no un taller** | Igual que 6 (sin cambio). | Los 3 diferenciadores actuales de `comparison.tsx`, sin cambios de copy. | `#comparativa` |
| 8 | **CTA** | Vuelve solo, centrado, todo encendido (zonas en violeta/teal). | "Ve el reporte antes de decidir." + botón a calendario + una línea: "Una práctica dura de 5 a 10 minutos · El reporte llega al terminar". Sin caja con halo. | — |

**Recortes respecto a la v1** (con razón):
- **Sin líneas 3D→fila del reporte** en el acto 5. Proyectar coordenadas del canvas al DOM se rompe en resize y móvil. El color compartido zona↔punto del semáforo cuenta lo mismo.
- **Sin red de 5-7 cerebros** en el acto 6. Son 7 × 205k vértices por frame. Seis sprites de glow alrededor del cerebro atenuado dicen "equipo" igual.
- **Sin curvas de sinapsis** (`CatmullRomCurve3`) hasta después del checkpoint. Los puntos actuales, atenuados por acto, bastan para las fases 1-2.
- **Sin bloom / `@react-three/postprocessing`.** El fresnel aditivo alcanza. Si en el checkpoint no alcanza, se reconsidera.

---

## 3. Fases con tareas por archivo

Cada fase termina con: `npm run build` limpio, capturas con `npm run shots` (§7.6) y bitácora en `docs/changelog/2026-MM-DD_landing_faseN.md`.

### Fase 0 — Preparación (0.5 día, sin bloqueos)

1. **Decimar el GLB** (una vez, sin dependencia permanente):
   ```bash
   cd menteviva-frontend
   npx @gltf-transform/cli simplify public/models/brain.glb public/models/brain.glb --ratio 0.3 --error 0.001
   npx @gltf-transform/cli inspect public/models/brain.glb   # verificar: ~60k vértices, < 1 MB
   ```
   Guardar el original como `public/models/brain-full.glb` **fuera de git** (o en `docs/`, no en `public/`) por si hay que re-decimar con otro ratio. Criterio: el relieve de los surcos sigue viéndose en captura de escritorio.
2. **Mover el script de capturas** al repo: `menteviva-frontend/scripts/landing-shots.cjs` (contenido = `shots.cjs` del scratchpad) y en `package.json`:
   `"shots": "node scripts/landing-shots.cjs docs/auditoria-landing-2026-09-22"` → recibe carpeta destino por argumento. Requiere `npm run dev` corriendo.
3. **Constante única de demo**: crear `src/lib/links.ts` con `export const DEMO_HREF = import.meta.env.VITE_DEMO_URL ?? \`mailto:${CONTACTO}?subject=Demo%20de%20Mente%20Viva\``. Reemplazar los 4 `mailto` (`hero`, `navbar`, `for-teams`, `cta`). Cuando Eric dé el link de Cal.com/Calendly, se pone en `.env` y no se toca código.

### Fase 1 — Cerebro vivo + hero (1 día)

**`src/components/landing/brain-scene.tsx`**
- `Brain()`: después de `scene.clone(true)`, recorrer con `root.traverse` y en cada `Mesh`:
  ```ts
  const old = mesh.material as THREE.MeshStandardMaterial
  mesh.material = new THREE.MeshStandardMaterial({
    color: "#2B1B5E", roughness: 0.4, metalness: 0.05,
    emissive: "#7C3AED", emissiveIntensity: 0.12,
    normalMap: old.normalMap, normalScale: old.normalScale,
  })
  old.map?.dispose(); old.roughnessMap?.dispose(); old.dispose()
  ```
  Guardar `mesh.geometry` en un ref para el fresnel. **No** clonar la geometría.
- Nuevo `BrainFresnel({ geometry })`: `<mesh geometry={geometry}>` con `ShaderMaterial` (`transparent`, `depthWrite: false`, `blending: AdditiveBlending`, `side: FrontSide`). Uniforms: `uColor` (`#A855F7`), `uPower` (2.5), `uIntensity` (0.9). GLSL:
  ```glsl
  // vertex
  varying float vFresnel;
  void main(){ vec3 n = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0);
    vFresnel = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), uPower); gl_Position = projectionMatrix*mv; }
  // fragment
  uniform vec3 uColor; uniform float uIntensity; varying float vFresnel;
  void main(){ gl_FragColor = vec4(uColor * vFresnel * uIntensity, vFresnel); }
  ```
  Va dentro del mismo `<group>` que el cerebro para heredar escala y posición.
- **Eliminar** `BrainAura` y el `<div>` velo `from-ink via-ink/85`.
- Luces: dejar `ambientLight 0.25`, `directionalLight` blanca cálida `[3, 4, 5]` intensidad 1.2 (para que el `normalMap` dibuje surcos), una `pointLight` violeta `[-4, 2, 3]` 0.8 y una teal `[4, -2, -3]` 0.5. Quitar el `spotLight` y la rosa.
- Quitar `Float` de drei (la pose la controla el motor de actos en fase 2; mientras, rotación `y` lenta en `useFrame`).
- **Póster de carga**: `useProgress` de drei en `BrainScene`; mientras `active` o si no hay WebGL (`!!document.createElement("canvas").getContext("webgl2")` falso), renderizar `<img src="/landing/brain-poster.webp">` centrado con la misma posición que el hero. El PNG se captura al final de esta fase con GPU real (captura del hero recortada, 1200×1200, WebP q80).

**`src/components/landing/hero.tsx`**
- Layout: `section min-h-[100dvh] flex flex-col justify-end` con el bloque de texto `mx-auto max-w-3xl text-center pb-24`. El cerebro queda en el tercio superior (pose del acto 1, `y: +0.9`), el texto en el inferior: no se enciman en 390 px ni en 1440.
- Fondo de lectura del hero: `absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-ink via-ink/80 to-transparent` detrás del texto.
- Borrar `stats` y el `<dl>`; borrar el `<span>` con gradiente ("evitando" en `text-cream` normal).
- CTA: un solo `<a href={DEMO_HREF}>` "Agendar demo" (mantener estilo de botón, **sin** `ArrowRight`). Debajo, `<button onClick={navigate("/registro")}>` como link de texto `text-muted underline-offset-4 hover:underline`: "o prueba una conversación gratis".

**Criterio de aceptación:** captura con GPU real (no SwiftShader): el cerebro se ve violeta oscuro con borde luminoso, **no café**; surcos visibles; texto del hero legible en 390 px sin encimarse; `npm run build` limpio.

### Fase 2 — Motor de actos (1-2 días) → **checkpoint con Eric**

**Nuevo `src/components/landing/acts.ts`** (datos, no código; es la perilla de calibración):
```ts
export type Zone = "amygdala" | "pfc" | "broca" | "temporal" | "parietal"
export const ANCHORS: Record<Zone, [number, number, number]> = {
  amygdala: [0.15, -0.35, 0.25], pfc: [0, 0.35, 0.95], broca: [-0.75, 0.05, 0.55],
  temporal: [-0.85, -0.3, 0], parietal: [0, 0.75, -0.3],   // se calibran con ?debug=brain
}
export type ActState = {
  pos: [number, number, number]; rot: number; scale: number
  fresnel: number          // 0-1
  synapses: number         // 0-1 opacidad de los puntos
  zones: Partial<Record<Zone, { color: string; intensity: number }>>
  mobile?: Partial<Pick<ActState, "pos" | "scale">>
}
export const ACTS: Record<number, ActState> = {
  1: { pos: [0, 0.9, 0],    rot: 0,    scale: 1.3, fresnel: 1,   synapses: 1,   zones: {} },
  2: { pos: [2.2, 0.2, -2], rot: 0.6,  scale: 0.9, fresnel: 0.3, synapses: 0.1, zones: {} },
  3: { pos: [-1.9, 0, 0.5], rot: -0.5, scale: 1.1, fresnel: 0.5, synapses: 0.3, zones: { amygdala: { color: "#DC2626", intensity: 2.5 } } },
  4: { pos: [-1.9, 0, 0.5], rot: -0.3, scale: 1.1, fresnel: 0.6, synapses: 0.6, zones: { amygdala: { color: "#DC2626", intensity: 0.6 }, pfc: { color: "#06B6D4", intensity: 2.2 } } },
  5: { pos: [1.9, 0, 0.3],  rot: 0.4,  scale: 1.0, fresnel: 0.5, synapses: 0.5, zones: {/* se rellena desde report.json en fase 5 */} },
  6: { pos: [0, 0.3, -4],   rot: 0.8,  scale: 0.8, fresnel: 0.25, synapses: 0.2, zones: {} },
  7: { pos: [0, 0.3, -4],   rot: 1.0,  scale: 0.8, fresnel: 0.25, synapses: 0.2, zones: {} },
  8: { pos: [0, 0.6, 0],    rot: 1.4,  scale: 1.2, fresnel: 1,   synapses: 1,   zones: { amygdala: { color: "#A855F7", intensity: 1 }, pfc: { color: "#06B6D4", intensity: 1.5 }, broca: { color: "#A855F7", intensity: 1 } } },
}
```
Valores iniciales a ojo; se ajustan con el modo debug.

**Nuevo `src/components/landing/use-act.ts`**
- `export const actRef = { current: 1 }` (objeto mutable a nivel de módulo: `useFrame` lo lee cada frame sin re-render; no hace falta zustand).
- `export function useActObserver()`: un `IntersectionObserver` sobre `document.querySelectorAll("[data-act]")` con `rootMargin: "-45% 0px -45% 0px"` (banda central de la pantalla). Al intersectar, `actRef.current = Number(el.dataset.act)` y `document.documentElement.dataset.act = ...` (por si CSS lo necesita). Se llama una vez desde `Landing`.

**`brain-scene.tsx`**
- `Brain3D`: quitar `progress`/`useScroll`. En `useFrame((_, delta))`: `const t = ACTS[actRef.current]` (con `mobile` si `innerWidth < 1024`) y `damp` de cada eje: `g.position.x = THREE.MathUtils.damp(g.position.x, t.pos[0], 2.5, delta)` (igual `y`, `z`, `scale`, `rotation.y`), `fresnel.uIntensity`, `points.material.opacity`. Rotación idle: `+ delta * 0.12` cuando no hay reduced motion.
- `prefers-reduced-motion`: `damp` con lambda 20 (salto casi inmediato) y sin rotación idle.
- Modo debug: si `new URLSearchParams(location.search).get("debug") === "brain"`: `<OrbitControls>` (drei) + una `sphereGeometry r=0.06` en cada `ANCHORS` + `<axesHelper>` + `console.log` del acto activo. Sirve para leer coordenadas y copiarlas a `acts.ts`.

**`src/pages/Landing.tsx`**
- Llamar `useActObserver()`.
- Cada bloque es `<section data-act="n" id="...">`. Orden: Hero(1) · Problem(2) · Pressure(3) · Answer(4) · Report(5) · ForTeams(6) · Comparison(7) · CTA(8).
- Nuevo componente de layout `ActSection({ act, side: "left" | "right" | "center", children })` en `src/components/landing/act-section.tsx`: `min-h-[90vh] flex items-center`, columna de texto `max-w-xl` alineada al lado contrario del cerebro (`side="left"` → `lg:mr-auto`; `right` → `lg:ml-auto`), y detrás del texto un `bg-gradient-to-r from-ink via-ink/85 to-transparent` (o `-l` según lado) de `lg:w-[60%]`. En `< lg` el texto va debajo con `pt-[42vh]` (el cerebro ocupa la parte superior con la pose `mobile`).
- Nuevo `problem.tsx` (acto 2): 3 frases del brief §2, sin H2 grande: una sola frase en Syne `text-3xl` + dos en `text-lg text-muted`.
- **Borrar** `how-it-works.tsx` (su contenido lo *muestran* los actos 3-5). Borrar `ForTeams` bento → placeholder de texto hasta fase 6.
- `navbar.tsx`: `navLinks` → `#presion`, `#reporte`, `#equipos`, `#comparativa`. Los anchors siguen siendo scroll nativo (nunca `ScrollControls` de drei).

**Criterio de aceptación:** al bajar se nota el cambio de pose en **cada** acto; anchors del navbar funcionan; `?debug=brain` muestra las 5 esferas; capturas en `docs/checkpoint-landing-fase2/` (desk + mob) para Eric. **Parar aquí hasta tener su visto bueno.**

### Fase 3 — Zonas (1 día)

**`brain-scene.tsx`**
- Nuevo `Zone({ anchor, target })`: `<group position={ANCHORS[anchor]}>` con
  - `<sprite>` con `SpriteMaterial` (textura radial hecha una vez con `<canvas>` 128×128: gradiente blanco→transparente), `blending: AdditiveBlending`, `depthWrite: false`, `scale` 0.6-0.9; y
  - `<pointLight distance={1.4} decay={2}>` que ilumina la superficie cercana.
  - En `useFrame`: `damp` de `color` (`Color.lerp`) e `intensity` hacia `ACTS[act].zones[anchor] ?? { intensity: 0 }`. Sprite `opacity = intensity / 2.5`.
- Montar las 5 zonas siempre (barato) y dejar que la intensidad las apague.
- `NeuralParticles`: `count` 220 → 140 (70 en móvil), y `opacity` la maneja el `damp` del acto.
- La pulsación de la amígdala en el acto 3 se conecta en fase 4 (`amplitudeRef`). Mientras, un `sin` lento.

**Criterio:** amígdala roja en el acto 3 y prefrontal teal en el 4, reconocibles sin leer el texto; no hay halos "cuadrados" (la textura del sprite se degrada a 0 en el borde).

### Fase 4 — Demo de audio, actos 3-4 (1 día, paralelizable con 3)

**Fuente:** una **sesión completa** con Roberto hecha por alguien del equipo (Eric o Brandon) en `/chat-lab` con `force_master_prompt`, ≥ 5 intercambios, con consentimiento explícito de publicar su voz/texto **o** con la respuesta reescrita por Sophia. Esa misma sesión alimenta la fase 5. Se identifica por `session_id` en `chatlab_conversations`.

**Nuevo `menteviva-backend/scripts/gen_landing_audio.py`** (mismo patrón que `scripts/test_*.py`):
```
poetry run python -m scripts.gen_landing_audio --session <id> --list          # imprime turnos numerados
poetry run python -m scripts.gen_landing_audio --session <id> --turn 3 --out objecion.mp3
poetry run python -m scripts.gen_landing_audio --text-file respuesta.txt --voice <voice_id> --out respuesta.mp3
```
- Lee `conversation_json` vía el pool de `app.db`. Llama `text_to_speech(texto, "roberto")` para la objeción. Para la respuesta usa una voz distinta de ElevenLabs (constante `LANDING_USER_VOICE` en el script; elegir una masculina/femenina distinta de las 3 de `AVATAR_VOICES`).
- Escribe en `menteviva-frontend/public/audio/landing/{objecion,respuesta}.mp3`. Logs a `logs/gen_landing_audio.txt` (stdout se traga en Windows).
- Costo: 2 clips, una vez. Nada se genera en vivo.

**Nuevo `menteviva-frontend/public/audio/landing/cues.json`** (a mano, escuchando el mp3):
```json
{ "objecion": { "speaker": "Roberto Garza", "cues": [{ "t": 0.0, "text": "..." }, { "t": 3.4, "text": "..." }] },
  "respuesta": { "speaker": "Respuesta de ejemplo", "cues": [ ... ] } }
```

**Nuevo `src/components/landing/audio-act.tsx`** (`AudioAct({ clip: "objecion" | "respuesta" })`):
- `<audio src preload="metadata">` + botón "Escuchar a Roberto" / "Escuchar la respuesta" (`aria-pressed`). **Solo reproduce al clic.**
- Al primer clic: `new AudioContext()`, `createMediaElementSource(audio)` → `AnalyserNode({ fftSize: 256 })` → `destination`. Un `requestAnimationFrame` lee `getByteTimeDomainData`, calcula RMS y escribe `amplitudeRef.current` (módulo `use-act.ts`, mismo patrón que `actRef`). `brain-scene` lo usa en el acto 3: `intensity = base * (1 + amplitude * 2)`.
- Transcripción: la cue cuya `t <= audio.currentTime` es la activa (`ontimeupdate`); se muestra en `font-sans text-2xl text-cream` (no Syne: la auditoría 2.3 dice que Syne cansa en citas), la anterior en `text-muted`. Siempre visible aunque no se reproduzca (accesibilidad).
- Etiqueta fija bajo el acto 4: "Respuesta de ejemplo. La de tu equipo será la suya."

**Criterio:** se oye a Roberto al hacer clic; la amígdala late con la voz; la transcripción cambia de línea en el tiempo correcto; sin autoplay.

### Fase 5 — Reporte real, acto 5 (0.5-1 día)

**Nuevo `menteviva-backend/scripts/gen_landing_report.py`**
- `--session <id>`: carga la conversación, aborta si `len(conversation)//2 < 4` (si no, `analyze_conversation` devuelve `_demo_analysis` y el plan exige puntajes reales). Llama `await analyze_conversation("roberto", conversation, duration_seconds=minutos*60, sales_case=<el de la sesión>)`.
- Escribe `menteviva-frontend/public/landing/report.json` con **solo** lo que la página usa: `{ "overall_score", "skills": [{ "id", "name", "score", "moment" }] }` ordenado por `weight` desc, máximo 4. Guarda el JSON completo en `logs/landing_report_full.json` para auditoría.
- Cuota: Gemini free tier es 20 req/día por modelo; este script corre una vez.

**Nuevo `src/components/landing/report-act.tsx`**
- Importa `report.json` estático. Semáforo con la **misma regla que `Report.tsx`**: `> 75 success`, `50-75 warning`, `< 50 danger`.
- Filas: nombre de habilidad · puntaje grande en Syne · punto de color · `moment` como cita en `text-muted` con comillas. Sin tarjetas, sin íconos.
- Mapea `skills[i]` → zona `["pfc", "broca", "temporal", "parietal"][i]` y **escribe `ACTS[5].zones` al montar** (color = el del semáforo, intensidad 1.8). Así la zona y el punto comparten color sin líneas.

**Criterio:** los puntajes del acto 5 coinciden con `logs/landing_report_full.json`; no hay números escritos a mano en el componente.

### Fase 6 — Equipos, CTA y copy final (1 día)

- **`for-teams.tsx`** reescrito: una sola composición de texto (H2 "Lo que ve RH y un taller no le da" se conserva) + 4 líneas cortas: reporte agregado por equipo, quién practicó y cuándo, sin instalar nada (navegador + micrófono), RH ve el agregado, no la transcripción. Sin bento, sin íconos.
- **`brain-scene.tsx`**, acto 6: `TeamGlows`: 6 sprites (misma textura de `Zone`) en un anillo de radio 2.2 alrededor del cerebro, colores alternando `violet.light` / `teal` / `success`, opacidad `damp` a 1 solo en actos 6-7.
- **`cta.tsx`**: quitar la caja con borde-gradiente y halo. Solo: H2 "Ve el reporte antes de decidir.", botón `DEMO_HREF`, y la línea "Una práctica dura de 5 a 10 minutos · El reporte llega al terminar".
- **Copy por acto** (borrador para que Brandon corrija; no repetir una idea en dos actos):
  - Acto 2: "Los cursos se ven. Los talleres se olvidan. Y la conversación que de verdad importa, la que cuesta el cliente o el candidato, nadie la practica antes de tenerla."
  - Acto 3 (H2): "Así suena la presión." Sub: "Roberto Garza, director de operaciones. Sesión real del piloto."
  - Acto 4 (H2): "Así suena sostenerla."
  - Acto 5 (H2): "Y esto es lo que queda." Sub: "Reporte real de esa sesión. Puntaje por habilidad y la frase exacta que lo justifica."
  - Acto 8: "Ve el reporte antes de decidir."
- **Prueba social** (depende de la decisión §8.2): si se puede nombrar a Ingeniería Cóndor, una línea bajo el acto 5: "Piloto con Ingeniería Cóndor, 2026." Sin logo grande.

**Criterio:** cero `mailto` fuera de `links.ts`; cada acto tiene una idea; capturas completas.

### Fase 7 — Pulido (0.5-1 día)

- `Canvas dpr={[1, isMobile ? 1.25 : 1.5]}`; partículas a la mitad en móvil (ya en fase 3).
- Poses `mobile` en `acts.ts`: `y` +0.6 sobre la de escritorio y `scale` × 0.75, para que el cerebro ocupe el tercio superior.
- `prefers-reduced-motion` verificado en cada acto (cambio por fundido, sin pulso; el color de zonas sí cambia).
- Póster: comprobar que aparece sin WebGL (`chrome://flags` o `--disable-gpu`) y que no hay salto de layout al llegar el GLB (`img` y canvas comparten `fixed inset-0`).
- OG/meta: el mismo póster como `og:image` en `index.html` (hoy no hay ninguno).
- Lighthouse móvil (`npm run build && npm run preview` + DevTools): rendimiento ≥ 70. Si no llega, el GLB se decima a `--ratio 0.2`.

---

## 4. Calendario y checkpoints

| Fase | Entrega | Esfuerzo | Puede ir en paralelo con |
|---|---|---|---|
| 0 | GLB decimado, `links.ts`, script de capturas en repo | 0.5 d | — |
| 1 | Material + fresnel + hero centrado + póster | 1 d | 4-5 (backend) |
| 2 | `acts.ts`, `use-act.ts`, `ActSection`, debug, navbar | 1-2 d | 4-5 (backend) |
| **checkpoint** | Capturas desk + mob para Eric | — | — |
| 3 | Zonas con sprite + pointLight | 1 d | 4-5 |
| 4 | Script de audio, mp3, `cues.json`, `AudioAct` | 1 d | 3 |
| 5 | Script de reporte, `report.json`, `ReportAct` | 0.5-1 d | 3 |
| 6 | Equipos, CTA, copy final | 1 d | — |
| 7 | Móvil, reduced-motion, póster, Lighthouse | 0.5-1 d | — |

**Total:** 6.5-8.5 días de un agente; **4.5-6 en calendario** si los scripts de backend (fases 4-5) los hace otro agente en paralelo a las fases 1-3.

**División sugerida** (regla del equipo: Claude toma lo complejo):

| Agente | Toma | Contrato de entrega |
|---|---|---|
| Claude | Fases 0-3, 6, 7 (todo lo 3D y de layout) | Consume `public/audio/landing/*.mp3`, `cues.json`, `public/landing/report.json` |
| OpenCode / Gemini | Fases 4-5 backend: `gen_landing_audio.py`, `gen_landing_report.py`, elegir la sesión en Neon, escribir `cues.json` | Entrega exactamente esos 4 archivos con el esquema de §3.4 y §3.5, más `logs/landing_report_full.json` |

---

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| El 3D se arrastra en móviles de gama baja | GLB decimado desde fase 0; `dpr` 1.25; si Lighthouse < 70, móvil usa el póster fijo y las zonas se pintan como círculos SVG sobre él |
| Las anclas no caen donde deben en este modelo | `?debug=brain` con `OrbitControls`; importa que se lea, no la anatomía |
| Eric o Brandon quieren otra dirección al ver la fase 2 | Checkpoint obligatorio; fases 3-7 no empiezan sin visto bueno |
| El plan 19 argumentaba que B2B prefiere claridad | El HTML se entiende con el canvas apagado (`aria-hidden`, póster); el 3D ilustra, no sustituye |
| No hay sesión completa publicable | Eric/Brandon hacen una en `/chat-lab` en 10 min; la respuesta la reescribe Sophia si hace falta |
| Cuota ElevenLabs / Gemini | 2 clips + 1 análisis, una vez cada uno |
| Decimar rompe la textura de normales | Probar `--ratio 0.3` y `0.5`; conservar `brain-full.glb` fuera de `public/` |

---

## 6. Qué se elimina del código actual

`stats` y `<dl>` de `hero.tsx` · palabra en gradiente del H1 · `how-it-works.tsx` completo · bento e íconos de `for-teams.tsx` · caja con halo de `cta.tsx` · `BrainAura` · velo `from-ink via-ink/85` · `Float` de drei · `useScroll` en `brain-scene.tsx` · `conversations.tsx` (lo sustituye `audio-act.tsx`) · los 4 `mailto` sueltos.

---

## 7. Lo que yo agregaría (no estaba en la v1)

1. **Decimar el GLB en fase 0, no en fase 7.** Es un comando, baja 205k → ~60k vértices y 2.5 MB → < 1 MB. Hace viable móvil y el fresnel sale gratis. Es la perilla de rendimiento más barata de todo el plan.
2. **`acts.ts` como archivo de datos.** Poses, luces, zonas y variantes móviles en un solo objeto tipado. Calibrar es editar números, no código; Brandon o Eric pueden tocarlo.
3. **`actRef` mutable en vez de store.** `useFrame` lee un objeto de módulo; cero re-renders de React, cero zustand para esto.
4. **Una sesión real del equipo como fuente única.** Resuelve tres cosas a la vez: la objeción con voz real, la respuesta (real con consentimiento o reescrita), y el reporte con ≥ 4 intercambios para que `analyze_conversation` no caiga en modo demo. La v1 no había visto ese umbral.
5. **Póster = OG image.** La captura del hero sirve de fallback sin WebGL, de placeholder de carga **y** de imagen para compartir en LinkedIn/WhatsApp (hoy no hay `og:image`).
6. **`npm run shots` en el repo.** El script de Playwright deja de vivir en un scratchpad; cada fase deja capturas reproducibles en `docs/`.
7. **`VITE_DEMO_URL` en `.env`.** El link de calendario no bloquea ninguna fase: mientras no exista, cae al `mailto` y se cambia sin tocar código.
8. **Transcripción en Instrument Sans, no Syne.** La auditoría (2.3) ya lo decía y la v1 no lo bajó a tarea.

---

## 8. Decisiones pendientes (de Eric)

1. Link de **Cal.com / Calendly** → `VITE_DEMO_URL`. No bloquea nada.
2. ¿Se puede **nombrar el piloto con Ingeniería Cóndor** como prueba? (línea bajo el acto 5).
3. ¿Quién hace la **sesión completa** con Roberto para audio + reporte, y la respuesta se publica real o la reescribe Sophia? Bloquea fases 4-5 (no 0-3).
4. ¿Referencias 3D que te gusten (más clínico vs. más espectacular)? Sirve para calibrar el material en fase 1.
