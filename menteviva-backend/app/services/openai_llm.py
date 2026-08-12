"""
Servicio de LLM usando OpenAI (ChatGPT).
"""

import logging

from openai import AsyncOpenAI

from app.config import settings
from app.services.llm_costs import log_llm_cost

logger = logging.getLogger("menteviva")

# Instancia asíncrona del cliente
_client = None

def get_openai_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        if not settings.chatgpt_api_key:
            raise RuntimeError(
                "CHATGPT_API_KEY no está configurada en menteviva-backend/.env"
            )
        _client = AsyncOpenAI(api_key=settings.chatgpt_api_key)
    return _client


def _log_cost(model: str, response) -> dict | None:
    """Loguea tokens y costo estimado del turno via llm_costs y devuelve el
    usage normalizado {"input_tokens", "output_tokens"} (o None si no vino).
    Los tokens de razonamiento de la familia gpt-5 se facturan como output y ya
    vienen dentro de completion_tokens, asi que el calculo los incluye."""
    usage = getattr(response, "usage", None)
    if not usage:
        return None
    in_tok = getattr(usage, "prompt_tokens", 0) or 0
    out_tok = getattr(usage, "completion_tokens", 0) or 0
    log_llm_cost("openai", model, in_tok, out_tok)
    return {"input_tokens": in_tok, "output_tokens": out_tok}


def _is_reasoning_model(model: str) -> bool:
    """True para la familia GPT-5 y los modelos o-series (razonamiento).

    Estos modelos NO aceptan los mismos parametros que gpt-4o via
    chat.completions: rechazan `temperature` distinto de 1 y usan
    `max_completion_tokens` en vez de `max_tokens`. Ver _build_kwargs.
    """
    m = model.lower()
    return m.startswith("gpt-5") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4")


async def chat_complete_openai(
    messages: list[dict],
    system_prompt: str,
    model: str = "gpt-5.4-mini",
    return_usage: bool = False,
) -> str | tuple[str, dict | None]:
    """
    Genera respuesta completa de OpenAI ChatGPT sin streaming.

    Con return_usage=True devuelve (texto, usage) donde usage es
    {"input_tokens": int, "output_tokens": int} o None si no vino en la
    respuesta. El default mantiene la firma clasica -> str.

    Compatibilidad de parametros:
    - gpt-4o / 4.1 (no-razonamiento): temperature=0.6 + max_tokens=500 (como antes).
    - gpt-5.x / o-series (razonamiento): temperature fija (el modelo solo acepta 1),
      max_completion_tokens (no max_tokens) y reasoning_effort="low" para respuestas
      de roleplay rapidas sin que el razonamiento se coma el budget y devuelva "".
    """
    full_messages = [
        {"role": "system", "content": system_prompt},
        *messages
    ]

    client = get_openai_client()
    logger.info(f"[OpenAI] Enviando request a modelo={model} - turnos={len(messages)}")

    kwargs: dict = {"model": model, "messages": full_messages}
    if _is_reasoning_model(model):
        # El razonamiento consume tokens del mismo budget que la respuesta; damos
        # holgura (2000) para que el turno no salga vacio, con esfuerzo bajo para
        # que siga siendo un chat conversacional y no una deliberacion larga.
        kwargs["max_completion_tokens"] = 2000
        kwargs["reasoning_effort"] = "low"
    else:
        kwargs["temperature"] = 0.6
        kwargs["max_tokens"] = 500

    response = await client.chat.completions.create(**kwargs)

    usage = _log_cost(model, response)

    reply = (response.choices[0].message.content or "").strip()
    return (reply, usage) if return_usage else reply
