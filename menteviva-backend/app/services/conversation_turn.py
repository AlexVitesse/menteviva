"""Pipeline común de un turno: LLM, cierre, historial y TTS."""

import asyncio
import base64
import logging
import time
from collections.abc import Callable

from fastapi import WebSocket

from app.config import settings
from app.services.conversation_providers import GroqConversationProvider
from app.services.telemetry import observe_seconds

logger = logging.getLogger("menteviva")


class TurnProcessor:
    def __init__(self, provider: GroqConversationProvider):
        self.provider = provider

    async def process(
        self,
        websocket: WebSocket,
        *,
        user_text: str,
        conversation_history: list[dict],
        avatar_id: str,
        llm_history: list[dict],
        system_prompt: str,
        closing_detector: Callable[[str], tuple[str, bool]],
        fallback_name: str | None,
    ) -> tuple[float, float]:
        await websocket.send_json({"type": "user_message", "content": user_text})
        conversation_history.append({"role": "user", "content": user_text})
        await websocket.send_json({"type": "status", "status": "thinking"})

        started = time.monotonic()
        parts: list[str] = []
        async with asyncio.timeout(settings.provider_llm_timeout_seconds):
            async for token in self.provider.stream_reply(llm_history, system_prompt):
                parts.append(token)
                await websocket.send_json({"type": "assistant_token", "content": token})
        llm_seconds = time.monotonic() - started
        await observe_seconds(
            "provider_latency", llm_seconds, provider="groq", operation="llm"
        )
        response, should_close = closing_detector("".join(parts))
        if should_close and not response.strip():
            response = (
                f"Muchas gracias, {fallback_name}. Tengo buen material para darte tu mapa."
                if fallback_name
                else "Muchas gracias. Tengo buen material para darte tu mapa."
            )
        conversation_history.append({"role": "assistant", "content": response})
        await websocket.send_json({"type": "status", "status": "generating_audio"})

        await websocket.send_json({"type": "assistant_audio_start", "content": response})
        started = time.monotonic()
        try:
            async with asyncio.timeout(settings.provider_tts_timeout_seconds):
                async for chunk in self.provider.stream_speech(response, avatar_id):
                    await websocket.send_json({
                        "type": "assistant_audio_chunk",
                        "audio": base64.b64encode(chunk).decode(),
                    })
        finally:
            await websocket.send_json({"type": "assistant_audio_end"})
        tts_seconds = time.monotonic() - started
        await observe_seconds(
            "provider_latency", tts_seconds, provider="edge_tts", operation="tts"
        )
        if should_close:
            await websocket.send_json({"type": "closing_intent"})
        await websocket.send_json({"type": "status", "status": "ready"})
        logger.info(
            "[WS] turno completado llm_seconds=%.2f tts_seconds=%.2f tokens=%d",
            llm_seconds,
            tts_seconds,
            len(parts),
        )
        return llm_seconds, tts_seconds
