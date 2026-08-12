from unittest.mock import AsyncMock

import pytest

from app.services import conversation_providers as providers


@pytest.mark.asyncio
async def test_groq_adapter_delegates_stt(monkeypatch):
    transcribe = AsyncMock(return_value="hola")
    monkeypatch.setattr(providers, "transcribe_audio", transcribe)
    adapter = providers.GroqConversationProvider()
    assert await adapter.transcribe(b"audio", "audio.webm") == "hola"
    transcribe.assert_awaited_once_with(b"audio", filename="audio.webm")


@pytest.mark.asyncio
async def test_groq_adapter_streams_llm_and_tts(monkeypatch):
    async def reply(_history, _prompt):
        for item in ["a", "b"]:
            yield item

    async def speech(_text, _avatar):
        yield b"audio"

    monkeypatch.setattr(providers, "chat_stream", reply)
    monkeypatch.setattr(providers, "text_to_speech_stream", speech)
    adapter = providers.GroqConversationProvider()
    assert [item async for item in adapter.stream_reply([], "prompt")] == ["a", "b"]
    assert [item async for item in adapter.stream_speech("hola", "roberto")] == [b"audio"]


def test_gemini_adapter_delegates_session_factory(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(providers, "open_session", lambda **_kwargs: sentinel)
    assert providers.GeminiLiveProvider().open(prompt="x") is sentinel
