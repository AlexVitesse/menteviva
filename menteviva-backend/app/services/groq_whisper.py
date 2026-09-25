"""
Servicio de Speech-to-Text usando Groq Whisper.

Groq ofrece Whisper de forma gratuita con limites generosos.
Modelo: whisper-large-v3-turbo

Whisper alucina sobre silencio o respiracion ("Gracias por ver el video",
"Subtitulos por la comunidad de Amara.org"). Si eso llega como turno, el avatar
le responde y ensucia el analisis. Se filtra en dos capas:
1. Segmentos que Whisper mismo marca como no-voz (no_speech_prob alto Y
   avg_logprob bajo: la misma regla que usa Whisper para saltar silencio).
2. Frases de relleno conocidas del dataset de entrenamiento (subtitulos de
   YouTube), que aparecen aunque el segmento tenga buena confianza.
"""

import asyncio
import logging
import re
import unicodedata

from app.config import settings
from app.services.groq_pool import get_groq_client

logger = logging.getLogger("menteviva")

# Umbrales por defecto de Whisper (transcribe.py: no_speech_threshold,
# logprob_threshold).
NO_SPEECH_PROB = 0.6
LOGPROB_THRESHOLD = -1.0

# Frases que Whisper inventa sobre silencio en español. Se comparan sin
# acentos y en minusculas. Deben ser lo bastante especificas para no borrar
# algo que un usuario diria en una venta o entrevista.
_HALLUCINATIONS = re.compile(
    r"(?<!\w)(?:"
    r"subtitulos? (realizados? |hechos? )?(por|de) (la comunidad de )?amara\.org"
    r"|subtitulado por[^.!?]*"
    r"|gracias por ver( el video)?"
    r"|no olvides suscribirte[^.!?]*"
    r"|suscribete( al canal)?"
    r"|dale like[^.!?]*"
    r"|nos vemos en el proximo video"
    r"|www\.[^\s]+"
    r")(?!\w)"
)


def _strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )


def _seg(segment, key: str):
    return segment.get(key) if isinstance(segment, dict) else getattr(segment, key, None)


def clean_transcription(text: str, segments: list | None = None) -> str:
    """Quita el texto que Whisper produjo sobre silencio o de memoria.

    Con segmentos, arma el texto solo con los que tienen voz; sin segmentos
    (respuesta vieja o formato text) usa el texto tal cual. Despues borra las
    alucinaciones conocidas. Devuelve "" si no queda nada con letras.
    """
    removed = False
    if segments:
        kept = [
            str(_seg(s, "text") or "")
            for s in segments
            if not (
                (_seg(s, "no_speech_prob") or 0) > NO_SPEECH_PROB
                and (_seg(s, "avg_logprob") or 0) < LOGPROB_THRESHOLD
            )
        ]
        removed = len(kept) < len(segments)
        text = "".join(kept)
    text = (text or "").strip()
    if not text:
        return ""
    # Buscar sobre la version sin acentos, pero cortar el texto original: los
    # indices coinciden porque NFD+filtro de Mn conserva un caracter base por
    # cada caracter precompuesto del español.
    folded = _strip_accents(text).lower()
    if len(folded) == len(text):
        parts, last = [], 0
        for m in _HALLUCINATIONS.finditer(folded):
            parts.append(text[last:m.start()])
            last = m.end()
        parts.append(text[last:])
        removed = removed or last > 0
        text = "".join(parts)
    if not removed:
        return text
    # Solo si se quito algo: limpiar la puntuacion huerfana que dejo el corte.
    text = re.sub(r"\s+", " ", text).strip(" .,;:!¡?¿-—")
    return text if re.search(r"\w", text) else ""


async def transcribe_audio(
    audio_bytes: bytes, filename: str = "audio.webm", language: str = "es"
) -> str:
    """
    Transcribe audio usando Groq Whisper y descarta silencio/alucinaciones.

    Args:
        audio_bytes: Audio en bytes (webm, mp4, ogg, wav, etc.)
        filename: Nombre del archivo con extension para indicar formato
        language: ISO-639-1 ("es", "en"); fijarlo evita que Whisper traduzca

    Returns:
        Texto transcrito ("" si no habia voz)

    Raises:
        Exception: Si hay error en la transcripcion
    """
    client = get_groq_client()
    # El SDK de Groq es sincrono: en un hilo para no congelar el event loop
    # (con 2+ usuarios, una transcripcion bloqueaba todos los WebSockets).
    transcription = await asyncio.to_thread(
        client.audio.transcriptions.create,
        file=(filename, audio_bytes),
        model=settings.groq_model_whisper,
        language=language,
        response_format="verbose_json",
    )
    # El SDK puede devolver str, un objeto con .text/.segments, o raramente
    # int/None con audio muy corto. Normalizamos para que el caller siempre
    # reciba str.
    if transcription is None:
        return ""
    raw = getattr(transcription, "text", transcription)
    segments = getattr(transcription, "segments", None)
    raw = str(raw).strip()
    cleaned = clean_transcription(raw, segments)
    if len(cleaned) < len(raw):
        logger.info(
            "[STT] filtrado silencio/alucinacion chars=%d->%d", len(raw), len(cleaned)
        )
    return cleaned
