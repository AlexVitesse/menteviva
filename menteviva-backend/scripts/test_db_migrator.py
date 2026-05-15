"""Smoke test: aplicar migraciones sobre Postgres y verificar columnas."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db import init_db, get_db, close_pool  # noqa: E402


async def main():
    await init_db()
    try:
        async with get_db() as db:
            async with db.cursor() as cur:
                await cur.execute(
                    "SELECT version, applied_at FROM schema_version ORDER BY version"
                )
                rows = await cur.fetchall()
                for row in rows:
                    print(f"  v{row['version']} applied {row['applied_at']}")

                # Postgres equivalent de PRAGMA table_info
                await cur.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'users' "
                    "ORDER BY ordinal_position"
                )
                cols = [r["column_name"] for r in await cur.fetchall()]
                print(f"  users cols: {cols}")

                # Postgres equivalent de PRAGMA index_list
                await cur.execute(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE schemaname = 'public' AND tablename = 'users' "
                    "ORDER BY indexname"
                )
                indices = [r["indexname"] for r in await cur.fetchall()]
                print(f"  users indices: {indices}")
        print("OK")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
