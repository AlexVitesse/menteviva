# CLAUDE.md - Contexto del Proyecto Mente Viva

## Resumen Ejecutivo

**Mente Viva** es una plataforma de entrenamiento de habilidades blandas (soft skills) que utiliza IA conversacional y avatares 2D para simular situaciones laborales reales. No es un LMS tradicional con videos - es práctica activa con presión real y feedback inmediato.

**Desarrollador Principal:** Eric V.
**Director de Producto:** Brandon H.

---

## Propuesta de Valor

### Para Profesionales (B2C)
- Practica sin riesgo real
- Feedback específico por sesión
- Roadmap adaptativo personalizado
- Certificación con evidencia

### Para Empresas (B2B)
- Capacita equipos escalablemente
- Define metas - la IA construye el plan
- KPIs conductuales medibles
- Escenarios personalizados por industria

---

## Catálogo de Escenarios

### 8 Categorías de Soft Skills (40+ escenarios planificados)

| ID | Categoría | Escenarios | Fase |
|----|-----------|------------|------|
| CAT-01 | Ventas y Cierre | 6 | Fase 1 |
| CAT-02 | Negociación | 5 | Fase 1 |
| CAT-03 | Entrevistas y Selección | 5 | Fase 1 |
| CAT-04 | Liderazgo y Equipos | 6 | Fase 2 |
| CAT-05 | Presentaciones Ejecutivas | 5 | Fase 2 |
| CAT-06 | Manejo de Conflictos | 5 | Fase 2 |
| CAT-07 | Comunicación Asertiva | 5 | Fase 2 |
| CAT-08 | Gestión de Proyectos | 5 | Fase 3 |

### Escenarios Fase 1 (Detalle)

#### CAT-01: Ventas y Cierre
- VEN-01: Venta consultiva B2B (SaaS)
- VEN-02: Retail de alto valor
- VEN-03: Venta farmacéutica
- VEN-04: Upselling y cross-selling
- VEN-05: Recuperación de cliente perdido
- VEN-06: Demo de producto técnico

#### CAT-02: Negociación
- NEG-01: Negociación con proveedor
- NEG-02: Renegociación de contrato
- NEG-03: Negociación salarial
- NEG-04: Resolución de disputa
- NEG-05: Negociación multicultural

#### CAT-03: Entrevistas y Selección
- ENT-01: Entrevista de trabajo general
- ENT-02: Entrevista técnica
- ENT-03: Entrevista conductual (STAR)
- ENT-04: Entrevista de ascenso
- ENT-05: Entrevistador de RRHH

### Niveles de Dificultad
Cada escenario tiene 3 niveles:
- **Principiante:** Avatar cooperativo, objeciones suaves
- **Intermedio:** Avatar neutral, objeciones moderadas
- **Avanzado:** Avatar desafiante, presión alta

---

## Motor de IA - Roadmap Adaptativo

### Fuentes de Datos (3 pilares)
1. **Perfil del usuario:** rol, industria, metas personales
2. **Resultados de sesiones:** scores, patrones, brechas detectadas
3. **Metas de la empresa:** competencias prioritarias, plazos (solo B2B)

### Lógica de Ajuste Automático
- Score >75 en 2 sesiones consecutivas → Sube de nivel
- Score <50 → Regresa al nivel anterior
- Sin mejora en 3 sesiones → Inserta sesión de refuerzo
- El plan se recalcula después de cada sesión

---

## Estructura del Prototipo (14 Pantallas)

### Flujo 1 - Onboarding
| ID | Pantalla | Ruta |
|----|----------|------|
| P-01 | Landing / Bienvenida | / |
| P-02 | Registro de cuenta | /registro |
| P-03 | Entrevista de perfil con IA | /onboarding/entrevista |
| P-04 | Perfil generado - Confirmación | /onboarding/perfil |

### Flujo 2 - Dashboard
| ID | Pantalla | Ruta |
|----|----------|------|
| P-05 | Dashboard del usuario | /dashboard |

### Flujo 3 - Simulación
| ID | Pantalla | Ruta |
|----|----------|------|
| P-06 | Catálogo de escenarios | /escenarios |
| P-07 | Briefing del escenario | /escenario/[id]/briefing |
| P-08 | Simulación en vivo | /escenario/[id]/simulacion |
| P-09 | Sesión en pausa / cierre | /escenario/[id]/pausa |

### Flujo 4 - Feedback
| ID | Pantalla | Ruta |
|----|----------|------|
| P-10 | Reporte post-sesión - Resumen | /reporte/[id] |
| P-11 | Reporte post-sesión - KPIs | /reporte/[id]/kpis |
| P-12 | Plan de desarrollo | /mi-plan |

### Flujo B2B - Vista Manager
| ID | Pantalla | Ruta |
|----|----------|------|
| P-13 | Dashboard empresarial | /empresa/dashboard |
| P-14 | Ficha de empleado | /empresa/empleado/[id] |

---

## Guía de Estilos Visuales

### Paleta de Colores
| Rol | Color | Hex | Uso |
|-----|-------|-----|-----|
| Fondo principal | Negro profundo | #08071A | Fondo de todas las pantallas |
| Fondo panel/sidebar | Azul muy oscuro | #110F2B | Sidebar, cards oscuras |
| Acento primario | Violeta medio | #7C3AED | Botones CTA, ítems activos |
| Acento secundario | Teal/Cian | #06B6D4 | Subtítulos, KPIs positivos |
| Positivo/éxito | Verde | #16A34A | Scores altos, fortalezas |
| Atención | Naranja | #F97316 | Áreas de mejora, alertas |
| Negativo | Rojo discreto | #DC2626 | Scores bajos, alertas críticas |
| Texto principal | Blanco hueso | #F5F3FF | Todo el texto principal |
| Texto secundario | Gris medio | #9CA3AF | Subtítulos, metadatos |

### Tipografía
| Fuente | Uso | Tamaños |
|--------|-----|---------|
| Syne (Google Fonts) | Títulos, logos, CTAs | H1: 48px, H2: 32px, H3: 24px, CTA: 14px bold |
| Instrument Sans (Google Fonts) | Cuerpo, párrafos, labels | Body: 14px, Small: 12px, Micro: 10px |

### Componentes Reutilizables

**Botón primario (CTA):**
- Fondo violeta (#7C3AED), texto blanco
- border-radius: 10px, padding: 10px 20px
- Fuente Syne bold 13px
- Hover con brillo sutil

**Botón secundario:**
- Borde 1px violeta, fondo transparente, texto violeta

**Tarjeta (card):**
- Fondo #201D3E
- Borde 1px rgba(255,255,255,0.07)
- border-radius: 16px, padding: 24px

**Chip/Tag:**
- Fondo rgba del color acento al 15%
- Borde 1px del color acento
- border-radius: 100px, padding: 4px 12px

**Barra de progreso:**
- Alto 6px, fondo #2D2B4E
- Color de relleno según KPI
- border-radius: 3px, transición 0.8s

**Input de formulario:**
- Fondo #201D3E
- Borde 1px rgba(255,255,255,0.1)
- border-radius: 8px, padding: 12px
- Focus con borde violeta

**Burbuja de chat (usuario):**
- Fondo violeta oscuro, alineada derecha
- border-radius: 16px 16px 4px 16px

**Burbuja de chat (avatar):**
- Fondo #201D3E, alineada izquierda
- border-radius: 16px 16px 16px 4px

---

## Stack Técnico

### Prototipo (Actual)
- HTML/CSS/JS puro o React
- Sin backend real (datos hardcoded)
- Archivos estáticos compartibles

### Producto Final (Futuro)
- **IA Conversacional:** Claude API
- **Avatar con lip-sync:** HeyGen / D-ID
- **Síntesis de voz:** ElevenLabs
- **Speech-to-text:** Whisper
- **Base de datos:** Por definir
- **Autenticación:** Por definir

---

## Modelo de Negocio

| Plan | Precio | Target |
|------|--------|--------|
| B2C Individual | $299 MXN/mes | Profesionales independientes |
| B2B Equipos | $150-250 MXN/usuario/mes | Empresas 10+ empleados |
| Piloto Empresarial | Gratis 3 meses | Primeras 3 empresas |

---

## Roadmap de Fases

| Fase | Alcance | Timeline |
|------|---------|----------|
| Fase 1 - MVP | 3 categorías, avatar 2D, roadmap v1 | Semanas 1-11 |
| Fase 2 - Expansión | 5 categorías más, análisis de voz | Semanas 12-20 |
| Fase 3 - VR | 40+ escenarios, realidad virtual | Mes 6+ |

---

## Equipo

| Nombre | Rol |
|--------|-----|
| Brandon H. | Director de Producto |
| Eric V. | Arquitecto Técnico & Dev Principal |
| Sophia M. | Contenido Psicológico |
| Cristina T. | Estrategia RRHH & B2B |
| Areli M. | Comercial & Marketing |

---

## Criterios de Aceptación del Prototipo

### Críticos
- [ ] Flujo completo navegable (P-01 a P-10)
- [ ] Avatar visible en simulación (P-08)
- [ ] Chat de simulación funciona (hardcoded)
- [ ] Score y KPIs visibles (P-10)
- [ ] Dashboard con datos (P-05)

### Alta Prioridad
- [ ] Vista B2B navegable (P-13, P-14)
- [ ] Plan de desarrollo visible (P-12)
- [ ] Diseño oscuro coherente
- [ ] Sidebar funcional

### Media Prioridad
- [ ] Animaciones básicas (fadeUp, counter, typewriter)
- [ ] Responsivo básico (1280px mínimo)
- [ ] Transiciones entre pantallas

---

## Notas Importantes para Desarrollo

1. **Todos los datos son estáticos** - El objetivo es que SE VEA y SE SIENTA real, no que funcione con IA real.

2. **Priorizar experiencia sobre lógica** - Animaciones y transiciones son más importantes que validaciones.

3. **Sofia es la asesora IA** - Aparece en onboarding (P-03), dashboard (P-05) y plan (P-12).

4. **Semáforo de scores:**
   - Verde: >75
   - Amarillo: 50-75
   - Rojo: <50

5. **Sidebar diferente para B2B** - El manager tiene opciones distintas al usuario individual.

6. **Tiempo estimado:** 3-5 días de desarrollo con apoyo de IA.

---

*"Haz que se vea real. El resto viene después."* — Brandon H.
