"""
SQLite async wrapper. Persistencia server-side de usuarios y diagnosticos.
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

logger = logging.getLogger("menteviva")

DB_PATH = Path(__file__).parent.parent / "data" / "menteviva.db"


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id           TEXT PRIMARY KEY,
    nombre            TEXT NOT NULL,
    email             TEXT,
    rol_objetivo      TEXT NOT NULL,
    industria         TEXT NOT NULL,
    experience_level  TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostics (
    diagnostic_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            TEXT NOT NULL,
    completed_at       TEXT NOT NULL,
    diagnostico_json   TEXT NOT NULL,
    conversation_json  TEXT NOT NULL,
    is_demo            INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_user ON diagnostics(user_id);
CREATE INDEX IF NOT EXISTS idx_diagnostics_created ON diagnostics(created_at);

CREATE TABLE IF NOT EXISTS practice_sessions (
    session_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            TEXT NOT NULL,
    avatar_id          TEXT NOT NULL,
    level              TEXT,
    started_at         TEXT NOT NULL,
    ended_at           TEXT NOT NULL,
    duration_seconds   INTEGER,
    total_exchanges    INTEGER,
    overall_score      INTEGER,
    analysis_json      TEXT,
    conversation_json  TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON practice_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON practice_sessions(created_at);
"""


async def init_db() -> None:
    """Crea el archivo y las tablas si no existen. Idempotente."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        await db.commit()
    logger.info(f"[DB] SQLite listo en {DB_PATH}")


@asynccontextmanager
async def get_db():
    """Context manager para una conexion. Usarse con 'async with get_db() as db'."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db
