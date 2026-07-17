from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.routers import chat_text


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(chat_text.router, prefix="/api")
    return app


def test_chatlab_is_closed_in_production_without_operator_token(monkeypatch):
    monkeypatch.setattr(settings, "app_environment", "production")
    monkeypatch.setattr(settings, "chatlab_token", "")

    with TestClient(_app()) as client:
        response = client.get("/api/chat/avatars")

    assert response.status_code == 503


def test_chatlab_rejects_shared_token_in_production(monkeypatch):
    monkeypatch.setattr(settings, "app_environment", "production")
    monkeypatch.setattr(settings, "chatlab_token", "secret")

    with TestClient(_app()) as client:
        response = client.get(
            "/api/chat/avatars", headers={"X-ChatLab-Token": "wrong"}
        )

    assert response.status_code == 503


def test_chatlab_accepts_firebase_operator(monkeypatch):
    monkeypatch.setattr(settings, "app_environment", "production")
    monkeypatch.setattr(settings, "chatlab_token", "")
    monkeypatch.setattr(settings, "chatlab_operator_uids", "operator-a")

    async def verify(_authorization):
        return "operator-a"

    monkeypatch.setattr(chat_text, "verify_firebase_token", verify)

    with TestClient(_app()) as client:
        response = client.get(
            "/api/chat/avatars", headers={"Authorization": "Bearer test"}
        )

    assert response.status_code == 200
