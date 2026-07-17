"""
Endpoints de sesiones de practica.

GET /api/user/{user_id}/sessions   -> lista ligera para dashboard
GET /api/session/{session_id}      -> sesion completa (analisis + conversacion)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.services.firebase_auth import verify_firebase_token
from app.services.session_repo import get_session, list_user_sessions

logger = logging.getLogger("menteviva")
router = APIRouter()


@router.get("/me/sessions")
async def read_my_sessions(
    limit: int = Query(50, ge=1, le=100),
    uid: str = Depends(verify_firebase_token),
):
    return {"sessions": await list_user_sessions(uid, limit=limit)}


@router.get("/session/{session_id}")
async def read_session(
    session_id: int,
    uid: str = Depends(verify_firebase_token),
):
    sess = await get_session(session_id, uid)
    if not sess:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")
    return sess


@router.get("/user/{user_id}/sessions", deprecated=True)
async def read_user_sessions_legacy(
    user_id: str,
    limit: int = Query(50, ge=1, le=100),
    uid: str = Depends(verify_firebase_token),
):
    if user_id != uid:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return await read_my_sessions(limit=limit, uid=uid)
