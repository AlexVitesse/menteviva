# 2026-07-09 — Diagnóstico: la duración (25/40/60) ahora SÍ cambia la entrevista

**Rama:** `feature/chat-lab-prompt-bench`
**Origen:** observación del usuario — "creo que no tenemos bien el enfoque de la
duración, ya que usamos el mismo prompt maestro para los 'tiempos'".

## Diagnóstico

El selector de duración (25/40/60 min) en ChatLab era prácticamente decorativo:

- El frontend mandaba `session_vars.minutos` y calculaba `targetExchanges()`
  (~1 intercambio/3 min), pero eso solo alimenta **el denominador de la barra de
  progreso** (cosmético).
- El backend sustituía `{{minutos}}` → una sola línea del prompt
  (`DURACION_OBJETIVO_MIN: "25"`). El resto del prompt maestro era **idéntico** en
  los tres casos.
- El disparador **real** del fin de la charla es la regla `[CIERRE]`
  (`entrevistador_prompt.md`), que estaba **fija** en "al menos 2-3 historias con
  STAR sobre competencias distintas". Es un umbral de **contenido**, no de tiempo.

Consecuencia: una sesión de 25 min y una de 60 min cerraban con el mismo umbral
(2-3 competencias). Elegir 60 min no producía una entrevista más larga ni más
profunda — el mismo guion. El mapa de 5 fases usa **porcentajes** de tiempo, así
que escala solo; el problema era exclusivamente el umbral de cierre hardcodeado.

## Qué se cambió

Se derivó de la duración una **política de cobertura/profundidad** y se inyectó
en ambos prompts (maestro de texto y conciso de voz Gemini), parametrizando la
regla `[CIERRE]`.

Nueva función `build_duration_policy(minutos)` en `app/prompts/entrevistador.py`:

| Duración | `competencias_min` (piso antes de `[CIERRE]`) | target | Profundidad |
|---|---|---|---|
| ≤30 min | 2 | 2-3 | 1-2 repreguntas BEI/historia; amplitud > profundidad |
| 31-50 min | 3 | 3-4 | 2-3 repreguntas; persigue resultado concreto (números) |
| ≥51 min | 4 | 4-5 | sondeo profundo: acción individual, obstáculos, contraejemplo, resultado medible |

- **Prompt maestro** (`entrevistador_prompt.md`): la sección CIERRE ahora usa
  placeholders `{{competencias_min}}`, `{{competencias_target}}` y
  `{{politica_duracion}}` (nueva línea "RITMO SEGÚN DURACIÓN"). Los placeholders
  se llenan en `build_entrevistador_variables()`.
- **Prompt conciso de voz** (`_GEMINI_DIAGNOSTICO_TEMPLATE`): las líneas de
  cobertura y de CIERRE (`finalizar_entrevista`) ahora reciben la política vía
  `.format()`.
- Fallback defensivo: `minutos` vacío/inválido → 25 min (piso 2).

**No se tocó:** frontend (el selector y la barra ya mandaban `minutos`
correctamente), ni el mapa de 5 fases (sus porcentajes escalan solos), ni el
analizador de fin de sesión.

## Verificación

Nuevo `scripts/test_duracion_policy.py` (determinista, **sin** llamar a
Groq/Gemini — correr conversaciones reales para ver el `[CIERRE]` quemaría cuota
de Gemini, 20 req/día por modelo, y sería no determinista):

```bash
poetry run python -m scripts.test_duracion_policy   # -> RESULTADO: TODO OK
```

Comprueba que el piso de competencias escala 2→3→4, que no quedan placeholders sin
sustituir, y que los tres prompts (maestro y Gemini) son distintos entre sí.
Salida también en `logs/duracion_policy.txt`.
