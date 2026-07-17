"""Smoke test local de cuotas y telemetria atomicas en Postgres."""

import asyncio

from app.config import settings
from app.db import close_pool, get_db, init_db
from app.services import resource_limits, telemetry

TEST_UID = "smoke:distributed-controls"
TEST_METRIC = "smoke_distributed_increment"


async def main() -> None:
    settings.resource_limit_store = "database"
    settings.telemetry_store = "database"
    await init_db()
    try:
        async with get_db() as conn:
            await conn.execute(
                "DELETE FROM conversation_usage_limits WHERE user_id = %s", (TEST_UID,)
            )
            await conn.execute(
                "DELETE FROM operational_metrics WHERE metric_name = %s", (TEST_METRIC,)
            )

        results = await asyncio.gather(
            resource_limits.acquire_conversation_slot(TEST_UID),
            resource_limits.acquire_conversation_slot(TEST_UID),
        )
        if sum(1 for accepted, _ in results if accepted) != 1:
            raise AssertionError(f"concurrencia no atomica: {results}")
        await resource_limits.release_conversation_slot(TEST_UID)
        await resource_limits.record_conversation_usage(TEST_UID, 15)

        await asyncio.gather(*(telemetry.increment(TEST_METRIC) for _ in range(20)))
        if (await telemetry.snapshot()).get(TEST_METRIC) != 20:
            raise AssertionError("incrementos distribuidos perdidos")

        print("OK: cuota atomica 1/2 y telemetria atomica 20/20")
    finally:
        async with get_db() as conn:
            await conn.execute(
                "DELETE FROM conversation_usage_limits WHERE user_id = %s", (TEST_UID,)
            )
            await conn.execute(
                "DELETE FROM operational_metrics WHERE metric_name = %s", (TEST_METRIC,)
            )
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
