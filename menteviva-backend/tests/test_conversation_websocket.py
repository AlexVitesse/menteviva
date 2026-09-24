from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.models.user_profile import Registro, UserProfile
from app.routers import conversation


def test_init_cannot_impersonate_another_user(monkeypatch):
    async def consume(_ticket):
        return "uid-owner"

    async def get_profile(_uid):
        return UserProfile(
            user_id="uid-owner",
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
            registro=Registro(
                nombre="Owner",
                rol_objetivo="Lead",
                industria="Software",
                experience_level="mid",
            ),
        )

    async def acquire(_uid):
        return True, None

    monkeypatch.setattr(settings, "realtime_provider", "groq")
    monkeypatch.setattr(conversation, "consume_ws_ticket", consume)
    monkeypatch.setattr(conversation, "get_user_profile", get_profile)
    monkeypatch.setattr(conversation, "acquire_conversation_slot", acquire)
    monkeypatch.setattr(conversation, "get_avatar", lambda _avatar: {"kind": "practice"})
    app = FastAPI()
    app.include_router(conversation.router, prefix="/api")

    with TestClient(app) as client:
        with client.websocket_connect("/api/conversation/roberto?ticket=valid") as ws:
            ws.send_json({
                "type": "init",
                "user_profile": {"user_id": "uid-attacker"},
            })
            event = ws.receive_json()
            assert event["type"] == "error"
            assert event["code"] == "invalid_protocol"


def _authorized_app(monkeypatch):
    async def consume(_ticket):
        return "uid-owner"

    async def get_profile(_uid):
        return UserProfile(
            user_id="uid-owner", created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
            registro=Registro(
                nombre="Owner", rol_objetivo="Lead", industria="Software",
                experience_level="mid",
            ),
        )

    monkeypatch.setattr(settings, "realtime_provider", "groq")
    monkeypatch.setattr(conversation, "consume_ws_ticket", consume)
    monkeypatch.setattr(conversation, "get_user_profile", get_profile)
    monkeypatch.setattr(
        conversation, "acquire_conversation_slot", AsyncMock(return_value=(True, None))
    )
    monkeypatch.setattr(conversation, "get_avatar", lambda _avatar: {"kind": "practice"})
    monkeypatch.setattr(conversation, "get_system_prompt", lambda *_args, **_kwargs: "prompt")
    app = FastAPI()
    app.include_router(conversation.router, prefix="/api")
    return app


def test_classic_text_session_reaches_shared_turn_and_finalizer(monkeypatch):
    app = _authorized_app(monkeypatch)

    async def process(ws, **kwargs):
        kwargs["conversation_history"].extend([
            {"role": "user", "content": kwargs["user_text"]},
            {"role": "assistant", "content": "respuesta"},
        ])
        await ws.send_json({"type": "status", "status": "ready"})

    async def finalize(ws, *_args):
        await ws.send_json({"type": "session_end", "metrics": {"total_exchanges": 1}})

    process_mock = AsyncMock(side_effect=process)
    monkeypatch.setattr(conversation, "_process_classic_turn", process_mock)
    monkeypatch.setattr(conversation, "finalize_conversation", finalize)
    with TestClient(app) as client:
        with client.websocket_connect("/api/conversation/roberto?ticket=valid") as ws:
            ws.send_json({"type": "init", "level": "intermedio"})
            assert ws.receive_json() == {"type": "status", "status": "ready"}
            ws.send_json({"type": "text", "text": "hola"})
            assert ws.receive_json()["status"] == "ready"
            ws.send_json({"type": "end_session"})
            assert ws.receive_json()["type"] == "session_end"
    process_mock.assert_awaited_once()


def test_classic_audio_session_transcribes_before_shared_turn(monkeypatch):
    app = _authorized_app(monkeypatch)
    monkeypatch.setattr(
        conversation.groq_provider, "transcribe", AsyncMock(return_value="texto transcrito")
    )

    async def process(ws, **_kwargs):
        await ws.send_json({"type": "status", "status": "ready"})

    process_mock = AsyncMock(side_effect=process)
    monkeypatch.setattr(conversation, "_process_classic_turn", process_mock)
    with TestClient(app) as client:
        with client.websocket_connect("/api/conversation/roberto?ticket=valid") as ws:
            ws.send_json({"type": "audio", "audio": "YQ==", "format": "audio.webm"})
            assert ws.receive_json()["status"] == "transcribing"
            assert ws.receive_json()["status"] == "ready"
    assert process_mock.await_args.kwargs["user_text"] == "texto transcrito"


def _run_turns_then_drop(monkeypatch, turns):
    """Abre la sesion, manda `turns` turnos de texto y cierra SIN end_session.
    Devuelve los argumentos con los que se llamo al finalizer (o None)."""
    import threading

    app = _authorized_app(monkeypatch)

    async def process(ws, **kwargs):
        kwargs["conversation_history"].extend([
            {"role": "user", "content": kwargs["user_text"]},
            {"role": "assistant", "content": "respuesta"},
        ])
        await ws.send_json({"type": "status", "status": "ready"})

    called = threading.Event()
    seen = {}

    async def finalize(ws, *args):
        seen["ws"], seen["history"] = ws, args[2]
        called.set()

    monkeypatch.setattr(conversation, "_process_classic_turn", AsyncMock(side_effect=process))
    monkeypatch.setattr(conversation, "finalize_conversation", finalize)
    with TestClient(app) as client:
        with client.websocket_connect("/api/conversation/roberto?ticket=valid") as ws:
            for i in range(turns):
                ws.send_json({"type": "text", "text": f"turno {i}"})
                assert ws.receive_json()["status"] == "ready"
        # Pestaña cerrada: el analisis corre en segundo plano.
        called.wait(timeout=2)
    return seen or None


def test_dropped_session_is_analyzed_without_client(monkeypatch):
    seen = _run_turns_then_drop(monkeypatch, turns=4)
    assert seen is not None
    assert seen["ws"] is None  # no intenta escribirle a un socket cerrado
    assert len(seen["history"]) == 8


def test_short_dropped_session_is_not_saved(monkeypatch):
    # < 4 intercambios: analyze_conversation daria puntajes demo aleatorios.
    assert _run_turns_then_drop(monkeypatch, turns=2) is None
