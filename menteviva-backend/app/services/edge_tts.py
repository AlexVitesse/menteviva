"""
Servicio de Text-to-Speech con ElevenLabs.

Cada avatar tiene su propia voz asignada por voice ID.

Dos entry points:
- text_to_speech(text, avatar_id): devuelve bytes MP3 completos (legacy).
- text_to_speech_stream(text, avatar_id): async generator que produce chunks
  MP3 conforme los emite ElevenLabs. Reduce first-byte-time perceptible para
  el usuario — Sofia/Roberto/etc empiezan a sonar antes de que se genere todo
  el audio.
"""

import logging
import asyncio
import re
from typing import AsyncIterator

from elevenlabs import ElevenLabs

from app.config import settings

logger = logging.getLogger("menteviva")

MAX_RETRIES = 3
RETRY_DELAY = 0.5

# Voces ElevenLabs por avatar
AVATAR_VOICES = {
    "roberto": "uPc5TJmLHicJAPs7qpif",        # Masculina
    "maria": "m7yTemJqdIqrcNleANfX",          # Femenina
    "carlos": "Rt1JHkPO27QCUX6Nd5bV",         # Masculina (distinta a Roberto)
    "entrevistador": "1vvbVDm3EpGMyY1WVZ3r",  # Sofia - Femenina (distinta a Maria)
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


async def text_to_speech_stream(
    text: str,
    avatar_id: str = "roberto",
) -> AsyncIterator[bytes]:
    """
    Streaming TTS con ElevenLabs /stream endpoint.

    Yields chunks MP3 conforme ElevenLabs los genera. El primer chunk llega
    tipicamente en <1s; el total es similar a convert() pero el usuario oye
    antes.

    No tiene retries: si el stream falla a medio camino, el cliente ya recibio
    chunks previos. Si falla antes del primer chunk, el asyncio raise se
    propaga al caller (conversation.py) para que envie assistant_audio_end
    limpio.
    """
    clean_text = clean_text_for_tts(text)
    if not clean_text:
        logger.warning("[TTS-Stream] Texto vacio despues de limpieza, usando original")
        clean_text = text

    voice_id = AVATAR_VOICES.get(avatar_id, AVATAR_VOICES["roberto"])

    loop = asyncio.get_event_loop()
    client = _get_client()

    def _open_stream():
        # ElevenLabs SDK v1.x: convert_as_stream usa el endpoint /stream con
        # menor TTFB. (El metodo que se llama solo .stream() no existe en
        # esta version del SDK, era convert_as_stream desde el inicio.)
        return client.text_to_speech.convert_as_stream(
            text=clean_text,
            voice_id=voice_id,
            model_id=settings.elevenlabs_model,
            output_format="mp3_44100_128",
        )

    stream_iter = await loop.run_in_executor(None, _open_stream)

    def _next_chunk(iterator) -> bytes | None:
        try:
            return next(iterator)
        except StopIteration:
            return None

    chunk_count = 0
    total_bytes = 0
    while True:
        chunk = await loop.run_in_executor(None, _next_chunk, stream_iter)
        if chunk is None:
            break
        if not chunk:  # skip empty bytes
            continue
        chunk_count += 1
        total_bytes += len(chunk)
        yield chunk

    logger.info(f"[TTS-Stream] Completo: {chunk_count} chunks, {total_bytes} bytes")
