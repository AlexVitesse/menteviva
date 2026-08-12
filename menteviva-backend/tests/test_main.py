import pytest
from fastapi import Request
from starlette.responses import Response

from app import main


def request(headers=None):
    raw_headers = [
        (key.lower().encode(), value.encode()) for key, value in (headers or {}).items()
    ]
    return Request({
        "type": "http", "method": "GET", "path": "/health",
        "raw_path": b"/health", "query_string": b"", "headers": raw_headers,
        "scheme": "http", "server": ("test", 80), "client": ("127.0.0.1", 1),
    })


@pytest.mark.asyncio
async def test_health_and_request_id_middleware():
    assert await main.health() == {"status": "ok"}

    async def call_next(_request):
        return Response(status_code=204)

    response = await main.request_id_middleware(
        request({"X-Request-ID": "request-test"}), call_next
    )
    assert response.headers["X-Request-ID"] == "request-test"


@pytest.mark.asyncio
async def test_request_id_middleware_sanitizes_unhandled_errors():
    async def call_next(_request):
        raise RuntimeError("database password must not escape")

    response = await main.request_id_middleware(request(), call_next)
    assert response.status_code == 500
    assert b"database password" not in response.body
    assert response.headers["X-Request-ID"]


@pytest.mark.asyncio
async def test_lifespan_opens_and_closes_database(monkeypatch):
    opened = False
    closed = False

    async def open_db():
        nonlocal opened
        opened = True

    async def close_db():
        nonlocal closed
        closed = True

    monkeypatch.setattr(main, "init_db", open_db)
    monkeypatch.setattr(main, "close_pool", close_db)
    async with main.lifespan(main.app):
        assert opened
        assert not closed
    assert closed
