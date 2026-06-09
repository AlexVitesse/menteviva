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

        Se cancela desde afuera (el proxy cancela esta task en end_session).
        """
        while True:
            produced = False
            explicit_complete = False
            async for response in self._session.receive():
                produced = True
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


def _build_config(system_prompt: str, voice: str) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
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
        # VAD menos sensible: sin audifonos el mic capta a Sofia y el VAD lo toma
        # como barge-in y le corta el audio (incluido el saludo). Baja sensibilidad
        # de inicio + mas silencio antes de cerrar turno reduce esos falsos cortes.
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                prefix_padding_ms=300,
                silence_duration_ms=800,
            )
        ),
    )


@asynccontextmanager
async def open_session(avatar_id: str, system_prompt: str):
    """Abre una sesion Gemini Live y la cede como `GeminiLiveSession`.

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
    config = _build_config(system_prompt + GEMINI_VOICE_ADDENDUM, voice)

    logger.info(f"[GeminiLive] Abriendo sesion - avatar={avatar_id} voz={voice} modelo={model}")
    async with client.aio.live.connect(model=model, config=config) as session:
        yield GeminiLiveSession(session, avatar_id)
    logger.info(f"[GeminiLive] Sesion cerrada - avatar={avatar_id}")
