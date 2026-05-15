# Mente Viva — Brief para Landing Page

Documento completo para construir una landing page. Pega esto en v0 / Framer /
diseñador / copywriter. Basado en el producto real a 23-abril-2026.

---

## 1. El producto en una frase

**Mente Viva es una plataforma de entrenamiento de habilidades blandas con IA
conversacional.** Los usuarios practican conversaciones reales (ventas,
negociación, entrevistas, liderazgo) con avatares que hablan, escuchan y
reaccionan como personas. Al final reciben un diagnóstico con fortalezas,
brechas y un plan de práctica personalizado.

No es un curso. No es videos pasivos. Es práctica activa con presión real.

---

## 2. El problema que resuelve

Las habilidades blandas se aprenden practicando, no viendo. Pero hoy:

- **Los cursos de soft skills** (Udemy, LinkedIn Learning, Crehana) son
  pasivos: videos, quizzes, PDFs. No te ponen a la prueba.
- **Un coach humano profesional** cobra ~$100-300 USD/hora. No escalable.
- **El roleplay con colegas** es incómodo, no da feedback objetivo, nadie
  tiene tiempo.
- **Los mock interviews o simuladores genéricos** no se adaptan a ti — todos
  reciben el mismo script.

Resultado: los profesionales sienten que no mejoran, los managers no pueden
capacitar a su equipo escalablemente, el talento se estanca.

---

## 3. La solución

1. **Diagnóstico inicial** (15-25 min) con Sofia, una entrevistadora IA con
   metodología BEI + STAR (estándar HR). Detecta fortalezas, áreas ciegas y
   brechas específicas a ti.
2. **Práctica con escenarios personalizados**. Roberto (venta consultiva
   B2B), María (negociación de contrato), Carlos (entrevistas) conversan
   contigo sabiendo tus brechas — te presionan donde más necesitas.
3. **Feedback post-sesión** con evidencia textual citada de lo que dijiste.
   No opiniones: "usaste 'nosotros' cuando deberías haber dicho 'yo'".
4. **Roadmap adaptativo** que evoluciona con cada práctica.

---

## 4. Audiencia

### B2C — Profesionales individuales

- Gerentes/directores que negocian presupuestos, manejan conflictos, lideran
  sin autoridad formal.
- Candidatos preparando entrevistas importantes (promoción, cambio de empresa).
- Vendedores B2B (SDR, AE, KAM) mejorando técnica consultiva.
- Freelancers y consultores que pitchean propuestas regularmente.
- Recién ascendidos a roles de gente.

### B2B — Empresas

- **HR de mid-market** (50-500 empleados): no tienen presupuesto para coach
  1:1 para todos, pero necesitan capacitar managers nuevos.
- **Training managers** en empresas de ventas / consultoría.
- **Startups en crecimiento** donde ascienden ingenieros a mánager y no
  saben dar feedback.
- **Equipos remotos** donde la capacitación presencial no funciona.

---

## 5. Propuesta de valor

**"Practica las conversaciones difíciles, antes de tenerlas."**

| Para el usuario | Para el manager / HR |
|---|---|
| Practicas sin riesgo real | Capacitas a tu equipo 10× más barato que 1:1 |
| Feedback específico basado en tu transcript | KPIs conductuales medibles |
| Roadmap que se ajusta a tu caso | Reportes agregados por equipo (futuro) |
| 24/7, sin agendar | Escalable a cualquier tamaño |
| Privacidad: tus sesiones no se comparten | Define competencias foco por rol |

---

## 6. Diferenciadores

### vs. cursos Udemy / LinkedIn / Crehana
- **Interactivo** vs pasivo
- **Te pone a la prueba** — no solo te explica
- **Feedback basado en TU transcript**, no contenido pre-grabado

### vs. coaches humanos
- **10× más barato** (~$300 MXN/mes vs ~$2,500 MXN/hora)
- **24/7 disponible** sin agendar
- **Escalable** a equipos enteros

### vs. otros simuladores con IA
- **Metodología BEI + STAR** (McClelland + Creswell, estándar HR)
- **Voz natural real** (ElevenLabs, no TTS robotizado)
- **Diagnóstico personalizado** que alimenta cada práctica (no scripts genéricos)
- **Evidencia textual citada** en cada feedback (no adjetivos vagos)

---

## 7. Cómo funciona (3 pasos para el landing)

### Paso 1 — Diagnóstico
Sofia te entrevista por ~15-25 minutos con metodología BEI + STAR. Le cuentas
momentos reales de tu trabajo. Ella explora con follow-ups y detecta patrones
en lo que dices.

### Paso 2 — Tu mapa
Recibes un diagnóstico con:
- 2-3 fortalezas con evidencia textual de tus palabras
- 2-3 áreas de foco con micro-prácticas concretas para esta semana
- Un "punto ciego": algo que no viste de ti mismo
- Una pregunta para llevarte a casa
- Recomendación del primer escenario que te toca practicar

### Paso 3 — Práctica
Eliges un escenario. El avatar ya sabe tus brechas del diagnóstico. Te presiona
donde más necesitas — no donde ya eres bueno. Cada sesión actualiza tu perfil.

---

## 8. Features ya construidas (al 23 abril 2026)

### Diagnóstico (✅ funcional)
- Sofia, avatar entrevistadora con voz natural (ElevenLabs)
- 5 fases BEI: rapport → encuadre → desarrollo → profundización → cierre
- Voice Activity Detection — no necesitas tocar botones, solo hablas
- Sofia inicia la conversación automáticamente
- Progress bar de tiempo
- Auto-cierre cuando Sofia siente que ya cubrió suficiente
- Evalúa contra catálogo de 10 competencias soft skills

### Práctica (✅ parcial)
- Roberto (Director de TI, venta consultiva B2B)
- María (Gerente de Compras, negociación de contrato)
- Carlos (entrevistas laborales — en desarrollo)
- Reciben contexto del diagnóstico y aprietan brechas específicas
- Feedback post-sesión con scores

### Perfil (✅ funcional)
- Diagnóstico completo paginado (resultados → recomendación)
- Descargar como Markdown
- Compartir en redes (Web Share API nativo en móvil, clipboard en desktop)
- Rehacer el diagnóstico

### Persistencia (✅ nuevo)
- SQLite server-side: guarda usuarios y diagnósticos
- Historial de sesiones (para evaluar evolución)

### Aspiracional (🔵 roadmap)
- 40+ escenarios en 8 categorías (hoy: 2 funcionales)
- Niveles de dificultad fácil/intermedio/difícil
- Loop adaptativo completo: cada práctica recalcula tu roadmap
- Gamificación ligera: niveles por habilidad (barra 0-100)
- Vista B2B para managers
- Multi-tenant con auth real

---

## 9. Tono y voz

**Profesional, directo, honesto.**

- NO corporate frío ("empoderando al talento disruptivo")
- NO cursi self-help ("descubre la mejor versión de ti")
- NO gamer hype ("¡Sube de nivel!")

**Sí**:
- "Practica. Recibe feedback. Mejora. Repite."
- "No te vamos a decir qué estás haciendo mal. Te vamos a mostrar la
  frase exacta donde pasó."
- "Tu coach de soft skills, siempre disponible."

Lenguaje de **coach de HR**, no de marketer.
**Español neutro / mexicano**. Audiencia principal: México + LatAm.

---

## 10. Identidad visual (ya definida en el producto)

### Paleta

| Rol | Hex | Uso |
|---|---|---|
| Fondo principal | `#08071A` (ink) | Base dark |
| Panel / sidebar | `#110F2B` (deep) | Cards, secundarios |
| Card content | `#201D3E` | Cards destacados |
| Acento primario | `#7C3AED` (violet) | CTAs, links, highlights |
| Acento secundario | `#06B6D4` (teal) | Datos, KPIs positivos |
| Éxito | `#16A34A` | Fortalezas, scores altos |
| Atención | `#F97316` | Áreas de mejora |
| Negativo | `#DC2626` | Alertas críticas |
| Texto principal | `#F5F3FF` (cream) | Body text |
| Texto secundario | `rgba(245,243,255,0.6)` | Subtítulos, metadatos |

### Tipografía
- **Títulos, logos, CTAs**: **Syne** (geometric moderno, Google Fonts)
- **Cuerpo**: **Instrument Sans** (Google Fonts)

### Estilo visual que ya existe
- **Dark mode nativo** (no es opción, es el default)
- **Glassmorphism** en cards (backdrop-blur, borde gradiente, glow sutil)
- **Escena 3D de fondo** (esferas, cubos, toros flotantes con react-three-fiber
  en la pantalla de login actual — opcional replicar en hero del landing)
- **Gradientes violet → fuchsia → teal** para textos destacados
- **Animaciones suaves** con framer-motion (fade-up, scale, stagger)
- Sin bordes duros agresivos. Radios generosos (2xl+).
- Shadows suaves con color (`shadow-violet/30`)

---

## 11. Proof points / credibilidad

Todo es alpha, así que:

- **Metodología validada**: Behavioral Event Interview (McClelland) + STAR +
  Creswell. Estándar en entrevistas conductuales de HR internacional.
- **Stack técnico de punta**:
  - ElevenLabs para voz (la misma que usan audiolibros y grandes plataformas)
  - Groq + Llama 3.3 70B para análisis
  - Whisper large-v3 para transcripción
  - Silero VAD para detección de voz sin botones
- **Construido por equipo mexicano con experiencia en HR, producto y tech**.
- **Sin veredictos de empleabilidad**: somos herramienta de práctica, no
  gatekeeper.

---

## 12. Call to action principal

**CTA Principal**: "Empezar mi diagnóstico gratis"
- Gratis, sin tarjeta
- 15-25 minutos
- Recibes tu perfil de soft skills al terminar

**CTA Secundario**: "Ver cómo funciona" (scroll a sección explicativa o video demo)

**CTA B2B**: "Pilotar en mi empresa" (lleva a formulario con email + empresa)

---

## 13. Secciones sugeridas del landing

### 1. Hero
- Headline potente + subheadline
- Primary CTA destacado
- Visual: avatar animado, escena 3D, o mockup de la app
- Texto de proof: "Respaldado en metodología BEI + STAR. Basado en tu transcript real."

### 2. El problema (pain agitation)
Tres párrafos cortos:
- Cursos no te cambian
- Coach cuesta caro
- Improvisar sale mal

### 3. Cómo funciona (3 pasos)
Tres cards visuales: Diagnóstico → Mapa → Práctica

### 4. Demo visual
Screenshot o video mostrando:
- Sofia hablando con el avatar animado
- La conversación en tiempo real
- El diagnóstico resultante con citas textuales

### 5. Características clave (grid 2×3)
- Voz natural realista (ElevenLabs)
- Sin clicks — solo hablas (VAD)
- Evidencia textual citada (no adjetivos)
- Metodología BEI + STAR
- Feedback accionable con micro-prácticas semanales
- Roadmap que evoluciona contigo

### 6. Para quién es (tabs B2C / B2B)
- Profesionales individuales
- Equipos / HR

### 7. Tabla comparativa
| | Cursos | Coach humano | Mente Viva |
|---|---|---|---|
| Interactivo | ❌ | ✅ | ✅ |
| Escalable | ✅ | ❌ | ✅ |
| Feedback personalizado | ❌ | ✅ | ✅ |
| 24/7 disponible | ✅ | ❌ | ✅ |
| Costo por usuario | $$ | $$$$ | $ |

### 8. Testimonios (cuando los tengas)
Por ahora aspiracional. Placeholder: "Construido con el equipo piloto de
[empresa] y el feedback de [N] profesionales."

### 9. Pricing
- **Individual**: $299 MXN/mes (~$15 USD) — diagnóstico + prácticas ilimitadas
- **Equipos** (5+ usuarios): $150-250 MXN/usuario/mes
- **Piloto empresarial**: Gratis 3 meses para las primeras 3 empresas

### 10. FAQ
Preguntas típicas:
- ¿Reemplaza a un coach humano? (No, complementa)
- ¿Qué pasa con mi data? (Se guarda privada, no se comparte)
- ¿Funciona en móvil? (Sí, iOS y Android modernos)
- ¿Necesito micrófono? (Sí, idealmente buenos audífonos)
- ¿Emiten veredictos de empleabilidad? (No, somos práctica)

### 11. Final CTA
Repite el primary CTA con copy más emocional.
"Empieza tu diagnóstico ahora. 15 minutos. Gratis. Sin tarjeta."

### 12. Footer
- Logo
- Links: Sobre nosotros, Privacidad, Términos, Contacto
- Social (si los tienen)
- Copyright

---

## 14. Headlines candidatos

Para que el copywriter elija:

1. **"Practica las conversaciones difíciles, antes de tenerlas."**
2. **"Tu coach de soft skills, siempre disponible."**
3. **"El feedback que un curso nunca te va a dar."**
4. **"No te decimos qué estás haciendo mal. Te mostramos la frase exacta."**
5. **"Mejora tus soft skills con IA que sí te entiende."**
6. **"Entrena como si fuera real. Mejora como si tuvieras coach."**
7. **"Habla. Recibe feedback. Mejora. Repite."**

Preferido: #1 o #2 (punchy, claro, específico).

---

## 15. Subheadlines candidatos

1. "Conversa con avatares que hablan, escuchan y reaccionan como personas.
   Recibe feedback basado en tus palabras reales. 15 minutos, gratis."

2. "Practica ventas, negociación, entrevistas y liderazgo sin el costo de un
   coach y sin el riesgo de perder clientes reales."

3. "Diagnóstico personalizado + escenarios adaptativos. Construido sobre
   metodología BEI + STAR. Tu próximo ascenso empieza aquí."

---

## 16. Lo que el landing NO debe prometer

- No "revoluciona tu carrera" (ni promete empleo)
- No "el único entrenamiento que necesitas" (complementa, no reemplaza)
- No "IA que te conoce mejor que tú" (la IA es herramienta, el usuario dirige)
- No "certificación oficial" (no tenemos acreditación todavía)
- No "100% efectivo" (honesto: efectividad varía por uso)

---

## 17. Equipo

Para la sección "Sobre nosotros":

- **Brandon H.** — Director de Producto
- **Eric V.** — Arquitecto Técnico & Dev Principal
- **Sophia M.** — Contenido Psicológico
- **Cristina T.** — Estrategia RRHH & B2B
- **Areli M.** — Comercial & Marketing

Construido en México 🇲🇽

---

## 18. Assets que tienes disponibles

En `menteviva-frontend/src/components/avatar/` hay avatares 2D SVG animados
que puedes extraer para mockups. En `menteviva-backend/app/static/greetings/`
hay 3 clips MP3 de la voz real de Sofia.

La escena 3D de `src/components/login/Scene3D.tsx` se puede reutilizar en
el landing como hero background.

---

## 19. Prompt sugerido para v0 (si vas por ese camino)

> Build a landing page for "Mente Viva" — a Spanish-language AI soft-skills
> training platform. Dark mode native (#08071A background). Use Syne for
> headings + Instrument Sans for body. Glassmorphism cards, gradient borders
> violet (#7C3AED) → teal (#06B6D4), backdrop-blur. Hero section with large
> Spanish headline "Practica las conversaciones difíciles, antes de tenerlas."
> and a 3-step "Cómo funciona" section: Diagnóstico → Tu Mapa → Práctica.
> Grid of 6 feature cards showcasing: voz natural, sin clicks, evidencia
> textual, BEI + STAR, micro-prácticas, roadmap. Comparison table vs courses
> and human coaches. Final CTA "Empezar mi diagnóstico gratis". Tech-polished
> but humane tone. Include framer-motion animations: fade-up on scroll,
> stagger on feature cards.

---

## 20. Resumen ejecutivo para presentaciones

Si necesitas un párrafo para pitch deck o email frío:

> Mente Viva es una plataforma SaaS que entrena habilidades blandas mediante
> conversaciones con avatares IA de voz natural. A diferencia de los cursos
> pasivos o del coaching 1:1 (caro, no escalable), Mente Viva diagnostica
> primero las brechas del usuario con metodología BEI + STAR, y después lo
> pone a practicar en escenarios reales (ventas, negociación, entrevistas)
> con feedback basado en evidencia textual. Mid-market HR y profesionales
> B2C. Construido por equipo mexicano. Alpha con piloto privado; roadmap a
> 40+ escenarios y vista empresarial.
