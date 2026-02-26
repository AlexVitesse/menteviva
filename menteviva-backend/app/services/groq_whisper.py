"""
Servicio de Speech-to-Text usando Groq Whisper.

Groq ofrece Whisper de forma gratuita con limites generosos.
Modelo: whisper-large-v3-turbo
"""

import logging
from groq import Groq
from app.config import settings

logger = logging.getLogger("menteviva")

# Cliente de Groq (singleton)
client = Groq(api_key=settings.groq_api_key)
logger.debug(f"[STT] Cliente Groq Whisper inicializado - Modelo: {settings.groq_model_whisper}")


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """
    Transcribe audio usando Groq Whisper.

    Args:
        audio_bytes: Audio en bytes (webm, mp3, wav, etc.)
        filename: Nombre del archivo con extension para indicar formato

    Returns:
        Texto transcrito

    Raises:
        Exception: Si hay error en la transcripcion
    """
    transcription = client.audio.transcriptions.create(
        file=(filename, audio_bytes),
        model=settings.groq_model_whisper,
        language="es",
        response_format="text"
    )
    return transcription


async def transcribe_audio_with_details(
    audio_bytes: bytes,
    filename: str = "audio.webm"
) -> dict:
    """
    Transcribe audio con detalles adicionales.

    Args:
        audio_bytes: Audio en bytes
        filename: Nombre del archivo con extension

    Returns:
        Dict con texto y metadatos
    """
    transcription = client.audio.transcriptions.create(
        file=(filename, audio_bytes),
        model=settings.groq_model_whisper,
        language="es",
        response_format="verbose_json"
    )

    return {
        "text": transcription.text,
        "language": transcription.language,
        "duration": transcription.duration,
    }
