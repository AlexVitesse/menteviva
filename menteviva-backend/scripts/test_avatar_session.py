"""Smoke test del router unificado de avatar (POST /api/avatar/session).

Valida el DESPACHO por `settings.avatar_provider` sin necesitar el
avatar-service real ni levantar uvicorn: llama a `create_avatar_session`
directo y, para el camino OSS, inyecta un STUB de httpx que simula la
respuesta de `POST {avatar_service_url}/session`. Uso:

    cd menteviva-backend
    poetry run python -m scripts.test_avatar_session

Cubre:
  - provider=none  -> {"provider": "none"}
  - provider=oss   -> shape del contrato §1.1 (contra el stub)
  - provider=oss sin AVATAR_SERVICE_URL -> 503
  - provider basura -> 503
El camino simli NO se ejerce aqui (consume la API live de Simli; ver
scripts/test_simli_token.py).
"""

import asyncio

from fastapi import HTTPException

from app.config import settings
from app.routers import avatar as avatar_router
from app.routers.avatar import AvatarSessionRequest, create_avatar_session


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    """Stub de httpx.AsyncClient: responde el /session del avatar-service."""

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url: str, json: dict | None = None):
        print(f"  [stub] POST {url}  body={json}")
        return _FakeResponse(
            200,
            {
                "session_id": "stub-session-0001",
                "signaling_url": f"{settings.avatar_service_url.rstrip('/')}/rtc/stub-session-0001",
                # sin ice_servers -> el router debe inyectar el STUN por default
                "max_session_seconds": 1800,
            },
        )


async def main() -> None:
    original_provider = settings.avatar_provider
    original_url = settings.avatar_service_url
    original_httpx = avatar_router.httpx
    try:
        # --- provider=none -----------------------------------------------
        settings.avatar_provider = "none"
        resp = await create_avatar_session(AvatarSessionRequest(avatar_id="entrevistador"))
        assert resp == {"provider": "none"}, resp
        print("OK  provider=none -> {'provider': 'none'}")

        # --- provider=oss (contra el stub) -------------------------------
        settings.avatar_provider = "oss"
        settings.avatar_service_url = "http://stub.local:8300"
        avatar_router.httpx = type("H", (), {"AsyncClient": _FakeAsyncClient, "HTTPError": Exception})
        resp = await create_avatar_session(AvatarSessionRequest(avatar_id="entrevistador"))
        assert resp["provider"] == "oss", resp
        assert resp["session_id"] == "stub-session-0001", resp
        assert resp["signaling_url"].endswith("/rtc/stub-session-0001"), resp
        assert resp["ice_servers"] == avatar_router.DEFAULT_ICE_SERVERS, resp
        assert resp["max_session_seconds"] == 1800, resp
        print(f"OK  provider=oss -> {resp}")

        # --- provider=oss sin URL -> 503 ---------------------------------
        settings.avatar_service_url = ""
        try:
            await create_avatar_session(AvatarSessionRequest(avatar_id="entrevistador"))
            raise AssertionError("se esperaba HTTPException 503 (sin AVATAR_SERVICE_URL)")
        except HTTPException as e:
            assert e.status_code == 503, e.status_code
            print("OK  provider=oss sin AVATAR_SERVICE_URL -> 503")

        # --- provider basura -> 503 --------------------------------------
        settings.avatar_provider = "chafa"
        try:
            await create_avatar_session(AvatarSessionRequest(avatar_id="entrevistador"))
            raise AssertionError("se esperaba HTTPException 503 (provider invalido)")
        except HTTPException as e:
            assert e.status_code == 503, e.status_code
            print("OK  provider invalido -> 503")

        print("\nTODO OK: el despacho de /api/avatar/session respeta el contrato §1.")
    finally:
        settings.avatar_provider = original_provider
        settings.avatar_service_url = original_url
        avatar_router.httpx = original_httpx


if __name__ == "__main__":
    asyncio.run(main())
