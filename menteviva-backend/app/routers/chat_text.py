"""
Router de chat SOLO TEXTO — banco de pruebas para evaluar prompts.

Aislado del flujo realtime (WebSocket + audio + TTS + avatar) pero REUSA sus
piezas de produccion para que el banco refleje lo que pasa de verdad: mismo
`get_system_prompt`, mismo analizador (`analysis.generate_user_profile`) y misma
persistencia (`user_repo`). Sirve para iterar prompts a mano desde una UI minima
o con curl, y ahora tambien para correr el diagnostico end-to-end como en voz.

Endpoints:
- GET  /api/chat/avatars    -> lista de avatares (incluye al entrevistador/Sofia)
- POST /api/chat            -> dada la conversacion, devuelve la siguiente respuesta
- POST /api/chat/diagnostico -> corre el analisis de produccion sobre la charla y
                                (opcional) lo persiste bajo user_id "chatlab:<nombre>"

Seguridad / Deploy en Producción:
- En producción, es imperativo setear `CHATLAB_TOKEN` en las variables de entorno (.env)
  ya que el piloto corre a través de un túnel público de Cloudflare. Si está seteado,
  los endpoints exigen el header `X-ChatLab-Token` (401 si falta o no coincide).
  En local, si se deja vacío, actúa en modo passthrough sin fricción.

Notas:
- El banco corre el prompt MAESTRO para todos los motores (mismo que Groq/ChatGPT)
  -> comparacion justa. `use_voice_prompt=true` es opt-in al prompt conciso de voz.
- La persistencia usa user_ids con prefijo "chatlab:" para NO mezclar datos de
  laboratorio con usuarios reales del piloto (Firebase UID).
"""

import logging
import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel

from app.config import settings
from app.models import UserProfile
from app.models.user_profile import Registro
from app.prompts.entrevistador import (
    build_gemini_entrevistador_prompt,
    build_session_state_note,
)
from app.prompts.scenarios import get_all_avatars, get_avatar, get_system_prompt
from app.services.analysis import generate_user_profile
from app.services.gemini_live import GEMINI_VOICE_ADDENDUM, generate_text
from app.services.groq_llm import chat_complete
from app.services.llm_costs import estimate_cost
from app.services.openai_llm import chat_complete_openai
from app.services.user_repo import save_chatlab_conversation, save_diagnostic, upsert_user

logger = logging.getLogger("menteviva")


async def verify_chatlab_token(x_chatlab_token: str | None = Header(None, alias="X-ChatLab-Token")):
    """Verifica el token de acceso si settings.chatlab_token está configurado."""
    if settings.chatlab_token:
        if not x_chatlab_token or x_chatlab_token != settings.chatlab_token:
            raise HTTPException(
                status_code=401,
                detail="Token de acceso al ChatLab faltante o inválido."
            )


router = APIRouter(dependencies=[Depends(verify_chatlab_token)])

# Misma marca de cierre que usa el flujo realtime (conversation.py). Aqui solo
# la limpiamos del texto para que no aparezca cruda en la UI de pruebas.
CLOSING_MARKER = "[CIERRE]"


def _extract_closing(reply: str) -> tuple[str, bool]:
    """Extrae el marcador [CIERRE] del texto y devuelve (texto_limpio, hay_cierre)."""
    closing = CLOSING_MARKER in reply
    if closing:
        reply = reply.replace(CLOSING_MARKER, "").strip()
    return reply, closing


def _strip_stage_directions(text: str) -> str:
    """Quita acotaciones escenicas que algunos modelos (Gemini sobre todo)
    emiten como texto plano pese a la regla del prompt: "Silencio.", "(pausa)",
    "*asiente*", "El candidato necesita espacio para procesar", etc. Todo lo que
    devuelve el avatar debe ser DIALOGO; estas narraciones se ven/leen feo.

    Conservador: solo formas claras de acotacion. No toca dialogo real ("necesito
    silencio para concentrarme" se conserva). Si el turno entero era una acotacion,
    devuelve "" y el caller lo trata como respuesta vacia (reintento/aviso).
    """
    if not text:
        return text
    t = text
    # 1) Apartes con asteriscos: *asiente*, *hace una pausa*.
    t = re.sub(r"\*[^*\n]{1,80}\*", " ", t)
    # 2) Parentesis SOLO si contienen palabra de acotacion (respeta "(por ej...)").
    t = re.sub(
        r"(?i)\([^)\n]*?(pausa|silencio|asiente|sonr[ií]e|espera|en voz|para s[ií])[^)\n]*\)",
        " ",
        t,
    )
    # 3) Frases-acotacion tipicas, a inicio de texto o de oracion.
    _stage_sentences = [
        r"silencio\s*[.!:]",
        r"el\s+candidato\s+necesita[^.\n]*\.?",
        r"(?:espero|aguardo)\s+(?:su|la)\s+respuesta[^.\n]*\.?",
        r"(?:hace|hago|hac[eé]s)\s+una\s+pausa[^.\n]*\.?",
        r"(?:doy|dando|dar)\s+espacio\s+para[^.\n]*\.?",
    ]
    for pat in _stage_sentences:
        t = re.sub(rf"(?i)(?:(?<=^)|(?<=[.\n]))\s*{pat}\s*", " ", t)
    # 4) Normaliza espacios sobrantes.
    t = re.sub(r"[ \t]{2,}", " ", t).strip()
    return t


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    avatar_id: str
    # Motor del LLM a evaluar:
    #   "groq"   -> prompt MAESTRO (get_system_prompt) + Groq gpt-oss  [produccion texto]
    #   "gemini" -> para el diagnostico: prompt CONCISO + GEMINI_VOICE_ADDENDUM
    #               + modelo Gemini de texto = "como si fuera la voz, pero sin audio".
    provider: str = "groq"  # "groq" | "gemini" | "chatgpt"
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
    model: str | None = None
    # Solo Gemini + diagnostico. Por DEFECTO el banco corre el prompt MAESTRO
    # (el mismo que Groq/ChatGPT) para comparar motores manzanas con manzanas.
    # Pon use_voice_prompt=True SOLO si quieres evaluar el prompt CONCISO de voz
    # (lo que recibe Gemini native-audio en produccion).
    use_voice_prompt: bool = False
    # Cronometro del frontend: segundos transcurridos desde el primer turno de la
    # sesion. Solo diagnostico: alimenta la NOTA DEL SISTEMA de ritmo (el modelo
    # no tiene reloj; con esto sabe en que % de la sesion va y cuando cerrar).
    elapsed_seconds: int | None = None


class ChatResponse(BaseModel):
    reply: str
    closing: bool = False
    prompt_chars: int
    # Motor que realmente corrio (util en la UI para saber que se evaluo).
    provider: str = "groq"
    model_name: str = ""
    # Latencia total de la llamada al LLM en milisegundos (sin red del cliente).
    latency_ms: int = 0
    # Tokens y costo estimado del turno (None si el proveedor no reporto usage
    # o el modelo no esta tarifado en llm_costs.PRICING). Para la comparacion
    # costo-vs-calidad en la UI del banco.
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None


_GREET_NUDGE = (
    "[El usuario se acaba de conectar y aun no ha dicho nada. Inicia tu la "
    "conversacion: saluda brevemente y comienza segun tu rol, con UNA sola "
    "pregunta.]"
)


def _classify_provider_error(e: Exception, provider: str) -> tuple[int, str]:
    """Clasifica un error del proveedor de LLM en (status_code, mensaje claro).

    Heuristica cross-provider por substrings del mensaje (Gemini/genai, Groq y
    OpenAI usan textos distintos para el mismo problema). El orden importa:
    cuota antes que auth antes que tamaño, etc. Lo no reconocido cae al 502
    generico con el detalle crudo (truncado) para no ocultar nada.
    """
    s = str(e).lower()

    # 1) Cuota / rate-limit (lo mas comun en free tier).
    if any(k in s for k in (
        "resource_exhausted", "rate limit", "rate-limit", "ratelimit",
        "quota", "too many requests", "429",
    )):
        return 429, (
            f"Límite de cuota/rate-limit en {provider}. Espera unos segundos o "
            f"cambia la API key. (Gemini free: 20 req/día por key por modelo; "
            f"Groq/OpenAI: límite del free tier.)"
        )

    # 2) Autenticacion: key faltante, inválida o sin permisos.
    if any(k in s for k in (
        "api key", "api_key", "unauthorized", "401", "invalid authentication",
        "permission_denied", "permission denied", "no esta configurada",
        "no está configurada", "incorrect api key",
    )):
        return 401, (
            f"Autenticación con {provider} falló: revisa que la API key exista y "
            f"sea válida en menteviva-backend/.env."
        )

    # 3) Prompt/contexto demasiado grande o TPM excedido.
    if any(k in s for k in (
        "413", "request too large", "payload", "context length",
        "maximum context", "context_length_exceeded", "too many tokens",
        "tokens per minute", "reduce the length",
    )):
        return 413, (
            f"El prompt es demasiado grande para {provider}/este modelo (límite de "
            f"tokens o TPM del free tier). Usa un modelo con más cupo o acorta el prompt."
        )

    # 4) Modelo inexistente / retirado / request inválido.
    if any(k in s for k in (
        "model_not_found", "does not exist", "not found", "404",
        "invalid model", "decommissioned", "unsupported", "model_decommissioned",
    )):
        return 400, (
            f"Modelo o request inválido en {provider}: puede no existir o estar "
            f"retirado. Prueba otro modelo del selector."
        )

    # 5) Bloqueo por filtros de contenido (típico de Gemini).
    if any(k in s for k in (
        "safety", "blocked", "block_reason", "prohibited_content", "recitation",
    )):
        return 422, (
            f"{provider} bloqueó la respuesta por filtros de contenido. Reformula "
            f"el mensaje o cambia de modelo."
        )

    # 6) Servidor caído / timeout / red.
    if any(k in s for k in (
        "timeout", "timed out", "connection", "network", "unavailable",
        "overloaded", "503", "502", "500", "internal server",
    )):
        return 503, (
            f"{provider} no está disponible o tardó demasiado (error de servidor/red). "
            f"Reintenta en un momento."
        )

    # 7) Cualquier otro: 502 con el detalle crudo (no ocultamos el error real).
    return 502, f"Error del proveedor {provider}: {str(e)[:200]}"


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
            # El banco suele mandar solo {registro:{...}}; completamos los campos
            # obligatorios de UserProfile con placeholders para poder construirlo
            # (asi {{nombre}}, {{rol}}, etc. del prompt se sustituyen de verdad).
            up = dict(req.user_profile)
            up.setdefault("user_id", "chatlab")
            up.setdefault("created_at", "1970-01-01T00:00:00Z")
            up.setdefault("updated_at", "1970-01-01T00:00:00Z")
            user_profile = UserProfile(**up)
        except Exception as e:
            logger.warning(f"[ChatText] user_profile invalido, ignorando: {e}")

    provider = req.provider if req.provider in ("groq", "gemini", "chatgpt") else "groq"
    is_diagnostico = avatar.get("kind") == "diagnostico"

    # ¿Usar el prompt CONCISO de voz? Solo si el caller lo pide explicitamente
    # (Gemini + diagnostico). Por defecto NO: el banco corre el prompt maestro
    # para todos los motores -> comparacion justa entre motores.
    serve_voice_prompt = (
        provider == "gemini" and is_diagnostico and req.use_voice_prompt
    )

    # Seleccion del system_prompt segun el motor a evaluar.
    if serve_voice_prompt:
        # Replica EXACTA de lo que recibe Gemini en voz: prompt conciso + el
        # addendum de voz (que en produccion se anexa dentro de open_session).
        system_prompt = (
            build_gemini_entrevistador_prompt(user_profile, req.session_vars)
            + GEMINI_VOICE_ADDENDUM
        )
    else:
        # Prompt MAESTRO: Groq y ChatGPT siempre; Gemini cuando se fuerza el
        # maestro o para avatares sin variante concisa de voz.
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
    elif is_diagnostico and messages and messages[-1]["role"] == "user":
        # NOTA DEL SISTEMA de ritmo: el modelo no tiene reloj, asi que le
        # anexamos al ultimo turno del usuario el avance de la sesion (tiempo
        # real del cronometro del frontend + intercambios respondidos; manda el
        # mayor). Con eso Sofia señaliza avance ("ultima pregunta...") y cierra
        # a tiempo en vez de entrevistar sin fin. Solo para la llamada al LLM:
        # el cliente nunca guarda la nota en su historial.
        note = build_session_state_note(
            (req.session_vars or {}).get("minutos"),
            elapsed_seconds=req.elapsed_seconds,
            exchanges=sum(1 for m in req.messages if m.role == "user"),
            cierre_como_tool=serve_voice_prompt,
        )
        if note:
            messages[-1] = {
                **messages[-1],
                "content": f"{messages[-1]['content']}\n\n{note}",
            }

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

    t0 = time.perf_counter()
    model_used = req.model or ""
    usage: dict | None = None
    try:
        if provider == "gemini":
            model_used = req.model or settings.gemini_model_text
            if serve_voice_prompt:
                # Cierre via tool-call finalizar_entrevista (como en voz), no [CIERRE].
                reply, closing, usage = await generate_text(
                    messages, system_prompt, enable_closing_tool=is_diagnostico,
                    model=model_used, return_usage=True,
                )
            else:
                # Con el prompt maestro el cierre viene como marcador [CIERRE] en el
                # texto (igual que Groq/ChatGPT), no como tool-call.
                reply, _, usage = await generate_text(
                    messages, system_prompt, enable_closing_tool=False,
                    model=model_used, return_usage=True,
                )
                reply, closing = _extract_closing(reply)
        elif provider == "chatgpt":
            # gpt-5.5 para el entrevistador (mejor calidad) y gpt-5.4-mini para el
            # resto (económico) si no se especifica un modelo.
            model_used = req.model or ("gpt-5.5" if is_diagnostico else "gpt-5.4-mini")
            reply, usage = await chat_complete_openai(
                messages, system_prompt, model=model_used, return_usage=True
            )
            reply, closing = _extract_closing(reply)
        else:
            model_used = req.model or settings.groq_model_llm
            reply, usage = await chat_complete(
                messages, system_prompt, model=model_used, return_usage=True
            )
            reply, closing = _extract_closing(reply)
    except HTTPException:
        raise
    except Exception as e:
        status, detail = _classify_provider_error(e, provider)
        if status >= 500:
            logger.error(f"[ChatText] error {provider}/{model_used}: {e}", exc_info=True)
        else:
            logger.warning(f"[ChatText] {status} en {provider}/{model_used}: {e}")
        raise HTTPException(status_code=status, detail=detail)

    # Guardrail: quita acotaciones escénicas ("Silencio.", "(pausa)", etc.) que el
    # modelo a veces emite como texto pese a la regla del prompt. Se limpian del
    # reply que ve la UI (ruta de texto); la voz nativa no pasa por aquí.
    reply = _strip_stage_directions(reply)

    # Respuesta vacía sin excepción (Gemini/OpenAI pueden devolver "" por bloqueo
    # de contenido o turno de baja señal; Groq ya cae a re-enganche por su cuenta).
    # No la tratamos como error si el avatar cerró la sesión (cierre válido).
    # También cae aquí si el turno entero era una acotación (quedó vacío al limpiar).
    if not (reply or "").strip() and not closing:
        logger.warning(f"[ChatText] {provider}/{model_used} devolvió texto vacío")
        raise HTTPException(
            status_code=422,
            detail=(
                f"{provider} no devolvió texto (posible bloqueo de contenido o "
                f"respuesta vacía). Reintenta o cambia de modelo."
            ),
        )

    latency_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(f"[ChatText] {provider}/{model_used} respondio en {latency_ms} ms")

    # Costo estimado del turno para la UI. La tabla de PRICING esta keyed por
    # "openai", no "chatgpt" (mismo catalogo de modelos).
    cost_usd: float | None = None
    if usage:
        pricing_provider = "openai" if provider == "chatgpt" else provider
        cost_usd = estimate_cost(
            pricing_provider, model_used,
            usage.get("input_tokens"), usage.get("output_tokens"),
        )
        if cost_usd is not None:
            cost_usd = round(cost_usd, 6)

    return ChatResponse(
        reply=reply,
        closing=closing,
        prompt_chars=len(system_prompt),
        provider=provider,
        model_name=model_used,
        latency_ms=latency_ms,
        input_tokens=usage.get("input_tokens") if usage else None,
        output_tokens=usage.get("output_tokens") if usage else None,
        cost_usd=cost_usd,
    )


class DiagnosticoRequest(BaseModel):
    """Payload para generar el diagnostico final de una sesion del entrevistador."""
    messages: list[ChatMessage]
    # Registro opcional {nombre, rol_objetivo, industria, experience_level}. Si
    # falta algun campo se rellena con un placeholder para que el analisis corra.
    user_profile: dict | None = None
    session_vars: dict | None = None
    # Si True, persiste el diagnostico + la conversacion en Postgres (igual que
    # el flujo de voz), bajo un user_id sintetico "chatlab:<nombre>". Si la BD no
    # esta disponible el diagnostico igual se devuelve (persistencia no-fatal).
    save: bool = True


class DiagnosticoResponse(BaseModel):
    diagnostico: dict
    latency_ms: int = 0
    # Estado de la persistencia en BD.
    saved: bool = False
    diagnostic_id: int | None = None
    save_error: str | None = None


def _chatlab_user_id(nombre: str) -> str:
    """user_id sintetico y estable para el banco: 'chatlab:<slug-del-nombre>'.

    El prefijo lo distingue de usuarios reales (Firebase UID) para no mezclar
    datos del piloto con pruebas de laboratorio.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", (nombre or "").lower()).strip("-")
    return f"chatlab:{slug or 'anon'}"


# experience_level debe ser uno de los Literal de Registro; "mid" es valido.
_DEFAULT_REGISTRO = {
    "nombre": "Candidato",
    "rol_objetivo": "Profesional",
    "industria": "General",
    "experience_level": "mid",
}


@router.post("/chat/diagnostico", response_model=DiagnosticoResponse)
async def chat_diagnostico(req: DiagnosticoRequest) -> DiagnosticoResponse:
    """
    Corre el MISMO paso de analisis que produccion (analysis.generate_user_profile,
    Groq gpt-oss-120b) sobre la conversacion del banco de pruebas.

    Esto cierra el hueco del ChatLab: la charla la conduce el motor elegido
    (Groq/Gemini/ChatGPT), pero el diagnostico lo genera SIEMPRE el analizador de
    produccion — tal como en la voz real, donde tras `finalizar_entrevista` corre
    este paso. El registro es opcional; con placeholders el analisis igual corre.
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="Envia la conversacion a analizar.")

    registro_raw = dict(_DEFAULT_REGISTRO)
    provided = (req.user_profile or {}).get("registro") or {}
    for key in _DEFAULT_REGISTRO:
        value = provided.get(key)
        if value:
            registro_raw[key] = value

    try:
        registro = Registro(**registro_raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registro invalido: {e}")

    conversation = [{"role": m.role, "content": m.content} for m in req.messages]

    logger.info(
        f"[ChatText] diagnostico solicitado - intercambios={len(conversation) // 2} "
        f"registro={registro.nombre}/{registro.rol_objetivo}"
    )

    t0 = time.perf_counter()
    diagnostico = await generate_user_profile(
        conversation, registro, session_vars=req.session_vars
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        f"[ChatText] diagnostico generado en {latency_ms} ms "
        f"(is_demo={diagnostico.get('is_demo')})"
    )

    # Persistencia (no-fatal): mismo destino que el flujo de voz. Si la BD no
    # esta disponible, devolvemos el diagnostico igual con save_error.
    saved = False
    diagnostic_id: int | None = None
    save_error: str | None = None
    if req.save:
        try:
            now = datetime.now(timezone.utc).isoformat()
            user_id = _chatlab_user_id(registro.nombre)
            profile = UserProfile(
                user_id=user_id, created_at=now, updated_at=now, registro=registro
            )
            await upsert_user(profile)
            diagnostic_id = await save_diagnostic(user_id, diagnostico, conversation)
            saved = True
            logger.info(f"[ChatText] diagnostico persistido id={diagnostic_id} user={user_id}")
        except Exception as e:
            save_error = str(e)[:200]
            logger.warning(f"[ChatText] no se pudo persistir el diagnostico: {e}")

    return DiagnosticoResponse(
        diagnostico=diagnostico,
        latency_ms=latency_ms,
        saved=saved,
        diagnostic_id=diagnostic_id,
        save_error=save_error,
    )


class SaveConversationRequest(BaseModel):
    """Payload para persistir una conversacion del ChatLab (auto-guardado)."""
    session_id: str
    messages: list[ChatMessage] = []
    # Metadatos opcionales para listar/identificar la conversacion en BD.
    name: str | None = None
    avatar_id: str | None = None
    provider: str | None = None
    model: str | None = None
    minutos: int | None = None
    closed: bool = False
    # Feedback like/dislike por mensaje (alineado por indice con `messages`).
    # Se incrusta en conversation_json para que la calificacion quede en BD.
    feedback: list[str | None] = []
    # Comentario del dislike ("por que no gusto") por mensaje, alineado por indice
    # con `messages`. Se incrusta junto al feedback en conversation_json.
    feedback_comments: list[str | None] = []
    # Encuesta de satisfaccion del diagnostico {rating:1-5, comment, submitted_at}.
    # Se guarda en su propia columna (satisfaction_json). None hasta que el
    # usuario la envia.
    satisfaction: dict | None = None
    # Cronometro de la sesion: ISO del primer turno y duracion real (segundos)
    # que llevo realizarla. Para "que quede registrado" el tiempo de la sesion.
    started_at: str | None = None
    duration_seconds: int | None = None
    # Fiabilidad: cuantos errores del proveedor (502, 429…) vio el usuario y su
    # detalle [{at, status, message}]. Aunque reintente con exito, queda el rastro.
    error_count: int = 0
    errors: list[dict] | None = None
    # Registro para derivar un user_id estable (chatlab:<slug>).
    user_profile: dict | None = None


@router.post("/chat/conversation")
async def save_conversation(req: SaveConversationRequest) -> dict:
    """Upsert (auto-guardado) de una conversacion del ChatLab en Postgres.

    El frontend lo llama tras cada turno y cada cambio de rating. Idempotente por
    session_id: la conversacion (con su feedback) NO se pierde aunque se limpie/
    reinicie o se cambie de dispositivo. Persistencia no-fatal: si la BD falla,
    devolvemos saved=False sin romper la UI (la fuente en vivo es localStorage).
    """
    if not req.session_id:
        raise HTTPException(status_code=400, detail="Falta session_id.")

    # Incrustamos el feedback (y su comentario) en cada mensaje (alineado por indice).
    conversation: list[dict] = []
    for i, m in enumerate(req.messages):
        item: dict = {"role": m.role, "content": m.content}
        fb = req.feedback[i] if i < len(req.feedback) else None
        if fb:
            item["feedback"] = fb
        comment = req.feedback_comments[i] if i < len(req.feedback_comments) else None
        if comment:
            item["feedback_comment"] = comment
        conversation.append(item)

    nombre = ((req.user_profile or {}).get("registro") or {}).get("nombre") or ""
    user_id = _chatlab_user_id(nombre)

    try:
        await save_chatlab_conversation(
            req.session_id,
            conversation,
            user_id=user_id,
            name=req.name,
            avatar_id=req.avatar_id,
            provider=req.provider,
            model=req.model,
            minutos=req.minutos,
            closed=req.closed,
            satisfaction=req.satisfaction,
            started_at=req.started_at,
            duration_seconds=req.duration_seconds,
            error_count=req.error_count,
            errors=req.errors,
        )
        return {"saved": True}
    except Exception as e:
        logger.warning(f"[ChatText] no se pudo persistir la conversacion: {e}")
        return {"saved": False, "error": str(e)[:200]}
