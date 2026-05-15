"""Inyecta un diagnostico mock para el user de prueba (Firebase preview)."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db import get_db, close_pool  # noqa: E402
from app.services.user_repo import save_diagnostic  # noqa: E402

TEST_EMAIL = "preview-test-2026@menteviva.dev"


async def main():
    async with get_db() as db:
        async with db.cursor() as cur:
            await cur.execute(
                "SELECT user_id FROM users WHERE email = %s",
                (TEST_EMAIL,),
            )
            row = await cur.fetchone()
        if not row:
            print(f"User {TEST_EMAIL} no encontrado")
            sys.exit(1)
        uid = row["user_id"]
        print(f"uid: {uid}")

    diag = {
        "completed_at": "2026-04-29T00:00:00Z",
        "competencias_foco": ["comunicacion"],
        "strengths": [{"skill": "escucha activa", "evidence": "demo", "why_matters": "demo"}],
        "gaps": [{"skill": "manejo objeciones", "evidence": "demo", "impact": "demo", "micro_practice": "demo"}],
        "blind_spot": "Tendencia a hablar mas que escuchar",
        "reflection_question": "Cuando fue la ultima vez que cediste para entender mejor?",
        "verbal_patterns": {
            "vague_verbs_detected": [],
            "we_vs_i_tendency": "media",
            "filler_frequency": "baja",
        },
        "recommended_next_scenario": "roberto",
        "recommended_next_level": "intermedio",
        "is_demo": True,
    }
    diag_id = await save_diagnostic(user_id=uid, diagnostico=diag, conversation=[])
    print(f"saved diag_id: {diag_id}")
    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
