"""Aislamiento y abuso con dos cuentas Firebase contra staging.

Uso:
  STAGING_BASE_URL=https://staging.example STAGING_TOKEN_A=... \
  STAGING_TOKEN_B=... poetry run python scripts/verify_staging_isolation.py
"""

import asyncio
import base64
import json
import os
import sys
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"Falta {name}")
    return value


def _uid(token: str) -> str:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return claims.get("user_id") or claims["sub"]
    except (IndexError, KeyError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit("Token Firebase invalido") from exc


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _ws_url(base: str, ticket: str) -> str:
    parts = urlsplit(base)
    scheme = "wss" if parts.scheme == "https" else "ws"
    return urlunsplit(
        (scheme, parts.netloc, "/api/conversation/roberto", urlencode({"ticket": ticket}), "")
    )


async def _ticket(client: httpx.AsyncClient, token: str) -> str:
    response = await client.post("/api/auth/ws-ticket", headers=_headers(token))
    response.raise_for_status()
    ticket = response.json().get("ticket")
    if not ticket:
        raise AssertionError("No se emitio ticket WebSocket")
    return str(ticket)


async def _expect_close(url: str, expected_code: int, *, payload: str | None = None) -> None:
    try:
        async with connect(url, open_timeout=20, close_timeout=5) as socket:
            if payload is not None:
                await socket.send(payload)
            while True:
                await asyncio.wait_for(socket.recv(), timeout=20)
    except ConnectionClosed as exc:
        if exc.code != expected_code:
            raise AssertionError(f"cierre esperado={expected_code}, recibido={exc.code}") from exc
        return
    raise AssertionError(f"WebSocket no cerro con {expected_code}")


async def main() -> int:
    base = _required("STAGING_BASE_URL").rstrip("/")
    token_a, token_b = _required("STAGING_TOKEN_A"), _required("STAGING_TOKEN_B")
    uid_a, uid_b = _uid(token_a), _uid(token_b)
    if uid_a == uid_b:
        raise SystemExit("Los tokens deben pertenecer a cuentas distintas")

    async with httpx.AsyncClient(base_url=base, timeout=20, follow_redirects=False) as client:
        for token in (token_a, token_b):
            response = await client.get("/api/me", headers=_headers(token))
            response.raise_for_status()
            if response.json().get("user_id") != _uid(token):
                raise AssertionError("/api/me devolvio una identidad distinta")

        for token, foreign_uid in ((token_a, uid_b), (token_b, uid_a)):
            for path in (
                f"/api/user/{foreign_uid}",
                f"/api/user/{foreign_uid}/diagnostics",
                f"/api/user/{foreign_uid}/sessions",
            ):
                response = await client.get(path, headers=_headers(token))
                if response.status_code != 404:
                    raise AssertionError(f"Aislamiento fallo: {path} -> {response.status_code}")

        used_ticket = await _ticket(client, token_a)
        async with connect(_ws_url(base, used_ticket), open_timeout=20):
            pass
        await _expect_close(_ws_url(base, used_ticket), 1008)

        first_ticket, second_ticket = await asyncio.gather(
            _ticket(client, token_a), _ticket(client, token_a)
        )
        async with connect(_ws_url(base, first_ticket), open_timeout=20):
            await _expect_close(_ws_url(base, second_ticket), 1008)

        payload_ticket = await _ticket(client, token_b)
        oversized = json.dumps({"type": "text", "text": "x" * 1_000_000})
        await _expect_close(_ws_url(base, payload_ticket), 1009, payload=oversized)

    print(
        "OK: aislamiento A/B, ticket single-use, concurrencia por UID y payload 1009"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
