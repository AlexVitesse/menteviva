"""
Servicio de LLM usando Groq con Llama 3.1 8B.

Groq ofrece inferencia ultra-rapida y gratuita.
Modelo: llama-3.1-8b-instant
"""

import logging
from typing import AsyncGenerator
from app.config import settings
from app.services.groq_pool import get_groq_client

logger = logging.getLogger("menteviva")


async def chat_stream(
    messages: list[dict],
    system_prompt: str
) -> AsyncGenerator[str, None]:
    """
    Genera respuesta del LLM en streaming.

    Args:
        messages: Historial de conversacion [{"role": "user", "content": "..."}]
        system_prompt: Prompt del sistema con personalidad del avatar

    Yields:
        Tokens de la respuesta uno por uno
    """
    full_messages = [
        {"role": "system", "content": system_prompt},
        *messages
    ]

    client = get_groq_client()
    stream = client.chat.completions.create(
        model=settings.groq_model_llm,
        # 0.4: respuestas mas consistentes y concisas. En 0.7 Sofia tendia a
        # parafrasear empaticamente y encadenar multiples preguntas "creativas".
        temperature=0.4,
        max_tokens=500,
        stream=True,
        messages=full_messages,
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def chat_complete(
    messages: list[dict],
    system_prompt: str
) -> str:
    """
    Genera respuesta completa del LLM (sin streaming).

    Args:
        messages: Historial de conversacion
        system_prompt: Prompt del sistema

    Returns:
        Respuesta completa del LLM
    """
    full_messages = [
        {"role": "system", "content": system_prompt},
        *messages
    ]

    client = get_groq_client()
    response = client.chat.completions.create(
        model=settings.groq_model_llm,
        messages=full_messages,
        temperature=0.7,
        max_tokens=500,
        stream=False
    )

    return response.choices[0].message.content


async def get_conversation_starter(system_prompt: str, avatar_name: str) -> str:
    """
    Genera un mensaje inicial del avatar para comenzar la conversacion.

    Args:
        system_prompt: Prompt del sistema del avatar
        avatar_name: Nombre del avatar

    Returns:
        Mensaje inicial del avatar
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
