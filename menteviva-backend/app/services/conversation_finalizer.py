"""Analisis y persistencia compartidos por todos los proveedores de conversacion."""

import asyncio
import logging
import time
from datetime import datetime, timezone

from fastapi import WebSocket

from app.config import settings
from app.models import UserProfile
from app.models.user_profile import Registro
from app.services.analysis import analyze_conversation, generate_user_profile
from app.services.session_repo import save_practice_session
from app.services.telemetry import increment, observe_seconds
from app.services.user_repo import save_diagnostic

logger = logging.getLogger("menteviva")


async def finalize_conversation(
    websocket: WebSocket,
    avatar: dict,
    avatar_id: str,
    conversation_history: list[dict],
    session_start_time: float,
    user_profile: UserProfile | None,
    session_vars: dict | None,
    level: str | None,
) -> None:
    duration_seconds = int(time.time() - session_start_time)
    total_exchanges = len(conversation_history) // 2
    logger.info(
        "[WS] sesion finalizada exchanges=%d duration_seconds=%d",
        total_exchanges,
        duration_seconds,
    )
    await websocket.send_json({"type": "status", "status": "analyzing"})
    base_metrics = {
        "total_exchanges": total_exchanges,
        "duration_seconds": duration_seconds,
        "conversation": conversation_history,
    }
    analysis_started = time.monotonic()

    if avatar.get("kind") == "diagnostico":
        registro = user_profile.registro if user_profile and user_profile.registro else None
        used_placeholder = registro is None
        if registro is None:
            registro = Registro(
                nombre="Candidato",
                rol_objetivo="Profesional",
                industria="General",
                experience_level="mid",
            )
        async with asyncio.timeout(settings.provider_analysis_timeout_seconds):
            diagnostico = await generate_user_profile(
                conversation=conversation_history,
                registro=registro,
                session_vars=session_vars,
            )
        await observe_seconds(
            "provider_latency",
            time.monotonic() - analysis_started,
            provider="groq",
            operation="analysis",
        )
        if used_placeholder:
            diagnostico["is_demo"] = True
        if user_profile and user_profile.user_id:
            try:
                await save_diagnostic(
                    user_id=user_profile.user_id,
                    diagnostico=diagnostico,
                    conversation=conversation_history,
                )
            except Exception as exc:
                await increment("persistence_failures", provider="postgres")
                logger.error("[WS] save_diagnostic fallo: %s", type(exc).__name__)
        await websocket.send_json({
            "type": "session_end",
            "metrics": {**base_metrics, "user_profile_update": diagnostico},
        })
        return

    async with asyncio.timeout(settings.provider_analysis_timeout_seconds):
        analysis = await analyze_conversation(
            avatar_id=avatar_id,
            conversation=conversation_history,
            duration_seconds=duration_seconds,
        )
    await observe_seconds(
        "provider_latency",
        time.monotonic() - analysis_started,
        provider="groq",
        operation="analysis",
    )
    session_id = None
    if user_profile and user_profile.user_id:
        try:
            session_id = await save_practice_session(
                user_id=user_profile.user_id,
                avatar_id=avatar_id,
                level=level,
                started_at=datetime.fromtimestamp(
                    session_start_time, timezone.utc
                ).isoformat(),
                ended_at=datetime.now(timezone.utc).isoformat(),
                duration_seconds=duration_seconds,
                total_exchanges=total_exchanges,
                analysis=analysis,
                conversation=conversation_history,
            )
        except Exception as exc:
            await increment("persistence_failures", provider="postgres")
            logger.error("[WS] save_practice_session fallo: %s", type(exc).__name__)
    metrics = {**base_metrics, "analysis": analysis}
    if session_id:
        metrics["session_id"] = session_id
    await websocket.send_json({"type": "session_end", "metrics": metrics})
