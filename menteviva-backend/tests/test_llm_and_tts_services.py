from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.config import settings
from app.services import edge_tts, llm_costs, openai_llm


def test_cost_catalog_exact_prefix_unknown_and_estimate():
    assert llm_costs.price_for("openai", "gpt-5.4") == (2.5, 15.0)
    assert llm_costs.price_for("openai", "gpt-5.4-2026") == (2.5, 15.0)
    assert llm_costs.price_for("unknown", "x") is None
    assert llm_costs.estimate_cost("openai", "gpt-5.4", 1_000_000, 1_000_000) == 17.5
    assert llm_costs.estimate_cost("unknown", "x", 1, 1) is None
    assert llm_costs.log_llm_cost("openai", "gpt-5.4", 10, 20) is not None
    assert llm_costs.log_llm_cost("unknown", "x", None, None) is None


def test_openai_helpers_and_lazy_client(monkeypatch):
    assert openai_llm._is_reasoning_model("gpt-5.4")
    assert openai_llm._is_reasoning_model("o3-mini")
    assert not openai_llm._is_reasoning_model("gpt-4o")
    assert openai_llm._log_cost("gpt-4o", SimpleNamespace(usage=None)) is None
    response = SimpleNamespace(
        usage=SimpleNamespace(prompt_tokens=10, completion_tokens=20)
    )
    assert openai_llm._log_cost("gpt-4o", response) == {
        "input_tokens": 10, "output_tokens": 20
    }
    monkeypatch.setattr(openai_llm, "_client", None)
    monkeypatch.setattr(settings, "chatgpt_api_key", "")
    with pytest.raises(RuntimeError):
        openai_llm.get_openai_client()


@pytest.mark.asyncio
@pytest.mark.parametrize("model,reasoning", [("gpt-5.4-mini", True), ("gpt-4o", False)])
async def test_openai_completion_uses_compatible_parameters(monkeypatch, model, reasoning):
    create = AsyncMock(return_value=SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=" respuesta "))],
        usage=SimpleNamespace(prompt_tokens=3, completion_tokens=4),
    ))
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(openai_llm, "get_openai_client", lambda: client)
    reply, usage = await openai_llm.chat_complete_openai(
        [{"role": "user", "content": "hola"}], "prompt", model, return_usage=True
    )
    assert reply == "respuesta" and usage == {"input_tokens": 3, "output_tokens": 4}
    kwargs = create.await_args.kwargs
    assert ("reasoning_effort" in kwargs) is reasoning
    assert ("temperature" in kwargs) is not reasoning


def test_tts_cleanup_client_and_sync_generation(monkeypatch):
    assert edge_tts.clean_text_for_tts("(sonrie)  Hola   mundo") == "Hola mundo"
    fake = MagicMock()
    fake.text_to_speech.convert.return_value = [b"a", b"b"]
    monkeypatch.setattr(edge_tts, "_client", fake)
    assert edge_tts._get_client() is fake
    assert edge_tts._generate_sync("hola", "voice") == b"ab"


@pytest.mark.asyncio
async def test_tts_retries_and_streams_without_real_provider(monkeypatch):
    generate = AsyncMock(side_effect=[RuntimeError("temporary"), b"audio"])
    monkeypatch.setattr(edge_tts, "_generate", generate)
    monkeypatch.setattr(edge_tts.asyncio, "sleep", AsyncMock())
    assert await edge_tts.text_to_speech("(accion) hola", "unknown") == b"audio"

    fake = MagicMock()
    fake.text_to_speech.convert_as_stream.return_value = iter([b"a", b"", b"b"])
    monkeypatch.setattr(edge_tts, "_client", fake)
    chunks = [chunk async for chunk in edge_tts.text_to_speech_stream("hola", "roberto")]
    assert chunks == [b"a", b"b"]
