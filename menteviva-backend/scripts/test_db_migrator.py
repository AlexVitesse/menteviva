"""Smoke test: aplicar migraciones sobre la DB y verificar columnas."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db import init_db, get_db  # noqa: E402


async def main():
    await init_db()
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT version, applied_at FROM schema_version ORDER BY version"
        )
        for row in await cursor.fetchall():
            print(f"  v{row['version']} applied {row['applied_at']}")

        cursor = await db.execute("PRAGMA table_info(users)")
        cols = [r["name"] for r in await cursor.fetchall()]
        print(f"  users cols: {cols}")

        cursor = await db.execute("PRAGMA index_list(users)")
        indices = [r["name"] for r in await cursor.fetchall()]
        print(f"  users indices: {indices}")
    print("OK")


if __name__ == "__main__":
    asyncio.run(main())
