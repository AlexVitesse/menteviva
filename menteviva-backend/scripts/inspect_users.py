import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import aiosqlite
from app.db import DB_PATH


async def main():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT user_id, email, nombre FROM users")
        rows = await cursor.fetchall()
        print(f"users count: {len(rows)}")
        for r in rows:
            print(f"  {r['user_id'][:8]} email={r['email']!r} nombre={r['nombre']!r}")

        cursor = await db.execute(
            "SELECT email, COUNT(*) as n FROM users GROUP BY email HAVING n > 1"
        )
        dups = await cursor.fetchall()
        print(f"emails duplicados: {len(dups)}")
        for r in dups:
            print(f"  email={r['email']!r} count={r['n']}")


if __name__ == "__main__":
    asyncio.run(main())
