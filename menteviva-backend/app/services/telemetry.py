"""Telemetria agregada sin PII para salud operativa.

Produccion persiste contadores en Postgres mediante UPSERT atomico para que el
panel refleje todas las instancias. Desarrollo y tests usan memoria.
"""

import asyncio
import hashlib
from collections import Counter
from datetime import datetime, timezone

from app.config import settings
from app.db import get_db

_lock = asyncio.Lock()
_counters: Counter[str] = Counter()


def pseudonymize_uid(uid: str | None) -> str:
    if not uid:
        return "anonymous"
    return hashlib.sha256(uid.encode("utf-8")).hexdigest()[:12]


def _use_database() -> bool:
    return settings.telemetry_store == "database" or (
        settings.telemetry_store == "auto"
        and settings.app_environment == "production"
    )


def _metric_name(metric: str, labels: dict[str, str]) -> str:
    if not labels:
        return metric
    suffix = ",".join(f"{key}={labels[key]}" for key in sorted(labels))
    return f"{metric}{{{suffix}}}"


async def increment(metric: str, amount: int = 1, **labels: str) -> None:
    metric = _metric_name(metric, labels)
    if _use_database():
        async with get_db() as conn:
            await conn.execute(
                """
                INSERT INTO operational_metrics (metric_name, metric_value)
                VALUES (%s, %s)
                ON CONFLICT (metric_name) DO UPDATE
                SET metric_value = operational_metrics.metric_value + EXCLUDED.metric_value,
                    updated_at = NOW()
                """,
                (metric, amount),
            )
        return
    async with _lock:
        _counters[metric] += amount


async def snapshot() -> dict[str, int]:
    if _use_database():
        async with get_db() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT metric_name, metric_value FROM operational_metrics"
                )
                rows = await cur.fetchall()
        return {str(row["metric_name"]): int(row["metric_value"]) for row in rows}
    async with _lock:
        return dict(_counters)


async def observe_seconds(metric: str, seconds: float, **labels: str) -> None:
    """Histograma minimo exportable: cantidad y suma de milisegundos."""
    await increment(f"{metric}_count", **labels)
    await increment(f"{metric}_total_ms", max(0, int(seconds * 1000)), **labels)


async def active_alerts() -> list[dict[str, str | int]]:
    values = await snapshot()
    rules = [
        ("auth_rejections", "ws_auth_rejected", settings.alert_auth_rejections),
        ("rate_limit", "ws_limit_rejected", settings.alert_limit_rejections),
        ("persistence", "persistence_failures{provider=postgres}", settings.alert_persistence_failures),
        ("http_5xx", "http_5xx", settings.alert_http_5xx),
    ]
    alerts = [
        {"code": code, "metric": metric, "value": values.get(metric, 0), "threshold": threshold}
        for code, metric, threshold in rules
        if values.get(metric, 0) >= threshold
    ]
    today = datetime.now(timezone.utc).date().isoformat()
    daily_cost = sum(
        value
        for metric, value in values.items()
        if metric.startswith("llm_cost_micro_usd{") and f"day={today}" in metric
    )
    cost_threshold = int(settings.alert_daily_cost_usd * 1_000_000)
    if daily_cost >= cost_threshold:
        alerts.append(
            {
                "code": "daily_cost",
                "metric": "llm_cost_micro_usd",
                "value": daily_cost,
                "threshold": cost_threshold,
            }
        )
    return alerts
