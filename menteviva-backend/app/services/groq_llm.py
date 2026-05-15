"""
Servicio de LLM usando Groq.

Modelo por defecto: openai/gpt-oss-20b (preview en Groq).
Reemplazo de llama-3.1-8b-instant tras comparativa head-to-head: misma
latencia (~0.66s/turno) pero cumple reglas estrictas del prompt mucho mejor
(reasoning bake-in).

# Fallback automático
gpt-oss-20b ocasionalmente emite tokens de tool-use aunque el request no
declare tools. Groq lo detecta y devuelve `APIError: Tool choice is none,
but model called a tool` ~10% de los turnos. Cuando pasa, hacemos UN
reintento con `llama-3.1-8b-instant` (modelo no-reasoning, no produce este
error). Solo aplica en `chat_stream` y `chat_complete` — get_conversation_starter
ya casi nunca dispara el bug porque el prompt es trivial.

Si el reintento tambien falla, se propaga la excepcion y el WS handler
mostrara el error al cliente (try/except por turno ya existe en conversation.py).
"""

import logging
from typing import AsyncGenerator

import groq

from app.config import settings
from app.services.groq_pool import get_groq_client

logger = logging.getLogger("menteviva")

FALLBACK_MODEL = "llama-3.1-8b-instant"


def _is_tool_use_glitch(err: BaseException) -> bool:
    """True si el error es el bug intermitente de tool-calling de gpt-oss-20b."""
    if not isinstance(err, groq.APIError):
        return False
    msg = str(err).lower()
    return "tool" in msg and ("called a tool" in msg or "tool choice" in msg)


def _build_stream(client, model: str, messages: list[dict], temperature: float):
    return client.chat.completions.create(
        model=model,
        temperature=temperature,
        max_tokens=500,
        stream=True,
        messages=messages,
    )


async def chat_stream(
    messages: list[dict],
    system_prompt: str
) -> AsyncGenerator[str, None]:
    """
    Genera respuesta del LLM en streaming.

    Si gpt-oss-20b dispara el glitch de tool-calling antes del primer token
    util, hace fallback automatico a llama-3.1-8b-instant para ese turno.
    """
    full_messages = [
        {"role": "system", "content": system_prompt},
        *messages
    ]

    client = get_groq_client()
    primary = settings.groq_model_llm

    yielded = 0
    try:
        # 0.4: respuestas mas consistentes y concisas. En 0.7 Sofia tendia a
        # parafrasear empaticamente y encadenar multiples preguntas "creativas".
        for chunk in _build_stream(client, primary, full_messages, 0.4):
            if chunk.choices[0].delta.content:
                yielded += 1
                yield chunk.choices[0].delta.content
        return
    except Exception as e:
        # Si ya emitimos tokens, no podemos reintentar sin duplicar la salida
        # rio abajo. Re-lanzamos para que el WS muestre el error y el siguiente
        # turno empiece limpio.
        if yielded > 0 or not _is_tool_use_glitch(e):
            raise
        logger.warning(
            f"[LLM] {primary} disparo tool-use glitch antes del primer token; "
            f"fallback a {FALLBACK_MODEL}. Detalle: {e}"
        )

    # Reintento con fallback. No envolver en try/except mas: si tambien falla,
    # se propaga al handler de turno.
    for chunk in _build_stream(client, FALLBACK_MODEL, full_messages, 0.4):
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def chat_complete(
    messages: list[dict],
    system_prompt: str
) -> str:
    """
    Genera respuesta completa del LLM (sin streaming).

    Mismo fallback automatico que chat_stream.
    """
    full_messages = [
        {"role": "system", "content": system_prompt},
        *messages
    ]

    client = get_groq_client()
    primary = settings.groq_model_llm

    def _call(model: str) -> str:
        response = client.chat.completions.create(
            model=model,
            messages=full_messages,
            temperature=0.7,
            max_tokens=500,
            stream=False,
        )
        return response.choices[0].message.content

    try:
        return _call(primary)
    except Exception as e:
        if not _is_tool_use_glitch(e):
            raise
        logger.warning(
            f"[LLM] {primary} disparo tool-use glitch en chat_complete; "
            f"fallback a {FALLBACK_MODEL}. Detalle: {e}"
        )
        return _call(FALLBACK_MODEL)


async def get_conversation_starter(system_prompt: str, avatar_name: str) -> str:
    """
    Genera un mensaje inicial del avatar para comenzar la conversacion.
    """
    starter_prompt = f"""El usuario acaba de conectarse. Genera un saludo breve y profesional
    como {avatar_name} para iniciar la conversacion. Maximo 2 oraciones."""

    messages = [{"role": "user", "content": starter_prompt}]

    client = get_groq_client()
    response = client.chat.completions.create(
        model=settings.groq_model_llm,
        messages=[
            {"role": "system", "content": system_prompt},
            *messages
        ],
        temperature=0.7,
        max_tokens=100,
        stream=False
    )

    return response.choices[0].message.content
