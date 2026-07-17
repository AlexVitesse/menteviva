from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from app.config import settings
from app.routers import avatar, simli


class Response:
    def __init__(self, status_code=200, data=None, text=""):
        self.status_code = status_code
        self._data = data or {}
        self.text = text

    def json(self):
        return self._data


class Client:
    response = Response()

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *_args, **_kwargs):
        return self.response


@pytest.mark.asyncio
async def test_simli_never_calls_provider_without_key(monkeypatch):
    monkeypatch.setattr(settings, "simli_api_key", "")
    with pytest.raises(HTTPException) as exc:
        await simli.mint_simli_session("entrevistador")
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_simli_mints_token_with_mock_provider(monkeypatch):
    monkeypatch.setattr(settings, "simli_api_key", "secret")
    Client.response = Response(data={"session_token": "ephemeral"})
    monkeypatch.setattr(simli.httpx, "AsyncClient", Client)
    result = await simli.create_simli_session_token(
        simli.SimliTokenRequest(avatar_id="entrevistador"), "uid-a"
    )
    assert result["session_token"] == "ephemeral"


@pytest.mark.asyncio
async def test_simli_maps_provider_failures(monkeypatch):
    monkeypatch.setattr(settings, "simli_api_key", "secret")
    monkeypatch.setattr(simli.httpx, "AsyncClient", Client)
    Client.response = Response(status_code=429, text="rate limited")
    with pytest.raises(HTTPException) as exc:
        await simli.mint_simli_session("x")
    assert exc.value.status_code == 502
    Client.response = Response(data={})
    with pytest.raises(HTTPException):
        await simli.mint_simli_session("x")


@pytest.mark.asyncio
async def test_avatar_dispatches_all_configured_modes(monkeypatch):
    req = avatar.AvatarSessionRequest(avatar_id="entrevistador")
    monkeypatch.setattr(settings, "avatar_provider", "none")
    assert await avatar.create_avatar_session(req, "uid-a") == {"provider": "none"}
    monkeypatch.setattr(settings, "avatar_provider", "simli")
    mint = AsyncMock(return_value={"session_token": "t", "face_id": "f"})
    monkeypatch.setattr(avatar, "mint_simli_session", mint)
    assert (await avatar.create_avatar_session(req, "uid-a"))["provider"] == "simli"
    monkeypatch.setattr(settings, "avatar_provider", "invalid")
    with pytest.raises(HTTPException) as exc:
        await avatar.create_avatar_session(req, "uid-a")
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_oss_session_uses_mock_service(monkeypatch):
    monkeypatch.setattr(settings, "avatar_service_url", "https://avatar.test")
    monkeypatch.setattr(avatar.httpx, "AsyncClient", Client)
    Client.response = Response(data={
        "session_id": "session-1",
        "signaling_url": "wss://avatar.test/ws",
    })
    result = await avatar._oss_session("entrevistador")
    assert result["provider"] == "oss"
    assert result["ice_servers"] == avatar.DEFAULT_ICE_SERVERS


@pytest.mark.asyncio
async def test_oss_network_error_is_sanitized(monkeypatch):
    class BrokenClient(Client):
        async def post(self, *_args, **_kwargs):
            raise httpx.ConnectError("secret upstream detail")

    monkeypatch.setattr(settings, "avatar_service_url", "https://avatar.test")
    monkeypatch.setattr(avatar.httpx, "AsyncClient", BrokenClient)
    with pytest.raises(HTTPException) as exc:
        await avatar._oss_session("x")
    assert exc.value.status_code == 502
    assert "secret" not in exc.value.detail
