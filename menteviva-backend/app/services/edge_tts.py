"""
Servicio de Text-to-Speech. Dos proveedores, seleccionables con TTS_PROVIDER:

- "elevenlabs" (default): MP3, con streaming real (TTFB <1s).
- "gemini": PCM16 24kHz que envolvemos en WAV. Reusa el pool de
  GEMINI_API_KEY* de gemini_live.py — no hay key ni SDK nuevos.
  Decision 2026-09-18: el alterno es Gemini, NO OpenAI
  (ver docs/changelog/2026-09-18_decision_tts_gemini_no_openai.md).

Cada avatar tiene su propia voz: `AVATAR_VOICES` (voice IDs de ElevenLabs) y
`gemini_live.GEMINI_VOICES` (voces prebuilt de Google, ya validadas por escucha).

**El formato de salida cambia con el proveedor**, asi que el WS manda
`mime` en `assistant_audio_start` y el front arma el Blob con eso. Si agregas un
proveedor, actualiza `output_mime()`.

Dos entry points:
- text_to_speech(text, avatar_id): bytes completos (legacy).
- text_to_speech_stream(text, avatar_id): async generator de chunks. Con
  ElevenLabs son chunks reales conforme se generan; con Gemini es un solo
  bloque al final (ver _gemini_stream).

Ambos caen a ElevenLabs si Gemini falla, para que el avatar nunca quede mudo.
"""

import asyncio
import io
import logging
import re
import wave
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
    "celeste": "m7yTemJqdIqrcNleANfX",        # Femenina (comparte voz con Maria por ahora)
    "carlos": "Rt1JHkPO27QCUX6Nd5bV",         # Masculina (distinta a Roberto)
    "entrevistador": "1vvbVDm3EpGMyY1WVZ3r",  # Sofia - Femenina (distinta a Maria)
}

# Gemini TTS devuelve PCM16 crudo (sin contenedor). Lo envolvemos en WAV para
# que el <audio> del navegador lo pueda reproducir tal cual.
GEMINI_SAMPLE_RATE_DEFAULT = 24000


def output_mime() -> str:
    """MIME del audio que produce el proveedor activo.

    El front arma el Blob con esto (`assistant_audio_start.mime`). Un WAV
    etiquetado como audio/mpeg no suena en Chrome, asi que esto NO es cosmetico.
    """
    return "audio/wav" if settings.tts_provider == "gemini" else "audio/mpeg"


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


def _pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    """Envuelve PCM16 mono en un contenedor WAV (header RIFF de 44 bytes)."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16 bits
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def _sample_rate_from_mime(mime: str | None) -> int:
    """Extrae el rate de 'audio/L16;codec=pcm;rate=24000'.

    Se lee de la respuesta en vez de hardcodear 24000: si Google cambia el
    default del modelo, un rate equivocado reproduce la voz acelerada o lenta
    en vez de fallar de forma visible.
    """
    if mime:
        match = re.search(r"rate=(\d+)", mime)
        if match:
            return int(match.group(1))
    return GEMINI_SAMPLE_RATE_DEFAULT


def _gemini_tts_sync(text: str, avatar_id: str) -> bytes:
    """Llamada sincrona al TTS de Gemini. Devuelve WAV listo para reproducir."""
    # Import local a proposito: evita cargar google-genai cuando el proveedor
    # activo es ElevenLabs, y corta cualquier ciclo con gemini_live.
    from google.genai import types

    from app.services.gemini_live import (
        _GEMINI_HTTP_OPTIONS,
        _gemini_client,
        get_voice,
    )

    # _GEMINI_HTTP_OPTIONS corta el retry interno del SDK (attempts=1) y pone un
    # timeout duro. Sin esto el SDK reintenta con backoff exponencial ANTES de
    # propagar el error y un turno lento se vuelve de 17-34s: medido, ver
    # docs/changelog/2026-09-22_tts_dispatcher_gemini.md. Preferimos fallar
    # rapido y caer a ElevenLabs a tener al usuario esperando media conversacion.
    client = _gemini_client(http_options=_GEMINI_HTTP_OPTIONS)  # rota la key
    response = client.models.generate_content(
        model=settings.gemini_model_tts,
        contents=text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=get_voice(avatar_id)
                    )
                )
            ),
        ),
    )

    # El modelo devuelve candidato SIN content (finish_reason=OTHER) de forma
    # intermitente, sobre todo con textos cortos — reproducido en el diagnostico
    # del 2026-09-22. Sin este guard revienta con un AttributeError sobre None
    # que no dice nada; asi el log nombra la causa y el caller cae a ElevenLabs.
    candidate = response.candidates[0] if response.candidates else None
    if candidate is None or candidate.content is None:
        razon = getattr(candidate, "finish_reason", None)
        raise RuntimeError(f"Gemini TTS no devolvio contenido (finish_reason={razon})")

    part = candidate.content.parts[0]
    inline = getattr(part, "inline_data", None)
    if inline is None or not inline.data:
        raise RuntimeError("Gemini TTS no devolvio audio (part sin inline_data)")

    return _pcm_to_wav(inline.data, _sample_rate_from_mime(inline.mime_type))


async def _gemini_tts(text: str, avatar_id: str) -> bytes:
    """Genera el audio en un thread para no bloquear el event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _gemini_tts_sync, text, avatar_id)


def _elevenlabs_wav_sync(text: str, voice_id: str) -> bytes:
    """ElevenLabs pidiendo PCM crudo, envuelto en WAV.

    Existe para el fallback del path de Gemini: el `mime` ya viajo al cliente
    como audio/wav, asi que devolver MP3 aqui reproduciria silencio. Mismo
    contenedor, otro proveedor.
    """
    client = _get_client()
    response = client.text_to_speech.convert(
        text=text,
        voice_id=voice_id,
        model_id=settings.elevenlabs_model,
        output_format=f"pcm_{GEMINI_SAMPLE_RATE_DEFAULT}",
    )
    pcm = b"".join(response)
    return _pcm_to_wav(pcm, GEMINI_SAMPLE_RATE_DEFAULT)


async def _elevenlabs_wav(text: str, voice_id: str) -> bytes:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _elevenlabs_wav_sync, text, voice_id)


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

    if settings.tts_provider == "gemini":
        try:
            audio_bytes = await _gemini_tts(clean_text, avatar_id)
            logger.info(f"[TTS-Gemini] OK ({len(audio_bytes)} bytes WAV)")
            return audio_bytes
        except Exception as e:
            # Fallback a ElevenLabs: preferimos gastar credito a dejar al avatar
            # mudo. El log dice cual fue para poder medir cuantas veces cae.
            # En WAV, porque output_mime() ya anuncio audio/wav.
            logger.warning(
                "[TTS-Gemini] Fallo, cayendo a ElevenLabs type=%s", type(e).__name__
            )
            voice_id = AVATAR_VOICES.get(avatar_id, AVATAR_VOICES["roberto"])
            return await _elevenlabs_wav(clean_text, voice_id)

    voice_id = AVATAR_VOICES.get(avatar_id, AVATAR_VOICES["roberto"])

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            audio_bytes = await _generate(clean_text, voice_id)
            logger.info(f"[TTS-ElevenLabs] OK ({len(audio_bytes)} bytes, intento {attempt})")
            return audio_bytes
        except Exception as e:
            logger.warning(
                "[TTS-ElevenLabs] Error intento %s type=%s", attempt, type(e).__name__
            )
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

    if settings.tts_provider == "gemini":
        try:
            # ponytail: Gemini se manda en UN solo chunk al final — el modelo de
            # TTS no expone streaming incremental como el /stream de ElevenLabs,
            # asi que el usuario espera el audio completo (peor TTFB). Si pesa,
            # el upgrade es streamear PCM y armar el WAV en el cliente: el front
            # ya tiene pcm16ToWavBlob() en useOssAvatarWs.ts.
            audio_bytes = await _gemini_tts(clean_text, avatar_id)
            logger.info(f"[TTS-Gemini-Stream] OK ({len(audio_bytes)} bytes WAV)")
            yield audio_bytes
            return
        except Exception as e:
            # El cliente ya recibio mime=audio/wav en assistant_audio_start, asi
            # que el fallback va en WAV tambien (no en el MP3 de mas abajo).
            logger.warning(
                "[TTS-Gemini-Stream] Fallo, cayendo a ElevenLabs type=%s",
                type(e).__name__,
            )
            audio_bytes = await _elevenlabs_wav(clean_text, voice_id)
            logger.info(f"[TTS-Fallback-WAV] OK ({len(audio_bytes)} bytes)")
            yield audio_bytes
            return

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
