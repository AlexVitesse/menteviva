# Roadmap — Mente Viva

Estado del producto y lo que sigue. Documento vivo: editar conforme cambien
las prioridades. Para contexto del producto y arquitectura ver `CLAUDE.md`;
para el detalle del paso 0 ya implementado ver `plan.txt`. Para el snapshot
de la última sesión técnica ver `session-status-2026-04-27.md`.

---

## 🎯 Piloto vivo — semana del 28-Abr al 1-May 2026

**Objetivo:** prueba en vivo con cliente accediendo a una URL pública. Sin
auth ni DB nueva — se mantiene SQLite local (commit `aad3d07`) porque el
producto no es la base de datos y meter Supabase/Firebase ahora consume
tiempo que vale más en feature útil.

### Plan día por día

| Día | Entregable | Status |
|---|---|---|
| **Mar 28** | Roberto 3 niveles (Principiante/Intermedio/Avanzado) + tests por nivel | tasks #22, #23 |
| **Mié 29** | UI de 6 KPIs en Report + selector de nivel en Briefing | tasks #24, #25 |
| **Jue 30** | Dashboard `/mi-plan` leyendo de SQLite + endpoints `GET /api/sessions/...` si faltan | task #26 |
| **Vie 1-May** | Deploy (Render backend con disco persistente + Vercel frontend) + validar Sofía/María con `gpt-oss-20b` + polish + bug bash | tasks #27, #28, #29 |

### Diseño de los 3 niveles de Roberto

| | Principiante (actual) | Intermedio | Avanzado |
|---|---|---|---|
| Vocabulario esperado | OEE, MTBF, downtime | + MTTR, FTQ, takt time, COPQ | Todos los anteriores **perfectos** — tropiezo = desconexión |
| Banco de objeciones | 4 (tiempo, ROI, fracaso, DG/Finanzas) | 5 (+ "competencia más barata", "proyecto interno") | 6 (+ "ya hablamos con [competidor]", "CapEx hasta Q3", "integración con SAP") |
| Para ceder | 2 objeciones manejadas + ROI claro | 3 objeciones + ROI con pay-back desglosado + propuesta de piloto | 4 objeciones + NPV/IRR + caso verificable + POC con go/no-go |
| Castigo a técnicas básicas | Suave (desconexión a features-only) | Medio (subir presión por descuento prematuro) | Fuerte (Roberto se molesta visiblemente) |
| 5 Porqués | Suficiente | No basta — pide datos | No funciona — pide procesos documentados |

### Decisiones tomadas para el piloto (no re-discutir)

- **SQLite, no Supabase/Firebase**: ya está integrado, "no tiene chiste" cambiarlo para una semana
- **Sin auth real**: el registro existente (nombre + email) es suficiente para piloto
- **Deploy con HTTPS por subdominio**, no IP plana: el navegador exige HTTPS para acceder al micrófono. Render (`menteviva-api.onrender.com`) + Vercel (`menteviva.vercel.app`) dan HTTPS automático sin dominio propio. IP plana sobre HTTP **rompe el demo**.
- **Avatar 3D queda como preview opt-in** (`?avatar3d=1`); default 2D para no arriesgar el demo
- **gpt-oss-20b para los 3 avatares**, con fallback a llama-3.1-8b-instant **sólo** si la validación del jueves revela degradación en Sofía/María

### Riesgos abiertos del piloto

- **Render free tier wipe el disco en restart** → necesita disco persistente (~$1/mo) o el .db se borra entre redeploys. Confirmar antes del viernes.
- **CORS**: añadir el dominio de Vercel a `cors_origins` en `config.py` antes del deploy.
- **WebSocket en Render**: validar que el plan free soporta WS (debería sí pero tipos free a veces tienen idle timeouts agresivos).
- **Multi-dispositivo**: si el cliente prueba en laptop y luego en celular, no ve continuidad (SQLite por usuario en server, pero sin auth real cada registro es nuevo). Decir explícitamente en demo: "auth viene en sprint 2".

---

## Hecho (Paso 0 — Fase de diagnostico)

- Registro de identidad (nombre, rol objetivo, industria, nivel de experiencia)
- Diagnostico conversacional con Sofia (metodologia BEI + STAR, 5 fases)
- Perfil de usuario persistente (registro + diagnostico) con contrato versionado
  espejeado en backend (Pydantic) y frontend (TypeScript)
- Inyeccion del perfil en las pruebas: Roberto y Maria reciben las brechas
  detectadas y aprietan justo ahi, en lugar de correr el script generico
- Streaming TTS via ElevenLabs: el audio empieza en <1s en vez de esperar
  3-5s a que se genere completo
- 4 voces ElevenLabs distintas (Roberto, Carlos, Maria, Sofia)
- Modelo de analisis: llama-3.3-70b-versatile para JSON estructurado confiable
- Reglas de calidad en el output del diagnostico:
  - Evidencia textual obligatoria (citas reales del candidato)
  - Prohibicion de "evidencia por ausencia" reforzada con filtro deterministico
  - Conducta observable, no etiquetas de personalidad
  - Micro-practicas accionables y especificas
  - Patrones verbales medidos del texto, no inferidos

---

## Bloqueador del piloto: loop adaptativo y progresion visible

**Por que es bloqueador:** la promesa central del producto es "roadmap
personalizado que evoluciona contigo". Hoy el perfil queda congelado tras el
diagnostico inicial — las sesiones de practica no lo actualizan. Un manager
B2B que vea esto en la sesion 5 va a notar que "el sistema no aprende del
usuario", y la propuesta pierde credibilidad.

**Scope estimado: 8-10 horas.**

### Parte 1 — Merge prueba → perfil (motor)

- Alinear el shape de `ConversationAnalysis` (output de pruebas) con
  `Diagnostico` (estructura del perfil). Hoy son distintos: el primero usa
  `strengths: string[]`, el segundo `Strength[]` con evidencia citable.
- Reglas de actualizacion del perfil tras cada prueba:
  - Una `strength` se "confirma" cuando 2+ sesiones la respaldan con evidencia
    consistente
  - Un `gap` baja de prioridad si se logra score >70 en sesiones que lo
    ejercitan
  - El `blind_spot` se reemplaza solo si una sesion revela uno mas fuerte con
    evidencia textual
  - El `recommended_next_scenario` rota cuando se completaron 2+ sesiones del
    actual con resultado positivo
- `mergeAnalysisIntoProfile()` en backend + wire en frontend tras cada
  `session_end` de practica
- Reconciliar el catalogo de habilidades: hoy `analyze_conversation` usa una
  rubrica de 5 skills hardcoded por avatar mientras que el diagnostico usa el
  catalogo de 10 habilidades. Hay que unificar para que el usuario vea
  consistencia entre su perfil y los reportes

### Parte 2 — Progresion visible (gamificacion ligera, sin caer en arcade)

Lenguaje de coach y desarrollo profesional, no de videojuego. Sin badges
flotantes, sin streaks agresivos, sin animaciones tipo "LEVELED UP".

- **Niveles por habilidad (0-100)** con barra de progreso discreta visible
  en el reporte post-sesion y en `/mi-plan`
- **Strengths confirmadas** marcadas con check + contador "respaldada por
  N sesiones"
- **Areas de foco** con barra de progreso desde el valor inicial del
  diagnostico
- **"Tu siguiente reto"** como tarjeta destacada en el dashboard, no popup
  intrusivo
- **Insights nuevos** (cuando un blind_spot se descubre o resuelve) se
  muestran una sola vez con transicion sobria
- **Indicador de constancia** discreto ("12 sesiones este mes") sin presion
  por mantener racha

Para perfil B2C el tono puede tener un poco mas de color; para B2B atenuar
sin tocar la logica subyacente. La capa visual va encima del motor de la
parte 1 — sin merge real, la gamificacion se siente vacia.

---

## Para piloto B2B (siguiente bloque)

- Persistencia server-side: reemplazar localStorage por base de datos
  (Postgres / Supabase / equivalente)
- Auth basico (email + magic link o OAuth)
- Modelo multi-tenant: organizacion → equipos → usuarios
- Vista manager (pantallas P-13, P-14 del spec): dashboard agregado del
  equipo + ficha de empleado individual
- Metricas para HR: cobertura, evolucion por habilidad a nivel grupo, areas
  de mayor brecha agregada
- Re-diagnostico desde `/mi-plan` (boton + flujo) cada N sesiones o por
  decision del usuario
- Edicion del registro desde `/mi-plan`

---

## Para escala (post-piloto)

- Avatar Carlos completo: system_prompt + visual SVG + rubrica de habilidades
  (CAT-03 Entrevistas laborales)
- Niveles de dificultad facil / intermedio / dificil por escenario
  (corresponde a Prioridad 2 de `plan.txt`)
- Personalizacion manual del user_context (corresponde a Prioridad 3 de
  `plan.txt`): textarea opcional para describir un producto, una vacante
  o un contexto especifico que enriquezca el escenario
- Ampliacion del catalogo de escenarios: CAT-02 a CAT-08 del spec original
- Mejoras visuales de avatares: expresiones por mood, contextos de fondo
  (oficina, sala de juntas, etc.)
- Pagina `/mi-plan` completa con historico de sesiones y curva de evolucion
  del perfil en el tiempo

---

## Decididos no hacer por ahora

- **VR / inmersivo** (Fase 3 del spec original): el ROI no justifica el costo
  de desarrollo en esta etapa
- **HeyGen / D-ID con lip-sync**: overkill para lo que hoy ofrecen los
  avatares 2D animados
- **Analisis de voz / prosodia**: complejo de implementar y aporta marginal
  vs lo que ya extraemos del contenido textual
- **Gamificacion estilo Duolingo** (streaks agresivos, leaderboards, vidas,
  notificaciones push): no encaja con el tono profesional que necesita el
  cliente B2B

---

## Riesgos abiertos

- **Sin DB hoy.** Todo el perfil vive en localStorage. Si el usuario limpia
  cookies pierde su avance. Bloqueante para piloto B2B real.
- **Desalineacion entre catalogo del diagnostico y rubrica de pruebas.** El
  diagnostico usa el catalogo de 10 habilidades; las pruebas usan 5 skills
  hardcoded por avatar (ver `SKILLS_BY_SCENARIO`). El usuario ve "comunicacion"
  y "autoconciencia" en su perfil pero su reporte de Roberto le evalua
  "manejo_objeciones" y "rapport". Hay que reconciliar — parte del trabajo
  del bloqueador del piloto.
- **Solo 2 avatares de practica.** Repetir 5+ sesiones con Roberto y Maria
  se va a sentir saturado. La integracion de Carlos es la salida natural,
  pero requiere su propia rubrica y visual.
- **Sin pruebas con humanos reales aun.** Todo lo planteado aqui son
  hipotesis hasta que un usuario haga el ciclo completo y reporte donde se
  siente raro o roto.
