# Decisión: el proveedor alterno es Gemini, no OpenAI

**Fecha:** 2026-09-18
**Tipo:** decisión de arquitectura (sin cambio de código)
**Alcance:** `docs/TODO_PILOTO.md` §1.1, `docs/plans/02_tts_swap_openai.md`

---

## Qué se decidió

El plan del piloto traía desde mayo un pendiente P1.1: **"TTS swap a OpenAI"**,
justificado sólo por precio (~6× más barato que ElevenLabs).

**Decisión del usuario: no nos vamos por OpenAI. De momento usamos Gemini.**

## Por qué tiene sentido técnicamente

No es sólo preferencia de proveedor — evita meter un tercer stack al backend:

- `google-genai` **ya es dependencia** (entró con Gemini Live, rama
  `feature/gemini-live-voice`).
- El pool de 4 llaves `GEMINI_API_KEY` .. `GEMINI_API_KEY_4` **ya existe** en
  `app/config.py`, con la misma lógica de rotación que el pool de Groq.
- Ya hay un `gemini_model_text` (`gemini-2.5-flash`) en uso.

Contra eso, OpenAI habría significado key nueva, SDK adicional y un cuarto lugar
donde vigilar cuota y costo. Nota: `app/services/openai_llm.py` **existe y se
queda** — es un proveedor de comparación del ChatLab (`chat_text.py`), no el
camino de producción. Esta decisión no lo toca.

## Qué NO cambia

- **ElevenLabs sigue siendo el default** hasta que el swap se implemente y se
  valide. Nada se rompió hoy.
- **El path realtime no se toca.** Gemini Live emite audio nativo y no pasa por
  `edge_tts.py`. El swap aplica sólo al pipeline clásico
  (`conversation.py` → `text_to_speech` / `text_to_speech_stream`).
- El dispatcher + fallback descritos en el plan 02 siguen siendo el diseño
  correcto; sólo cambia el proveedor destino.

## Riesgo abierto

**El free tier de Gemini es por modelo y Gemini Live ya lo consume.** Antes de
poner `TTS_PROVIDER=gemini` por default en prod hay que medir la cuota real del
modelo de TTS. Si choca, el fallback a ElevenLabs deja de ser una red de
seguridad y se vuelve el camino normal — que es justo lo que se quería evitar.
Ver `memory/gemini_quota_y_replay.md`.

## Archivos tocados

- `docs/TODO_PILOTO.md` — §1.1 reescrito: "TTS swap a Gemini", checklist ajustado
  (sin `poetry add`, sin key nueva), alcance y riesgo de cuota explícitos.
- `docs/plans/02_tts_swap_openai.md` — banner `SUPERSEDED` al inicio. El cuerpo
  del plan se conserva: el diseño del dispatcher sigue vigente.
