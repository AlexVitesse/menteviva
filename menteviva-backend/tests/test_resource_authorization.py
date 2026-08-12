from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import profiles, sessions
from app.routers.conversation import _decode_base64_limited, _validate_text_turn
from app.services.firebase_auth import verify_firebase_token

TEST_UID = "firebase-user-a"


def _authenticated_app() -> FastAPI:
    app = FastAPI()
    app.include_router(profiles.router, prefix="/api")
    app.include_router(sessions.router, prefix="/api")
    app.dependency_overrides[verify_firebase_token] = lambda: TEST_UID
    return app


def test_legacy_profile_path_cannot_impersonate_another_user():
    with TestClient(_authenticated_app()) as client:
        response = client.get("/api/user/firebase-user-b")

    assert response.status_code == 404


def test_legacy_sessions_path_cannot_impersonate_another_user():
    with TestClient(_authenticated_app()) as client:
        response = client.get("/api/user/firebase-user-b/sessions")

    assert response.status_code == 404


def test_session_lookup_receives_authenticated_owner(monkeypatch):
    seen: dict[str, object] = {}

    async def fake_get_session(session_id: int, owner_uid: str):
        seen.update(session_id=session_id, owner_uid=owner_uid)
        return None

    monkeypatch.setattr(sessions, "get_session", fake_get_session)
    with TestClient(_authenticated_app()) as client:
        response = client.get("/api/session/42")

    assert response.status_code == 404
    assert seen == {"session_id": 42, "owner_uid": TEST_UID}


def test_diagnostic_lookup_receives_authenticated_owner(monkeypatch):
    seen: dict[str, object] = {}

    async def fake_get_diagnostic(diagnostic_id: int, owner_uid: str):
        seen.update(diagnostic_id=diagnostic_id, owner_uid=owner_uid)
        return None

    monkeypatch.setattr(profiles, "get_diagnostic", fake_get_diagnostic)
    with TestClient(_authenticated_app()) as client:
        response = client.get("/api/diagnostic/7")

    assert response.status_code == 404
    assert seen == {"diagnostic_id": 7, "owner_uid": TEST_UID}


def test_sessions_limit_is_bounded():
    with TestClient(_authenticated_app()) as client:
        assert client.get("/api/me/sessions?limit=0").status_code == 422
        assert client.get("/api/me/sessions?limit=101").status_code == 422


def test_audio_base64_is_strict_and_bounded():
    assert _decode_base64_limited("YWJj", 3, "audio") == b"abc"

    for invalid in ("not-base64!", "YWJjZA=="):
        try:
            _decode_base64_limited(invalid, 3, "audio")
        except ValueError:
            pass
        else:
            raise AssertionError("El payload invalido debio rechazarse")


def test_text_turn_is_trimmed_and_bounded(monkeypatch):
    from app.routers import conversation

    monkeypatch.setattr(conversation.settings, "ws_max_text_chars", 4)
    assert _validate_text_turn(" hola ") == "hola"

    for invalid in ("", "     ", "cinco"):
        try:
            _validate_text_turn(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("El texto invalido debio rechazarse")
