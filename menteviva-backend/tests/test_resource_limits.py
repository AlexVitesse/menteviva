from contextlib import asynccontextmanager
from datetime import date, datetime, timezone

import pytest

from app.config import settings
from app.services import resource_limits
from app.services.resource_limits import (
    acquire_conversation_slot,
    record_conversation_usage,
    release_conversation_slot,
    reset_limits_for_tests,
)


@pytest.fixture(autouse=True)
async def clean_limits():
    await reset_limits_for_tests()
    yield
    await reset_limits_for_tests()


@pytest.mark.asyncio
async def test_concurrent_session_is_rejected_and_slot_is_released(monkeypatch):
    monkeypatch.setattr(settings, "ws_max_concurrent_per_uid", 1)
    monkeypatch.setattr(settings, "ws_max_sessions_per_hour", 20)

    assert await acquire_conversation_slot("uid-a") == (True, None)
    accepted, reason = await acquire_conversation_slot("uid-a")
    assert accepted is False
    assert "activa" in (reason or "")

    await release_conversation_slot("uid-a")
    assert await acquire_conversation_slot("uid-a") == (True, None)


@pytest.mark.asyncio
async def test_hourly_session_quota_is_enforced(monkeypatch):
    monkeypatch.setattr(settings, "ws_max_concurrent_per_uid", 1)
    monkeypatch.setattr(settings, "ws_max_sessions_per_hour", 2)

    assert (await acquire_conversation_slot("uid-a"))[0]
    await release_conversation_slot("uid-a")
    assert (await acquire_conversation_slot("uid-a"))[0]
    await release_conversation_slot("uid-a")

    accepted, reason = await acquire_conversation_slot("uid-a")
    assert accepted is False
    assert "hora" in (reason or "")


@pytest.mark.asyncio
async def test_limits_are_isolated_per_uid(monkeypatch):
    monkeypatch.setattr(settings, "ws_max_concurrent_per_uid", 1)
    monkeypatch.setattr(settings, "ws_max_sessions_per_hour", 1)

    assert (await acquire_conversation_slot("uid-a"))[0]
    assert (await acquire_conversation_slot("uid-b"))[0]


@pytest.mark.asyncio
async def test_daily_voice_quota_is_enforced(monkeypatch):
    monkeypatch.setattr(settings, "ws_max_daily_minutes_per_uid", 1)
    await record_conversation_usage("uid-a", 60)

    accepted, reason = await acquire_conversation_slot("uid-a")
    assert accepted is False
    assert "diario" in (reason or "")
    assert (await acquire_conversation_slot("uid-b"))[0]


class _FakeCursor:
    def __init__(self, row, normalized):
        self.results = [row, normalized]
        self.executed = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def execute(self, sql, params=()):
        self.executed.append((sql, params))

    async def fetchone(self):
        return self.results.pop(0)


class _FakeConnection:
    def __init__(self, row=None, normalized=None):
        now = datetime.now(timezone.utc)
        self.cursor_instance = _FakeCursor(
            row
            or {
                "active_updated_at": now,
                "active_sessions": 0,
                "hour_window_start": now,
                "hour_count": 0,
                "usage_day": date.today(),
                "daily_seconds": 0,
            },
            normalized
            or {"active_sessions": 0, "hour_count": 0, "daily_seconds": 0},
        )
        self.executed = []

    async def execute(self, sql, params=()):
        self.executed.append((sql, params))

    def cursor(self):
        return self.cursor_instance


def _database_context(conn):
    @asynccontextmanager
    async def context():
        yield conn

    return context


@pytest.mark.asyncio
async def test_database_store_acquires_releases_and_records(monkeypatch):
    monkeypatch.setattr(settings, "resource_limit_store", "database")
    conn = _FakeConnection()
    monkeypatch.setattr(resource_limits, "get_db", _database_context(conn))

    assert await acquire_conversation_slot("uid-a") == (True, None)
    assert any("FOR UPDATE" in sql for sql, _ in conn.cursor_instance.executed)
    assert any("active_sessions = %s" in sql for sql, _ in conn.cursor_instance.executed)

    release_conn = _FakeConnection()
    monkeypatch.setattr(resource_limits, "get_db", _database_context(release_conn))
    await release_conversation_slot("uid-a")
    await record_conversation_usage("uid-a", 12.5)
    assert any("GREATEST" in sql for sql, _ in release_conn.executed)
    assert any("daily_seconds" in sql for sql, _ in release_conn.executed)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("normalized", "reason"),
    [
        ({"active_sessions": 1, "hour_count": 0, "daily_seconds": 0}, "activa"),
        ({"active_sessions": 0, "hour_count": 20, "daily_seconds": 0}, "hora"),
        ({"active_sessions": 0, "hour_count": 0, "daily_seconds": 7200}, "diario"),
    ],
)
async def test_database_store_rejects_each_quota(monkeypatch, normalized, reason):
    monkeypatch.setattr(settings, "resource_limit_store", "database")
    conn = _FakeConnection(normalized=normalized)
    monkeypatch.setattr(resource_limits, "get_db", _database_context(conn))
    accepted, detail = await acquire_conversation_slot("uid-a")
    assert accepted is False
    assert reason in (detail or "")
