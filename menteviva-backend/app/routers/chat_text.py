"""
Router de chat SOLO TEXTO — banco de pruebas para evaluar prompts.

Aislado a proposito del flujo realtime (WebSocket + audio + Gemini + analisis +
DB). Aqui SOLO se ejercita el system_prompt contra el LLM (Groq), igual que en
produccion via `get_system_prompt` + `chat_complete`, pero sin TTS, sin avatar,
sin persistencia y sin scoring. Sirve para iterar prompts a mano desde una UI
minima o con curl.

Endpoints:
- GET  /api/chat/avatars  -> lista de avatares (incluye al entrevistador/Sofia)
- POST /api/chat          -> dada la conversacion, devuelve la siguiente respuesta

No toca nada del producto: si se borra este archivo y su include_router, el
resto sigue igual.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import UserProfile
from app.prompts.entrevistador import build_gemini_entrevistador_prompt
from app.prompts.scenarios import get_all_avatars, get_avatar, get_system_prompt
from app.services.gemini_live import GEMINI_VOICE_ADDENDUM, generate_text
from app.services.groq_llm import chat_complete

logger = logging.getLogger("menteviva")
router = APIRouter()

# Misma marca de cierre que usa el flujo realtime (conversation.py). Aqui solo
# la limpiamos del texto para que no aparezca cruda en la UI de pruebas.
CLOSING_MARKER = "[CIERRE]"


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    avatar_id: str
    # Motor del LLM a evaluar:
    #   "groq"   -> prompt MAESTRO (get_system_prompt) + Groq gpt-oss  [produccion texto]
    #   "gemini" -> para el diagnostico: prompt CONCISO + GEMINI_VOICE_ADDENDUM
    #               + modelo Gemini de texto = "como si fuera la voz, pero sin audio".
    provider: str = "groq"  # "groq" | "gemini"
    messages: list[ChatMessage] = []
    # Si True, el avatar inicia la conversacion (util cuando messages esta vacio).
    # Inyecta un "nudge" como turno de usuario SOLO para la llamada al LLM; no se
    # devuelve en el historial, el cliente solo guarda la respuesta del avatar.
    greet: bool = False
    # Nivel de dificultad para avatares que lo soportan (Roberto).
    level: str | None = None
    # Variables de sesion del diagnostico (idioma, tono, minutos, competencias).
    session_vars: dict | None = None
    # Registro opcional del usuario (para sustituir {{nombre}}, {{rol}}, etc. en
    # el prompt del entrevistador). Forma libre: {registro: {...}, ...}.
    user_profile: dict | None = None


class ChatResponse(BaseModel):
    reply: str
    closing: bool = False
    prompt_chars: int
    # Motor que realmente corrio (util en la UI para saber que se evaluo).
    provider: str = "groq"


_GREET_NUDGE = (
    "[El usuario se acaba de conectar y aun no ha dicho nada. Inicia tu la "
    "conversacion: saluda brevemente y comienza segun tu rol, con UNA sola "
    "pregunta.]"
)


@router.get("/chat/avatars")
async def list_chat_avatars():
    """Avatares disponibles para el banco de pruebas (incluye al entrevistador)."""
    return {"avatars": get_all_avatars(include_diagnostico=True)}


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """
    Genera la siguiente respuesta del avatar dado el historial.

    Stateless: el cliente manda la conversacion completa en cada turno. No hay
    streaming (la UI de pruebas no lo necesita) ni audio ni analisis.
    """
    avatar = get_avatar(req.avatar_id)
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")

    user_profile: UserProfile | None = None
    if req.user_profile:
        try:
            user_profile = UserProfile(**req.user_profile)
        except Exception as e:
            logger.warning(f"[ChatText] user_profile invalido, ignorando: {e}")

    provider = req.provider if req.provider in ("groq", "gemini") else "groq"
    is_diagnostico = avatar.get("kind") == "diagnostico"

    # Seleccion del system_prompt segun el motor a evaluar.
    if provider == "gemini" and is_diagnostico:
        # Replica EXACTA de lo que recibe Gemini en voz: prompt conciso + el
        # addendum de voz (que en produccion se anexa dentro de open_session).
        system_prompt = (
            build_gemini_entrevistador_prompt(user_profile, req.session_vars)
            + GEMINI_VOICE_ADDENDUM
        )
    else:
        # Groq siempre, y Gemini para avatares sin prompt conciso propio: el
        # maestro. (Solo el diagnostico tiene variante concisa para voz.)
        system_prompt = get_system_prompt(
            req.avatar_id,
            user_profile=user_profile,
            session_vars=req.session_vars,
            level=req.level,
        )

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    if req.greet:
        # El nudge va como ultimo turno de usuario para gatillar la apertura.
        messages.append({"role": "user", "content": _GREET_NUDGE})

    if not messages:
        raise HTTPException(
            status_code=400,
            detail="Envia al menos un mensaje o usa greet=true.",
        )

    logger.info(
        f"[ChatText] avatar={req.avatar_id} provider={provider} "
        f"turnos={len(req.messages)} greet={req.greet} "
        f"prompt={len(system_prompt)} chars"
    )

    if provider == "gemini":
        # Cierre via tool-call finalizar_entrevista (como en voz), no via [CIERRE].
        reply, closing = await generate_text(
            messages, system_prompt, enable_closing_tool=is_diagnostico
        )
    else:
        reply = await chat_complete(messages, system_prompt)
        closing = CLOSING_MARKER in reply
        if closing:
            reply = reply.replace(CLOSING_MARKER, "").strip()

    return ChatResponse(
        reply=reply,
        closing=closing,
        prompt_chars=len(system_prompt),
        provider=provider,
    )
