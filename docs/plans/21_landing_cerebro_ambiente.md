# 21 - Landing: el cerebro como ambiente (propuesta)

**Fecha:** 2026-09-23
**Estado (2026-09-23, tarde):** aprobado por Eric ("me late la dirección") y **portado a React el mismo día** (ver `docs/changelog/2026-09-23_landing_propuesta_cerebro_ambiente.md` §7). Capturas en `docs/checkpoint-landing-v4/`.
**Prototipo:** artifact borrado a pedido de Eric; copia en `docs/landing-assets/proto-cerebro-ambiente/`.
**Feedback que la motiva (Eric):** "se ve básico, se han hecho correcciones pero no me gusta; quiero que se use ese 3D".
**Relación con el plan 20:** el 20 hizo que el cerebro *reaccione* al scroll (poses por acto, zonas). Se queda. Lo que
falta no es más reacción, es *presencia*: el cerebro sigue siendo un objeto mediano flotando en negro plano.

---

## 1. Por qué se ve básico (diagnóstico sobre `docs/checkpoint-landing-v3/`)

| Síntoma | Causa en el código |
|---|---|
| El cerebro parece un icono grande, no un ambiente | Tamaño constante (~300 px en 1440) en todos los actos; la cámara nunca se mueve, solo el objeto (`ACTS[n].pos/scale`). |
| Se ve de plástico | Sin mapa de entorno: `MeshStandardMaterial` sin reflejos. Solo luz direccional + emisivo. |
| El fondo es negro plano | Nada del 3D toca la página: sin derrame de luz, sin grano, sin viñeta. Texto blanco sobre `#08071A` liso. |
| El brillo de las zonas no se siente | Sprites aditivos sin bloom: puntos de luz, no resplandor. |
| El texto vive *al lado* del cerebro | `ActSection` reserva medio ancho para el texto y medio para el cerebro, siempre. No hay un solo momento en que el texto esté *sobre* la corteza. |

## 2. Idea

**El cerebro deja de ser un objeto y pasa a ser el lugar donde ocurre la página.** Cinco movimientos, en orden de impacto:

1. **Escala y encuadre.** En el hero el cerebro mide 1.1 pantallas de alto, recortado arriba, y el titular va *encima* de su tercio inferior. En "la presión" y "sostenerla" la cámara hace un *dolly* hasta que la corteza llena la pantalla y la amígdala / la corteza prefrontal laten debajo del texto.
2. **La cámara se mueve, no el objeto.** El cerebro queda en el origen y cada acto define `cam` + `look`. Eso da primeros planos reales (perspectiva, paralaje) que mover un objeto no da.
3. **Luz que cae sobre la página.** Un degradado radial (CSS, `mix-blend-mode: screen`) cuyo centro se calcula por frame proyectando el cerebro o la zona activa al viewport. Rojo en la presión, teal en la respuesta, violeta en hero/CTA.
4. **Material con entorno + bloom.** `MeshPhysicalMaterial` con `RoomEnvironment` (procedural, sin descargas), clearcoat bajo e iridiscencia leve. `UnrealBloomPass` con umbral alto: solo brillan fresnel y zonas.
5. **Atmósfera.** Grano (SVG `feTurbulence`, opacidad 0.07) y viñeta fijas. Cuestan cero.

Y dos cosas del plan 20 que se conservan tal cual: la interpolación continua por scroll (ahora entre `cam/look`, no `pos/scale`) y las zonas por acto con latido por línea de guion.

## 3. Guion por acto (lo que hace el prototipo)

| # | Acto | Cámara / cerebro | Página |
|---|---|---|---|
| 1 | Hero | Cerebro a 1.1 pantallas, recortado arriba; titular sobre el tercio inferior. Bloom 0.75. | H1 + lead + CTA, centrado abajo. |
| 2 | Problema | Se aleja a la derecha, sinapsis casi apagadas. | Frase grande + 2 columnas. Velo del lado del texto. |
| 3 | La presión | *Dolly* a 2.5 unidades: la corteza llena la pantalla; amígdala roja late y da un golpe extra con cada línea de Roberto. Derrame rojo. | Guion (ROBERTO en rojo). Líneas una a una. |
| 4 | Sostenerla | El cerebro gira 80° para dar la cara; se enciende la corteza prefrontal en teal, el rojo baja. Derrame teal. | Guion (TÚ en teal). |
| 5 | Reporte | Se aleja a la derecha; 4 zonas encendidas en violeta/teal. | Hoja de resultados; el punto de cada habilidad se enciende con retraso escalonado. **Puntajes siguen en "—"** y los colores son de marca, no de semáforo, hasta tener la sesión con consentimiento. |
| 6-7 | Equipos / Comparativa | Al fondo, pequeño, casi apagado. | Texto a todo el ancho. |
| 8 | CTA | Vuelve al encuadre del hero, 4 zonas encendidas. | Titular sobre el cerebro. |

## 4. Cómo se porta a React (sin dependencias nuevas salvo una)

| Qué | Dónde | Cambio |
|---|---|---|
| Cámara por acto | `acts.ts` | `ActState` pasa de `pos/rot/scale` a `cam/look/rot/bloom/bleed`. Cerebro fijo en el origen. Los valores del prototipo (`ACTS` en `index.html`) se copian tal cual: mismo diámetro 2.4 y mismos `ANCHORS`. |
| Interpolación continua | `use-act.ts` + `brain-scene.tsx` | Sustituir el `IntersectionObserver` que marca "acto activo" por `scrollY` → par de actos + `t` suavizado (función `sample()` del prototipo). El IO se queda solo para el revelado de líneas y el `kick`. |
| Material | `brain-scene.tsx::Brain` | `MeshPhysicalMaterial` (valores en el prototipo) + `<Environment>` de drei con `preset` **no** (descarga de polyhaven): usar `RoomEnvironment` vía `useThree` + `PMREMGenerator`, o `<Environment><Lightformer/></Environment>`. |
| Bloom | `brain-scene.tsx::BrainScene` | **Única dependencia nueva:** `@react-three/postprocessing` (`<EffectComposer><Bloom luminanceThreshold={0.62} intensity={...} /></EffectComposer>`). Alternativa sin dep: `UnrealBloomPass` de three con `useFrame(..., 1)` y `gl.autoClear=false`, ~25 líneas. |
| Derrame de luz | `brain-scene.tsx` + `index.css` | En `useFrame`, proyectar el punto (`Vector3.project(camera)`) y escribir `--bx/--by/--bc` en `document.documentElement.style`. Div fijo `.bleed` en `Landing.tsx`. |
| Grano + viñeta | `index.css` + `Landing.tsx` | Dos divs fijos. Grano oculto con `prefers-reduced-motion`. |
| Velos | `act-section.tsx` | El velo actual (`VEIL`) se vuelve más opaco (0.92 → 0.6 → 0) y ocupa 62 % del ancho del lado del texto; en móvil sube desde abajo. |
| Latido por línea | `Landing.tsx::Transcript` + `brain-scene.tsx` | `data-kick="amygdala|pfc"` en la sección; el IO programa `kicks[zona]=1.6` con retraso `550ms × i`. En la fase 4 (audio) el `kick` lo dispara la amplitud. |
| Póster | `BrainPoster` | Reencuadrar `brain-poster.webp` con el nuevo acto 1 (cámara a 3.1, look y −0.45). |
| Móvil | `acts.ts` | Regla única en vez de `mobile` por acto: `look.y −= 0.85` y distancia ×1.75 cuando `aspect < 1`. |

Costo estimado: 1.5 días. Fase 4/5 del plan 20 (audio y puntajes reales) siguen bloqueadas por la sesión con consentimiento y no cambian con esta propuesta.

## 5. Lo que hay que decidir (Eric)

1. **Intensidad.** El prototipo está calibrado "alto". Si el derrame o el bloom cansan, se bajan en `ACTS[n].bloom` y el alpha de `bleed`; la estructura no cambia.
2. **Bloom: dep o 25 líneas.** Recomiendo la dep (`@react-three/postprocessing`): es la manera estándar con R3F y evita mantener el composer a mano.
3. **Texto sobre corteza (actos 3-4).** Es el riesgo estético de la propuesta. Si no convence, el velo se sube a 0.97 y el cerebro se ve solo por el borde izquierdo; el *dolly* se conserva.
4. **Móvil.** El prototipo lo resuelve con la regla única; falta verlo en un teléfono real (las capturas son de Playwright a 390×844).

## 6. Lo que NO cambia

Paleta, Syne + Instrument Sans, titular, los 3 diferenciadores, "RH ve / RH no ve", un solo CTA crema, sin marcas de plantilla (`HALLAZGOS.md` §2.1), puntajes en "—" hasta la sesión con consentimiento, `DEMO_HREF`.

## 7. Copy: qué debe comunicar cada acto (aplicado 2026-09-23, borrador para Brandon)

Feedback de Eric: "no me termina de convencer el texto; no entiendo qué quieres comunicar". Regla: cada H2 se lee solo,
sin la escena 3D, y responde qué es / qué hace / para quién. El drama lo pone el cerebro.

| Acto | Antes | Comunica | Ahora |
|---|---|---|---|
| 1 Hero | La conversación que estás evitando. | Qué es y para quién | **Tu equipo practica la venta difícil antes de tener al cliente enfrente.** Lead: Mente Viva es un simulador de conversaciones. Cada persona habla en voz alta con un avatar que objeta como un cliente real. Al terminar recibe un reporte con puntaje por habilidad, y tú ves quién mejora. |
| 2 Problema | Nadie practica la conversación difícil antes de tenerla. | Por qué lo de hoy no sirve | **Los talleres enseñan qué decir. Nadie practica decirlo.** Un curso se ve. Un roleplay con un colega no mide. / Cuando llega el cliente real, es la primera vez. |
| 3 Presión | Así suena la presión. | Quién es Roberto (avatar) y qué vivirá el equipo | **Esto es lo que va a enfrentar tu equipo.** Roberto es un avatar: director de operaciones de una planta. Sus objeciones salen de sesiones reales del piloto. |
| 4 Respuesta | Así suena sostenerla. | Qué se evalúa | **Y esto es lo que Mente Viva evalúa: cómo responde bajo presión.** |
| 5 Reporte | Y esto es lo que queda. | Qué recibe cada persona | **Cada sesión termina en un reporte con puntaje por habilidad.** No es una opinión: cada puntaje cita la frase exacta que lo justifica. |
| 6 Equipos | Lo que ve RH y un taller no le da | Qué ve el comprador y el límite | **Tú ves el avance del equipo. No sus conversaciones.** |
| 7 Comparativa | Por qué no un taller o un curso en línea | Por qué funciona | **Qué hace que esto funcione y un taller no.** (los 3 diferenciadores sin cambio) |
| 8 CTA | Ve el reporte antes de decidir. | Qué hacer ahora | **Agenda una demo y prueba una sesión con Roberto.** Dura de 5 a 10 minutos · El reporte llega al terminar. |

Dos decisiones implícitas: Roberto se presenta como avatar (antes "Roberto Garza… sesión real del piloto" sonaba a persona)
y la audiencia queda una sola: el comprador lee, el equipo es lo que se muestra. Los turnos de Roberto y la respuesta de
ejemplo no cambian (siguen esperando a Sophia).
