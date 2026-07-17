from types import SimpleNamespace

import pytest

from app.services import groq_llm, groq_whisper


def _response(text, prompt_tokens=0, completion_tokens=0):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text))],
        usage=SimpleNamespace(
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        ),
    )


def _chunk(text):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=text))]
    )


class _Completions:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        value = self.responses.pop(0)
        if isinstance(value, BaseException):
            raise value
        return value


def _client(responses):
    completions = _Completions(responses)
    return SimpleNamespace(
        chat=SimpleNamespace(completions=completions), completions=completions
    )


@pytest.mark.asyncio
async def test_chat_stream_emits_tokens(monkeypatch):
    client = _client([[_chunk("hola"), _chunk(None), _chunk(" mundo")]])
    monkeypatch.setattr(groq_llm, "get_groq_client", lambda: client)

    assert [part async for part in groq_llm.chat_stream([], "sistema")] == [
        "hola",
        " mundo",
    ]
    assert client.completions.calls[0]["stream"] is True


@pytest.mark.asyncio
async def test_chat_stream_retries_empty_then_falls_back(monkeypatch):
    client = _client([[], []])
    monkeypatch.setattr(groq_llm, "get_groq_client", lambda: client)
    monkeypatch.setattr(groq_llm, "_next_reengage", lambda: "continua")

    assert [part async for part in groq_llm.chat_stream([], "sistema")] == [
        "continua"
    ]
    assert [call["temperature"] for call in client.completions.calls] == [0.6, 0.85]


@pytest.mark.asyncio
async def test_chat_complete_usage_retry_and_starter(monkeypatch):
    client = _client(
        [
            _response("", 2, 3),
            _response(" respuesta ", 5, 7),
            _response("bienvenida"),
        ]
    )
    costs = []
    monkeypatch.setattr(groq_llm, "get_groq_client", lambda: client)
    monkeypatch.setattr(groq_llm, "log_llm_cost", lambda *args: costs.append(args))

    text, usage = await groq_llm.chat_complete([], "sistema", return_usage=True)
    assert text == "respuesta"
    assert usage == {"input_tokens": 7, "output_tokens": 10}
    assert len(costs) == 2
    assert await groq_llm.get_conversation_starter("sistema", "Sofia") == "bienvenida"


@pytest.mark.asyncio
async def test_chat_complete_propagates_real_error(monkeypatch):
    monkeypatch.setattr(
        groq_llm, "get_groq_client", lambda: _client([RuntimeError("provider")])
    )
    with pytest.raises(RuntimeError, match="provider"):
        await groq_llm.chat_complete([], "sistema")


@pytest.mark.asyncio
async def test_whisper_normalizes_all_sdk_shapes(monkeypatch):
    values = iter([None, SimpleNamespace(text=" hola "), 123])
    transcription_api = SimpleNamespace(create=lambda **_kwargs: next(values))
    client = SimpleNamespace(
        audio=SimpleNamespace(transcriptions=transcription_api)
    )
    monkeypatch.setattr(groq_whisper, "get_groq_client", lambda: client)

    assert await groq_whisper.transcribe_audio(b"x") == ""
    assert await groq_whisper.transcribe_audio(b"x") == "hola"
    assert await groq_whisper.transcribe_audio(b"x") == "123"


@pytest.mark.asyncio
async def test_whisper_details(monkeypatch):
    result = SimpleNamespace(text="hola", language="es", duration=1.25)
    api = SimpleNamespace(create=lambda **_kwargs: result)
    monkeypatch.setattr(
        groq_whisper,
        "get_groq_client",
        lambda: SimpleNamespace(audio=SimpleNamespace(transcriptions=api)),
    )
    assert await groq_whisper.transcribe_audio_with_details(b"x") == {
        "text": "hola",
        "language": "es",
        "duration": 1.25,
    }
