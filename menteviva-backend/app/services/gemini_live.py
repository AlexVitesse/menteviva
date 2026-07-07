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
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger("menteviva")

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

    def __init__(self, session, avatar_id: str):
        self._session = session
        self.avatar_id = avatar_id
        # Handle de resumption mas reciente (lo emite el servidor). El proxy lo
        # usa para reconectar sin perder el hilo cuando llega un go_away.
        self.resume_handle: str | None = None

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
):
    """Abre una sesion Gemini Live y la cede como `GeminiLiveSession`.

    enable_closing_tool: declara finalizar_entrevista (cierre del diagnostico).
    resume_handle: si se pasa, reanuda una sesion previa (reconexion transparente).

    Uso:
        async with open_session("entrevistador", prompt) as live:
            await live.send_text("Hola")
            turn = await live.collect_turn()
    """
    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY no esta configurada. Obten una gratis en "
            "https://aistudio.google.com y ponla en menteviva-backend/.env"
        )

    client = genai.Client(api_key=settings.gemini_api_key)
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
        yield GeminiLiveSession(session, avatar_id)
    logger.info(f"[GeminiLive] Sesion cerrada - avatar={avatar_id}")


async def generate_text(
    messages: list[dict],
    system_prompt: str,
    *,
    enable_closing_tool: bool = False,
) -> tuple[str, bool]:
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
    """
    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY no esta configurada. Obten una gratis en "
            "https://aistudio.google.com y ponla en menteviva-backend/.env"
        )

    client = genai.Client(api_key=settings.gemini_api_key)

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

    def _call():
        return client.models.generate_content(
            model=settings.gemini_model_text,
            contents=contents,
            config=config,
        )

    # generate_content es sincrono en el SDK; a un hilo para no bloquear el loop.
    resp = await asyncio.to_thread(_call)

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

    return "".join(text_parts).strip(), closing
