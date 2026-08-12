# Plan 18 — Remediación de retros: casos de Roberto y conducción de Sofía

**Fecha:** 2026-08-12  
**Rama:** `codex/roberto-sales-cases` (creada directamente desde `main`)  
**Worktree:** `C:\Users\pcdec\OneDrive\Documentos\Mente Viva-roberto-sales-cases`  
**Estado:** implementación y pruebas terminadas; pendiente validación humana completa por voz  
**Commits:**

- `60995e9 feat: divide casos de ventas y refuerza diagnostico`
- `964d194 fix: endurece conduccion y diagnostico de sofia`

---

## 1. Origen

La sesión respondió a las retros de Eric y Sofi después de probar los modelos de
diagnóstico y práctica de Mente Viva.

### Observaciones positivas

- La comprensión de frases incompletas, especialmente por voz, mejoró.
- Los diagnósticos se percibieron acertados y bien generados.
- Los tiempos de respuesta y la naturalidad mejoraron respecto a versiones
  anteriores.
- Gemini parafraseaba y comprendía correctamente muchas respuestas difíciles.

### Problemas reportados

1. No estaba claro si los escenarios reales correspondían a los documentos
   funcionales preparados por el equipo.
2. Roberto seguía mostrando carencias de entrenamiento en ventas y manejo de
   objeciones.
3. El entrenamiento de ventas estaba excesivamente centrado en manufactura sin
   comunicar claramente que esa especialización era intencional.
4. Sofía terminaba la conversación ante respuestas ambiguas, incongruentes o con
   poca información, en lugar de profundizar o reformular.
5. Los tres modelos iniciaban sin suficiente contexto; el usuario no sabía qué
   papel desempeñar ni de qué hablar.
6. La duración seleccionada se percibía como un límite por turnos y no como
   minutos reales.
7. El cierre de la entrevista era abrupto y no seguía de forma consistente la
   metodología definida.
8. La voz podía robotizarse o demorarse, produciendo sensación de bloqueo.
9. El tono de algunos escenarios se sentía demasiado duro.

---

## 2. Decisiones de producto

### 2.1 Roberto permanece especializado en manufactura

Se decidió no convertir a Roberto en un avatar adaptable a cualquier industria.
Su identidad canónica permanece fija:

- Roberto Garza, Director de Operaciones.
- Planta metalmecánica mediana.
- Primera visita/proceso comercial de Ingeniería Cóndor.
- Problema operativo centrado en la estación 4, paros, OEE, mantenimiento y
  visibilidad de planta.
- Solución comercial: Smart Factory 360° / Maintrack.

La especialización deja de ser una inconsistencia y se convierte en una decisión
explícita del escenario.

### 2.2 Un avatar, dos casos de ventas

Roberto se dividió en dos ejercicios dentro del mismo contexto de manufactura:

#### Caso 1 — Descubrimiento operativo

Objetivo del usuario:

- entender el proceso antes de presentar;
- identificar síntoma, causa y consecuencia;
- cuantificar el impacto de los paros;
- resumir el problema;
- proponer un diagnóstico de bajo riesgo.

Roberto no debe lanzar el banco comercial de objeciones en este caso. Si el
vendedor presenta producto o intenta cerrar prematuramente, debe devolverlo al
descubrimiento.

#### Caso 2 — Objeciones y avance comercial

Parte de un descubrimiento ya realizado. Evalúa si el vendedor puede:

- reconocer la objeción;
- descubrir la preocupación de fondo;
- responder con evidencia;
- confirmar si resolvió la preocupación;
- proponer un siguiente paso concreto y de bajo riesgo.

Cada caso mantiene los niveles principiante, intermedio y avanzado.

### 2.3 Cada caso usa una evaluación compatible

El caso de descubrimiento tiene una rúbrica propia. No penaliza al usuario por no
negociar o cerrar cuando esas acciones no pertenecen al objetivo de la sesión.

La rúbrica histórica de Roberto queda asociada al caso de objeciones y venta
industrial completa.

---

## 3. Implementación de Roberto

### Backend

- `app/prompts/roberto.py`
  - soporta `sales_case=descubrimiento|objeciones`;
  - ensambla identidad + dificultad + módulo del caso;
  - conserva fallbacks seguros para valores inválidos.
- `app/prompts/roberto_caso_descubrimiento.md`
  - reglas exclusivas de descubrimiento;
  - inhibe objeciones comerciales prematuras;
  - define apertura y condición de logro.
- `app/prompts/roberto_caso_objeciones.md`
  - parte del conocimiento ya obtenido;
  - aplica objeciones por nivel;
  - define recuperación ante respuestas ambiguas.
- `app/prompts/scenarios.py`
  - lee `session_vars.roberto_case` y selecciona el módulo correspondiente.
- `app/services/analysis.py`
  - añade `roberto_descubrimiento` con seis KPIs y pesos que suman 100;
  - mantiene la rúbrica anterior para objeciones.
- `app/routers/conversation.py`
  - pasa el caso seleccionado al analizador final.

### Frontend

- `src/stores/sessionStore.ts`
  - añade `selectedRobertoCase`;
  - valores válidos: `descubrimiento` y `objeciones`.
- `src/pages/Briefing.tsx`
  - muestra los dos casos;
  - alinea identidad, empresa, objetivo, contexto, habilidades y consejos;
  - elimina la contradicción anterior de “Director de TI / Grupo Industrial
    Norte”.
- `src/pages/Simulation.tsx`
  - envía `session_vars.roberto_case` al WebSocket.

---

## 4. Remediación de Sofía

### 4.1 Recuperación ante respuestas de baja señal

Se definió una secuencia explícita:

1. Frase truncada: invitar a completarla sin adivinar.
2. Ambigüedad: pedir una precisión observable (resultado, cambio o medición).
3. Contradicción: mencionar neutralmente ambas versiones y preguntar cuál
   ocurrió realmente.
4. Respuesta general: pedir un caso concreto.
5. Dos intentos agotados: pivotar a otra competencia.
6. Cierre por falta de material: solo después de probar varias competencias.

Una única respuesta pobre ya no autoriza el cierre.

### 4.2 Cierre en dos turnos

El cierre natural requiere:

1. anunciar la última pregunta y formular una reflexión;
2. escuchar la respuesta;
3. agradecer y cerrar en el turno siguiente.

Está prohibido preguntar y cerrar en el mismo turno.

### 4.3 Una pregunta por turno

Las pruebas reales mostraron que el prompt por sí solo no garantizaba esta
regla. Se añadieron dos defensas:

- instrucción final de máxima prioridad en el prompt conciso;
- saneamiento en las rutas de texto: si Gemini devuelve varias preguntas, se
  conserva únicamente la primera pregunta completa.

Esta segunda defensa no sustituye la validación por voz: Gemini Live sintetiza
audio directamente y depende principalmente de la instrucción del prompt.

### 4.4 Respuestas vacías y silencios

El prompt ahora prohíbe responder con texto vacío. Ante silencio o corte, Sofía
debe indicar brevemente que no escuchó y hacer una única invitación para
continuar.

### 4.5 Control interno de duración

Durante una ronda larga, Gemini inventó y pronunció mensajes como:

```text
[NOTA DEL SISTEMA: Han pasado 5 minutos y 40 segundos]
```

Para evitarlo:

- el reloj dejó de usar una frase humana fácil de imitar;
- ahora viaja como `<session_control hidden="true" ...>`;
- el prompt prohíbe generar, repetir, describir o inventar etiquetas, minutos o
  porcentajes;
- las rutas de texto eliminan cualquier control interno antes de devolver la
  respuesta;
- se conserva el comportamiento por bandas: apertura, profundización, tramo
  final y cierre.

### 4.6 Duración visible en VoiceLab

VoiceLab muestra progreso por tiempo real (`transcurrido / objetivo`) en vez de
presentar la duración como un cupo de turnos. El límite técnico de turnos sigue
existiendo como protección, pero no representa la promesa de duración al
usuario.

---

## 5. Refuerzo del diagnóstico final

Las pruebas demostraron que el modelo podía detectar una señal durante la
entrevista y omitirla en el reporte. Se añadió una recuperación determinista,
limitada a evidencia explícita:

### Falta de métricas

Si el candidato dice literalmente frases como:

- “no hubo cifras concretas”;
- “no medimos el impacto”;
- “no tenemos métricas”;

el diagnóstico incorpora `orientacion_resultados` como gap, con la cita real,
impacto y micropráctica.

### Contribución individual oculta

Si el analizador detecta tendencia alta a “nosotros” y existe una cita como “el
equipo y yo…”, puede construir un punto ciego sobre la dificultad para separar
la acción personal de la colectiva.

### Restricción de seguridad

No se generan gaps por ausencia silenciosa. La recuperación solo opera cuando
existe evidencia textual inequívoca en el transcript.

---

## 6. Pruebas creadas y actualizadas

### `scripts/test_prompt_contracts.py`

Valida sin red:

- aislamiento de los dos casos de Roberto;
- fallback de nivel/caso;
- propagación frontend → sesión → prompt;
- rúbricas compatibles y pesos correctos;
- reglas de recuperación y cierre de Sofía;
- formato opaco del control interno;
- eliminación de controles y preguntas adicionales;
- refuerzo de métricas y punto ciego con evidencia explícita.

### `scripts/test_roberto_sales_cases.py`

Prueba cuatro conductas:

1. entrega gradual de datos en descubrimiento;
2. freno a una presentación prematura;
3. continuidad del caso de objeciones sin repetir el descubrimiento;
4. aclaración ante una respuesta ambigua.

Soporta simulación determinista y `--live`.

### `scripts/test_sofia_recovery.py`

Prueba:

- frase truncada;
- contradicción;
- ambigüedad;
- control interno de ritmo.

Soporta simulación determinista, proxy Groq y ruta real `--gemini`.

### `scripts/test_pacing_policy.py`

Actualizado para el nuevo formato `<session_control>` y conserva pruebas de:

- bandas temporales;
- prioridad de tiempo/esfuerzo;
- cierre por marca o herramienta;
- fallbacks de duración;
- render de prompts.

### `scripts/test_sofia_long_alternate.py`

Ronda larga alternativa creada al final de la sesión:

- candidata Mariana Soto;
- Gerente de Operaciones en logística;
- 15 respuestas controladas;
- contradicción explícita;
- conflicto minimizado;
- falta de métricas;
- prioridades sin criterio completo;
- control interno real;
- cierre y diagnóstico final.

Este archivo fue creado después del segundo commit y debe incluirse en el
siguiente commit de documentación/pruebas.

---

## 7. Resultados de las rondas reales

### 7.1 Roberto con modelo real

Resultado: **4/4 conductas aprobadas**.

Hallazgo durante la iteración: el primer prompt de descubrimiento respondió a
una presentación prematura con una objeción de implementación. Se reforzó la
prioridad del módulo de caso y la repetición posterior pasó.

### 7.2 Sofía — ronda Daniel Reyes

Primera ronda larga:

- Gemini 2.5 Flash;
- una clave se agotó en el intercambio 8;
- se confirmó posteriormente que existía `GEMINI_API_KEY2` sin guion bajo.

Hallazgos:

- buena recuperación de frase truncada;
- varias preguntas por turno;
- permanencia excesiva en una historia;
- omisión de falta de métricas en el diagnóstico.

Segunda ejecución con la otra clave:

- llegó a 15 intercambios;
- Gemini inventó y verbalizó notas de tiempo;
- hubo respuestas vacías ante silencios;
- el diagnóstico detectó “nosotros”, pero seguía perdiendo métricas.

Estos hallazgos originaron el segundo commit.

### 7.3 Sofía — pruebas focalizadas posteriores

Ruta real Gemini texto:

- truncado: aprobado;
- contradicción: aprobado;
- ambigüedad: aprobado;
- control interno invisible: aprobado;
- una pregunta visible por respuesta: aprobado.

Resultado: **4/4**.

También se verificó el failover: una clave devolvió `504` y el sistema continuó
con la siguiente.

### 7.4 Sofía — ronda alternativa Mariana Soto

Resultado automático: **TODO VERDE**.

Comportamientos confirmados:

- cero respuestas vacías;
- cero controles internos visibles;
- máximo una pregunta por turno;
- contradicción detectada y aclarada;
- transición de cierre;
- cierre mediante herramienta;
- falta de métricas incluida en gaps;
- tendencia “nosotros/yo” incluida como punto ciego;
- failover de Gemini ante `429`.

Observaciones cualitativas aún abiertas:

1. Sofía repitió varias veces la solicitud de contar una historia de conflicto.
2. Gemini produjo énfasis Markdown (`*ese*`, `*tú*`) en un turno; la regla de
   texto plano debe seguir vigilándose, especialmente por voz.
3. El diagnóstico usó como evidencia de liderazgo “Yo hablé con él…”, aunque la
   candidata contradijo después esa afirmación. La evidencia contradicha debe
   excluirse o marcarse como no confiable.
4. La fortaleza de comunicación quedó algo sobreinterpretada.
5. Gestión de prioridades se exploró, pero con menor profundidad que conflicto
   y resultados.

Por estas razones, “verde” significa que pasa los contratos automatizados
actuales; no significa que toda decisión cualitativa del LLM sea perfecta.

---

## 8. Validación acumulada

- Compilación Python: aprobada.
- Contratos de prompt/diagnóstico: aprobados.
- Recuperación determinista de Sofía: 4/4.
- Recuperación real con Gemini texto: 4/4.
- Política de duración: todo aprobado.
- Casos de Roberto deterministas: 4/4.
- Casos de Roberto con modelo real: 4/4 en la ronda ejecutada.
- Build TypeScript/Vite de producción: aprobado.
- `git diff --check`: aprobado antes de cada commit.

Advertencias no bloqueantes del frontend:

- `caniuse-lite` desactualizado;
- bundle principal mayor a 500 kB.

---

## 9. Archivos principales modificados

### Backend

- `menteviva-backend/app/prompts/entrevistador.py`
- `menteviva-backend/app/prompts/entrevistador_prompt.md`
- `menteviva-backend/app/prompts/roberto.py`
- `menteviva-backend/app/prompts/roberto_caso_descubrimiento.md`
- `menteviva-backend/app/prompts/roberto_caso_objeciones.md`
- `menteviva-backend/app/prompts/scenarios.py`
- `menteviva-backend/app/routers/chat_text.py`
- `menteviva-backend/app/routers/conversation.py`
- `menteviva-backend/app/services/analysis.py`
- `menteviva-backend/app/services/gemini_live.py`

### Frontend

- `menteviva-frontend/src/pages/Briefing.tsx`
- `menteviva-frontend/src/pages/Simulation.tsx`
- `menteviva-frontend/src/pages/VoiceLab.tsx`
- `menteviva-frontend/src/stores/sessionStore.ts`

### Pruebas

- `menteviva-backend/scripts/test_prompt_contracts.py`
- `menteviva-backend/scripts/test_roberto_sales_cases.py`
- `menteviva-backend/scripts/test_sofia_recovery.py`
- `menteviva-backend/scripts/test_sofia_long_alternate.py`
- `menteviva-backend/scripts/test_pacing_policy.py`

---

## 10. Riesgos y pendientes

### Pendiente crítico de QA

Ejecutar una entrevista humana completa con Gemini Live por voz para validar:

- naturalidad acústica;
- latencia entre fin de voz y primera respuesta;
- robotización o cortes de audio;
- interrupciones/barge-in;
- texto plano hablado sin Markdown;
- una sola pregunta audible;
- cierre real en dos turnos;
- cero lectura de controles internos.

### Pendientes cualitativos

- Evitar repetir una solicitud de historia ya respondida parcialmente.
- Invalidar citas que el candidato contradiga más adelante.
- Revisar que strengths y gaps utilicen la competencia correcta.
- Asegurar cobertura equilibrada de competencias foco.
- Repetir rondas largas con distintas personas y temperaturas para medir
  consistencia, no solo un resultado favorable.

### Cuotas y configuración

- El `.env` admite `GEMINI_API_KEY`, `GEMINI_API_KEY2` y las variantes con guion
  bajo mediante alias.
- El pool de Gemini realiza rotación y failover ante `429`, `5xx`, timeout y
  errores de autenticación.
- El prompt maestro de texto puede exceder el límite gratuito de 8k TPM de
  `openai/gpt-oss-20b`; las pruebas largas de conducción usan el prompt conciso
  de Gemini texto.

### Seguridad operativa

Durante una validación previa, un error de configuración imprimió una credencial
del servicio de avatar en la salida de terminal. No se copió a código ni a esta
documentación. Se recomienda rotar `AVATAR_SERVICE_TOKEN` si aún no se hizo.

---

## 11. Siguiente paso recomendado

1. Commit de este documento, su changelog y
   `scripts/test_sofia_long_alternate.py`.
2. QA humana por voz con guion adversarial equivalente al de Mariana.
3. Registrar transcript, tiempos y condición exacta de cierre.
4. Corregir únicamente los hallazgos reproducibles.
5. Abrir PR hacia `main` cuando voz y texto pasen la misma batería funcional.

