# Auditoría de la landing — 2026-09-22

**Alcance:** `menteviva-frontend/src/pages/Landing.tsx` + `src/components/landing/*` (incluye la pasada de copy del mismo día, `docs/changelog/2026-09-22_landing_copy.md`).
**Método:** lectura del código + capturas en local (Vite :5173) a 1440×900 y 390×844, con Playwright headless. Las capturas están en esta misma carpeta.
**Feedback de partida (Eric):** "el fondo me encanta pero el texto no mucho"; tras la pasada de copy: "lo veo igual", "se ve genérico, hecho por IA en plantilla", "se desaprovecha el cerebro de fondo", "la parte de *Esto es lo que vas a oír* está horrible".

> Ojo con las capturas: se tomaron con render por software (SwiftShader), así que el cerebro puede verse algo más oscuro que en una GPU real. El tono carne sí viene del modelo (`public/models/brain.glb`, 2.5 MB).

**Conclusión en una línea:** la página *describe* el producto pero nunca lo *muestra*, y el cerebro 3D, que es lo único distintivo, está usado como papel tapiz.

La pasada de copy del 22-sep arregló contradicciones puntuales, pero no toca el problema de fondo, que es de concepto y no de redacción.

---

## 1. Auditoría de marketing

### 1.1 Problema central: se cuenta, no se muestra
| Qué es el producto | Qué ve el visitante |
|---|---|
| Práctica **por voz** | Ni un segundo de audio |
| Avatares que sostienen el papel | Ningún avatar |
| Reporte con puntaje y semáforo | El semáforo solo descrito en texto (`Verde 75+ · Ámbar…`) |
| Evidencia por persona | Ninguna evidencia en la propia página |

### 1.2 "Esto es lo que vas a oír" (`conversations.tsx`)
1. **Rompe su propia promesa.** Dice *oír* y entrega texto plano.
2. **Empieza por la línea más débil de la sesión.** *"Buenos días. Roberto Garza. ¿De qué empresa es y cuál es el motivo de su visita?"* suena a recepcionista, no transmite presión.
3. **Muestra medio diálogo.** Solo habla el avatar. Sin la respuesta de la persona ni la evaluación del sistema, no hay tensión ni se ve el valor. El "tú contestas, en voz alta" no sustituye eso.
4. **El subtítulo es defensivo y habla hacia dentro.** *"Fragmentos textuales… Ninguna está escrita para esta página"* responde a una objeción que el visitante no tiene; lo que quiere saber es qué gana.
5. **El formato le quita vida.** Citas en Syne de 28 px separadas por líneas horizontales se leen como un documento, no como una conversación (ver `desk_01.png`, `mob_01.png`).

### 1.3 No hay prueba
- No hay logos, testimonios, resultados del piloto ni caras.
- El piloto con Ingeniería Cóndor (Roberto es literalmente su cliente tipo) es prueba real y no aparece.
- Las cifras del hero antes eran inventadas (10K+ / 95%); ahora son datos del producto (5–10 min, BEI + STAR), que son ciertos pero no prueban nada.

### 1.4 No hay historia
Las secciones son bloques independientes (qué es → cómo funciona → para equipos → comparativa → CTA). Falta el arco de persuasión:
**problema** (los talleres no cambian conductas) → **míralo funcionar** → **evidencia** → **cómo se compra**.
El problema, que ya está bien redactado en `docs/landing-brief.md §2`, no aparece en la página.

### 1.5 Audiencia partida
- El titular ("La conversación que estás evitando") le habla emocionalmente a la **persona que practica**.
- El CTA ("Agendar demo"), "Lo que ve RH" y "aprobar el presupuesto" le hablan al **comprador B2B**.
- Nadie une las dos voces. Propuesta: el comprador es el lector y el practicante es la prueba ("esto es lo que va a vivir tu equipo").

### 1.6 Fricción en la conversión
- **"Agendar demo" es un `mailto:`** en 4 lugares (navbar, hero, para equipos, CTA). Abre el cliente de correo, la ruta con más fricción. Debe ir a un calendario (Cal.com o Calendly).
- **"Probar gratis" lleva a `/registro`.** Está bien como CTA secundario, pero el hero lo pone al mismo nivel que la demo.

---

## 2. Auditoría de frontend / diseño

### 2.1 Por qué se ve de plantilla
Tiene, una por una, las marcas del kit típico de landing generada con IA (v0 / shadcn):

| Marca de plantilla | Dónde |
|---|---|
| Navbar en píldora de vidrio fija arriba | `navbar.tsx` |
| Una palabra del H1 con gradiente violeta→teal | `hero.tsx` ("evitando") |
| Fila de 3 cifras bajo los botones | `hero.tsx` |
| Bento con íconos lucide en cuadritos de color | `for-teams.tsx` |
| Stepper con íconos en cuadritos | `how-it-works.tsx` |
| Caja de CTA con borde en gradiente y halo difuso | `cta.tsx` |
| Botón morado con `ArrowRight` que se desplaza al hover | todos |
| `motion` fade-up de 24–30 px en cada bloque | todos |

**Monotonía de layout:** todas las secciones repiten *H2 a la izquierda → párrafo gris → lista/tarjetas*, con la mitad derecha vacía salvo por el cerebro. No hay un solo momento de composición distinto.

**Huecos:** hay espacios de ~300 px entre secciones (`desk_02.png`, `desk_03.png`, parte superior) que parecen un error de carga más que aire intencional.

### 2.2 El cerebro está desaprovechado (`brain-scene.tsx`)
| Hallazgo | Detalle técnico |
|---|---|
| **Es papel tapiz** | `fixed inset-0` detrás de todo; se queda a la derecha toda la página. |
| **El scroll casi no se nota** | `position.x = 1.7 + t*0.9`, `z = -t*2.2`, `rotation.y = t*1.4π` a lo largo de **toda** la página (~5700 px). Por pantalla el cambio es imperceptible. |
| **No reacciona al contenido** | Ninguna sección le afecta; da igual lo que se esté leyendo. |
| **Se ve café, "de carne", no vivo** | La textura del GLB es anatómica. La iluminación es `ambientLight 0.35` + point lights de color que apenas lo tiñen, y encima lleva un velo `from-ink via-ink/85` (`lg:via-ink/70`). |
| **El aura se ve como un círculo tenue** | La esfera `BackSide` de opacidad 0.06 deja un borde duro visible (`desk_02.png`, a la derecha). |
| **En móvil se encima al texto** | El cerebro invade el hero y las citas (`mob_00.png`, `mob_01.png`); no hay regla de layout para móvil. |
| **Partículas genéricas** | 220 puntos al azar en una esfera. No representan sinapsis ni conectan nada. |

### 2.3 Tipografía y legibilidad
- Syne (display ancho) está bien en H1/H2, pero **en citas largas pesa demasiado** y cansa.
- Los párrafos largos en `text-muted` sobre `ink` quedan con contraste bajo; se nota más donde el velo es más ligero.
- "Al terminar" como cifra del hero no es una cifra: rompe la lógica de la fila.

### 2.4 Lo que sí funciona (conservar)
- La paleta (`ink/deep`, violeta/teal) y la idea del fondo oscuro con el cerebro. Eric lo validó explícitamente.
- El titular "La conversación que estás evitando.".
- Los 3 diferenciadores de la comparativa ("Se practica, no se ve", "Deja evidencia, no asistencia", "Escala sin agenda"). Es el mejor copy de la página.
- Carga diferida del 3D (`lazy` + `Suspense`), `useReducedMotion` respetado en todas partes.

---

## 3. Diagnóstico

1. El problema **no es de redacción**: es que la página no tiene un concepto que la haga propia. Sin el cerebro, sería intercambiable con cualquier SaaS.
2. El único activo distintivo (el cerebro 3D) no cuenta nada.
3. El activo más convincente del producto (la voz de un avatar difícil + un reporte con evidencia) no está en la página.

La propuesta que resuelve los tres a la vez, **el cerebro como narrador del scroll**, está en `docs/plans/20_landing_cerebro_narrador.md`.

## Capturas
| Archivo | Qué muestra |
|---|---|
| `desk_00.png` | Hero en escritorio: cerebro café a la derecha, fila de cifras |
| `desk_01.png` | "Esto es lo que vas a oír": citas como documento |
| `desk_02.png` | Hueco vacío + "Tres pasos"; borde del aura visible |
| `desk_03.png` | Bento de "Lo que ve RH" |
| `desk_05.png` | Caja de CTA con halo |
| `mob_00.png`, `mob_01.png` | Móvil: el cerebro se encima al texto |
