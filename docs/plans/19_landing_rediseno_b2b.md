# 19 - Rediseño de la landing pública (auditoría + plan)

**Fecha:** 2026-08-19
**Modo:** Redesign - Preserve (conservar marca, IA y el cerebro 3D)
**Audiencia objetivo:** cliente B2B (RRHH / L&D que compra licencias para su equipo)
**Alcance auditado:** `src/pages/Landing.tsx` + los 8 componentes de `src/components/landing/` (898 líneas)

> Design read: *landing de SaaS B2B para compradores de L&D, con lenguaje dark-tech violeta/teal existente, evolucionando el sistema actual en vez de reemplazarlo.*

---

## 1. Estado actual

**Estructura (6 secciones):** Navbar → Hero → Cómo funciona (3 cards) → Características (6 cards) → Comparativa (tabla 8 filas) → CTA → Footer.

**Tokens de marca (se conservan):** `tailwind.config.js` define ink `#08071A`, deep `#110F2B`, violet `#7C3AED`, teal `#06B6D4`, cream `#F5F3FF`. Tipografía Syne (display) + Instrument Sans (cuerpo).

**Lectura de dials del sitio actual:** `DESIGN_VARIANCE 3` (todo centrado y simétrico), `MOTION_INTENSITY 5` (fades de framer-motion en todo), `VISUAL_DENSITY 4`.

**Dials objetivo:** `VARIANCE 6` / `MOTION 5` / `DENSITY 4`. Subir asimetría, mantener la motion actual, no tocar la densidad. B2B no quiere Awwwards, quiere claridad y confianza.

---

## 2. Hallazgos

### A. Bloqueantes de credibilidad B2B

**A1. Métricas inventadas en el hero.** `hero.tsx:81-83` anuncia `10K+ Prácticas` y `95% Satisfacción`, hardcodeado. Los números reales en Neon: **7 usuarios, 7 conversaciones de lab, 1 sesión de práctica**. Un comprador que pregunte "¿de dónde salen esos 10K?" deja la conversación ahí. Es el hallazgo más grave y el más barato de arreglar.

**A2. La landing no le habla a una empresa.** Todo el copy es segunda persona singular a un individuo ("tu ritmo", "tu diagnóstico", "practica"). No existe en toda la página: precio o licencias por equipo, panel de manager, reporte agregado del equipo, tratamiento de datos, casos por industria, logos de clientes, ni la palabra "equipo". El comprador objetivo no encuentra nada que le sirva para justificar la compra internamente.

**A3. No hay vía de conversión B2B.** El único CTA es `Empezar gratis → /registro` (self-service individual). Falta "Agendar demo" o "Hablar con ventas", que es **la** conversión de este segmento.

**A4. Footer con enlaces muertos.** `footer.tsx:22-30`: Privacidad, Términos y Contacto son `href="#"`. El producto **graba voz** de los usuarios. Una página de privacidad rota es un bloqueo directo en revisión de proveedor.

### B. Estructura y layout

**B1. Hero centrado sobre gradiente violeta = el default exacto de IA.** Badge con `Sparkles` + headline centrado con gradiente violet→teal + dos botones. Es el patrón que la guía de diseño marca como el tell #1.

**B2. El cerebro 3D está tapado por su propio headline.** El canvas es fondo de página completo (`Landing.tsx:22`), así que el activo diferenciador queda detrás del texto y apenas se percibe. Un hero partido (copy izquierda / cerebro derecha en columna propia) es lo que **justifica** conservarlo.

**B3. Repetición de familia de layout.** "Cómo funciona" (3 cards iguales) y "Características" (6 cards iguales) son la misma composición dos secciones seguidas. Con 6 secciones deberían existir al menos 3 familias distintas de layout; hoy hay 2 y media.

**B4. Eyebrows en 3 de 3 secciones.** `PROCESO`, `CARACTERÍSTICAS`, `COMPARATIVA` (más el badge del hero). El límite razonable es 2 para esta cantidad de secciones, y ninguna de las tres aporta información que el titular no dé ya.

**B5. El hero tiene 5 bloques de texto.** Badge + h1 + subtítulo + CTAs + stats. El máximo sano es 4. Los stats deben salir a una franja propia debajo.

**B6. La tabla comparativa es un spec-sheet de 8 filas.** `comparison.tsx` usa `divide-y` en 8 filas con 3 columnas de iconos. Además compara contra "Cursos Online" y "Coaches", que no son las alternativas que evalúa un comprador B2B (esas son: no hacer nada, un taller presencial, o una plataforma de e-learning corporativa).

**B7. Cero imágenes reales.** 8 componentes, ninguna fotografía ni captura de producto. El único activo visual es el cerebro. Una landing B2B sin una sola captura de la herramienta no muestra qué se compra.

### C. Técnico y accesibilidad

**C1. `min-h-screen` en hero y main.** `Landing.tsx:19` y `hero.tsx:7`. Provoca salto de layout en iOS Safari al esconderse la barra de direcciones. Debe ser `min-h-[100dvh]`.

**C2. Cero soporte de `prefers-reduced-motion`.** Hay ~20 animaciones de framer-motion, el cerebro rotando en bucle y las partículas orbitando, sin ninguna degradación. Es un fallo de accesibilidad y aparece en cualquier revisión de proveedor corporativo.

**C3. Contraste insuficiente en `text-subtle`.** `rgba(245,243,255,0.35)` sobre `#08071A` da aproximadamente 3.3:1, por debajo del mínimo AA de 4.5:1 para texto normal. Se usa en el footer completo, la leyenda de la comparativa y los labels de los stats.

**C4. Seis familias de color de acento en una sección.** `features.tsx` asigna gradientes violet→purple, purple→pink, pink→rose, teal→cyan, cyan→blue, blue→violet. La marca son dos colores (violeta y teal); esto los diluye.

**C5. Peso del activo 3D.** `brain.glb` 2.5 MB + three.js + drei son el grueso del LCP de la landing pública. Va lazy y en chunk aparte, pero sigue siendo el costo dominante en móvil.

### D. Copy

**D1. Dos etiquetas para la misma intención.** "Empezar gratis" (navbar y hero) y "Empezar mi diagnóstico gratis" (CTA final). Debe ser una sola etiqueta en toda la página.

**D2. Verbo de relleno.** "Empieza tu transformación hoy" (`cta.tsx`). Genérico e intercambiable con cualquier otra landing.

### E. Lo que funciona y se conserva

- Los tokens de color y la tipografía Syne + Instrument Sans. Son distintivos y están bien aplicados.
- El cerebro 3D, una vez que se le dé espacio propio.
- La navbar flotante con `backdrop-blur`: una línea, altura correcta, ancla a las secciones.
- El bloque de confianza del CTA final ("Sin tarjeta de crédito · Resultados en 5 minutos · 100% privado"): es concreto y verdadero.
- La estructura de anclas `#como-funciona` / `#caracteristicas` / `#comparativa`. **No se tocan** (SEO y memoria muscular).

---

## 3. Plan propuesto

Orden por relación impacto/riesgo. Cada bloque es independiente y se puede aprobar suelto.

| # | Cambio | Archivos | Tamaño |
|---|---|---|---|
| 1 | **Quitar las métricas falsas.** Sustituir el trío del hero por hechos verificables (metodología BEI + STAR, feedback en menos de 60 s, sin tarjeta) y sacarlo del hero a franja propia. | `hero.tsx` | chico |
| 2 | **Footer real.** Páginas de Privacidad y Términos con contenido, Contacto a correo real. Incluir mención explícita del tratamiento de audio. | `footer.tsx` + 2 rutas nuevas | medio |
| 3 | **Hero partido.** Copy a la izquierda, cerebro 3D en columna propia a la derecha, deja de ser fondo tapado. Máximo 4 bloques de texto. `min-h-[100dvh]`. | `hero.tsx`, `Landing.tsx`, `brain-scene.tsx` | medio |
| 4 | **CTA dual B2B.** "Agendar demo" primario, "Probar gratis" secundario. Una sola etiqueta por intención en toda la página. | `navbar.tsx`, `hero.tsx`, `cta.tsx` | chico |
| 5 | **Sección nueva "Para equipos".** Lo que compra L&D: reporte agregado, seguimiento por persona, escenarios por rol, despliegue sin instalación. Es la sección que hoy no existe. | archivo nuevo | medio |
| 6 | **Romper la repetición de layout.** "Cómo funciona" pasa a stepper vertical o zigzag; "Características" se queda en grid. Eliminar 2 de los 3 eyebrows. | `how-it-works.tsx`, `features.tsx`, `comparison.tsx` | medio |
| 7 | **Comparativa de 8 filas a 3 diferenciadores.** Los tres que importan en grande, el resto bajo un "Ver comparativa completa". Cambiar las columnas a las alternativas reales del comprador B2B. | `comparison.tsx` | medio |
| 8 | **Accesibilidad y consistencia.** `prefers-reduced-motion` en todas las animaciones y en el cerebro, subir `text-subtle` a AA, reducir los 6 gradientes de features a la pareja violeta/teal. | todos + `tailwind.config.js` | chico |
| 9 | **Capturas reales del producto.** Al menos una imagen de una sesión en curso y una del reporte. Requiere generar o capturar los activos. | pendiente de activos | bloqueado |

**Recomendación de corte:** 1, 2, 3, 4 y 8 son el mínimo defendible y arreglan lo que hoy es un riesgo comercial o legal. 5, 6 y 7 son el rediseño propiamente dicho. 9 necesita que alguien produzca las imágenes.

---

## 4. Fuera de alcance

- Cambiar las rutas, los slugs de ancla o las etiquetas de navegación (SEO y analítica).
- Reescribir la voz de marca en español.
- Sustituir `lucide-react`: la guía de diseño lo desaconseja, pero ya es dependencia del proyecto y cambiarla no aporta nada al comprador.
- Tocar el modelo `brain.glb`. La procedencia (repo sin licencia) sigue documentada en el changelog del 2026-08-18 y ya fue una decisión tomada.
