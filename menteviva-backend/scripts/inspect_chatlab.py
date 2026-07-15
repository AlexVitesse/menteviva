import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db import get_db, close_pool

async def main():
    try:
        async with get_db() as db:
            async with db.cursor() as cur:
                await cur.execute("SELECT COUNT(*) AS count FROM diagnostics")
                diag = await cur.fetchone()
                print("Diagnostics count:", diag["count"])

                await cur.execute("SELECT COUNT(*) AS count FROM chatlab_conversations")
                chatlab = await cur.fetchone()
                print("Chatlab conversations count:", chatlab["count"])

                await cur.execute("SELECT user_id, completed_at, is_demo FROM diagnostics")
                rows = await cur.fetchall()
                for r in rows:
                    print(f"  Diag: user_id={r['user_id']} completed_at={r['completed_at']} is_demo={r['is_demo']}")

                await cur.execute("SELECT session_id, user_id, name, avatar_id, provider, model, conversation_json FROM chatlab_conversations")
                rows = await cur.fetchall()
                for r in rows:
                    conv_preview = r['conversation_json'][:300] if r['conversation_json'] else "None"
                    print(f"  Chatlab Session: session_id={r['session_id']} user_id={r['user_id']} name={r['name']} avatar_id={r['avatar_id']} provider={r['provider']} model={r['model']}")
                    print(f"    Conversation preview: {conv_preview}\n")
    finally:
        await close_pool()

if __name__ == "__main__":
    asyncio.run(main())
