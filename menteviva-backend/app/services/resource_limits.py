"""Cuotas de concurrencia y frecuencia por identidad autenticada.

Produccion usa una fila bloqueada en Postgres por UID, por lo que varios workers
e instancias comparten limites atomicos. Desarrollo y tests conservan memoria.
"""

import asyncio
import time
from collections import defaultdict, deque

from app.config import settings
from app.db import get_db

_lock = asyncio.Lock()
_active_sessions: dict[str, int] = defaultdict(int)
_session_starts: dict[str, deque[float]] = defaultdict(deque)
_daily_usage: dict[tuple[str, int], float] = defaultdict(float)


def _utc_day() -> int:
    return int(time.time() // 86400)


def _use_database() -> bool:
    return settings.resource_limit_store == "database" or (
        settings.resource_limit_store == "auto"
        and settings.app_environment == "production"
    )


async def _ensure_database_row(conn, uid: str) -> None:
    await conn.execute(
        """
        INSERT INTO conversation_usage_limits (user_id)
        VALUES (%s) ON CONFLICT (user_id) DO NOTHING
        """,
        (uid,),
    )


async def _acquire_database(uid: str) -> tuple[bool, str | None]:
    async with get_db() as conn:
        await _ensure_database_row(conn, uid)
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT * FROM conversation_usage_limits WHERE user_id = %s FOR UPDATE",
                (uid,),
            )
            row = await cur.fetchone()
            await cur.execute(
                """
                SELECT
                    CASE WHEN %s < NOW() - (%s * INTERVAL '1 second')
                         THEN 0 ELSE %s END AS active_sessions,
                    CASE WHEN %s <= NOW() - INTERVAL '1 hour'
                         THEN 0 ELSE %s END AS hour_count,
                    CASE WHEN %s <> CURRENT_DATE THEN 0 ELSE %s END AS daily_seconds
                """,
                (
                    row["active_updated_at"],
                    settings.ws_max_session_seconds + 60,
                    row["active_sessions"],
                    row["hour_window_start"],
                    row["hour_count"],
                    row["usage_day"],
                    row["daily_seconds"],
                ),
            )
            normalized = await cur.fetchone()
            active = int(normalized["active_sessions"])
            hourly = int(normalized["hour_count"])
            daily = float(normalized["daily_seconds"])
            if active >= settings.ws_max_concurrent_per_uid:
                return False, "Ya existe una conversacion activa para este usuario."
            if hourly >= settings.ws_max_sessions_per_hour:
                return False, "Se alcanzo el limite de sesiones por hora."
            if daily >= settings.ws_max_daily_minutes_per_uid * 60:
                return False, "Se alcanzo el limite diario de voz y video."
            await cur.execute(
                """
                UPDATE conversation_usage_limits
                SET active_sessions = %s,
                    active_updated_at = NOW(),
                    hour_window_start = CASE
                        WHEN hour_window_start <= NOW() - INTERVAL '1 hour'
                        THEN NOW() ELSE hour_window_start END,
                    hour_count = %s,
                    usage_day = CURRENT_DATE,
                    daily_seconds = %s
                WHERE user_id = %s
                """,
                (active + 1, hourly + 1, daily, uid),
            )
    return True, None


async def acquire_conversation_slot(uid: str) -> tuple[bool, str | None]:
    """Reserva concurrencia y cuota horaria para una nueva conversacion."""
    if _use_database():
        return await _acquire_database(uid)
    now = time.monotonic()
    window_start = now - 3600
    async with _lock:
        starts = _session_starts[uid]
        while starts and starts[0] <= window_start:
            starts.popleft()
        if _active_sessions[uid] >= settings.ws_max_concurrent_per_uid:
            return False, "Ya existe una conversacion activa para este usuario."
        if len(starts) >= settings.ws_max_sessions_per_hour:
            return False, "Se alcanzo el limite de sesiones por hora."
        if _daily_usage[(uid, _utc_day())] >= settings.ws_max_daily_minutes_per_uid * 60:
            return False, "Se alcanzo el limite diario de voz y video."
        _active_sessions[uid] += 1
        starts.append(now)
        return True, None


async def release_conversation_slot(uid: str) -> None:
    if _use_database():
        async with get_db() as conn:
            await conn.execute(
                """
                UPDATE conversation_usage_limits
                SET active_sessions = GREATEST(active_sessions - 1, 0),
                    active_updated_at = NOW()
                WHERE user_id = %s
                """,
                (uid,),
            )
        return
    async with _lock:
        current = _active_sessions.get(uid, 0)
        if current <= 1:
            _active_sessions.pop(uid, None)
        else:
            _active_sessions[uid] = current - 1


async def record_conversation_usage(uid: str, duration_seconds: float) -> None:
    """Acumula uso diario al finalizar; nunca recibe audio ni PII adicional."""
    duration = max(0.0, duration_seconds)
    if _use_database():
        async with get_db() as conn:
            await _ensure_database_row(conn, uid)
            await conn.execute(
                """
                UPDATE conversation_usage_limits
                SET usage_day = CURRENT_DATE,
                    daily_seconds = CASE
                        WHEN usage_day = CURRENT_DATE THEN daily_seconds + %s
                        ELSE %s END
                WHERE user_id = %s
                """,
                (duration, duration, uid),
            )
        return
    async with _lock:
        _daily_usage[(uid, _utc_day())] += duration
        stale_days = [key for key in _daily_usage if key[1] < _utc_day() - 1]
        for key in stale_days:
            _daily_usage.pop(key, None)


async def reset_limits_for_tests() -> None:
    async with _lock:
        _active_sessions.clear()
        _session_starts.clear()
        _daily_usage.clear()
