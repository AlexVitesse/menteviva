"""
Servicio de LLM usando Groq.

Modelo por defecto: openai/gpt-oss-20b (preview en Groq).
Reemplazo de llama-3.1-8b-instant tras comparativa head-to-head: misma
latencia (~0.66s/turno) pero cumple reglas estrictas del prompt mucho mejor
(reasoning bake-in).

# Fallback automático
gpt-oss-20b ocasionalmente emite tokens de tool-use aunque el request no
declare tools. Groq lo detecta y devuelve `APIError: Tool choice is none,
but model called a tool` ~10% de los turnos. Tambien, en turnos de baja senal,
a veces "razona" y devuelve contenido vacio. En ambos casos hacemos UN reintento
con EL MISMO modelo (gpt-oss-20b). Solo aplica en `chat_stream` y `chat_complete`
— get_conversation_starter ya casi nunca dispara el bug porque el prompt es trivial.

NO usamos llama-3.1-8b-instant como fallback: su limite de 6k TPM en el free tier
de Groq es menor que el system prompt del entrevistador (~8.5k tokens), asi que
cualquier llamada a llama con ese prompt da 413. El primario si tiene cupo y tanto
el glitch como el vacio son intermitentes: el reintento casi siempre resuelve.

Si el reintento tambien falla (error real), se propaga la excepcion y el WS handler
mostrara el error al cliente (try/except por turno ya existe en conversation.py).
"""

import logging
import random
from typing import AsyncGenerator

import groq

from app.config import settings
from app.services.groq_pool import get_groq_client
from app.services.llm_costs import log_llm_cost

logger = logging.getLogger("menteviva")

# Preguntas de re-enganche para el caso (raro) en que gpt-oss-20b no entrega
# texto dos veces seguidas con un usuario muy evasivo. Garantizan que Sofia
# nunca se quede muda. Son cortas, concretas y ofrecen opciones — alineadas
# con la guia de "manejo de resistencia" del prompt. Elegimos al azar para dar
# variedad sin estado global compartido entre sesiones (este path es raro, no
# necesita rotacion estricta y random.choice es seguro bajo concurrencia).
_REENGAGE_FALLBACKS = [
    "Vamos con algo más concreto: ¿qué fue lo último que te tocó resolver en el trabajo esta semana?",
    "Cambiemos el ángulo. Dime una sola persona con la que trabajaste este mes.",
    "Para arrancar fácil: ¿prefieres contarme de un día complicado o de un buen logro reciente?",
    "Bájemoslo a algo chico: ¿qué hiciste ayer que te sacó del automático?",
]


def _next_reengage() -> str:
    return random.choice(_REENGAGE_FALLBACKS)


def _is_tool_use_glitch(err: BaseException) -> bool:
    """True si el error es el bug intermitente de tool-calling de gpt-oss-20b."""
    if not isinstance(err, groq.APIError):
        return False
    msg = str(err).lower()
    return "tool" in msg and ("called a tool" in msg or "tool choice" in msg)


# Penalizaciones contra repeticion. Sin esto (y con temperature baja) el modelo
# tiende a calcar frases palabra-por-palabra entre turnos seguidos e incluso a
# copiar los ejemplos literales del system prompt (ej. "¿Cuándo la definición no
# fue clara entre tú y quien te la asigna?"). frequency_penalty castiga repetir
# tokens ya usados; presence_penalty empuja a introducir temas/vocabulario nuevo
# (clave para que Sofia pivotee de competencia en vez de re-preguntar lo mismo).
FREQUENCY_PENALTY = 0.5
PRESENCE_PENALTY = 0.4


def _build_stream(client, model: str, messages: list[dict], temperature: float):
    return client.chat.completions.create(
        model=model,
        temperature=temperature,
        max_tokens=500,
        stream=True,
        frequency_penalty=FREQUENCY_PENALTY,
        presence_penalty=PRESENCE_PENALTY,
        messages=messages,
    )


async def chat_stream(
    messages: list[dict],
    system_prompt: str
) -> AsyncGenerator[str, None]:
    """
    Genera respuesta del LLM en streaming.

    Si el modelo primario falla antes del primer token (tool-use glitch de
    gpt-oss-20b) o devuelve contenido vacio, reintenta UNA vez con el mismo
    modelo a temperatura mas alta. Si aun asi no hay texto, emite una pregunta
    de re-enganche para que Sofia nunca se quede muda.

    Nota: NO usamos llama-3.1-8b-instant como fallback. Su limite de 6k TPM en
    el free tier de Groq es menor que este system prompt (~8.5k tokens), asi que
    cualquier llamada a llama con este prompt da 413. El primario (gpt-oss-20b)
    si tiene cupo, y tanto el glitch como el vacio son intermitentes: un
    reintento del mismo modelo casi siempre resuelve.
    """
    full_messages = [
        {"role": "system", "content": system_prompt},
        *messages
    ]

    client = get_groq_client()
    primary = settings.groq_model_llm

    yielded = 0
    try:
        # 0.6: en 0.4 Sofia calcaba frases entre turnos (muy deterministico);
        # en 0.7 parafraseaba de mas y encadenaba preguntas "creativas". 0.6 +
        # las penalizaciones de repeticion dan variedad sin perder foco.
        for chunk in _build_stream(client, primary, full_messages, 0.6):
            if chunk.choices[0].delta.content:
                yielded += 1
                yield chunk.choices[0].delta.content
        if yielded > 0:
            return
        # yielded == 0 sin excepcion: gpt-oss-20b a veces "razona" y devuelve
        # contenido vacio en turnos de baja senal (usuario evasivo: "no se",
        # "es lo mismo").
        logger.warning(f"[LLM] {primary} devolvio respuesta vacia (0 tokens); reintentando")
    except Exception as e:
        # Si ya emitimos tokens, no podemos reintentar sin duplicar la salida
        # rio abajo. Re-lanzamos para que el WS muestre el error y el siguiente
        # turno empiece limpio. Tampoco reintentamos errores que no sean el
        # glitch intermitente (ej. 429/401 — reintentar no ayudaria).
        if yielded > 0 or not _is_tool_use_glitch(e):
            raise
        logger.warning(
            f"[LLM] {primary} disparo tool-use glitch antes del primer token; "
            f"reintentando. Detalle: {e}"
        )

    # Reintento con el MISMO modelo a temperatura mas alta (rompe el patron de
    # vacio y suele esquivar el glitch intermitente). yielded==0 garantizado aqui.
    try:
        for chunk in _build_stream(client, primary, full_messages, 0.85):
            if chunk.choices[0].delta.content:
                yielded += 1
                yield chunk.choices[0].delta.content
    except Exception as e:
        # Si ya emitimos tokens en el reintento, re-lanzar duplicaria salida:
        # propagamos. Un error REAL (401/429/bug) tambien se propaga para que el
        # WS lo muestre. Pero si es el glitch de tool-use otra vez (intermitente,
        # ~1% de los turnos), NO lo enmascaramos como error: caemos al
        # re-enganche igual que en el caso de vacio, para que Sofia no quede muda.
        if yielded > 0 or not _is_tool_use_glitch(e):
            logger.warning(f"[LLM] reintento de {primary} fallo: {e}")
            raise
        logger.warning(
            f"[LLM] {primary} disparo tool-use glitch tambien en el reintento; "
            f"usando re-enganche. Detalle: {e}"
        )
    if yielded > 0:
        return

    # Doble fallo sin texto util (vacio o glitch en ambos intentos): ultima red
    # para no dejar a Sofia muda.
    logger.warning(f"[LLM] {primary} sin texto tras reintento; usando re-enganche")
    yield _next_reengage()


async def chat_complete(
    messages: list[dict],
    system_prompt: str,
    model: str | None = None,
    return_usage: bool = False,
) -> str | tuple[str, dict | None]:
    """
    Genera respuesta completa del LLM (sin streaming).

    Mismo fallback automatico que chat_stream.

    Con return_usage=True devuelve (texto, usage) donde usage es
    {"input_tokens": int, "output_tokens": int} ACUMULADO entre reintentos (el
    usuario paga todos los intentos), o None si el proveedor no lo reporto.
    El default (False) mantiene la firma clasica -> str (scripts existentes).
    """
    full_messages = [
        {"role": "system", "content": system_prompt},
        *messages
    ]

    client = get_groq_client()
    primary = model or settings.groq_model_llm
    total_usage: dict | None = None

    def _call(model_name: str, temperature: float) -> str:
        nonlocal total_usage
        response = client.chat.completions.create(
            model=model_name,
            messages=full_messages,
            temperature=temperature,
            max_tokens=500,
            frequency_penalty=FREQUENCY_PENALTY,
            presence_penalty=PRESENCE_PENALTY,
            stream=False,
        )
        # Costo estimado del turno a los logs (los tokens de razonamiento de
        # gpt-oss se facturan como output y ya vienen en completion_tokens).
        usage = getattr(response, "usage", None)
        if usage:
            in_tok = getattr(usage, "prompt_tokens", 0) or 0
            out_tok = getattr(usage, "completion_tokens", 0) or 0
            log_llm_cost("groq", model_name, in_tok, out_tok)
            if total_usage is None:
                total_usage = {"input_tokens": 0, "output_tokens": 0}
            total_usage["input_tokens"] += in_tok
            total_usage["output_tokens"] += out_tok
        # gpt-oss-20b a veces "razona" y devuelve content None/"" sin excepcion.
        # Normalizamos a str para que ningun caller reviente con .strip().
        return (response.choices[0].message.content or "").strip()

    try:
        text = _call(primary, 0.6)
    except Exception as e:
        if not _is_tool_use_glitch(e):
            raise
        logger.warning(
            f"[LLM] {primary} disparo tool-use glitch en chat_complete; "
            f"reintento con el mismo modelo. Detalle: {e}"
        )
        # No caemos a llama: su limite de 6k TPM en free tier < este system
        # prompt (~8.5k tokens) => 413. El glitch es intermitente, reintentar
        # el mismo modelo casi siempre resuelve (igual que chat_stream).
        text = ""

    if not text:
        # Vacio (content None/"" sin excepcion) o glitch en el primer intento:
        # UN reintento a temperatura mas alta, igual que chat_stream. Un error
        # real aqui se propaga; si vuelve vacio, re-enganche para no devolver "".
        logger.warning(f"[LLM] {primary} sin texto en chat_complete; reintentando")
        try:
            text = _call(primary, 0.85)
        except Exception as e:
            if not _is_tool_use_glitch(e):
                raise
            logger.warning(f"[LLM] glitch tambien en reintento de chat_complete: {e}")
            text = ""

    text = text or _next_reengage()
    return (text, total_usage) if return_usage else text


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
