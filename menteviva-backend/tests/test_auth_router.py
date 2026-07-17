from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.config import settings
from app.routers import auth


@pytest.mark.asyncio
async def test_register_uses_verified_uid_and_firebase_email(monkeypatch):
    monkeypatch.setattr(
        auth, "get_firebase_user",
        AsyncMock(return_value={"email": "verified@example.test", "email_verified": True}),
    )
    register = AsyncMock(return_value=MagicMock())
    register.return_value.model_dump.return_value = {"user_id": "uid-a"}
    monkeypatch.setattr(auth, "register_firebase_user", register)
    body = auth.RegisterBody(
        nombre="QA", rol_objetivo="Lead", industria="Software", experience_level="mid"
    )
    result = await auth.auth_register(body, uid="uid-a")
    assert result == {"user_id": "uid-a"}
    assert register.await_args.kwargs["firebase_uid"] == "uid-a"
    assert register.await_args.kwargs["email"] == "verified@example.test"


@pytest.mark.asyncio
async def test_sync_returns_404_without_profile(monkeypatch):
    monkeypatch.setattr(auth, "get_user_profile", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await auth.auth_sync("uid-a")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_sync_touches_login_and_returns_profile(monkeypatch):
    profile = MagicMock()
    profile.model_dump.return_value = {"user_id": "uid-a"}
    monkeypatch.setattr(auth, "get_user_profile", AsyncMock(return_value=profile))
    touch = AsyncMock()
    monkeypatch.setattr(auth, "touch_last_login", touch)
    assert await auth.auth_sync("uid-a") == {"user_id": "uid-a"}
    touch.assert_awaited_once_with("uid-a")


@pytest.mark.asyncio
async def test_ticket_and_operator_metrics(monkeypatch):
    monkeypatch.setattr(auth, "issue_ws_ticket", AsyncMock(return_value=("opaque", 45)))
    assert await auth.create_ws_ticket("uid-a") == {"ticket": "opaque", "expires_in": 45}
    monkeypatch.setattr(settings, "chatlab_operator_uids", "uid-operator")
    monkeypatch.setattr(auth, "snapshot", AsyncMock(return_value={"ok": 1}))
    monkeypatch.setattr(auth, "active_alerts", AsyncMock(return_value=[]))
    assert await auth.operational_metrics("uid-operator") == {
        "metrics": {"ok": 1}, "alerts": []
    }
    with pytest.raises(HTTPException) as exc:
        await auth.operational_metrics("uid-user")
    assert exc.value.status_code == 403
