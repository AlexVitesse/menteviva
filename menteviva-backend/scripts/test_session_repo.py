"""Smoke test del session_repo."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db import init_db  # noqa: E402
from app.services.session_repo import (  # noqa: E402
    get_session,
    list_user_sessions,
    save_practice_session,
)


async def main():
    await init_db()
    sid = await save_practice_session(
        user_id="test-user-001",
        avatar_id="roberto",
        level="intermedio",
        started_at="2026-04-28T10:00:00",
        ended_at="2026-04-28T10:08:00",
        duration_seconds=480,
        total_exchanges=12,
        analysis={
            "overall_score": 72,
            "overall_summary": "Test analysis",
            "skills": [],
        },
        conversation=[
            {"role": "user", "content": "hola"},
            {"role": "assistant", "content": "Buenos dias."},
        ],
    )
    print(f"saved id={sid}")
    sessions = await list_user_sessions("test-user-001")
    print(f"list count={len(sessions)}")
    if sessions:
        print(f"sample: {sessions[0]}")
    full = await get_session(sid)
    print(f"full keys: {list(full.keys())}")
    print(f"full overall_score: {full['overall_score']}")
    print(f"full level: {full['level']}")
    print("OK")


if __name__ == "__main__":
    asyncio.run(main())
