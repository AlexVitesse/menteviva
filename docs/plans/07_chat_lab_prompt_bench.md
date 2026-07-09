# Plan 07 — ChatLab: banco de pruebas de prompts (solo texto) + mejoras

**Rama:** `feature/chat-lab-prompt-bench` · **Fecha:** 2026-07-07
**Origen:** herramienta interna para iterar prompts sin pasar por el pipeline de
voz (WebSocket + STT + TTS + análisis + DB). Este doc cubre qué es, cómo usarla
y las mejoras/fixes aplicados en esta sesión.

---

## A. Qué es el ChatLab

Pantalla aislada en `/chat-lab` (sin guard de onboarding, fuera del flujo de
producto) que ejercita el `system_prompt` de cada avatar contra el LLM real,
solo texto. Sirve para comparar prompts, proveedores y modelos turno a turno
sin gastar audio ni cuota de Gemini Live.

| Pieza | Dónde | Notas |
|---|---|---|
| UI | `menteviva-frontend/src/pages/ChatLab.tsx` | Sesiones múltiples persistidas en `localStorage`, export a Markdown, telemetría (chars del prompt, modelo, latencia, cierre) |
| Router REST | `menteviva-backend/app/routers/chat_text.py` | `GET /api/chat/avatars` + `POST /api/chat` (stateless: el cliente manda todo el historial cada turno). Si se borra el archivo y su `include_router`, el resto del producto sigue igual |
| Servicio OpenAI | `menteviva-backend/app/services/openai_llm.py` | Nuevo, solo lo usa el ChatLab. Requiere `CHATGPT_API_KEY` en `.env` |

### Motores (provider) y qué evalúa cada uno

| Provider | System prompt | Modelo default | Para qué |
|---|---|---|---|
| `groq` | Maestro (`get_system_prompt`) | `settings.groq_model_llm` (gpt-oss-20b) | Producción texto |
| `gemini` | **Maestro por default** (mismo que Groq/ChatGPT) para comparar motores manzanas con manzanas. El prompt conciso de voz (`GEMINI_VOICE_ADDENDUM`) es opt-in explícito con `use_voice_prompt=true`. Rota entre `GEMINI_API_KEY` + `GEMINI_API_KEY2..4` | `settings.gemini_model_text` | Comparar Gemini vs GPT con el mismo prompt |
| `chatgpt` | Maestro | `gpt-4o` (diagnóstico) / `gpt-4o-mini` (resto) | Vara de comparación externa (el north-star de Brandon corre en GPT) |

Cualquier provider acepta `model` en el request para forzar una variante
específica; la UI lo expone en el dropdown "Modelo Específico" y la respuesta
reporta `model_name` con lo que realmente corrió.

### Cierre de sesión

- `groq` / `chatgpt`: marca `[CIERRE]` en el texto (se limpia antes de mostrar).
- `gemini`: tool-call `finalizar_entrevista`, igual que en voz.

---

## B. Mejoras aplicadas en esta sesión (2026-07-07)

| # | Tipo | Cambio | Dónde |
|---|------|--------|-------|
| 1 | 🔴 Fix | **`settings` sin importar rompía todo el endpoint**: `chat_text.py` usaba `settings.groq_model_llm` / `settings.gemini_model_text` sin `from app.config import settings` → `NameError` en cualquier llamada con Groq o Gemini | `chat_text.py:24` |
| 2 | Feature | **Latencia por turno**: el router mide la llamada al LLM y devuelve `latency_ms`. La UI la muestra junto a cada burbuja del avatar, en telemetría (última / promedio de la sesión) y en el export Markdown | `chat_text.py` (`ChatResponse.latency_ms`), `ChatLab.tsx` |
| 3 | Fix | **Modelos retirados fuera del dropdown**: Gemini 1.5 flash/pro, `o1-mini`/`o3-mini` (OpenAI) y `deepseek-r1-distill-llama-70b` (dado de baja en Groq) solo iban a dar error. Entraron: `openai/gpt-oss-120b` (el del análisis), Gemini 2.5 Flash Lite / 2.0 Flash, GPT-4.1 / 4.1-mini | `ChatLab.tsx::PROVIDER_MODELS` |
| 4 | UX | **Aviso preventivo del 413**: con modelo llama seleccionado y prompt > 20k chars (~5k tokens), la telemetría avisa que el free tier de Groq (6k TPM) probablemente devuelva HTTP 413, en vez de fallar sin explicación | `ChatLab.tsx` (telemetría) |
| 5 | Docs | `CHATGPT_API_KEY` declarada en `.env.example` (la leía `openai_llm.py` pero no estaba documentada) | `menteviva-backend/.env.example` |
| 6 | Test | Smoke test siguiendo la convención del repo (escribe a `logs/chatlab_smoke.txt` porque stdout se traga en Windows). Acepta un modelo como argumento para probar el override | `scripts/test_chatlab_smoke.py` |

### Verificación realizada

```bash
cd menteviva-backend
poetry run python -m scripts.test_chatlab_smoke                          # default → gpt-oss-20b, 840 ms
poetry run python -m scripts.test_chatlab_smoke llama-3.3-70b-versatile  # override → 822 ms
# Ambas: Roberto saluda en personaje, model_name y latency_ms correctos.

cd menteviva-frontend && npm run build   # tsc sin errores
```

OJO: el smoke test pega al API real de Groq (1 request por corrida); re-correrlo
en ráfaga puede toparse con el 429 del free tier (cuota, no bug).

---

## B2. Fix de layout: input y mensajes siempre visibles (2026-07-08)

**Síntoma reportado:** para escribir había que hacer scroll de toda la página
hasta el input, y al hacerlo los mensajes quedaban fuera de vista.

**Causa raíz:** el contenedor raíz de `ChatLab.tsx` usaba `min-h-screen`, que
solo fija un mínimo — la página crecía más allá del viewport empujada por el
sidebar. El scroll vivía en el `body` (página completa) y no en el área de
mensajes, así que el auto-scroll al último mensaje (que ya existía sobre
`scrollRef`) no tenía efecto visible y el input quedaba bajo el pliegue.

**Fix (solo clases Tailwind en `ChatLab.tsx`, cero lógica):**

| Cambio | Clases | Efecto |
|---|---|---|
| Raíz anclada al viewport | `min-h-screen` → `h-screen h-dvh overflow-hidden` | Header arriba e input abajo siempre visibles; `h-dvh` corrige la barra dinámica del navegador móvil (Tailwind ≥ 3.4) |
| `min-h-0` en la cadena flex | workspace, `<main>` y área de mensajes | Sin esto los hijos flex no pueden encogerse y el `overflow-y-auto` interno nunca se activa (gotcha clásico de flexbox) |
| Sidebar acotado en móvil | `max-h-[45vh] lg:max-h-none` en el `<aside>` | En pantallas chicas (layout apilado) el sidebar scrollea por su cuenta en vez de tapar el chat |
| Footer más compacto | `p-6` → `px-6 py-4` | Más alto útil para mensajes |

Resultado: solo el área de mensajes scrollea, el auto-scroll ahora sí deja el
último mensaje a la vista y el input queda fijo abajo. Verificado con
`npm run build` (tsc + vite) sin errores.

---

## C. Diagnóstico end-to-end, persistencia y rotación de keys (2026-07-08)

Origen: el usuario probó el mismo caso (candidato "Eric", perfil consultor mid) en
**ChatGPT** (persona "Elena Ríos", prompt maestro inyectado — el north-star de
Brandon) y en **ChatLab con Gemini** (persona "Sofia"). El diagnóstico de Gemini
salía pobre y **sin reporte final**. El análisis reveló que **no era comparación
justa**: Gemini corría el prompt CONCISO de voz (~3k, deliberadamente pelado) y el
paso de diagnóstico (análisis) nunca se disparaba en el banco. Estos cambios cierran
esa brecha y hacen que el banco se comporte como el flujo de voz real.

### C1. Comparación justa de motores — prompt maestro por default

- **Antes:** `gemini + diagnostico` → prompt conciso de voz forzado (imposible
  evaluar Gemini con el prompt maestro desde el banco).
- **Ahora:** el banco corre el **prompt maestro** para todos los motores. El
  conciso de voz quedó como opt-in explícito (`use_voice_prompt=true`).
- Con el maestro, el cierre de Gemini se detecta por marcador `[CIERRE]` (como
  Groq/ChatGPT), no por el tool-call `finalizar_entrevista`.
- `chat_text.py`: campo `force_master_prompt` → reemplazado por `use_voice_prompt:
  bool = False`. UI: se quitó el toggle; ahora solo un aviso informativo.

### C2. Diagnóstico end-to-end (como en voz)

- Nuevo endpoint **`POST /api/chat/diagnostico`**: corre el MISMO analizador de
  producción (`analysis.generate_user_profile`, Groq gpt-oss-120b) sobre la
  conversación del banco. El diagnóstico NO depende del motor que condujo la
  charla — igual que en voz (Gemini conduce, Groq analiza).
- UI: botón **"🔬 Generar Diagnóstico"** + modal con resumen ejecutivo, fortalezas,
  áreas de oportunidad, blind spot, pregunta para llevarse, patrones verbales y
  recomendación. Botón "📄 Ver último diagnóstico" para reabrirlo.
- **Hallazgo clave:** con la charla de Gemini (superficial) el analizador honesto
  devuelve el sentinel *"No fue posible identificar un punto ciego"*. El cuello de
  botella de calidad NO es el analizador (es el mismo que GPT), es la **conducción**
  de la entrevista. Ver memoria `chatlab_diagnostico_bench` / `diagnostico_north_star_gpt`.

### C3. Persistencia en BD (como en voz)

- El endpoint de diagnóstico persiste diagnóstico + conversación en Postgres vía
  `user_repo` (mismas tablas `users`/`diagnostics` que producción), bajo un
  `user_id` sintético **`chatlab:<slug-nombre>`** — el prefijo aísla los datos de
  laboratorio de los usuarios reales del piloto (Firebase UID).
- Persistencia **no-fatal**: si la BD no responde, el diagnóstico se devuelve igual
  con `save_error`. La respuesta trae `saved` / `diagnostic_id` / `save_error` y la
  UI muestra "✓ Guardado (diagnostic_id=N)" o el error.
- **Onboarding en el panel derecho** (como el de voz): antes de arrancar la
  entrevista se piden nombre*, correo, rol, industria y nivel. Esos datos alimentan
  el `{{nombre}}`/`{{rol}}` del prompt y el diagnóstico.
- **Datos cacheados**: el registro se guarda en `localStorage` (`chatlab_registro`)
  y se prefila en cada sesión nueva — no hay que re-registrarse en cada prueba.

### C4. Rotación de API keys de Gemini

- `GEMINI_API_KEY` + `GEMINI_API_KEY2..4` rotan round-robin (thread-safe), igual
  que `GroqPool`, para repartir carga y estirar el free tier (20 req/día POR KEY
  POR MODELO). `config.gemini_api_keys` (property) + `gemini_live._next_gemini_key()`.
- Se aceptan ambas grafías del nombre: `GEMINI_API_KEY2` == `GEMINI_API_KEY_2`
  (vía `AliasChoices`). Documentado en `.env.example`.

### C5. Manejo de errores del proveedor — clasificación por tipo

`_classify_provider_error(e, provider)` en `chat_text.py` mapea el error crudo del
SDK (Gemini/genai, Groq, OpenAI usan textos distintos) a un `(status, mensaje claro)`.
**No hay fallback cruzado entre proveedores** — el motor elegido falla limpio, no se
sustituye por otro (eso invalidaría la prueba). Orden de clasificación:

| Tipo | HTTP | Mensaje (resumen) |
|---|---|---|
| Cuota / rate-limit (`RESOURCE_EXHAUSTED`, 429, quota) | 429 | Espera o cambia la API key (Gemini: 20/día por key por modelo) |
| Auth: key faltante/inválida/sin permiso (401, "api key", "no configurada") | 401 | Revisa la API key en `.env` |
| Prompt/TPM demasiado grande (413, "context length", "tokens per minute") | 413 | Usa un modelo con más cupo o acorta el prompt |
| Modelo inexistente/retirado (404, "does not exist", "decommissioned") | 400 | Prueba otro modelo del selector |
| Bloqueo por contenido / safety (típico Gemini) | 422 | Reformula el mensaje o cambia de modelo |
| Servidor caído / timeout / red (500/502/503, overloaded) | 503 | Reintenta en un momento |
| Cualquier otro | 502 | Detalle crudo (truncado, no se oculta) |

- **Respuesta vacía** (Gemini/OpenAI pueden devolver `""` por bloqueo o baja señal;
  Groq ya cae a re-enganche solo) → **HTTP 422** con aviso, salvo que sea un cierre
  válido (`closing=True`). Antes mostraba una burbuja en blanco.
- **UI**: además del recuadro en la telemetría del sidebar, ahora hay un **banner de
  error descartable en el área principal del chat** (visible aunque el sidebar esté
  colapsado). `apiFetch` propaga el `detail` como mensaje, así que el texto tal cual
  es el que ve el usuario.
- Verificado offline: los 8 tipos clasifican al status esperado (429/401/413/400/422/503/502).

### Verificación realizada (2026-07-08)

```bash
cd menteviva-backend
poetry run python -m scripts.test_chatlab_smoke   # 3 partes, pega a Groq + Gemini live
# A) Groq/Roberto greet OK
# B) Gemini/entrevistador default = maestro -> prompt_chars 26690 (no 3k) + rotación
# C) Diagnóstico gpt-oss-120b sobre la charla real Eric<->Sofia:
#    saved=True diagnostic_id=16, resumen ejecutivo + 2 strengths + 2 gaps con cita
cd menteviva-frontend && npm run build   # tsc sin errores
```

También verificado offline: `settings.gemini_api_keys` detecta las 2 keys (primary
+ `GEMINI_API_KEY2` vía alias); `_is_quota_error` clasifica bien 429/RESOURCE_EXHAUSTED
vs errores genéricos; el registro fluye a ambos prompts; la fila persistida se lee
de vuelta (`get_diagnostic`).

### Archivos tocados

| Archivo | Cambio |
|---|---|
| `app/routers/chat_text.py` | `use_voice_prompt` (maestro default), endpoint `/chat/diagnostico` + persistencia, manejo de cuota, user_profile tolerante a registro-only |
| `app/config.py` | `gemini_api_key_2/3/4` (alias con/sin guion) + property `gemini_api_keys` |
| `app/services/gemini_live.py` | `_next_gemini_key()` / `_gemini_client()` round-robin en ambos puntos de cliente |
| `app/services/analysis.py`, `user_repo.py` | (reusados, sin cambios) |
| `.env.example` | `GEMINI_API_KEY2..4` documentadas |
| `src/pages/ChatLab.tsx` | onboarding en panel derecho, registro cacheado en localStorage, botón + modal de diagnóstico, estado de guardado, aviso prompt maestro |
| `scripts/test_chatlab_smoke.py` | 3 partes (Groq greet, Gemini maestro, diagnóstico+persistencia sobre charla real) |

---

## D. Pendientes / ideas (no implementado)

- **Comparación lado a lado**: mismo historial contra dos motores a la vez — el
  siguiente salto de valor real para iterar prompts.
- Duplicar sesión (clonar historial + config para bifurcar una prueba).
- Devolver tokens consumidos (prompt/completion) además de chars del prompt.
- Streaming en la UI (hoy no hace falta: el banco no necesita TTFT visual).
