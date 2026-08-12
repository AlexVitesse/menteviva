# 2026-07-16 — Fix: pinnear la API key de Gemini durante el resume de sesión Live

## Síntoma
Durante el smoke del avatar OSS, la sesión de voz (Gemini Live) del entrevistador
caía a los ~15 s con `1006 abnormal closure` y, al reintentar la reconexión,
moría con:

```
google.genai.errors.APIError: 1008 None. Session does not belong to this project
```

El usuario percibía que "Sofía saludaba pero la conversación no seguía".

## Causa raíz
El handle de `session_resumption` que emite Gemini está atado al **proyecto de
Google de la API key** con que se abrió la sesión. El pool de keys
(`gemini_live.py::_next_gemini_key`, round-robin igual que GroqPool) tiene keys de
**proyectos distintos**. El loop de reconexión en
`routers/conversation.py::_run_gemini_conversation` reabría
`open_session(..., resume_handle=...)` en cada vuelta, y cada `open_session`
llamaba `_gemini_client()` → `_next_gemini_key()` → **rotaba a otra key/proyecto**.
Reconectar con el `resume_handle` de un proyecto usando la key de OTRO proyecto ⇒
`1008 Session does not belong to this project`. La reconexión nunca podía
funcionar con ≥2 keys de proyectos distintos.

## Fix
Pinnear la key durante la vida de una sesión: rotar solo en la **apertura
inicial** (balanceo de carga, deseable), y en los **resume** reusar la MISMA key.

- **`app/services/gemini_live.py`**
  - `_gemini_client(http_options=None, api_key=None)`: si se pasa `api_key`, la
    usa; si no, rota el pool (`_next_gemini_key`).
  - `GeminiLiveSession.__init__(..., api_key=None)`: expone `self.api_key` (la key
    con que se abrió la sesión).
  - `open_session(..., api_key=None)`: elige la key UNA vez (`api_key or
    _next_gemini_key()`), construye el cliente con ella y la propaga al
    `GeminiLiveSession` cedido.
- **`app/routers/conversation.py`** (`_run_gemini_conversation`): nueva variable
  `pinned_key`. Se pasa `api_key=pinned_key` a `open_gemini_session` (None en la
  1ª apertura ⇒ rota) y tras cada sesión se captura `pinned_key = live.api_key or
  pinned_key`, junto al `resume_handle`. Las reconexiones reusan esa key.

## Por qué es seguro
- 1ª apertura sigue rotando (balanceo intacto).
- Con 1 sola key o keys del mismo proyecto: pinnear es no-op / inocuo.
- La reconexión ya estaba **rota** al rotar (daba 1008); pinnear solo puede
  mejorarla. Si la key pinneada agota cuota a mitad, el resume falla — pero eso ya
  pasaba (y el handle es de ese proyecto de todos modos).

## Verificación
- `poetry run python -c "import app.services.gemini_live, app.routers.conversation"`
  → importa OK; firmas nuevas presentes (`api_key` en las 3).
- Backend recarga (uvicorn `--reload`) y queda healthy en `:8000`.
- **Pendiente de E2E**: confirmar en vivo que una reconexión (go_away / caída
  transitoria) ya NO da 1008. Requiere una key válida de un solo proyecto —
  el usuario está revisando que `GEMINI_API_KEY` sea una `AIza…` válida (la actual
  `AQ.Ab8…` no es una API key estándar de Gemini y es sospechosa del `1006`).

## Nota (fuera de este fix, para seguimiento)
El `1006 abnormal closure` a los ~15 s es un problema aparte (probablemente la
`GEMINI_API_KEY` con formato no estándar / token expirable). El pin de key evita
que el reintento muera con 1008, pero la causa del corte inicial se resuelve por
el lado de las credenciales.
