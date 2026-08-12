"""
Servicio de conversacion en tiempo real con Gemini Live API (audio nativo).

PoC (Fase 1) de la migracion descrita en docs/plans/05_gemini_live_voice.md:
reemplazar el pipeline STT(Whisper) + LLM(gpt-oss) + TTS(ElevenLabs) por una
sola sesion bidireccional speech-to-speech.

Este modulo expone SOLO lo minimo para el smoke test:
- `GEMINI_VOICES`: voz prebuilt de Google por avatar (analogo a AVATAR_VOICES
  de edge_tts.py, pero con voces nativas de Gemini, no ElevenLabs).
- `open_session(avatar_id, system_prompt)`: async context manager que abre la
  sesion Live con el system prompt como `system_instruction` y devuelve una
  `GeminiLiveSession` con helpers para enviar turnos y recolectar la respuesta.

El proxy WebSocket, el streaming de microfono y el manejo de barge-in se
construyen en fases posteriores (ver el plan). Aqui no se toca el router ni el
frontend.

Formato de audio:
- Entrada (cuando se use mic): PCM16 mono 16 kHz.
- Salida (lo que genera Gemini): PCM16 mono 24 kHz (raw, sin contenedor).
"""

import asyncio
import logging
import struct
from contextlib import asynccontextmanager
from dataclasses import dataclass
from threading import Lock

from google import genai
from google.genai import types

from app.config import settings
from app.services.llm_costs import log_llm_cost

logger = logging.getLogger("menteviva")

# ============================================================
# Rotacion de API keys de Gemini (round-robin, thread-safe)
# ============================================================
# El free tier de Gemini es 20 req/dia POR KEY POR MODELO. Con varias keys en
# .env (GEMINI_API_KEY, GEMINI_API_KEY2/3/4) repartimos las llamadas y estiramos
# la cuota, igual que GroqPool. La lista se lee de settings en cada llamada para
# no cachear un estado viejo si cambian las keys.
_gemini_key_index = 0
_gemini_key_lock = Lock()


def _next_gemini_key() -> str:
    """Siguiente API key de Gemini en round-robin. Lanza si no hay ninguna."""
    global _gemini_key_index
    keys = settings.gemini_api_keys
    if not keys:
        raise RuntimeError(
            "GEMINI_API_KEY no esta configurada. Obten una gratis en "
            "https://aistudio.google.com y ponla en menteviva-backend/.env"
        )
    with _gemini_key_lock:
        key = keys[_gemini_key_index % len(keys)]
        _gemini_key_index += 1
    return key


# El SDK de google-genai reintenta 503/"high demand" internamente con backoff
# exponencial ANTES de propagar el error: eso hacia que un turno colgara ~46s en
# una sola key saturada antes de que nuestro failover saltara a la siguiente.
# Cortamos ese retry interno (attempts=1) para que el 503 aflore al instante y
# nuestro loop de rotacion pruebe otra key de inmediato; el timeout duro evita
# ademas que una conexion colgada monopolice el turno.
_GEMINI_HTTP_OPTIONS = types.HttpOptions(
    timeout=20_000,  # ms; cap por intento
    retry_options=types.HttpRetryOptions(attempts=1),  # sin backoff interno
)


def _gemini_client(
    http_options: types.HttpOptions | None = None,
    api_key: str | None = None,
) -> genai.Client:
    """Cliente Gemini. Usa `api_key` si se pasa; si no, rota la siguiente del pool.

    `http_options` se aplica solo al path de TEXTO (generate_content); la sesion
    Live de audio usa el default para no meterle un timeout HTTP a un websocket
    persistente.

    `api_key` explicita se usa para PINNEAR una key durante la vida de una sesion
    Live: el handle de session_resumption esta atado al PROYECTO de Google de la
    key con que se abrio, asi que reconectar con otra key (otro proyecto) revienta
    con 1008 "Session does not belong to this project". Ver open_session.
    """
    kwargs = {"api_key": api_key or _next_gemini_key()}
    if http_options is not None:
        kwargs["http_options"] = http_options
    return genai.Client(**kwargs)


def _num_gemini_keys() -> int:
    return len(settings.gemini_api_keys)


def _should_try_next_key(e: Exception) -> bool:
    """¿El error justifica reintentar con OTRA key del pool?

    Sí para cuota/rate-limit (429), auth (key inválida/sin permisos) y caídas
    transitorias del servidor: otra key (p.ej. una de pago con cupo) puede
    resolverlo. NO para bloqueos de contenido, modelo inexistente o request
    inválido: darían el mismo resultado con cualquier key -> no gastamos cuota.
    """
    s = str(e).lower()
    return any(
        k in s
        for k in (
            "resource_exhausted", "rate limit", "rate-limit", "ratelimit",
            "quota", "too many requests", "429",
            "api key", "api_key", "unauthorized", "401", "permission_denied",
            "permission denied", "invalid authentication",
            "503", "500", "unavailable", "overloaded", "internal server",
            "timeout", "timed out",
        )
    )

# Sample rate del audio que emite Gemini Live (PCM16 mono). Lo necesita el
# consumidor para envolver los bytes en un WAV o reproducirlos correctamente.
OUTPUT_SAMPLE_RATE = 24000
INPUT_SAMPLE_RATE = 16000

# Voz prebuilt de Gemini por avatar. Se eligen 4 voces DISTINTAS respetando el
# genero de cada persona (igual criterio que edge_tts.AVATAR_VOICES):
#   - roberto      -> masculina
#   - maria        -> femenina
#   - carlos       -> masculina (distinta a Roberto)
#   - entrevistador (Sofia) -> femenina (distinta a Maria)
# Catalogo de voces: https://ai.google.dev/gemini-api/docs/speech-generation
# (Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr, ...).
# VALIDADAS por escucha en el smoke test (2026-06-05): Kore/Charon/Aoede
# aprobadas por el dueño de producto. carlos=Fenrir queda tentativo (el avatar
# aun no existe en scenarios.py::AVATARS — se confirma cuando se implemente).
GEMINI_VOICES = {
    "roberto": "Charon",        # masculina, grave — aprobada
    "maria": "Aoede",           # femenina — aprobada
    "carlos": "Fenrir",         # masculina (tentativa; avatar no implementado)
    "entrevistador": "Kore",    # Sofia - femenina — aprobada
}
DEFAULT_VOICE = "Kore"


def get_voice(avatar_id: str) -> str:
    return GEMINI_VOICES.get(avatar_id, DEFAULT_VOICE)


# Addendum que se anexa al system_prompt SOLO en la rama Gemini. El prompt base
# fue afinado para gpt-oss (texto); Gemini native-audio lo interpreta distinto y
# tiende a (a) esperar a que hable el usuario y (b) hacer "eco" repitiendo lo que
# el usuario dijo (justo lo que el prompt base ya prohibe, pero Gemini lo ignora).
# Estas reglas, al final del prompt, pesan mas para el modelo de voz.
GEMINI_VOICE_ADDENDUM = """

============================================================
REGLAS PARA ESTA LLAMADA DE VOZ EN TIEMPO REAL (máxima prioridad)
============================================================
1. INICIA TÚ. Apenas comienza la llamada, saluda en 1–2 frases y haz tu primera
   pregunta. NO esperes a que la otra persona hable primero.
2. NUNCA repitas, parafrasees ni hagas "eco" de lo que la persona acaba de decir.
   Nada de "Entonces lo que me dices es...", ni repetir su frase. Como mucho un
   gancho de 3–5 palabras ("Interesante.", "Ya veo.") y pasa DIRECTO a tu pregunta.
   Repetir lo que dijo suena robótico y está PROHIBIDO.
3. Habla natural, cálido y BREVE, como en una conversación real — no leas un guion
   ni expliques la metodología como un instructivo largo. Intégrala con naturalidad.
4. Una sola pregunta por turno. Frases cortas.
5. TEXTO PLANO: esto es voz. Nada de markdown (asteriscos **, viñetas, títulos)
   ni emojis. Para enfatizar, entónalo — no lo marques con símbolos.
6. SOLO DIÁLOGO: todo lo que emites se DICE en voz alta. Nada de acotaciones ni
   narración ("Silencio.", "(pausa)", "El candidato necesita procesar", "*asiente*").
   Si quieres dar espacio, di una frase breve o termina tu turno — no lo describas.
"""


@dataclass
class TurnResult:
    """Resultado de un turno del asistente recolectado de la sesion Live."""

    audio: bytes = b""                 # PCM16 mono 24 kHz (raw)
    output_transcript: str = ""        # lo que DIJO el avatar (texto)
    input_transcript: str = ""         # transcripcion de lo que envio el user
    interrupted: bool = False          # True si el modelo reporto barge-in

    @property
    def audio_seconds(self) -> float:
        # PCM16 mono: 2 bytes por sample.
        return len(self.audio) / (OUTPUT_SAMPLE_RATE * 2)


class GeminiLiveSession:
    """Envoltura fina sobre una sesion `live.connect` ya abierta."""

    def __init__(self, session, avatar_id: str, api_key: str | None = None):
        self._session = session
        self.avatar_id = avatar_id
        # Handle de resumption mas reciente (lo emite el servidor). El proxy lo
        # usa para reconectar sin perder el hilo cuando llega un go_away.
        self.resume_handle: str | None = None
        # Key con que se abrio esta sesion. El proxy la reusa al reconectar con
        # resume_handle: el handle es por-PROYECTO, rotar de key da 1008.
        self.api_key: str | None = api_key

    async def send_text(self, text: str) -> None:
        """Envia un turno de usuario como TEXTO (util para el smoke test).

        En produccion el turno del usuario llega como audio del microfono via
        `send_audio_chunk`; el texto se usa para validar la sesion sin tener
        que sintetizar audio de entrada.
        """
        await self._session.send_client_content(
            turns=types.Content(role="user", parts=[types.Part(text=text)]),
            turn_complete=True,
        )

    async def send_context_note(self, text: str) -> None:
        """Inyecta una nota de CONTEXTO sin disparar un turno del modelo.

        turn_complete=False => el contenido se agrega a la conversacion y el
        modelo lo ve al procesar su siguiente turno; NO genera respuesta
        inmediata (a diferencia de send_text). Lo usa el proxy para el ritmo
        del diagnostico: la NOTA DEL SISTEMA con el avance del tiempo de sesion
        (ver entrevistador.build_session_state_note).
        """
        await self._session.send_client_content(
            turns=types.Content(role="user", parts=[types.Part(text=text)]),
            turn_complete=False,
        )

    async def send_audio_chunk(self, pcm16_16k: bytes) -> None:
        """Envia un chunk de audio del microfono (PCM16 mono 16 kHz)."""
        await self._session.send_realtime_input(
            audio=types.Blob(data=pcm16_16k, mime_type="audio/pcm;rate=16000")
        )

    async def send_tool_response(self, function_call) -> None:
        """Responde a un tool-call para que el modelo continue su turno."""
        await self._session.send_tool_response(
            function_responses=[
                types.FunctionResponse(
                    id=getattr(function_call, "id", None),
                    name=getattr(function_call, "name", None),
                    response={"status": "ok"},
                )
            ]
        )

    async def events(self):
        """Async generator que normaliza los eventos crudos de Gemini Live a
        traves de MULTIPLES turnos (toda la sesion).

        Clave: `session.receive()` cede UN turno y termina (asi lo documenta el
        SDK: "the returned responses will represent a complete model turn"). Para
        una conversacion lo envolvemos en un `while True` que vuelve a llamar
        `receive()` por turno; el fin del `async for` interno ES la frontera de
        turno. Entre turnos, `receive()` bloquea hasta que llega la respuesta al
        siguiente input del usuario.

        A diferencia de `collect_turn` (que acumula un turno, util en el smoke
        test), esto cede cada evento conforme llega — lo que necesita el proxy
        WebSocket para forwarding incremental.

        Cede dicts con `type`:
          - {"type": "audio", "data": <bytes PCM24>}     chunk de audio del avatar
          - {"type": "input_text", "text": str}          transcripcion del usuario
          - {"type": "output_text", "text": str}         transcripcion del avatar
          - {"type": "interrupted"}                       barge-in detectado
          - {"type": "turn_complete"}                     fin del turno del modelo
          - {"type": "tool_call", "name": str, "call": fc} el modelo llamo una funcion
          - {"type": "go_away"}                            el servidor va a cortar la sesion

        Ademas actualiza self.resume_handle con cada session_resumption_update.
        Se cancela desde afuera (el proxy cancela esta task en end_session).
        """
        while True:
            produced = False
            explicit_complete = False
            async for response in self._session.receive():
                produced = True

                # Tool call (cierre): el modelo llamo finalizar_entrevista.
                tc = getattr(response, "tool_call", None)
                if tc and getattr(tc, "function_calls", None):
                    for fc in tc.function_calls:
                        yield {"type": "tool_call", "name": fc.name, "call": fc}

                # Handle de resumption para reconectar sesiones largas.
                sru = getattr(response, "session_resumption_update", None)
                if sru and getattr(sru, "new_handle", None):
                    self.resume_handle = sru.new_handle

                # El servidor avisa que va a cerrar la conexion (limite de sesion).
                if getattr(response, "go_away", None) is not None:
                    yield {"type": "go_away"}

                if getattr(response, "data", None):
                    yield {"type": "audio", "data": response.data}

                sc = getattr(response, "server_content", None)
                if sc is None:
                    continue

                it = getattr(sc, "input_transcription", None)
                if it and it.text:
                    yield {"type": "input_text", "text": it.text}
                ot = getattr(sc, "output_transcription", None)
                if ot and ot.text:
                    yield {"type": "output_text", "text": ot.text}
                if getattr(sc, "interrupted", False):
                    yield {"type": "interrupted"}
                if getattr(sc, "turn_complete", False):
                    explicit_complete = True
                    yield {"type": "turn_complete"}

            # `receive()` se agoto. Si no produjo nada, la sesion se cerro: salir
            # limpio (evita busy-spin). Si produjo turno pero sin flag explicito
            # de turn_complete, sintetizamos uno para que el proxy cierre el turno.
            if not produced:
                return
            if not explicit_complete:
                yield {"type": "turn_complete"}

    async def collect_turn(self) -> TurnResult:
        """Consume la respuesta del modelo hasta `turn_complete`.

        Acumula los chunks de audio y las transcripciones parcial/finales. Se
        usa en el smoke test (turn-based). El proxy WS real hara forwarding
        incremental en vez de acumular.
        """
        result = TurnResult()
        audio = bytearray()
        out_parts: list[str] = []
        in_parts: list[str] = []

        async for response in self._session.receive():
            # Audio: el SDK expone los bytes inline en response.data.
            if getattr(response, "data", None):
                audio.extend(response.data)

            sc = getattr(response, "server_content", None)
            if sc is None:
                continue

            if getattr(sc, "input_transcription", None) and sc.input_transcription.text:
                in_parts.append(sc.input_transcription.text)
            if getattr(sc, "output_transcription", None) and sc.output_transcription.text:
                out_parts.append(sc.output_transcription.text)
            if getattr(sc, "interrupted", False):
                result.interrupted = True
            if getattr(sc, "turn_complete", False):
                break

        result.audio = bytes(audio)
        result.output_transcript = "".join(out_parts).strip()
        result.input_transcript = "".join(in_parts).strip()
        return result


# Tool de cierre para el diagnostico. Reemplaza el marcador de texto [CIERRE] del
# pipeline Groq (que en voz nativa el modelo pronunciaria en voz alta). El modelo
# llama esta funcion cuando junto material suficiente; el proxy la mapea a un
# evento closing_intent hacia el cliente (que dispara el countdown de cierre).
CLOSING_TOOL = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="finalizar_entrevista",
            description=(
                "Llama esta funcion UNA sola vez cuando ya juntaste material "
                "suficiente (2-3 historias con detalle sobre competencias distintas) "
                "y la entrevista debe terminar. Despidete con calidez ANTES de "
                "llamarla. NUNCA la llames al inicio ni a mitad de la conversacion."
            ),
            parameters=types.Schema(type=types.Type.OBJECT, properties={}),
        )
    ]
)


def _build_config(
    system_prompt: str,
    voice: str,
    *,
    enable_closing_tool: bool = False,
    resume_handle: str | None = None,
) -> types.LiveConnectConfig:
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part(text=system_prompt)]),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
            )
        ),
        # Necesitamos el texto en ambos sentidos para: captions, deteccion de
        # cierre y reconstruir el conversation_history que alimenta el analisis
        # de Groq al final de la sesion (que NO migramos).
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        # VAD configurable por .env (ver config.py). Tradeoff eco vs "se queda
        # callada": start HIGH capta mejor tu voz (responde, no se queda esperando)
        # pero el eco puede cortarla -> audifonos. Defaults HIGH/HIGH/500.
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                start_of_speech_sensitivity=(
                    types.StartSensitivity.START_SENSITIVITY_LOW
                    if settings.gemini_vad_start_sensitivity.upper() == "LOW"
                    else types.StartSensitivity.START_SENSITIVITY_HIGH
                ),
                end_of_speech_sensitivity=(
                    types.EndSensitivity.END_SENSITIVITY_LOW
                    if settings.gemini_vad_end_sensitivity.upper() == "LOW"
                    else types.EndSensitivity.END_SENSITIVITY_HIGH
                ),
                prefix_padding_ms=300,
                silence_duration_ms=settings.gemini_vad_silence_ms,
            )
        ),
        # Sesiones largas (el diagnostico apunta a ~25 min):
        # - context_window_compression (sliding window): la sesion NO muere al
        #   llenar la ventana de contexto; comprime los turnos viejos.
        # - session_resumption: el servidor emite handles periodicos; al recibir
        #   un go_away (aviso de corte ~cada pocos minutos) el proxy reconecta con
        #   el ultimo handle sin que el usuario lo note. resume_handle != None en
        #   las reconexiones.
        context_window_compression=types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow(),
        ),
        session_resumption=types.SessionResumptionConfig(handle=resume_handle),
    )
    if enable_closing_tool:
        config.tools = [CLOSING_TOOL]
    return config


@asynccontextmanager
async def open_session(
    avatar_id: str,
    system_prompt: str,
    *,
    enable_closing_tool: bool = False,
    resume_handle: str | None = None,
    api_key: str | None = None,
):
    """Abre una sesion Gemini Live y la cede como `GeminiLiveSession`.

    enable_closing_tool: declara finalizar_entrevista (cierre del diagnostico).
    resume_handle: si se pasa, reanuda una sesion previa (reconexion transparente).
    api_key: si se pasa, PINNEA la key (no rota). Obligatorio al reconectar con
        resume_handle para no cambiar de proyecto (el handle es por-proyecto ->
        rotar da 1008). El caller lee `live.api_key` de la 1a sesion y lo reusa.

    Uso:
        async with open_session("entrevistador", prompt) as live:
            await live.send_text("Hola")
            turn = await live.collect_turn()
    """
    # 1a apertura (api_key=None): rota el pool para balancear carga. Reconexion:
    # el caller pasa la MISMA key para que el resume_handle siga siendo valido.
    used_key = api_key or _next_gemini_key()
    client = _gemini_client(api_key=used_key)
    voice = get_voice(avatar_id)
    model = settings.gemini_model_live
    # Anexamos las reglas de voz al final (mas peso para el modelo native-audio).
    config = _build_config(
        system_prompt + GEMINI_VOICE_ADDENDUM,
        voice,
        enable_closing_tool=enable_closing_tool,
        resume_handle=resume_handle,
    )

    tag = " (resume)" if resume_handle else ""
    logger.info(f"[GeminiLive] Abriendo sesion{tag} - avatar={avatar_id} voz={voice} modelo={model}")
    async with client.aio.live.connect(model=model, config=config) as session:
        yield GeminiLiveSession(session, avatar_id, api_key=used_key)
    logger.info(f"[GeminiLive] Sesion cerrada - avatar={avatar_id}")


async def generate_text(
    messages: list[dict],
    system_prompt: str,
    *,
    enable_closing_tool: bool = False,
    model: str | None = None,
    return_usage: bool = False,
) -> tuple[str, bool] | tuple[str, bool, dict | None]:
    """Genera UNA respuesta de Gemini en modo TEXTO (sin voz).

    Reproduce el MODELO Gemini que se usa en voz nativa pero por texto: mismo
    proveedor y (si el caller pasa el prompt conciso + GEMINI_VOICE_ADDENDUM) el
    mismo system_prompt que en la llamada Live, solo que via `generate_content`
    (stateless, response=TEXT). No abre sesion Live ni produce audio. Pensado
    para el banco de pruebas de prompts (chat_text.py, provider="gemini").

    NOTA: usa `gemini_model_text` (flash de texto), NO el modelo native-audio de
    voz; el prompt se evalua igual pero el modelo no es byte-a-byte el de la voz.

    Devuelve (texto, closing) donde closing=True si el modelo llamo a
    `finalizar_entrevista` (equivalente al marcador [CIERRE] del pipeline Groq).
    Con return_usage=True devuelve (texto, closing, usage) donde usage es
    {"input_tokens": int, "output_tokens": int} (thinking contado como output,
    que es como factura Google) o None si el SDK no reporto usage_metadata.
    """
    # Gemini usa el rol "model" para el asistente (no "assistant" como OpenAI/Groq).
    contents = [
        types.Content(
            role="model" if m["role"] == "assistant" else "user",
            parts=[types.Part(text=m["content"])],
        )
        for m in messages
    ]

    config = types.GenerateContentConfig(
        system_instruction=types.Content(parts=[types.Part(text=system_prompt)]),
    )
    if enable_closing_tool:
        config.tools = [CLOSING_TOOL]

    model_to_use = model or settings.gemini_model_text

    # Failover entre keys: si una da 429/cuota/auth/5xx, reintenta con la
    # siguiente del pool (round-robin). Cada _gemini_client() avanza el indice,
    # asi que N intentos prueban N keys distintas. La ultima excepcion propaga.
    attempts = max(1, _num_gemini_keys())
    last_err: Exception | None = None
    resp = None
    for i in range(attempts):
        client = _gemini_client(http_options=_GEMINI_HTTP_OPTIONS)

        def _call():
            return client.models.generate_content(
                model=model_to_use,
                contents=contents,
                config=config,
            )

        try:
            # generate_content es sincrono en el SDK; a un hilo para no bloquear.
            resp = await asyncio.to_thread(_call)
            break
        except Exception as e:  # noqa: BLE001 - clasificamos abajo
            last_err = e
            if i < attempts - 1 and _should_try_next_key(e):
                logger.warning(
                    f"[GeminiText] key {i + 1}/{attempts} fallo "
                    f"type={type(e).__name__}; reintentando con la siguiente key"
                )
                continue
            raise

    if resp is None:  # defensivo: no deberia pasar (el bucle propaga antes)
        raise last_err or RuntimeError("Gemini no devolvio respuesta")

    # Costo estimado del turno a los logs. Gemini factura los tokens de "thinking"
    # como output, asi que los sumamos a candidates_token_count.
    usage = getattr(resp, "usage_metadata", None)
    usage_out: dict | None = None
    if usage:
        in_tok = getattr(usage, "prompt_token_count", 0) or 0
        out_tok = (getattr(usage, "candidates_token_count", 0) or 0) + (
            getattr(usage, "thoughts_token_count", 0) or 0
        )
        log_llm_cost("gemini", model_to_use, in_tok, out_tok)
        usage_out = {"input_tokens": in_tok, "output_tokens": out_tok}

    text_parts: list[str] = []
    closing = False
    candidates = resp.candidates or []
    cand = candidates[0] if candidates else None
    if cand and cand.content and cand.content.parts:
        for part in cand.content.parts:
            if getattr(part, "text", None):
                text_parts.append(part.text)
            fc = getattr(part, "function_call", None)
            if fc and getattr(fc, "name", "") == "finalizar_entrevista":
                closing = True

    text = "".join(text_parts).strip()
    # Defensa para Gemini texto: nunca exponer controles internos y mantener
    # el contrato conversacional de una pregunta por turno.
    from app.prompts.entrevistador import sanitize_interviewer_text

    text = sanitize_interviewer_text(text)
    if return_usage:
        return text, closing, usage_out
    return text, closing


# ============================================================
# Señal vocal experimental (VoiceLab) — tono/nervios desde el audio crudo
# ============================================================
# Idea: en vez de sumar un modelo de emocion dedicado, aprovechamos que Gemini
# ya entiende audio nativamente. El proxy WS bufferea el audio PCM del USUARIO
# (no el de Sofia) durante la sesion Live y, al cerrar, se lo mandamos aqui en
# una sola llamada de texto/multimodal pidiendole que describa el TONO (no el
# contenido). Solo VoiceLab lo usa hoy (ver conversation.py _run_gemini_conversation,
# finalize=False) para validar si aporta algo al diagnostico antes de decidir si
# vale la pena llevarlo a produccion.
_VOCAL_TONE_MIN_SECONDS = 3.0
# Ventana deslizante: si la sesion es larga, solo mandamos lo mas reciente para
# no pasarnos del limite de audio inline de generate_content ni inflar cuota.
_VOCAL_TONE_MAX_SECONDS = 180.0
# Tope en bytes de la ventana (PCM16 mono 16 kHz). Lo usa tambien el proxy WS
# (conversation.py) para recortar el buffer SOBRE LA MARCHA: sin ese recorte,
# una sesion de 60 min acumularia ~115 MB de RAM que igual se descartarian aqui.
VOCAL_TONE_MAX_BYTES = int(_VOCAL_TONE_MAX_SECONDS * 16000 * 2)

_VOCAL_TONE_PROMPT = (
    "Vas a escuchar un fragmento de audio de un candidato hablando durante una "
    "entrevista de trabajo simulada. Ignora POR COMPLETO lo que dice (el "
    "contenido ya se analiza aparte) y describe en 1-2 frases breves solo COMO "
    "suena su voz: ritmo, pausas, firmeza, temblor, energia, cambios de tono a "
    "lo largo del fragmento. Si no percibes señales claras de nervios o "
    "emocion particular, dilo honestamente en vez de inventar. Responde SOLO "
    "esa descripcion, sin preambulos ni disclaimers."
)


def _pcm16_to_wav(pcm: bytes, sample_rate: int = 16000) -> bytes:
    """Envuelve PCM16 mono crudo en un contenedor WAV (header de 44 bytes).

    generate_content NO acepta `audio/pcm` crudo (eso es exclusivo de la Live
    API); los formatos documentados son WAV/MP3/AAC/OGG/FLAC. WAV es el envoltorio
    mas barato: solo un header, sin re-encodear.
    """
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(pcm), b"WAVE",
        b"fmt ", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16,
        b"data", len(pcm),
    )
    return header + pcm


async def analyze_vocal_tone(audio_pcm16_16k: bytes) -> str | None:
    """Lee el TONO de un fragmento de audio del usuario (nervios/energia).

    EXPERIMENTAL: reutiliza `gemini_model_text` (multimodal) con el audio
    crudo como input en vez de meter un modelo de emocion dedicado. Best-effort
    — devuelve None si el audio es muy corto o si Gemini falla; nunca debe
    bloquear el cierre de la sesion de VoiceLab.
    """
    min_bytes = int(_VOCAL_TONE_MIN_SECONDS * 16000 * 2)
    if not audio_pcm16_16k or len(audio_pcm16_16k) < min_bytes:
        return None

    if len(audio_pcm16_16k) > VOCAL_TONE_MAX_BYTES:
        audio_pcm16_16k = audio_pcm16_16k[-VOCAL_TONE_MAX_BYTES:]

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part(text=_VOCAL_TONE_PROMPT),
                types.Part(
                    inline_data=types.Blob(
                        data=_pcm16_to_wav(audio_pcm16_16k), mime_type="audio/wav"
                    )
                ),
            ],
        )
    ]

    attempts = max(1, _num_gemini_keys())
    for i in range(attempts):
        client = _gemini_client(http_options=_GEMINI_HTTP_OPTIONS)

        def _call():
            return client.models.generate_content(
                model=settings.gemini_model_text,
                contents=contents,
            )

        try:
            resp = await asyncio.to_thread(_call)
        except Exception as e:  # noqa: BLE001
            if i < attempts - 1 and _should_try_next_key(e):
                logger.warning(
                    f"[GeminiVocalTone] key {i + 1}/{attempts} fallo "
                    f"type={type(e).__name__}; reintentando con la siguiente key"
                )
                continue
            logger.warning(
                "[GeminiVocalTone] fallo, se omite la señal type=%s", type(e).__name__
            )
            return None

        usage = getattr(resp, "usage_metadata", None)
        if usage:
            log_llm_cost(
                "gemini",
                settings.gemini_model_text,
                getattr(usage, "prompt_token_count", 0) or 0,
                (getattr(usage, "candidates_token_count", 0) or 0)
                + (getattr(usage, "thoughts_token_count", 0) or 0),
            )
        return (getattr(resp, "text", None) or "").strip() or None

    return None
