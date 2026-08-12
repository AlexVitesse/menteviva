"""Adaptadores inyectables para proveedores usados por la conversación."""

from collections.abc import AsyncIterator

from app.services.edge_tts import text_to_speech_stream
from app.services.gemini_live import open_session
from app.services.groq_llm import chat_stream
from app.services.groq_whisper import transcribe_audio


class GroqConversationProvider:
    async def transcribe(self, audio: bytes, filename: str) -> str:
        return await transcribe_audio(audio, filename=filename)

    async def stream_reply(
        self, history: list[dict], system_prompt: str
    ) -> AsyncIterator[str]:
        async for token in chat_stream(history, system_prompt):
            yield token

    async def stream_speech(self, text: str, avatar_id: str) -> AsyncIterator[bytes]:
        async for chunk in text_to_speech_stream(text, avatar_id):
            yield chunk


class GeminiLiveProvider:
    def open(self, *args, **kwargs):
        # Passthrough completo: el caller pasa avatar_id y system_prompt POSICIONALES
        # (conversation_session.py). Sin *args esto lanzaba TypeError antes de abrir
        # la sesion, y el except generico lo reportaba como "fallo inesperado".
        return open_session(*args, **kwargs)


groq_provider = GroqConversationProvider()
gemini_provider = GeminiLiveProvider()
