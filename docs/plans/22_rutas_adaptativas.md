# 22 - Rutas adaptativas: el plan que se recalcula después de cada sesión

**Fecha:** 2026-09-23
**Estado:** propuesta, sin empezar.
**Ejecuta:** Claude en todas las fases (decisión de Eric, 2026-09-23). No hay reparto entre agentes.
**Fuente:** `MenteViva_DocumentoFuncional_v2.docx` §4 (Motor de Roadmap Adaptativo), `MenteViva_EspecificacionPrototipo_v2.docx`
(pantallas de catálogo, roadmap y P-13/P-14) y `docs/roadmap.md` ("Bloqueador del piloto: loop adaptativo").

---

## 0. Estado verificado del código (2026-09-23)

| Qué | Dato | Consecuencia |
|---|---|---|
| Perfil | `UserProfile = registro + diagnostico`. El diagnóstico trae `strengths[]`/`gaps[]` con `skill` del catálogo de 10 (`SOFT_SKILLS_CATALOG`) **sin puntaje**, más `recommended_next_scenario` (`roberto\|maria`) y `recommended_next_level` (`facil\|intermedio\|dificil`). | El diagnóstico es el punto de partida, pero no hay números: la línea base se infiere (§3.1). |
| Sesiones | `practice_sessions` guarda `avatar_id, level, overall_score, analysis_json` por sesión. `analysis.skills[]` usa los **KPI del avatar** (`KPIS_BY_SCENARIO`: roberto 6, maria 6, celeste 6), no el catálogo de 10. | Hace falta un mapa KPI → habilidad. Los datos ya están, así que **no se toca el analizador**. |
| Análisis demo | Con < 4 intercambios, `_demo_analysis` devuelve **puntajes aleatorios** (`random.randint`) con `is_demo: true`. Si falla, `error: true` y `overall_score: 0`. | El motor **debe descartar** `is_demo` y `error`, o la ruta se mueve por ruido. |
| Niveles | Prompts: `principiante\|intermedio\|avanzado` (Roberto y Celeste tienen `supports_levels`). Diagnóstico: `facil\|intermedio\|dificil`. `MiPlan.tsx` los traduce a mano. El frontend (`Briefing.tsx::AVATARS_WITH_LEVELS`) solo reconoce a Roberto. | El motor habla un solo vocabulario (el de los prompts). Celeste se agrega a `AVATARS_WITH_LEVELS`. |
| `/mi-plan` | Muestra el diagnóstico congelado, "siguiente reto" = `recommended_next_scenario` e historial. Ya tiene "rehacer diagnóstico". | Se reescribe sobre el endpoint nuevo. Rehacer el diagnóstico ya existe. |
| B2B | No hay organizaciones, equipos ni managers en la BD. Las migraciones van en `db.py::MIGRATIONS` (versionadas, idempotentes; la última es la 7). | La fase 4 agrega 4 tablas en la migración 8. |
| Endpoints | `GET /api/me`, `/api/me/sessions`, `/api/me/diagnostics`, `/api/session/{id}`. No hay `PATCH` de registro. | Se agregan `GET /api/me/plan` y `PATCH /api/me/registro`. |

---

## 1. Decisión de diseño central: el plan se **deriva**, no se guarda

El documento funcional dice "el roadmap se recalcula automáticamente después de cada sesión". La forma más barata y correcta de lograrlo:
**no guardar el plan**. Es una función pura:

```
compute_plan(registro, diagnostico, sesiones[], metas_equipo[]) -> Plan
```

Se calcula en cada `GET /api/me/plan` y al cerrar cada sesión. Esto trae varias ventajas:
- **No hay merge del análisis en el perfil** (`mergeAnalysisIntoProfile` de `roadmap.md`) ni estado que se desincronice. El historial de sesiones *es* el estado.
- Si cambian los umbrales o el mapa KPI → habilidad, el plan de **todos** los usuarios se corrige sin migrar datos.
- Si un manager cambia las metas del equipo, la ruta de cada persona cambia en su siguiente carga, tal como pide el doc.
- Se prueba con asserts y conversaciones sintéticas, sin LLM, sin BD y sin cuota.

Costo: una consulta de las últimas ~50 sesiones por usuario (con índice `idx_sessions_user`). Irrelevante a esta escala.
`# ponytail: se recalcula en cada request; cachear por (user_id, max(session_id)) si algún día pesa.`

**Sin LLM en el motor.** Las reglas del doc (75 / 50 / 3 sesiones) son deterministas. El LLM ya hace su trabajo en el análisis de cada sesión; el motor solo junta los números.

---

## 2. Qué calcula el motor

```python
Plan = {
  "skills": [                      # las 10 del catálogo
    {"id", "name", "baseline", "current", "delta", "sessions", "confirmed", "trainable_by": ["roberto", ...]}
  ],
  "levels": {"roberto": "intermedio", "celeste": "principiante", "maria": None},   # nivel vigente por avatar
  "next": {"avatar_id", "level", "focus_skill", "kind": "normal|refuerzo|sube|baja", "why"},
  "sequence": [ ...6 entradas como "next"... ],   # horizonte (~4-8 semanas a 1-2 sesiones/semana)
  "consistency": {"sessions_this_month", "total_sessions"},
  "rediagnose_suggested": bool,
}
```

### 2.1 Mapa KPI → habilidad (`SKILL_MAP`, borrador para que Sophia lo corrija)

| Avatar · KPI | Habilidad del catálogo |
|---|---|
| roberto · `diagnostico_tecnico` | `resolucion_problemas`, `pensamiento_critico` |
| roberto · `idioma_cliente` | `comunicacion`, `adaptabilidad` |
| roberto · `estructura_praincodereci` | `comunicacion` |
| roberto · `control_presion` | `inteligencia_emocional` |
| roberto · `roi_calculado` | `orientacion_resultados` |
| roberto · `habilitacion_campeon` | `liderazgo` |
| maria · `manejo_objeciones` | `inteligencia_emocional`, `pensamiento_critico` |
| maria · `escucha_activa` | `comunicacion` |
| maria · `estructura_praincodereci` | `comunicacion` |
| maria · `control_emocional` | `inteligencia_emocional` |
| maria · `tecnica_cierre` | `orientacion_resultados` |
| maria · `valor_vs_precio` | `pensamiento_critico` |
| celeste · `encuadre_descubrimiento` | `comunicacion` |
| celeste · `preguntas_operativas` | `resolucion_problemas` |
| celeste · `causa_raiz` | `pensamiento_critico` |
| celeste · `impacto_cuantificado` | `orientacion_resultados` |
| celeste · `escucha_y_sintesis` | `comunicacion` |
| celeste · `siguiente_paso_diagnostico` | `orientacion_resultados` |

**Hueco real:** `autoconciencia`, `trabajo_en_equipo` y `gestion_prioridades` no las entrena ningún avatar, y `adaptabilidad` apenas.
El plan las muestra con su línea base del diagnóstico y la etiqueta "aún sin escenario que la entrene". Ese hueco es
el insumo de la fase 5 (qué escenario construir primero).

### 2.2 Reglas

1. **Línea base** (del diagnóstico): habilidad en `strengths` → 70; en `gaps` → 40; en `competencias_foco` sin
   evidencia → 55; no observada → `None` ("sin dato"). Diagnóstico `is_demo` → todo `None`.
2. **Puntaje de una habilidad en una sesión**: promedio ponderado (por `weight` del KPI) de los KPI que la mapean.
3. **Valor actual**: media móvil exponencial sobre las sesiones válidas en orden cronológico,
   `current = 0.5·current + 0.5·puntaje_sesión`. Si `current` es `None`, arranca con el primer puntaje.
   `delta = current − baseline`.
   `# ponytail: EMA alpha 0.5, fija; subir a ventana ponderada por recencia si Sophia pide otra curva.`
4. **Sesión válida**: `analysis` sin `is_demo`, sin `error` y con `total_exchanges ≥ 4`.
5. **Fortaleza confirmada**: ≥ 2 sesiones válidas con puntaje > 70 en esa habilidad ("respaldada por N sesiones").
6. **Nivel por avatar** (solo en avatares con `supports_levels`), evaluado sobre las sesiones de **ese avatar en su nivel vigente**:
   - Las 2 últimas con `overall_score > 75` → **sube** (tope `avanzado`).
   - La última `< 50` → **baja** (piso `principiante`).
   - 3 seguidas sin superar el mejor puntaje previo en ese nivel → la siguiente es de **refuerzo**: mismo nivel, foco en la habilidad más baja de ese avatar.
   - Nivel inicial = `recommended_next_level` del diagnóstico traducido (`facil→principiante`, `dificil→avanzado`).
7. **Siguiente sesión**: la habilidad entrenable con mayor brecha `(meta − current)` gana (meta = 75 por defecto o la del equipo en la fase 4, ponderada por `priority`).
   El avatar elegido es el que más peso de KPI pone en esa habilidad. Empate → el menos practicado. Nunca el mismo avatar 3 veces seguidas, salvo refuerzo.
8. **Secuencia**: se repite la regla 7 seis veces simulando que cada sesión cierra la brecha de su foco en +8.
   `why` es una frase de plantilla: "Tu comunicación está en 48 y la meta es 75. María la pone a prueba en 3 de sus 6 criterios."
   `# ponytail: proyección lineal +8; es una heurística para ordenar, no una predicción que se muestre como número.`
9. **Sugerir nuevo diagnóstico**: ≥ 8 sesiones válidas o ≥ 45 días desde el último.

Umbrales (75, 50, 3, 70, +8, 8 sesiones, 45 días) en un solo dict `RULES` al inicio del módulo: es la perilla de calibración.

---

## 3. Fases

Cada fase cierra con `npm run build` limpio, `poetry run python -m scripts.test_roadmap` en verde y una bitácora en
`docs/changelog/YYYY-MM-DD_rutas_faseN.md` (regla del equipo).

### Fase 1 — Motor (backend, 1 día)

**Nuevo `app/services/roadmap.py`**
- `SKILL_MAP`, `RULES`, `BASELINE` (datos arriba).
- `compute_plan(registro, diagnostico, sessions, goals=None) -> dict`: pura, sin I/O. `sessions` = lista de dicts con
  `avatar_id, level, overall_score, total_exchanges, analysis, created_at`.
- `_valid(session)`, `_skill_scores(avatar_id, analysis)`, `_levels(...)`, `_next(...)`: helpers internos.
- Lee los KPI de `KPIS_BY_SCENARIO` para pesos y los avatares de `AVATARS` (`kind == "practica"`, `supports_levels`). No se duplica config.
- Al importar: `assert` de que cada KPI de `KPIS_BY_SCENARIO` tiene entrada en `SKILL_MAP`. Así, un avatar nuevo sin mapa truena en el arranque y no en silencio.

**`app/services/session_repo.py`**
- `list_user_sessions_for_plan(user_id, limit=50)`: como `list_user_sessions`, pero con `analysis_json` parseado (sin `conversation_json`).

**`app/routers/sessions.py`**
- `GET /api/me/plan` → `get_user_profile(uid)` + `list_user_sessions_for_plan(uid)` → `compute_plan`. 404 si no hay registro.

**`app/services/conversation_finalizer.py`**
- Después de `save_practice_session`: calcular el plan y agregar `metrics["plan"] = {"next", "changed": [...]}`, donde
  `changed` = habilidades cuyo `current` cambió con esta sesión y un aviso si cambió el nivel. Si falla, se loguea y
  la sesión cierra igual (el plan es un extra y no puede romper el reporte).

**Nuevo `scripts/test_roadmap.py`** (asserts, cero LLM, cero BD):
- Sin sesiones → `next` = recomendación del diagnóstico.
- 2 sesiones de Roberto con 80 en `principiante` → `levels.roberto == "intermedio"`, `kind == "sube"`.
- Última con 45 en `intermedio` → baja.
- 3 sesiones planas (60, 58, 61 con mejor previo 62) → `kind == "refuerzo"`.
- Sesión `is_demo` con 95 → no cambia nada.
- Brecha en `comunicacion` → el siguiente avatar es el de mayor peso en comunicación.
- Nunca 3 veces seguidas el mismo avatar en `sequence`.

**Nuevo `scripts/replay_plan_neon.py`**: corre `compute_plan` sobre los usuarios reales de Neon (`practice_sessions` + `diagnostics`)
y escribe `logs/replay_plan.txt`. Sirve para calibrar con datos de verdad antes de enseñarlo (regla "comprobar, no preguntar").

**Criterio:** `test_roadmap` pasa; `replay_plan_neon` produce planes razonables para los testers del piloto; `/api/me/plan` responde en < 200 ms.

### Fase 2 — Mi plan, reporte y briefing (frontend, 1.5 días) → **checkpoint con Eric, Brandon y Sophia**

**`src/types/index.ts`**: tipo `Plan` espejo del dict de §2.

**`src/pages/MiPlan.tsx`** (reescritura sobre `/api/me/plan`, mismo lenguaje de coach, sin gamificación de videojuego, ver `roadmap.md` parte 2):
1. **"Tu siguiente reto"**: avatar, nivel, foco y `why`, con botón de iniciar. Reemplaza `startNextChallenge`: toma avatar y nivel del plan y ya no hace el mapeo a mano.
2. **"Tu ruta"**: las 6 sesiones de `sequence` como lista numerada, con un "¿Por qué este orden?" desplegable (`<details>` nativo) que explica las reglas en 3 líneas.
   Encabezado: "Este plan se recalcula después de cada sesión".
3. **Habilidades**: 10 filas con barra discreta 0-100, marca de la línea base y `delta` ("+12 desde tu diagnóstico").
   Las confirmadas llevan check y "respaldada por N sesiones". Las no entrenables se muestran atenuadas con "aún sin escenario".
4. **Constancia**: "N sesiones este mes", sin rachas.
5. Si `rediagnose_suggested`, el botón de rehacer el diagnóstico (ya existe) pasa a primer plano.
6. Se conservan el historial actual y el bloque del diagnóstico (resumen, punto ciego).

**`src/pages/Report.tsx`**: si `metrics.plan` existe, un bloque al final llamado "Qué cambió en tu plan" con las habilidades de `changed` (flecha y delta),
el aviso de nivel si lo hubo y el botón "Siguiente: {avatar} · {nivel}".

**`src/pages/Briefing.tsx`**: el nivel sale preseleccionado del plan (el usuario puede cambiarlo). `AVATARS_WITH_LEVELS` += `celeste`.

**`src/pages/Dashboard.tsx`**: la tarjeta "Tu siguiente reto" usa `plan.next`, si hay sesión.

**Checkpoint:** capturas de `/mi-plan` y del bloque del reporte con **datos reales del replay**. Sophia valida el `SKILL_MAP`
y las líneas base; Brandon, el tono. Las fases 3-5 no empiezan sin su visto bueno.

### Fase 3 — Perfil editable (0.5 día)

- `PATCH /api/me/registro` (en `routers/profiles.py`) con validación Pydantic de `Registro`. `upsert_user` ya existe.
- En `/mi-plan`: "Editar mis datos" (rol objetivo, industria, nivel de experiencia) en un formulario en línea reutilizando los campos de `Registro.tsx`.
- El registro no mueve el plan (el motor no lo usa para puntajes), solo el contexto del prompt. Se dice en el formulario.

### Fase 4 — Equipos y vista del manager (B2B, 3 días)

**Migración 8** (`db.py::MIGRATIONS`; hoy la última es la 7):
```sql
CREATE TABLE organizations (org_id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE teams (team_id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations,
                    name TEXT NOT NULL, invite_code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE team_members (team_id BIGINT REFERENCES teams, user_id TEXT REFERENCES users,
                           role TEXT NOT NULL CHECK (role IN ('member','manager')), joined_at TEXT NOT NULL,
                           PRIMARY KEY (team_id, user_id));
CREATE TABLE team_goals (team_id BIGINT REFERENCES teams, skill_id TEXT NOT NULL, target INTEGER NOT NULL CHECK (target BETWEEN 0 AND 100),
                         priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 3), updated_at TEXT NOT NULL,
                         PRIMARY KEY (team_id, skill_id));
```

**Alta**: sin panel de administración. `scripts/create_team.py --org "Ingeniería Cóndor" --team "Ventas" --manager <email>`
imprime el `invite_code`. Las personas se unen en `/unirse/:code` (requiere sesión; si no hay, pasa por login y regresa).
`# ponytail: alta por script; panel de admin cuando haya más de ~5 clientes.`

**Metas → motor** (fuente 3 del doc): `GET /api/me/plan` carga los `team_goals` de los equipos del usuario y los pasa a
`compute_plan(goals=...)`. Con eso se cumple "el roadmap de todos los afectados se recalcula en la siguiente sesión", sin trabajo extra.

**Endpoints de manager** (nuevo `app/routers/teams.py`; cada query exige `role = 'manager'` del equipo en SQL, 404 si no):
- `GET /api/teams/mine`: equipos donde soy manager.
- `GET /api/teams/{id}/summary` (**P-13**): cobertura (quién practicó en los últimos 30 días), sesiones por persona,
  promedio por habilidad del equipo contra la meta, las 3 brechas mayores del equipo y la evolución semanal del promedio.
- `GET /api/teams/{id}/members/{uid}` (**P-14**): habilidades (`current`, `delta`), niveles, historial con fecha, avatar, nivel y puntaje.
- `PUT /api/teams/{id}/goals`: el manager define meta y prioridad por habilidad.

**Privacidad (promesa de la landing: "Tú ves el avance del equipo. No sus conversaciones.")**: los endpoints de manager
**nunca** devuelven `conversation_json`, citas `moment`/`evidence` ni el diagnóstico narrativo. Solo números, fechas y nombres de habilidad.
Un test en `scripts/test_roadmap.py` (o `test_teams_privacy.py`) serializa la respuesta y hace assert de que no aparecen esas claves.

**Frontend**: `/equipo` (P-13: tabla de personas con cobertura, más barras de equipo contra meta y el editor de metas) y
`/equipo/:uid` (P-14). Guard: solo aparece en el navbar si `GET /api/teams/mine` trae equipos.

**Criterio:** un manager ve el agregado y la ficha, cambia una meta y el `/mi-plan` de un miembro reordena su ruta. El test de privacidad pasa.

### Fase 5 — Catálogo (1.5 días de código + contenido)

- `app/prompts/scenarios.py`: `CATEGORIES` con las 8 categorías del doc (id, nombre, descripción) y `category` en cada avatar.
  Las categorías sin avatar se muestran como "Próximamente".
- `GET /api/catalog`: categorías → escenarios (nombre, niveles, minutos estimados, habilidades que entrena según `SKILL_MAP`).
- Nuevo `/catalogo`: acordeón por categoría (`<details>`), filtro "En mi plan" (escenarios que aparecen en `sequence`) y la etiqueta
  "Tu plan recomienda esto" en la categoría de `plan.next`. Selector de nivel con la advertencia en "Avanzado" (spec del prototipo).
- **Contenido** (no es código; lo hace Claude con revisión de Sophia): el siguiente escenario sale del hueco de §2.1.
  Candidato natural: **Carlos** (CAT-03 Entrevistas) orientado a `autoconciencia` y `trabajo_en_equipo`. Requiere prompt, KPIs,
  voz en `AVATAR_VOICES` y entrada en `SKILL_MAP` (el assert de arranque lo exige). Niveles para María, igual que Roberto.
- Agregar un avatar después de esto = config + contenido; el motor, el catálogo y el plan lo toman solos.

---

## 4. Calendario

| Fase | Entrega | Esfuerzo | Bloqueo |
|---|---|---|---|
| 1 | `roadmap.py`, `/api/me/plan`, `plan` en `session_end`, test y replay | 1 d | — |
| 2 | Mi plan, reporte, briefing, dashboard | 1.5 d | — |
| **checkpoint** | Capturas con datos reales; Sophia valida mapa y bases | — | Eric, Brandon, Sophia |
| 3 | Editar registro | 0.5 d | — |
| 4 | Equipos, metas, P-13, P-14, privacidad | 3 d | Decisiones §6.3-6.4 |
| 5 | Catálogo; Carlos y niveles de María | 1.5 d + contenido | Revisión de Sophia |

**Total:** ~7.5 días de código. Las fases 1-3 (~3 días) cierran el bloqueador del piloto que marca `roadmap.md`.

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| El mapa KPI → habilidad no convence a Sophia | Es un dict; el plan se recalcula solo al corregirlo. Checkpoint antes de la fase 3. |
| Pocas sesiones por usuario: el plan "no se mueve" | EMA 0.5 reacciona desde la 1.ª sesión; el bloque del reporte muestra el cambio aunque sea chico. |
| Ruido del LLM analizador (±10 puntos entre corridas) | Subir exige 2 sesiones seguidas; bajar, 1 sesión < 50 (umbral lejano). Se revisa con el replay. |
| Puntajes demo aleatorios contaminan la ruta | Filtro `is_demo`/`error`/`< 4 intercambios`, con test. |
| Fuga de privacidad en la vista del manager | Lista blanca de campos en el endpoint, más el test de claves prohibidas. |
| Umbrales mal calibrados | Viven en `RULES`; el replay contra Neon se corre antes de cada cambio. |

## 6. Decisiones pendientes

1. **Umbrales**: ¿se respetan los del doc (75 dos veces sube, < 50 baja, 3 sin mejora refuerzo) tal cual? Propuesta: sí.
2. **Línea base inferida** (70 / 55 / 40) o **sin línea base** hasta la primera sesión. Propuesta: inferida, marcada "estimado del diagnóstico".
3. **¿El manager ve el puntaje individual por persona** (P-14 del spec) o solo el agregado? La landing promete "no sus conversaciones",
   no "no sus puntajes". Propuesta: sí ve puntajes por persona, nunca texto. Confirmar con Cristina (estrategia B2B).
4. **Alta de equipos**: ¿basta con código de invitación o hace falta correo con magic link? Propuesta: código para el piloto.
5. **Siguiente escenario a construir** (fase 5): ¿Carlos para `autoconciencia` y `trabajo_en_equipo`, u otro de CAT-04 a CAT-08?

## 7. Lo que NO se hace

- Guardar el plan en BD o mezclar el análisis en el perfil (el plan se deriva, §1).
- LLM dentro del motor de rutas.
- Rachas, badges, leaderboards o notificaciones push (`roadmap.md`, "Decididos no hacer").
- Reescribir las rúbricas de los avatares hacia el catálogo de 10 (el mapa las une sin tocar el analizador).
- Panel de administración de organizaciones (script hasta tener más de ~5 clientes).
