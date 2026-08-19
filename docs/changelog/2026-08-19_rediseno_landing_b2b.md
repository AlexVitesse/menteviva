# 2026-08-19 — Rediseño de la landing pública (enfoque B2B)

Ejecución del plan [`19_landing_rediseno_b2b`](../plans/19_landing_rediseno_b2b.md).
Modo **preserve**: se conservan los tokens de marca, la tipografía, el cerebro
3D y las anclas de navegación existentes.

**Decisión del usuario:** el bloque 1 del plan (retirar las métricas `10K+` y
`95%` del hero) **no se aplica**. Se quedan porque el sitio se usa para demo.
El riesgo queda documentado en el plan.

## Qué cambió

### Nuevo

- **`pages/Legal.tsx`** — Aviso de privacidad y Términos de uso reales, con
  rutas `/privacidad` y `/terminos`. El aviso detalla qué pasa con el audio
  (se transcribe, no se conserva el archivo), qué proveedores intervienen y
  cómo se ejerce cancelación. Antes los tres enlaces del footer eran `href="#"`,
  lo que bloquea cualquier revisión de proveedor en un producto que graba voz.
  La dirección de contacto vive en una sola constante `CONTACTO` al inicio del
  archivo; **hay que confirmarla antes del piloto abierto**.
- **`components/landing/for-teams.tsx`** — Sección "Para equipos, no solo para
  personas" (ancla `#para-equipos`). Bento de 4 celdas: reporte agregado
  destacado + escenarios por rol, sin instalación y privacidad por diseño. Es
  el contenido que un comprador de L&D no encontraba en ninguna parte.

### Rehecho

- **`hero.tsx`** — De hero centrado con el cerebro de fondo tapado por el
  titular, a **hero partido**: mensaje a la izquierda, cerebro 3D en columna
  propia a la derecha. `min-h-[100dvh]` en vez de `min-h-screen`. Titular
  ajustado a 3 líneas (`lg:text-[2.6rem]`); con la escala anterior caía a 4.
- **`brain-scene.tsx`** — Deja de ser `fixed inset-0` de página completa y pasa
  a llenar el contenedor que lo aloja (`className` con `absolute inset-0` por
  defecto). Canvas transparente: el fondo lo pone la sección. Rotación,
  partículas, aura y `Float` respetan `prefers-reduced-motion`.
- **`how-it-works.tsx`** — De tres tarjetas iguales a **stepper vertical** con
  riel. Iba seguido de otra sección de tarjetas iguales: dos veces la misma
  familia de layout.
- **`comparison.tsx`** — De tabla de 8 filas siempre visible a **tres
  diferenciadores** en tipografía grande y el detalle replegado en un
  `<details>`. Las columnas cambian de "Cursos Online / Coaches" a **"Taller
  presencial / E-learning"**, que son las alternativas que evalúa una empresa.
  La tabla pasa a `<table>` semántica con `sr-only` por celda (antes eran
  `<div>` con iconos, ilegibles con lector de pantalla).
- **`cta.tsx`** — "Empieza tu transformación hoy" (verbo de relleno) pasa a
  "Ve el reporte antes de decidir", con la promesa concreta de la demo.
- **`footer.tsx`** — Enlaces reales, nota sobre transcripciones, y el texto sube
  de `text-subtle` a `text-muted`.
- **`navbar.tsx`** — Enlace a `#para-equipos`, CTA principal **"Agendar demo"**.
  Los links pasan de `md:` a `lg:` para que las cuatro entradas quepan en una
  sola línea.

### Transversal

- **CTA dual en toda la página:** "Agendar demo" (primario, B2B) y "Probar
  gratis" (secundario, self-service). Antes había dos etiquetas para la misma
  intención ("Empezar gratis" y "Empezar mi diagnóstico gratis").
- **`prefers-reduced-motion`** respetado en las seis secciones y en la escena
  3D. Antes no había ninguna degradación con ~20 animaciones activas.
- **Un solo par de acento.** `features.tsx` usaba seis familias de gradiente
  (violet→purple, purple→pink, pink→rose, teal→cyan, cyan→blue, blue→violet);
  ahora todas son violeta→teal.
- **Contraste.** Se retira `text-subtle` (rgba .35 sobre `#08071A`, ~3.3:1, por
  debajo de AA) de la landing en favor de `text-muted`.
- Se eliminan 2 de los 3 eyebrows (`PROCESO`, `CARACTERÍSTICAS`).
- Contenedores unificados a `max-w-6xl`: `how-it-works` y `comparison` iban a
  `max-w-4xl` y dejaban el borde izquierdo dentado contra el resto.

## Verificación

- `npm run build` (tsc + vite) en verde.
- Revisión en Chrome sobre `vite dev`: el hero cabe en el viewport
  (`heroCabe: true`), titular en 3 líneas, el footer termina exactamente en
  `scrollHeight` (sin hueco muerto), las seis secciones renderizan y el cerebro
  se ve completo en su columna.

## Pendiente

- **Bloque 9 del plan (capturas del producto): sin hacer.** La skill
  `gpt-image-2` necesita el CLI de RunComfy y no está instalado en esta máquina.
  Independientemente de eso, lo que falta aquí es una **captura real** de una
  sesión y del reporte: una imagen generada de un panel inventado sería un
  producto falso, peor que no tener imagen.
- Confirmar `CONTACTO` en `pages/Legal.tsx`.
- Los textos legales son un punto de partida operativo, no una revisión
  jurídica.
