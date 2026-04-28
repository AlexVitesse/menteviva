"""
Endpoints de sesiones de practica.

GET /api/user/{user_id}/sessions   -> lista ligera para dashboard
GET /api/session/{session_id}      -> sesion completa (analisis + conversacion)
"""

import logging

from fastapi import APIRouter, HTTPException

from app.services.session_repo import get_session, list_user_sessions

logger = logging.getLogger("menteviva")
router = APIRouter()


@router.get("/user/{user_id}/sessions")
async def read_user_sessions(user_id: str, limit: int = 50):
    return {"sessions": await list_user_sessions(user_id, limit=limit)}


@router.get("/session/{session_id}")
async def read_session(session_id: int):
    sess = await get_session(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")
    return sess
