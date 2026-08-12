import pytest

from app.models.ws_protocol import parse_client_message


def test_classic_protocol_accepts_known_messages():
    assert parse_client_message({"type": "text", "text": "hola"}) == {
        "type": "text",
        "text": "hola",
    }
    assert parse_client_message({"type": "end_session"}) == {"type": "end_session"}


def test_protocol_rejects_unknown_type_and_extra_identity():
    with pytest.raises(ValueError):
        parse_client_message({"type": "unknown"})
    with pytest.raises(ValueError):
        parse_client_message(
            {"type": "init", "user_profile": {"user_id": "attacker"}}
        )


def test_live_protocol_only_accepts_pcm_chunks():
    assert parse_client_message(
        {"type": "audio_chunk", "pcm": "YWJj"}, live=True
    ) == {"type": "audio_chunk", "pcm": "YWJj"}
    with pytest.raises(ValueError):
        parse_client_message({"type": "audio", "audio": "YWJj"}, live=True)
