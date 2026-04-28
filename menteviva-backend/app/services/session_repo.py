"""
Repositorio de sesiones de practica (Roberto, Maria, Carlos).

Mantiene el mismo patron que user_repo: JSON en columnas TEXT para no
normalizar y mantener la velocidad de iteracion.

El diagnostico vive en `diagnostics`; las sesiones de practica viven aqui.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from app.db import get_db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

logger = logging.getLogger("menteviva")


async def save_practice_session(
    user_id: str,
    avatar_id: str,
    level: Optional[str],
    started_at: str,
    ended_at: str,
    duration_seconds: Optional[int],
    total_exchanges: Optional[int],
    analysis: Optional[dict],
    conversation: list[dict],
) -> int:
    """Guarda una sesion de practica completa. Retorna el session_id."""
    overall_score = None
    if analysis and isinstance(analysis.get("overall_score"), (int, float)):
        overall_score = int(analysis["overall_score"])

    async with get_db() as db:
        cursor = await db.execute(
            """
            INSERT INTO practice_sessions (
                user_id, avatar_id, level, started_at, ended_at,
                duration_seconds, total_exchanges, overall_score,
                analysis_json, conversation_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                avatar_id,
                level,
                started_at,
                ended_at,
                duration_seconds,
                total_exchanges,
                overall_score,
                json.dumps(analysis, ensure_ascii=False) if analysis else None,
                json.dumps(conversation, ensure_ascii=False),
                _now_iso(),
            ),
        )
        await db.commit()
        sid = cursor.lastrowid or 0
    logger.info(
        f"[DB] practice_session saved id={sid} user={user_id} avatar={avatar_id} "
        f"level={level} score={overall_score}"
    )
    return sid


async def list_user_sessions(user_id: str, limit: int = 50) -> list[dict]:
    """Lista ligera para el dashboard — sin la conversacion completa."""
    async with get_db() as db:
        rows = await (
            await db.execute(
                """
                SELECT session_id, user_id, avatar_id, level, started_at, ended_at,
                       duration_seconds, total_exchanges, overall_score, created_at
                FROM practice_sessions
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (user_id, limit),
            )
        ).fetchall()
        return [dict(r) for r in rows]


async def get_session(session_id: int) -> Optional[dict]:
    """Devuelve una sesion completa con analisis y conversacion parseados."""
    async with get_db() as db:
        row = await (
            await db.execute(
                "SELECT * FROM practice_sessions WHERE session_id = ?",
                (session_id,),
            )
        ).fetchone()
        if not row:
            return None
        return {
            "session_id": row["session_id"],
            "user_id": row["user_id"],
            "avatar_id": row["avatar_id"],
            "level": row["level"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
            "duration_seconds": row["duration_seconds"],
            "total_exchanges": row["total_exchanges"],
            "overall_score": row["overall_score"],
            "analysis": json.loads(row["analysis_json"]) if row["analysis_json"] else None,
            "conversation": json.loads(row["conversation_json"]) if row["conversation_json"] else [],
            "created_at": row["created_at"],
        }
