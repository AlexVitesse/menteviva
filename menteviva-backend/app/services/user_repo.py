"""
Repositorio de usuarios y diagnosticos en SQLite.

Todo en JSON dentro de columnas TEXT — mantiene el contrato con el
frontend sin normalizar (prioridad: velocidad de iteracion).
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from app.db import get_db
from app.models.user_profile import Diagnostico, Registro, UserProfile


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

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


async def register_firebase_user(
    firebase_uid: str,
    email: Optional[str],
    email_verified: bool,
    registro: Registro,
) -> UserProfile:
    """Crea/actualiza un usuario tras un signup en Firebase.

    El user_id queda igual al firebase_uid para que la PK sea consistente con
    la identidad del proveedor de auth. firebase_uid se duplica en su columna
    propia (con UNIQUE) para hacer JOINs explicitos cuando alguna vez tengamos
    multiples providers.
    """
    now = _now_iso()
    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO users (
                user_id, nombre, email, rol_objetivo, industria,
                experience_level, created_at, updated_at,
                auth_provider, firebase_uid, email_verified, last_login
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                nombre = excluded.nombre,
                email = excluded.email,
                rol_objetivo = excluded.rol_objetivo,
                industria = excluded.industria,
                experience_level = excluded.experience_level,
                updated_at = excluded.updated_at,
                email_verified = excluded.email_verified,
                last_login = excluded.last_login
            """,
            (
                firebase_uid,
                registro.nombre,
                email,
                registro.rol_objetivo,
                registro.industria,
                registro.experience_level,
                now,
                now,
                "firebase",
                firebase_uid,
                1 if email_verified else 0,
                now,
            ),
        )
        await db.commit()
    logger.info(f"[DB] firebase user registrado uid={firebase_uid} ({registro.nombre})")
    profile = await get_user_profile(firebase_uid)
    if not profile:
        # No deberia pasar; el insert acaba de correr.
        raise RuntimeError(f"register_firebase_user: profile no encontrado tras INSERT uid={firebase_uid}")
    return profile


async def touch_last_login(user_id: str) -> None:
    """Actualiza last_login al hacer /auth/sync. Tolera user inexistente."""
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET last_login = ? WHERE user_id = ?",
            (_now_iso(), user_id),
        )
        await db.commit()


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
                                     conversation_json, is_demo, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                completed_at,
                json.dumps(diagnostico, ensure_ascii=False),
                json.dumps(conversation, ensure_ascii=False),
                is_demo,
                _now_iso(),
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
