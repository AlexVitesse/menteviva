"""
Servicio de Text-to-Speech con ElevenLabs.

Cada avatar tiene su propia voz asignada por voice ID.
"""

import logging
import asyncio
import re

from elevenlabs import ElevenLabs

from app.config import settings

logger = logging.getLogger("menteviva")

MAX_RETRIES = 3
RETRY_DELAY = 0.5

# Voces ElevenLabs por avatar
AVATAR_VOICES = {
    "roberto": "htFfPSZGJwjBv1CL0aMD",       # Voz masculina
    "maria": "m7yTemJqdIqrcNleANfX",          # Voz femenina
    "carlos": "htFfPSZGJwjBv1CL0aMD",         # Voz masculina (misma que Roberto)
    "entrevistador": "m7yTemJqdIqrcNleANfX",  # Sofia - voz femenina (misma que Maria por ahora)
}

_client: ElevenLabs | None = None


def _get_client() -> ElevenLabs:
    """Lazy-init del cliente ElevenLabs."""
    global _client
    if _client is None:
        _client = ElevenLabs(api_key=settings.elevenlabs_api_key)
    return _client


def clean_text_for_tts(text: str) -> str:
    """
    Limpia el texto para TTS removiendo acciones entre parentesis.

    Ejemplos:
    - "(sonríe) Hola" -> "Hola"
    - "Bien (asiente con la cabeza)" -> "Bien"
    """
    cleaned = re.sub(r'\([^)]*\)', '', text)
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned.strip()


async def text_to_speech(text: str, avatar_id: str = "roberto") -> bytes:
    """
    Convierte texto a audio MP3 usando ElevenLabs.

    Args:
        text: Texto a convertir
        avatar_id: ID del avatar para seleccionar voz

    Returns:
        Audio en bytes (MP3)
    """
    clean_text = clean_text_for_tts(text)
    if not clean_text:
        logger.warning("[TTS] Texto vacio despues de limpieza, usando original")
        clean_text = text

    voice_id = AVATAR_VOICES.get(avatar_id, AVATAR_VOICES["roberto"])

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            audio_bytes = await _generate(clean_text, voice_id)
            logger.info(f"[TTS-ElevenLabs] OK ({len(audio_bytes)} bytes, intento {attempt})")
            return audio_bytes
        except Exception as e:
            logger.warning(f"[TTS-ElevenLabs] Error intento {attempt}: {type(e).__name__}: {e}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY * attempt)

    raise RuntimeError("ElevenLabs TTS fallo despues de todos los reintentos")


async def _generate(text: str, voice_id: str) -> bytes:
    """Genera audio en un thread para no bloquear el event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _generate_sync, text, voice_id)


def _generate_sync(text: str, voice_id: str) -> bytes:
    """Llamada sincrona al API de ElevenLabs."""
    client = _get_client()
    response = client.text_to_speech.convert(
        text=text,
        voice_id=voice_id,
        model_id=settings.elevenlabs_model,
        output_format="mp3_44100_128",
    )
    audio_bytes = b""
    for chunk in response:
        audio_bytes += chunk
    return audio_bytes
