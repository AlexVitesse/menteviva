from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pytest

from app.config import settings
from app.services import telemetry


@pytest.fixture(autouse=True)
async def clean_memory_metrics():
    async with telemetry._lock:
        telemetry._counters.clear()
    yield
    async with telemetry._lock:
        telemetry._counters.clear()


@pytest.mark.asyncio
async def test_memory_metrics_labels_latency_and_alerts(monkeypatch):
    monkeypatch.setattr(settings, "telemetry_store", "memory")
    monkeypatch.setattr(settings, "alert_auth_rejections", 2)
    await telemetry.increment("ws_auth_rejected", 2)
    await telemetry.observe_seconds("provider_latency", 1.25, provider="groq")

    values = await telemetry.snapshot()
    assert values["provider_latency_count{provider=groq}"] == 1
    assert values["provider_latency_total_ms{provider=groq}"] == 1250
    assert (await telemetry.active_alerts())[0]["code"] == "auth_rejections"
    assert telemetry.pseudonymize_uid(None) == "anonymous"
    assert telemetry.pseudonymize_uid("uid") != "uid"


@pytest.mark.asyncio
async def test_http_and_daily_cost_alerts(monkeypatch):
    monkeypatch.setattr(settings, "telemetry_store", "memory")
    monkeypatch.setattr(settings, "alert_http_5xx", 1)
    monkeypatch.setattr(settings, "alert_daily_cost_usd", 0.5)
    day = datetime.now(timezone.utc).date().isoformat()
    await telemetry.increment("http_5xx")
    await telemetry.increment(
        "llm_cost_micro_usd", 500_000, day=day, provider="gemini"
    )
    codes = {alert["code"] for alert in await telemetry.active_alerts()}
    assert {"http_5xx", "daily_cost"} <= codes


class _Cursor:
    def __init__(self):
        self.executed = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def execute(self, sql, params=()):
        self.executed.append((sql, params))

    async def fetchall(self):
        return [{"metric_name": "ws_sessions_started", "metric_value": 3}]


class _Connection:
    def __init__(self):
        self.executed = []
        self.cursor_instance = _Cursor()

    async def execute(self, sql, params=()):
        self.executed.append((sql, params))

    def cursor(self):
        return self.cursor_instance


@pytest.mark.asyncio
async def test_database_metrics_use_atomic_upsert_and_snapshot(monkeypatch):
    connection = _Connection()

    @asynccontextmanager
    async def database():
        yield connection

    monkeypatch.setattr(settings, "telemetry_store", "database")
    monkeypatch.setattr(telemetry, "get_db", database)

    await telemetry.increment("ws_sessions_started", 2)
    assert "ON CONFLICT" in connection.executed[0][0]
    assert connection.executed[0][1] == ("ws_sessions_started", 2)
    assert await telemetry.snapshot() == {"ws_sessions_started": 3}
