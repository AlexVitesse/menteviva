import pytest

from app.services import ws_tickets


@pytest.mark.asyncio
async def test_ticket_is_single_use():
    ticket, ttl = await ws_tickets.issue_ws_ticket("uid-a")

    assert ttl > 0
    assert await ws_tickets.consume_ws_ticket(ticket) == "uid-a"
    assert await ws_tickets.consume_ws_ticket(ticket) is None


@pytest.mark.asyncio
async def test_missing_ticket_is_rejected():
    assert await ws_tickets.consume_ws_ticket(None) is None
    assert await ws_tickets.consume_ws_ticket("") is None
    assert await ws_tickets.consume_ws_ticket("unknown") is None


@pytest.mark.asyncio
async def test_expired_ticket_is_rejected(monkeypatch):
    now = 100.0
    monkeypatch.setattr(ws_tickets.time, "monotonic", lambda: now)
    ticket, _ = await ws_tickets.issue_ws_ticket("uid-a")
    monkeypatch.setattr(ws_tickets.time, "monotonic", lambda: now + 1000)

    assert await ws_tickets.consume_ws_ticket(ticket) is None
