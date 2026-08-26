# 2026-08-26 — Celeste: avatar de ventas alterno a Roberto, disponible en labs

## Por qué

Roberto (CAT-01 Ventas) no terminaba de convencer. Brandon armó y validó a mano
un GEM de Gemini con otro enfoque de venta —"Celeste Vargas", clienta difícil que
se calibra al rubro que traiga el vendedor— y pidió tenerlo en los labs **junto**
a Roberto para que el equipo compare los dos con el mismo motor y el mismo nivel.

Fuentes (Downloads, no versionadas):
- `MenteViva_GEM_GEMINI_Ventas_Instructions (2).txt` → el system prompt (portado).
- `MenteViva_GEM_GEMINI_Ventas_Config (2).docx` → la guía de armado del GPT.
- `MenteViva_CAT01_Cientifico_.docx` → el "Knowledge" del GEM (diálogos modelo de
  los 3 niveles + ejemplos de las 8 técnicas). **No se portó** — ver Pendientes.

## Qué se hizo

**Backend**

- `app/prompts/celeste.md` — port del prompt del GEM (~8k chars). Cambios frente
  al original:
  - El Paso 0 pregunta **4** datos, no 5: el nivel lo manda la plataforma (el
    selector del ChatLab), así que se le prohíbe preguntarlo.
  - Marcador `{{NIVEL}}`: al modelo le llega solo el bloque de su nivel, no los
    tres.
  - Regla anti-acotaciones narrativas (la tiene Roberto; el GEM no la necesitaba
    pero Groq/Gemini sí las emiten).
  - El feedback final se acota a ~500 palabras y termina con `[CIERRE]`, igual
    que Sofia, para que el lab marque la sesión como cerrada. La marca va dentro
    de la plantilla de salida, no como instrucción suelta al final (ver Auditoría).
  - **Precedencia explícita regla 3 > regla 2**: bajar el precio NO resuelve la
    objeción de precio, así que no avanza a la siguiente. Sin esa línea el modelo
    trataba el descuento como objeción resuelta y pasaba a "confianza" — se
    reprodujo en el test antes de agregarla.
- `app/prompts/celeste.py` — `get_celeste_prompt(level)`: sustituye `{{NIVEL}}`
  por el bloque de principiante/intermedio/avanzado. Nivel inválido → principiante.
- `app/prompts/scenarios.py` — entrada `celeste` en `AVATARS`
  (`kind="practica"`, `supports_levels=True`, `lab_only=True`) y su rama en
  `get_system_prompt()`. `get_all_avatars()` gana el parámetro `include_lab_only`
  para que el avatar exista en el banco sin salir al catálogo del piloto.
- `app/services/edge_tts.py` — voz de Celeste (comparte la de María por ahora).
- `app/services/analysis.py` — `KPIS_BY_SCENARIO["celeste"]`. Los 6 KPIs del GEM
  son **idénticos en id, nombre y peso** a los de María (mismo marco), así que se
  reusa esa definición y solo cambia el `scenario_type`.

**Frontend**

- **Cero cambios necesarios para los labs**: el ChatLab arma la lista desde
  `/api/chat/avatars` y ya muestra el selector de nivel para cualquier avatar con
  `supports_levels`. Es chat de texto, no dibuja avatar.
- `AnimatedAvatar.tsx` — nuevo helper `avatarCharacterFor(avatarId)`. Los tres
  call sites que mapeaban avatar→cuerpo SVG a mano (`AvatarCard`, `Briefing`,
  `Simulation`) caían al fallback masculino ante cualquier id nuevo. Con
  `lab_only` ya no es urgente, pero deja el mapeo en un solo lugar para el día
  que Celeste (o cualquier otra) salga al catálogo.

**Test**

- `scripts/test_celeste.py`. Dos capas:
  - Sin LLM (`--assembly-only`): `{{NIVEL}}` sustituido y sin filtrar los otros
    niveles · nivel inválido cae a principiante · Celeste visible en el banco y
    NO en el catálogo de producción · el post-proceso no mutila el feedback.
  - Conducta, 4 llamadas a Groq: Paso 0 no pregunta el nivel · descuento
    prematuro → castiga el margen · avanzado no acepta el primer cierre ·
    "Fin" → feedback completo con `[CIERRE]`. Más las reglas absolutas
    (≤3 oraciones, ≤1 pregunta, sin fuga de IA, sin acotaciones), que ahora solo
    se aplican **en personaje**: el Paso 0 y el feedback son bloques largos y
    legítimamente fuera de personaje. Pausa de 30 s entre escenarios (8k TPM) y
    transcripción completa a `logs/test_celeste.txt`.

Resultado: `ensamblado=OK | conducta 4/4`. `test_prompt_contracts` sigue en verde
y `npm run build` (el type-check del frontend) pasa.

**Archivos tocados**

| Archivo | Qué |
|---|---|
| `app/prompts/celeste.md` | nuevo — prompt del avatar |
| `app/prompts/celeste.py` | nuevo — ensamblado por nivel |
| `scripts/test_celeste.py` | nuevo — harness |
| `app/prompts/scenarios.py` | alta del avatar + `include_lab_only` |
| `app/services/analysis.py` | rúbrica de 6 KPIs |
| `app/services/edge_tts.py` | voz |
| `app/services/groq_llm.py` | `max_tokens` 500 → 3000 (ver Auditoría) |
| `app/routers/chat_text.py` | regex de acotaciones + endpoint del banco |
| `src/components/avatar/AnimatedAvatar.tsx` | helper `avatarCharacterFor` |
| `AvatarCard.tsx` · `Briefing.tsx` · `Simulation.tsx` | usan el helper |

## Auditoría posterior — 3 defectos encontrados y corregidos

La primera versión pasaba sus tests pero nunca ejercitó el turno de feedback, que
es justo lo que el equipo compara contra el GEM. Al probarlo end-to-end:

1. **El feedback salía vacío.** `groq_llm.chat_complete` tenía `max_tokens=500` y
   gpt-oss-20b es un modelo de razonamiento: sus tokens de reasoning se descuentan
   del mismo cap. Medido: `finish_reason=length`, `completion_tokens=500`,
   2179 chars de razonamiento y **0 de contenido**. El caller lo trataba como
   turno vacío y devolvía una frase de re-enganche de Sofía — fuera de personaje
   y sin ningún feedback. Con 2000 el mismo turno da `finish_reason=stop` y 3112
   chars de feedback real.
   → Cap a **3000** (razonamiento + el feedback más largo observado; con el
   prompt de ~2.5k sigue bajo los 8k TPM del free tier). Solo afecta al banco:
   producción va por `chat_stream`, que conserva su límite de 500.

2. **El post-proceso destrozaba el feedback.** La regla anti-acotaciones de
   `chat_text._strip_stage_directions` (`\*...\*`) casaba dentro del `**negrita**`
   de Markdown. En una corrida real borró 219 chars y dejó las líneas como
   `- * *: 5/10` — sin el nombre del KPI. Ahora el patrón exige asterisco
   **simple** a ambos lados, así que `*asiente*` se sigue limpiando y
   `**KPI-1 …**` sobrevive.

3. **Celeste era alcanzable desde producción.** `get_all_avatars()` lista todo
   `kind="practica"`, así que aparecía en el catálogo del Dashboard y un tester
   del piloto podía entrar por voz a un flujo sin probar (sin selector de nivel,
   sin texto de escenario y con el feedback Markdown leído literal por el TTS).
   → Nueva marca `lab_only` en el avatar y parámetro `include_lab_only` en
   `get_all_avatars()`; solo `/api/chat/avatars` la pide.

Además, dos ajustes que salieron de lo anterior:

- El feedback se truncaba a media palabra aun con cap 2000, y por eso perdía el
  `[CIERRE]` final (no era que el modelo lo ignorara). Se acotó el informe a
  ~500 palabras y el `[CIERRE]` ahora vive dentro de la plantilla de salida, no
  solo en una instrucción al final.
- `test_celeste.py` reconfigura stdout a UTF-8 y vuelca la transcripción a
  `logs/`: la consola cp1252 de Windows reventaba al imprimir el feedback
  (`U+2011`), matando el script después de haber gastado la cuota.

## Cómo correr la comparativa

1. ChatLab (`/chat-lab`) → selector de avatar → **Celeste Vargas** → nivel.
   Celeste no aparece en el Dashboard del piloto: es solo del banco.
2. Celeste abre con el Paso 0 (qué vendes, a quién, precio, etapa). Roberto no
   pregunta nada: su contexto de manufactura Cóndor es fijo. Esa es justamente
   la diferencia de enfoque a evaluar.
3. La misma conversación con Roberto en otra sesión, **mismo motor y mismo
   nivel** = comparativa manzanas con manzanas.
4. Escribe "Fin" para disparar el feedback de los 6 KPIs y cerrar la sesión.

Todo queda en Neon (`chatlab_conversations`) con el transcript completo, así que
la comparación se puede revisar después sin repetirla.

```bash
cd menteviva-backend
poetry run python scripts/test_celeste.py                  # 4 llamadas al LLM (~2 min)
poetry run python scripts/test_celeste.py --assembly-only  # sin cuota
poetry run python scripts/test_celeste.py --level avanzado # un solo nivel
```

Un 429 al re-correr seguido es cuota del free tier de Groq, no un bug. La
transcripción completa de la última corrida queda en `logs/test_celeste.txt`.

## Pendientes / decisiones

- **Knowledge del GEM no portado.** El `.docx` científico son ~47k chars (~12k
  tokens) de diálogos modelo; con el prompt de Celeste (~2k tokens) revienta los
  8k TPM de Groq. Si más adelante se quiere, va como RAG o como recorte de los
  ejemplos de las 8 técnicas, no pegado al system prompt.
- **Promover Celeste a producción** (cuando la comparativa lo decida) es: quitar
  `lab_only`, agregarla a `AVATARS_WITH_LEVELS` y a los textos de escenario en
  `Briefing.tsx`, decidir qué hace el feedback largo en voz (probablemente
  delegarlo a `analysis.py` en vez de que lo dicte el avatar) y subir el
  `max_tokens` de `chat_stream` si se queda en el avatar.
- Celeste comparte la voz de María. Si conviven en una sesión de voz hay que
  darle una voz propia en `edge_tts.py::AVATAR_VOICES`.
