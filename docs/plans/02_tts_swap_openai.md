# Plan: Swap TTS de ElevenLabs a OpenAI

**Motivacion:** OpenAI TTS cuesta $0.015 / 1k chars (vs $0.066–0.10 de ElevenLabs) y la concurrencia depende del usage tier de tu cuenta OpenAI (no de un plan rigido de 2–30 streams). Para 100 usuarios concurrentes en el piloto, OpenAI es ~6× mas barato y mas escalable.

## Estado actual

`menteviva-backend/app/services/edge_tts.py` (nombre legacy, ya documentado en CLAUDE.md) llama al SDK `elevenlabs` de Python. Routers importan `from app.services.edge_tts import text_to_speech`. Voces hardcoded en `AVATAR_VOICES = {avatar_id: elevenlabs_voice_id}`.

## Diseño propuesto

Mantener la firma del modulo y agregar un switch por env var:

```python
TTS_PROVIDER=openai   # default
TTS_PROVIDER=elevenlabs  # fallback rapido
```

Asi podemos volver a EL en 1 cambio de env si la calidad de OpenAI no convence.

### Firma estable

`text_to_speech(text: str, avatar_id: str) -> bytes` devuelve MP3 (formato que ya espera el frontend, no cambia nada en el cliente).

### Voces OpenAI (6 estandar)

| OpenAI voice | Genero | Recomendado para |
|---|---|---|
| `alloy` | Neutral/F | Sofia (diagnostico) |
| `nova` | F joven | Maria (Compras) |
| `shimmer` | F madura | (reserva feminine) |
| `onyx` | M profundo | Roberto (Director) |
| `echo` | M neutro | (reserva masculine) |
| `fable` | M britanico | (no usar — acento extranjero) |

## Pasos de implementacion

### Paso 1 — Dependencias

```bash
cd menteviva-backend
poetry add openai
# Si ya esta agregado (revisar pyproject.toml), skip.
```

`.env` agrega:
```
TTS_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### Paso 2 — Refactor de `app/services/edge_tts.py`

Estructura nueva (simplificada):

```python
"""TTS service. Soporta OpenAI (default) y ElevenLabs (fallback)."""
import logging
from openai import OpenAI
from elevenlabs.client import ElevenLabs
from app.config import settings

logger = logging.getLogger("menteviva")

# Mapeo avatar -> voice id por provider.
AVATAR_VOICES = {
    "openai": {
        "entrevistador": "alloy",   # Sofia
        "sofia": "alloy",
        "roberto": "onyx",
        "maria": "nova",
        "carlos": "echo",
    },
    "elevenlabs": {
        "entrevistador": "<eleven_voice_id_sofia>",
        "roberto": "<eleven_voice_id_roberto>",
        "maria": "<eleven_voice_id_maria>",
        # ... (los actuales que ya viven en este archivo)
    },
}

_openai_client: OpenAI | None = None
_eleven_client: ElevenLabs | None = None

def _get_openai() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client

def _get_eleven() -> ElevenLabs:
    global _eleven_client
    if _eleven_client is None:
        _eleven_client = ElevenLabs(api_key=settings.elevenlabs_api_key)
    return _eleven_client


async def text_to_speech(text: str, avatar_id: str) -> bytes:
    provider = settings.tts_provider  # "openai" | "elevenlabs"
    voice = AVATAR_VOICES.get(provider, {}).get(avatar_id)
    if not voice:
        logger.warning(f"[TTS] avatar={avatar_id} sin voz mapeada en provider={provider}; uso fallback")
        voice = "alloy" if provider == "openai" else next(iter(AVATAR_VOICES["elevenlabs"].values()))

    if provider == "openai":
        return await _tts_openai(text, voice)
    return await _tts_elevenlabs(text, voice)


async def _tts_openai(text: str, voice: str) -> bytes:
    client = _get_openai()
    # tts-1: rapido, $15/1M chars. tts-1-hd mas calidad y $30/1M.
    # Probar primero tts-1; subir a tts-1-hd si la calidad no alcanza.
    resp = client.audio.speech.create(
        model="tts-1",
        voice=voice,         # alloy/echo/fable/onyx/nova/shimmer
        input=text,
        response_format="mp3",
        speed=1.0,
    )
    # OpenAI SDK devuelve un HttpResponse con .content como bytes.
    return resp.content


async def _tts_elevenlabs(text: str, voice_id: str) -> bytes:
    client = _get_eleven()
    audio_stream = client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id="eleven_flash_v2_5",
        output_format="mp3_44100_128",
    )
    return b"".join(audio_stream)
```

### Paso 3 — Config (`app/config.py`)

Agregar a la clase `Settings` (pydantic-settings):

```python
tts_provider: Literal["openai", "elevenlabs"] = "openai"
openai_api_key: str = ""
```

### Paso 4 — Tests

Script de humo: `menteviva-backend/scripts/test_tts.py`

```python
import asyncio
from app.services.edge_tts import text_to_speech

async def main():
    for avatar in ["sofia", "roberto", "maria"]:
        audio = await text_to_speech(f"Hola, soy {avatar}.", avatar)
        path = f"/tmp/tts_{avatar}.mp3"
        with open(path, "wb") as f:
            f.write(audio)
        print(f"  {avatar}: {len(audio)} bytes -> {path}")

asyncio.run(main())
```

```bash
cd menteviva-backend
TTS_PROVIDER=openai poetry run python -m scripts.test_tts
# Abrir /tmp/tts_*.mp3 y verificar calidad/idioma/genero.
```

Comparar luego con `TTS_PROVIDER=elevenlabs` para A/B.

### Paso 5 — Validacion humana

- Sesión de 5 minutos en `/diagnostico` con OpenAI → escuchar a Sofía completa.
- Sesión de 5 minutos en `/simulation` con Roberto (Onyx) y Maria (Nova).
- Criterios para aprobar: pronunciacion correcta en espanol, sin acento extranjero raro, latencia ≤500 ms TTFB, sin glitches.

### Paso 6 — Default a OpenAI + dejar EL como fallback

Si la validacion pasa:
- `.env` y `.env.example` por default: `TTS_PROVIDER=openai`.
- Mantener `ELEVENLABS_API_KEY` en `.env` para poder revertir con un env-flip.
- (Opcional) anadir alerta en log si `_tts_openai` tira error y caer al EL automaticamente:

```python
try:
    return await _tts_openai(text, voice_openai)
except Exception as e:
    logger.error(f"[TTS] OpenAI fallo, fallback a EL: {e}")
    return await _tts_elevenlabs(text, voice_eleven)
```

### Paso 7 — Cleanup

Si tras el piloto decidimos no volver a EL:
- `poetry remove elevenlabs`
- Quitar las ramas EL del dispatcher.
- Renombrar `edge_tts.py` a `tts.py` finalmente (era un nombre legacy de cuando usabamos Microsoft Edge TTS, despues EL, ahora OpenAI).

## Riesgos / mitigaciones

| Riesgo | Mitigacion |
|---|---|
| Calidad de OpenAI voices en espanol no convence | Plan B: `TTS_PROVIDER=elevenlabs` con un env-flip, sin redeploy de codigo |
| Latencia mayor de OpenAI vs EL (OpenAI ~400ms TTFB, EL ~300ms) | Aceptable para nuestro flujo turn-based. Si fuera critico, considerar Cartesia Sonic (~90ms) |
| Rate limit de OpenAI en tier 1 (100 req/min) | Subir a tier 2 cargando $50; tier 2 = 500 RPM = 8/s, suficiente para piloto |
| Streaming chunks: OpenAI no soporta WS streaming nativo (devuelve MP3 completo) | El frontend ya consume `assistant_audio` como blob completo, no chunked. Compatible 1:1 |
| Voces fijas (no clonadas) | No relevante para piloto. Si Mente Viva necesita voces propias luego, evaluar Cartesia (clona) o EL |

## Esfuerzo estimado

- Refactor `edge_tts.py` + config: **30 min**
- Test script + A/B: **30 min**
- Validacion humana: **15 min**
- Cleanup post-validacion: **10 min**

**Total: ~1.5 hrs** de un dev.
