import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import firebase_auth


@pytest.mark.asyncio
async def test_verify_rejects_unavailable_missing_and_empty(monkeypatch):
    monkeypatch.setattr(firebase_auth, "is_configured", lambda: False)
    with pytest.raises(HTTPException) as exc:
        await firebase_auth.verify_firebase_token("Bearer secret")
    assert exc.value.status_code == 503
    assert "secret" not in exc.value.detail

    monkeypatch.setattr(firebase_auth, "is_configured", lambda: True)
    for header in (None, "Basic x", "Bearer   "):
        with pytest.raises(HTTPException) as exc:
            await firebase_auth.verify_firebase_token(header)
        assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_verify_and_get_user_with_fake_firebase(monkeypatch):
    class Expired(Exception):
        pass

    class Invalid(Exception):
        pass

    fake_auth = SimpleNamespace(
        ExpiredIdTokenError=Expired,
        InvalidIdTokenError=Invalid,
        verify_id_token=lambda token: {"uid": f"uid-{token}"},
        get_user=lambda uid: SimpleNamespace(
            uid=uid, email="qa@example.test", email_verified=True, display_name="QA"
        ),
    )
    monkeypatch.setitem(sys.modules, "firebase_admin", SimpleNamespace(auth=fake_auth))
    monkeypatch.setattr(firebase_auth, "is_configured", lambda: True)
    assert await firebase_auth.verify_firebase_token("Bearer token") == "uid-token"
    user = await firebase_auth.get_firebase_user("uid-a")
    assert user["email_verified"] is True

    fake_auth.verify_id_token = lambda _token: (_ for _ in ()).throw(Expired())
    with pytest.raises(HTTPException) as exc:
        await firebase_auth.verify_firebase_token("Bearer expired")
    assert exc.value.detail == "Token expirado"
    fake_auth.verify_id_token = lambda _token: (_ for _ in ()).throw(Invalid("internal"))
    with pytest.raises(HTTPException) as exc:
        await firebase_auth.verify_firebase_token("Bearer invalid")
    assert exc.value.detail == "Token invalido"


def test_is_configured_uses_lazy_initialization(monkeypatch):
    monkeypatch.setattr(firebase_auth, "_initialized", False)

    def initialize():
        firebase_auth._initialized = True
        return True

    monkeypatch.setattr(firebase_auth, "_try_init", initialize)
    assert firebase_auth.is_configured() is True
