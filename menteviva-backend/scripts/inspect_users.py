"""Lista usuarios + detecta emails duplicados. Postgres (psycopg async)."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db import get_db, close_pool  # noqa: E402


async def main():
    try:
        async with get_db() as db:
            async with db.cursor() as cur:
                await cur.execute("SELECT user_id, email, nombre FROM users")
                rows = await cur.fetchall()
                print(f"users count: {len(rows)}")
                for r in rows:
                    uid = r["user_id"]
                    print(f"  {uid[:8]} email={r['email']!r} nombre={r['nombre']!r}")

                await cur.execute(
                    "SELECT email, COUNT(*) AS n FROM users "
                    "GROUP BY email HAVING COUNT(*) > 1"
                )
                dups = await cur.fetchall()
                print(f"emails duplicados: {len(dups)}")
                for r in dups:
                    print(f"  email={r['email']!r} count={r['n']}")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
