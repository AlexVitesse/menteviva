from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.routers import chat_text


def test_text_cleanup_and_provider_error_contracts():
    assert chat_text._extract_closing("adios [CIERRE]") == ("adios", True)
    assert chat_text._extract_closing("hola") == ("hola", False)
    cleaned = chat_text._strip_stage_directions("*asiente* Silencio. Hola (por ejemplo)")
    assert "asiente" not in cleaned and "Silencio" not in cleaned
    assert "por ejemplo" in cleaned
    cases = [
        ("quota 429", 429), ("invalid api key 401", 401),
        ("context length 413", 413), ("model_not_found", 400),
        ("blocked by safety", 422), ("network timeout", 503),
        ("opaque sdk internals", 502),
    ]
    for message, expected in cases:
        status, public = chat_text._classify_provider_error(RuntimeError(message), "fake")
        assert status == expected
        if expected == 502:
            assert "opaque sdk internals" not in public


@pytest.mark.asyncio
async def test_avatar_list_and_chatlab_slug():
    result = await chat_text.list_chat_avatars()
    assert result["avatars"]
    assert chat_text._chatlab_user_id("Ána QA 1") == "chatlab:na-qa-1"
    assert chat_text._chatlab_user_id("") == "chatlab:anon"


@pytest.mark.asyncio
async def test_diagnostic_uses_fake_analysis_and_persists(monkeypatch):
    generated = {"is_demo": False, "competencias_foco": ["liderazgo"]}
    monkeypatch.setattr(
        chat_text, "generate_user_profile", AsyncMock(return_value=generated)
    )
    upsert = AsyncMock()
    save = AsyncMock(return_value=77)
    monkeypatch.setattr(chat_text, "upsert_user", upsert)
    monkeypatch.setattr(chat_text, "save_diagnostic", save)
    request = chat_text.DiagnosticoRequest(
        messages=[chat_text.ChatMessage(role="user", content="historia")],
        user_profile={"registro": {
            "nombre": "Ana", "rol_objetivo": "Lead", "industria": "Software",
            "experience_level": "mid",
        }},
        save=True,
    )
    result = await chat_text.chat_diagnostico(request)
    assert result.saved is True and result.diagnostic_id == 77
    assert save.await_args.args[0] == "chatlab:ana"


@pytest.mark.asyncio
async def test_diagnostic_persistence_failure_is_sanitized(monkeypatch):
    monkeypatch.setattr(
        chat_text, "generate_user_profile", AsyncMock(return_value={"is_demo": True})
    )
    monkeypatch.setattr(
        chat_text, "upsert_user", AsyncMock(side_effect=RuntimeError("password=secret"))
    )
    request = chat_text.DiagnosticoRequest(
        messages=[chat_text.ChatMessage(role="user", content="hola")], save=True
    )
    result = await chat_text.chat_diagnostico(request)
    assert result.saved is False
    assert "secret" not in (result.save_error or "")


@pytest.mark.asyncio
async def test_conversation_upsert_embeds_feedback_and_is_idempotent(monkeypatch):
    save = AsyncMock()
    monkeypatch.setattr(chat_text, "save_chatlab_conversation", save)
    request = chat_text.SaveConversationRequest(
        session_id="session-a",
        messages=[chat_text.ChatMessage(role="assistant", content="respuesta")],
        feedback=["dislike"],
        feedback_comments=["muy larga"],
        user_profile={"registro": {"nombre": "Ana"}},
    )
    assert await chat_text.save_conversation(request) == {"saved": True}
    stored = save.await_args.args[1]
    assert stored[0]["feedback"] == "dislike"
    assert stored[0]["feedback_comment"] == "muy larga"

    save.side_effect = RuntimeError("postgres password secret")
    failed = await chat_text.save_conversation(request)
    assert failed["saved"] is False and "secret" not in failed["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["groq", "gemini", "chatgpt", "unknown"])
async def test_chat_dispatches_every_provider_without_real_api(monkeypatch, provider):
    monkeypatch.setattr(
        chat_text, "get_avatar", lambda _id: {"kind": "diagnostico", "name": "Sofia"}
    )
    monkeypatch.setattr(chat_text, "get_system_prompt", lambda *_args, **_kwargs: "master")
    monkeypatch.setattr(
        chat_text, "build_gemini_entrevistador_prompt", lambda *_args: "voice"
    )
    monkeypatch.setattr(
        chat_text, "chat_complete",
        AsyncMock(return_value=("groq reply [CIERRE]", {"input_tokens": 1, "output_tokens": 2})),
    )
    monkeypatch.setattr(
        chat_text, "chat_complete_openai", AsyncMock(return_value=("openai reply", None))
    )
    monkeypatch.setattr(
        chat_text, "generate_text", AsyncMock(return_value=("gemini reply", True, None))
    )
    request = chat_text.ChatRequest(
        avatar_id="entrevistador", provider=provider, greet=True,
        use_voice_prompt=provider == "gemini",
    )
    result = await chat_text.chat(request)
    expected = provider if provider in {"groq", "gemini", "chatgpt"} else "groq"
    assert result.provider == expected
    assert result.reply


@pytest.mark.asyncio
async def test_chat_validates_avatar_messages_empty_reply_and_provider_error(monkeypatch):
    monkeypatch.setattr(chat_text, "get_avatar", lambda _id: None)
    with pytest.raises(HTTPException) as exc:
        await chat_text.chat(chat_text.ChatRequest(avatar_id="missing", greet=True))
    assert exc.value.status_code == 404

    monkeypatch.setattr(chat_text, "get_avatar", lambda _id: {"kind": "practice"})
    monkeypatch.setattr(chat_text, "get_system_prompt", lambda *_args, **_kwargs: "prompt")
    with pytest.raises(HTTPException) as exc:
        await chat_text.chat(chat_text.ChatRequest(avatar_id="roberto"))
    assert exc.value.status_code == 400

    monkeypatch.setattr(chat_text, "chat_complete", AsyncMock(return_value=("", None)))
    with pytest.raises(HTTPException) as exc:
        await chat_text.chat(chat_text.ChatRequest(avatar_id="roberto", greet=True))
    assert exc.value.status_code == 422

    monkeypatch.setattr(
        chat_text, "chat_complete", AsyncMock(side_effect=RuntimeError("quota 429 secret"))
    )
    with pytest.raises(HTTPException) as exc:
        await chat_text.chat(chat_text.ChatRequest(avatar_id="roberto", greet=True))
    assert exc.value.status_code == 429
    assert "secret" not in exc.value.detail
