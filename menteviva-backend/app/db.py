"""
SQLite async wrapper. Persistencia server-side de usuarios, diagnosticos y
sesiones de practica.

# Portabilidad a Postgres
El schema esta escrito para minimizar fricciones cuando se migre a Postgres
(probablemente Supabase, post-piloto). Reglas seguidas:

- TEXT en lugar de VARCHAR(n)        -> Postgres tambien soporta TEXT.
- INTEGER PRIMARY KEY AUTOINCREMENT  -> en Postgres se reemplaza por SERIAL/
                                        BIGSERIAL o IDENTITY. La semantica es
                                        la misma; el ALTER es trivial.
- Sin DEFAULT (datetime('now'))      -> es una funcion SQLite-only. Escribimos
                                        ISO timestamps desde Python, asi el
                                        comportamiento es identico en Postgres
                                        (y la columna queda como TEXT/ISO o se
                                        promueve a TIMESTAMPTZ trivialmente).
- TEXT para JSON                     -> Postgres puede leer TEXT igual; al
                                        migrar conviene cambiar a JSONB con
                                        ALTER TABLE ... ALTER COLUMN ... TYPE
                                        JSONB USING <col>::jsonb.
- FOREIGN KEY ... REFERENCES         -> SQLite no enforza FKs por defecto;
                                        habilitamos `PRAGMA foreign_keys = ON`
                                        en cada conexion.

# Migraciones
Tabla `schema_version` mas funcion `apply_migrations()` aplican ALTERs
idempotentes en orden. No usamos Alembic todavia para no traer una
dependencia pesada en piloto; cuando migremos a Postgres lo introducimos
y reemplazamos esto por una migracion baseline.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

logger = logging.getLogger("menteviva")

DB_PATH = Path(__file__).parent.parent / "data" / "menteviva.db"


# ============================================================
# Schema base — version 0 (idempotente)
# ============================================================

BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    -- En piloto user_id = Firebase UID (post-firebase auth). Antes era UUID
    -- generado en cliente. Mantener TEXT permite ambos.
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
    -- En Postgres: SERIAL PRIMARY KEY
    diagnostic_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            TEXT NOT NULL,
    completed_at       TEXT NOT NULL,
    -- TEXT con JSON serializado. Migrar a JSONB en Postgres.
    diagnostico_json   TEXT NOT NULL,
    conversation_json  TEXT NOT NULL,
    is_demo            INTEGER NOT NULL DEFAULT 0,
    -- ISO escrito desde Python (ver user_repo.save_diagnostic).
    created_at         TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_user ON diagnostics(user_id);
CREATE INDEX IF NOT EXISTS idx_diagnostics_created ON diagnostics(created_at);

CREATE TABLE IF NOT EXISTS practice_sessions (
    -- En Postgres: SERIAL PRIMARY KEY
    session_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            TEXT NOT NULL,
    avatar_id          TEXT NOT NULL,
    level              TEXT,
    started_at         TEXT NOT NULL,
    ended_at           TEXT NOT NULL,
    duration_seconds   INTEGER,
    total_exchanges    INTEGER,
    overall_score      INTEGER,
    -- TEXT con JSON serializado. Migrar a JSONB en Postgres.
    analysis_json      TEXT,
    conversation_json  TEXT,
    created_at         TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON practice_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON practice_sessions(created_at);
"""


# ============================================================
# Migraciones incrementales
# ============================================================
# Cada entrada: (version, descripcion, lista_de_statements).
# Las migraciones se aplican en orden y solo si version > MAX(schema_version).
# Cada statement debe ser idempotente o gated por SELECT a sqlite_master.

MIGRATIONS: list[tuple[int, str, list[str]]] = [
    (
        1,
        "auth fields: password_hash, last_login, email_verified, UNIQUE email",
        [
            # SQLite no soporta IF NOT EXISTS en ADD COLUMN; usamos try/except
            # en apply_migrations(). En Postgres seria:
            #   ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
            "ALTER TABLE users ADD COLUMN password_hash TEXT",
            "ALTER TABLE users ADD COLUMN last_login TEXT",
            "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
            # UNIQUE solo si email es no-null. SQLite trata NULL como distintos
            # entre si en UNIQUE -> esto sigue permitiendo multiples NULL.
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)",
        ],
    ),
    (
        2,
        "firebase: provider + uid metadata para usuarios autenticados via Firebase",
        [
            # Permite migrar usuarios locales (UUID) a usuarios Firebase sin
            # romper FKs: user_id sigue siendo PK; firebase_uid es el espejo
            # del UID que viene en el token verificado.
            "ALTER TABLE users ADD COLUMN auth_provider TEXT",
            "ALTER TABLE users ADD COLUMN firebase_uid TEXT",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid)",
        ],
    ),
]


async def _current_version(db: aiosqlite.Connection) -> int:
    cursor = await db.execute("SELECT MAX(version) FROM schema_version")
    row = await cursor.fetchone()
    return (row[0] if row and row[0] is not None else 0)


async def _apply_migration(
    db: aiosqlite.Connection, version: int, description: str, statements: list[str]
) -> None:
    """Aplica una migracion. Tolera ALTERs cuya columna ya exista (idempotente
    real cuando alguien corrio la migracion a mano antes de tener la tabla
    schema_version)."""
    for stmt in statements:
        try:
            await db.execute(stmt)
        except aiosqlite.OperationalError as e:
            msg = str(e).lower()
            if "duplicate column" in msg or "already exists" in msg:
                logger.info(f"[DB][migrate v{version}] skip (ya existe): {stmt[:60]}")
                continue
            raise
    await db.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?, datetime('now'))",
        (version,),
    )
    await db.commit()
    logger.info(f"[DB][migrate v{version}] OK — {description}")


async def init_db() -> None:
    """Crea el archivo, aplica el schema base y todas las migraciones pendientes."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.executescript(BASE_SCHEMA)
        await db.commit()

        current = await _current_version(db)
        pending = [m for m in MIGRATIONS if m[0] > current]
        if pending:
            logger.info(
                f"[DB] schema_version actual={current}, "
                f"aplicando {len(pending)} migraciones..."
            )
            for version, desc, stmts in pending:
                await _apply_migration(db, version, desc, stmts)
        else:
            logger.info(f"[DB] schema al dia (version {current})")
    logger.info(f"[DB] SQLite listo en {DB_PATH}")


@asynccontextmanager
async def get_db():
    """Context manager para una conexion. Habilita FKs por conexion (SQLite
    olvida el PRAGMA si no se setea cada vez)."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        db.row_factory = aiosqlite.Row
        yield db
