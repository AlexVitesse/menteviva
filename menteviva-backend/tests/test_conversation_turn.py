import asyncio

import pytest

from app.config import settings
from app.services.conversation_turn import TurnProcessor


class Provider:
    async def stream_reply(self, _history, _prompt):
        yield "[CIERRE]"

    async def stream_speech(self, text, _avatar):
        assert "Muchas gracias" in text
        yield b"audio"


class Socket:
    def __init__(self):
        self.events = []

    async def send_json(self, event):
        self.events.append(event)


@pytest.mark.asyncio
async def test_turn_pipeline_applies_default_closing_and_typed_audio_events():
    ws = Socket()
    history = []
    processor = TurnProcessor(Provider())
    await processor.process(
        ws,
        user_text="hola",
        conversation_history=history,
        avatar_id="entrevistador",
        llm_history=[{"role": "user", "content": "hola"}],
        system_prompt="prompt",
        closing_detector=lambda text: (text.replace("[CIERRE]", ""), True),
        fallback_name="Ana",
    )
    assert history[0] == {"role": "user", "content": "hola"}
    assert history[1]["role"] == "assistant"
    assert [event["type"] for event in ws.events][-3:] == [
        "assistant_audio_end", "closing_intent", "status"
    ]


@pytest.mark.asyncio
async def test_turn_pipeline_times_out_llm(monkeypatch):
    class SlowProvider(Provider):
        async def stream_reply(self, _history, _prompt):
            await asyncio.sleep(0.05)
            yield "late"

    monkeypatch.setattr(settings, "provider_llm_timeout_seconds", 0.001)
    with pytest.raises(TimeoutError):
        await TurnProcessor(SlowProvider()).process(
            Socket(), user_text="hola", conversation_history=[], avatar_id="x",
            llm_history=[], system_prompt="x", closing_detector=lambda text: (text, False),
            fallback_name=None,
        )
