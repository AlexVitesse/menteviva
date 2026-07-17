from types import SimpleNamespace

import pytest

from app.services import gemini_live


class _AsyncItems:
    def __init__(self, items):
        self.items = items

    def __aiter__(self):
        async def iterate():
            for item in self.items:
                yield item

        return iterate()


class _LiveRawSession:
    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = []

    def receive(self):
        return _AsyncItems(self.turns.pop(0) if self.turns else [])

    async def send_client_content(self, **kwargs):
        self.calls.append(("content", kwargs))

    async def send_realtime_input(self, **kwargs):
        self.calls.append(("audio", kwargs))

    async def send_tool_response(self, **kwargs):
        self.calls.append(("tool", kwargs))


def _server_content(**kwargs):
    defaults = dict(
        input_transcription=None,
        output_transcription=None,
        interrupted=False,
        turn_complete=False,
    )
    return SimpleNamespace(**(defaults | kwargs))


@pytest.mark.asyncio
async def test_live_session_send_helpers_and_collect_turn():
    raw = _LiveRawSession(
        [[
            SimpleNamespace(data=b"ab", server_content=None),
            SimpleNamespace(
                data=b"cd",
                server_content=_server_content(
                    input_transcription=SimpleNamespace(text=" usuario "),
                    output_transcription=SimpleNamespace(text=" respuesta "),
                    interrupted=True,
                    turn_complete=True,
                ),
            ),
        ]]
    )
    live = gemini_live.GeminiLiveSession(raw, "roberto", api_key="key")

    await live.send_text("hola")
    await live.send_context_note("nota")
    await live.send_audio_chunk(b"pcm")
    await live.send_tool_response(SimpleNamespace(id="1", name="fin"))
    result = await live.collect_turn()

    assert [kind for kind, _ in raw.calls] == ["content", "content", "audio", "tool"]
    assert result.audio == b"abcd"
    assert result.input_transcript == "usuario"
    assert result.output_transcript == "respuesta"
    assert result.interrupted is True
    assert result.audio_seconds == pytest.approx(4 / 48_000)


@pytest.mark.asyncio
async def test_live_events_normalizes_all_events():
    function_call = SimpleNamespace(name="finalizar_entrevista")
    response = SimpleNamespace(
        tool_call=SimpleNamespace(function_calls=[function_call]),
        session_resumption_update=SimpleNamespace(new_handle="resume"),
        go_away=object(),
        data=b"audio",
        server_content=_server_content(
            input_transcription=SimpleNamespace(text="u"),
            output_transcription=SimpleNamespace(text="a"),
            interrupted=True,
            turn_complete=True,
        ),
    )
    live = gemini_live.GeminiLiveSession(_LiveRawSession([[response], []]), "maria")

    events = [event async for event in live.events()]
    assert [event["type"] for event in events] == [
        "tool_call", "go_away", "audio", "input_text", "output_text",
        "interrupted", "turn_complete",
    ]
    assert live.resume_handle == "resume"


@pytest.mark.asyncio
async def test_live_events_synthesizes_turn_complete():
    response = SimpleNamespace(
        tool_call=None, session_resumption_update=None, go_away=None,
        data=b"x", server_content=None,
    )
    live = gemini_live.GeminiLiveSession(_LiveRawSession([[response], []]), "maria")
    assert [event["type"] async for event in live.events()] == [
        "audio", "turn_complete"
    ]


def test_key_rotation_classification_voice_config_and_wav(monkeypatch):
    monkeypatch.setattr(
        gemini_live,
        "settings",
        SimpleNamespace(
            gemini_api_keys=["a", "b"],
            gemini_vad_start_sensitivity="HIGH",
            gemini_vad_end_sensitivity="HIGH",
            gemini_vad_silence_ms=500,
        ),
    )
    monkeypatch.setattr(gemini_live, "_gemini_key_index", 0)
    assert [gemini_live._next_gemini_key() for _ in range(3)] == ["a", "b", "a"]
    assert gemini_live._should_try_next_key(RuntimeError("429 quota")) is True
    assert gemini_live._should_try_next_key(RuntimeError("bad request")) is False
    assert gemini_live.get_voice("maria") == "Aoede"
    assert gemini_live.get_voice("unknown") == gemini_live.DEFAULT_VOICE
    config = gemini_live._build_config("prompt", "Kore", enable_closing_tool=True)
    assert config.tools == [gemini_live.CLOSING_TOOL]
    wav = gemini_live._pcm16_to_wav(b"\x00\x01")
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE" and wav[-2:] == b"\x00\x01"


def test_missing_key_and_client_options(monkeypatch):
    monkeypatch.setattr(
        gemini_live, "settings", SimpleNamespace(gemini_api_keys=[])
    )
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        gemini_live._next_gemini_key()

    created = []
    monkeypatch.setattr(
        gemini_live.genai,
        "Client",
        lambda **kwargs: created.append(kwargs) or SimpleNamespace(),
    )
    options = SimpleNamespace()
    gemini_live._gemini_client(http_options=options, api_key="explicit")
    assert created == [{"api_key": "explicit", "http_options": options}]


def _text_response(text="hola", *, closing=False, usage=True):
    parts = [SimpleNamespace(text=text, function_call=None)]
    if closing:
        parts.append(
            SimpleNamespace(
                text=None,
                function_call=SimpleNamespace(name="finalizar_entrevista"),
            )
        )
    metadata = (
        SimpleNamespace(
            prompt_token_count=2, candidates_token_count=3, thoughts_token_count=4
        )
        if usage else None
    )
    return SimpleNamespace(
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=parts))],
        usage_metadata=metadata,
        text=text,
    )


@pytest.mark.asyncio
async def test_generate_text_returns_closing_and_usage(monkeypatch):
    models = SimpleNamespace(generate_content=lambda **_kwargs: _text_response(closing=True))
    monkeypatch.setattr(gemini_live, "_num_gemini_keys", lambda: 1)
    monkeypatch.setattr(
        gemini_live, "_gemini_client", lambda **_kwargs: SimpleNamespace(models=models)
    )
    costs = []
    monkeypatch.setattr(gemini_live, "log_llm_cost", lambda *args: costs.append(args))

    result = await gemini_live.generate_text(
        [{"role": "assistant", "content": "previo"}],
        "sistema",
        enable_closing_tool=True,
        return_usage=True,
    )
    assert result == ("hola", True, {"input_tokens": 2, "output_tokens": 7})
    assert costs[0][-2:] == (2, 7)


@pytest.mark.asyncio
async def test_generate_text_failover(monkeypatch):
    outcomes = iter([RuntimeError("429 quota"), _text_response("ok", usage=False)])
    models = SimpleNamespace(generate_content=lambda **_kwargs: next(outcomes))

    def generate(**_kwargs):
        value = next(outcomes)
        if isinstance(value, Exception):
            raise value
        return value

    models.generate_content = generate
    monkeypatch.setattr(gemini_live, "_num_gemini_keys", lambda: 2)
    monkeypatch.setattr(
        gemini_live, "_gemini_client", lambda **_kwargs: SimpleNamespace(models=models)
    )
    assert await gemini_live.generate_text([], "sistema") == ("ok", False)


@pytest.mark.asyncio
async def test_analyze_vocal_tone_short_success_and_failure(monkeypatch):
    assert await gemini_live.analyze_vocal_tone(b"short") is None
    enough = b"\x00" * (3 * 16_000 * 2)
    models = SimpleNamespace(generate_content=lambda **_kwargs: _text_response(" firme "))
    monkeypatch.setattr(gemini_live, "_num_gemini_keys", lambda: 1)
    monkeypatch.setattr(
        gemini_live, "_gemini_client", lambda **_kwargs: SimpleNamespace(models=models)
    )
    monkeypatch.setattr(gemini_live, "log_llm_cost", lambda *_args: None)
    assert await gemini_live.analyze_vocal_tone(enough) == "firme"

    def fail(**_kwargs):
        raise RuntimeError("bad request")

    models.generate_content = fail
    assert await gemini_live.analyze_vocal_tone(enough) is None
