"""Tickets efimeros y de un solo uso para autenticar WebSockets.

El ID token de Firebase no viaja en la URL. El cliente lo usa una vez contra
REST para obtener un valor aleatorio que expira pronto y se consume de forma
atomica durante el handshake WebSocket.

Produccion usa Postgres con DELETE RETURNING atomico; desarrollo y tests usan
memoria para no exigir infraestructura externa.
"""

import asyncio
import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import get_db

_tickets: dict[str, tuple[str, float]] = {}
_lock = asyncio.Lock()


def _use_database() -> bool:
    return settings.ws_ticket_store == "database" or (
        settings.ws_ticket_store == "auto" and settings.app_environment == "production"
    )


def _ticket_hash(ticket: str) -> str:
    return hashlib.sha256(ticket.encode("utf-8")).hexdigest()


async def issue_ws_ticket(uid: str) -> tuple[str, int]:
    """Crea un ticket opaco para ``uid`` y devuelve (ticket, ttl_seconds)."""
    ttl = settings.ws_ticket_ttl_seconds
    ticket = secrets.token_urlsafe(32)
    if _use_database():
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)
        async with get_db() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM ws_tickets WHERE expires_at <= NOW()")
                await cur.execute(
                    "INSERT INTO ws_tickets (ticket_hash, user_id, expires_at) VALUES (%s, %s, %s)",
                    (_ticket_hash(ticket), uid, expires_at),
                )
        return ticket, ttl
    expires_at = time.monotonic() + ttl
    async with _lock:
        now = time.monotonic()
        expired = [key for key, (_, expiry) in _tickets.items() if expiry <= now]
        for key in expired:
            _tickets.pop(key, None)
        _tickets[ticket] = (uid, expires_at)
    return ticket, ttl


async def consume_ws_ticket(ticket: str | None) -> str | None:
    """Consume el ticket una sola vez y devuelve su UID si sigue vigente."""
    if not ticket:
        return None
    if _use_database():
        async with get_db() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    DELETE FROM ws_tickets
                    WHERE ticket_hash = %s AND expires_at > NOW()
                    RETURNING user_id
                    """,
                    (_ticket_hash(ticket),),
                )
                row = await cur.fetchone()
        return str(row["user_id"]) if row else None
    async with _lock:
        value = _tickets.pop(ticket, None)
    if not value:
        return None
    uid, expires_at = value
    if expires_at <= time.monotonic():
        return None
    return uid
