"""
Servicio de Text-to-Speech con Edge TTS y fallback a gTTS.

Edge TTS es gratuito pero a veces Microsoft bloquea peticiones (403).
gTTS (Google TTS) es el fallback - mas lento pero mas confiable.
"""

import logging
import asyncio
import io
import re
from typing import AsyncGenerator

import edge_tts
from gtts import gTTS

from app.config import settings

logger = logging.getLogger("menteviva")


def clean_text_for_tts(text: str) -> str:
    """
    Limpia el texto para TTS removiendo acciones entre parentesis.

    Ejemplos:
    - "(sonríe) Hola" -> "Hola"
    - "Bien (asiente con la cabeza)" -> "Bien"
    - "(pausa) Entonces... (piensa)" -> "Entonces..."
    """
    # Remover texto entre parentesis (acciones)
    cleaned = re.sub(r'\([^)]*\)', '', text)
    # Limpiar espacios multiples
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned.strip()

# Configuracion de reintentos para Edge TTS
MAX_RETRIES = 4  # Mas reintentos antes de fallback
RETRY_DELAY = 0.3  # segundos

# Voces Edge TTS (espanol Mexico)
AVATAR_VOICES_EDGE = {
    "roberto": "es-MX-JorgeNeural",
    "maria": "es-MX-DaliaNeural",
    "carlos": "es-MX-CecilioNeural",
}


async def text_to_speech(text: str, avatar_id: str = "roberto") -> bytes:
    """
    Convierte texto a audio. Intenta Edge TTS primero, luego gTTS como fallback.

    Args:
        text: Texto a convertir
        avatar_id: ID del avatar para seleccionar voz

    Returns:
        Audio en bytes (MP3)
    """
    # Limpiar texto (remover acciones entre parentesis)
    clean_text = clean_text_for_tts(text)
    if not clean_text:
        logger.warning("[TTS] Texto vacio despues de limpieza, usando original")
        clean_text = text

    # Intentar Edge TTS primero
    audio = await _try_edge_tts(clean_text, avatar_id)
    if audio:
        return audio

    # Fallback a gTTS (ADVERTENCIA: voz generica, puede ser femenina)
    logger.warning("[TTS] Edge TTS fallo, usando gTTS - VOZ PUEDE NO COINCIDIR CON AVATAR")
    return await _gtts_fallback(clean_text)


async def _try_edge_tts(text: str, avatar_id: str) -> bytes | None:
    """Intenta generar audio con Edge TTS."""
    voice = AVATAR_VOICES_EDGE.get(avatar_id, settings.tts_voice)
    logger.debug(f"[TTS-Edge] Intentando - Voz: {voice}")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            communicate = edge_tts.Communicate(text, voice)
            audio_bytes = b""

            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_bytes += chunk["data"]

            if audio_bytes:
                logger.info(f"[TTS-Edge] OK ({len(audio_bytes)} bytes, intento {attempt})")
                return audio_bytes

        except Exception as e:
            logger.warning(f"[TTS-Edge] Error intento {attempt}: {type(e).__name__}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY * attempt)

    return None


async def _gtts_fallback(text: str) -> bytes:
    """Genera audio con gTTS (Google TTS) como fallback."""
    logger.debug(f"[TTS-gTTS] Generando audio ({len(text)} chars)")

    try:
        # gTTS es sincrono, lo ejecutamos en thread pool
        loop = asyncio.get_event_loop()
        audio_bytes = await loop.run_in_executor(None, _gtts_sync, text)
        logger.info(f"[TTS-gTTS] OK ({len(audio_bytes)} bytes)")
        return audio_bytes
    except Exception as e:
        logger.error(f"[TTS-gTTS] Error: {e}")
        raise Exception(f"TTS fallo completamente: {e}")


def _gtts_sync(text: str) -> bytes:
    """Funcion sincrona para gTTS."""
    tts = gTTS(text=text, lang="es", tld="com.mx")
    buffer = io.BytesIO()
    tts.write_to_fp(buffer)
    buffer.seek(0)
    return buffer.read()


async def text_to_speech_stream(
    text: str,
    avatar_id: str = "roberto"
) -> AsyncGenerator[bytes, None]:
    """Stream de audio usando Edge TTS."""
    voice = AVATAR_VOICES_EDGE.get(avatar_id, settings.tts_voice)
    communicate = edge_tts.Communicate(text, voice)

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            yield chunk["data"]
