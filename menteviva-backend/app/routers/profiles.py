"""
Endpoints de usuario y diagnosticos persistidos.

GET /api/user/{user_id}                 -> UserProfile completo (registro + ultimo diag)
GET /api/user/{user_id}/diagnostics     -> metadatos del historial
GET /api/diagnostic/{diagnostic_id}     -> un diagnostico especifico + conversacion
"""
import logging

from fastapi import APIRouter, HTTPException

from app.services.user_repo import (
    get_diagnostic,
    get_user_profile,
    list_user_diagnostics,
)

logger = logging.getLogger("menteviva")
router = APIRouter()


@router.get("/user/{user_id}")
async def read_user_profile(user_id: str):
    profile = await get_user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return profile.model_dump()


@router.get("/user/{user_id}/diagnostics")
async def read_user_diagnostics(user_id: str):
    return {"diagnostics": await list_user_diagnostics(user_id)}


@router.get("/diagnostic/{diagnostic_id}")
async def read_diagnostic(diagnostic_id: int):
    diag = await get_diagnostic(diagnostic_id)
    if not diag:
        raise HTTPException(status_code=404, detail="Diagnostico no encontrado")
    return diag
