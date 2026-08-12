from unittest.mock import AsyncMock

import pytest

from app.models.user_profile import Registro, UserProfile
from app.services import conversation_finalizer as finalizer


class FakeWebSocket:
    def __init__(self):
        self.events = []

    async def send_json(self, event):
        self.events.append(event)


def profile() -> UserProfile:
    return UserProfile(
        user_id="uid-a",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        registro=Registro(
            nombre="QA",
            rol_objetivo="Lead",
            industria="Software",
            experience_level="mid",
        ),
    )


@pytest.mark.asyncio
async def test_finalizes_and_persists_practice(monkeypatch):
    analyze = AsyncMock(return_value={"overall_score": 88})
    save = AsyncMock(return_value=42)
    monkeypatch.setattr(finalizer, "analyze_conversation", analyze)
    monkeypatch.setattr(finalizer, "save_practice_session", save)
    ws = FakeWebSocket()

    await finalizer.finalize_conversation(
        ws, {"kind": "practice"}, "roberto",
        [{"role": "user", "content": "hola"}, {"role": "assistant", "content": "ok"}],
        0, profile(), None, "intermedio",
    )

    assert ws.events[-1]["type"] == "session_end"
    assert ws.events[-1]["metrics"]["session_id"] == 42
    save.assert_awaited_once()


@pytest.mark.asyncio
async def test_finalizes_diagnostic_with_placeholder(monkeypatch):
    generate = AsyncMock(return_value={"overall_score": 70})
    monkeypatch.setattr(finalizer, "generate_user_profile", generate)
    ws = FakeWebSocket()

    await finalizer.finalize_conversation(
        ws, {"kind": "diagnostico"}, "entrevistador", [], 0, None, None, None,
    )

    assert ws.events[-1]["metrics"]["user_profile_update"]["is_demo"] is True
