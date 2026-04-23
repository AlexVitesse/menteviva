"""
Repositorio de usuarios y diagnosticos en SQLite.

Todo en JSON dentro de columnas TEXT — mantiene el contrato con el
frontend sin normalizar (prioridad: velocidad de iteracion).
"""
import json
import logging
from typing import Optional

from app.db import get_db
from app.models.user_profile import Diagnostico, Registro, UserProfile

logger = logging.getLogger("menteviva")


async def upsert_user(profile: UserProfile) -> None:
    """Inserta o actualiza el registro del usuario."""
    r = profile.registro
    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO users (user_id, nombre, email, rol_objetivo, industria,
                               experience_level, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                nombre = excluded.nombre,
                email = excluded.email,
                rol_objetivo = excluded.rol_objetivo,
                industria = excluded.industria,
                experience_level = excluded.experience_level,
                updated_at = excluded.updated_at
            """,
            (
                profile.user_id,
                r.nombre,
                r.email,
                r.rol_objetivo,
                r.industria,
                r.experience_level,
                profile.created_at,
                profile.updated_at,
            ),
        )
        await db.commit()
    logger.info(f"[DB] upsert user {profile.user_id} ({r.nombre})")


async def save_diagnostic(
    user_id: str,
    diagnostico: dict,
    conversation: list[dict],
) -> int:
    """Guarda un diagnostico + la conversacion que lo origino. Retorna el id."""
    is_demo = 1 if diagnostico.get("is_demo") else 0
    completed_at = diagnostico.get("completed_at", "")
    async with get_db() as db:
        cursor = await db.execute(
            """
            INSERT INTO diagnostics (user_id, completed_at, diagnostico_json,
                                     conversation_json, is_demo)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                user_id,
                completed_at,
                json.dumps(diagnostico, ensure_ascii=False),
                json.dumps(conversation, ensure_ascii=False),
                is_demo,
            ),
        )
        await db.commit()
        diag_id = cursor.lastrowid or 0
    logger.info(f"[DB] diagnostic saved id={diag_id} user={user_id} is_demo={is_demo}")
    return diag_id


async def get_user_profile(user_id: str) -> Optional[UserProfile]:
    """
    Devuelve el UserProfile completo (registro + diagnostico mas reciente).
    None si el usuario no existe.
    """
    async with get_db() as db:
        user_row = await (
            await db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        ).fetchone()
        if not user_row:
            return None

        diag_row = await (
            await db.execute(
                "SELECT diagnostico_json FROM diagnostics WHERE user_id = ? "
                "ORDER BY created_at DESC LIMIT 1",
                (user_id,),
            )
        ).fetchone()

        diagnostico = None
        if diag_row:
            try:
                parsed = json.loads(diag_row["diagnostico_json"])
                diagnostico = Diagnostico(**parsed)
            except Exception as e:
                logger.error(f"[DB] diagnostico json corrupto user={user_id}: {e}")

        return UserProfile(
            user_id=user_row["user_id"],
            created_at=user_row["created_at"],
            updated_at=user_row["updated_at"],
            registro=Registro(
                nombre=user_row["nombre"],
                email=user_row["email"],
                rol_objetivo=user_row["rol_objetivo"],
                industria=user_row["industria"],
                experience_level=user_row["experience_level"],
            ),
            diagnostico=diagnostico,
        )


async def list_user_diagnostics(user_id: str) -> list[dict]:
    """Lista ligera para historial (sin el JSON completo, solo metadatos)."""
    async with get_db() as db:
        rows = await (
            await db.execute(
                """
                SELECT diagnostic_id, completed_at, is_demo, created_at
                FROM diagnostics
                WHERE user_id = ?
                ORDER BY created_at DESC
                """,
                (user_id,),
            )
        ).fetchall()
        return [dict(r) for r in rows]


async def get_diagnostic(diagnostic_id: int) -> Optional[dict]:
    """Devuelve un diagnostico completo por su id."""
    async with get_db() as db:
        row = await (
            await db.execute(
                "SELECT * FROM diagnostics WHERE diagnostic_id = ?",
                (diagnostic_id,),
            )
        ).fetchone()
        if not row:
            return None
        return {
            "diagnostic_id": row["diagnostic_id"],
            "user_id": row["user_id"],
            "completed_at": row["completed_at"],
            "diagnostico": json.loads(row["diagnostico_json"]),
            "conversation": json.loads(row["conversation_json"]),
            "is_demo": bool(row["is_demo"]),
            "created_at": row["created_at"],
        }
