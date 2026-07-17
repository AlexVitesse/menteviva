"""
Endpoints de usuario y diagnosticos persistidos.

GET /api/user/{user_id}                 -> UserProfile completo (registro + ultimo diag)
GET /api/user/{user_id}/diagnostics     -> metadatos del historial
GET /api/diagnostic/{diagnostic_id}     -> un diagnostico especifico + conversacion
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.services.firebase_auth import verify_firebase_token
from app.services.user_repo import (
    get_diagnostic,
    get_user_profile,
    list_user_diagnostics,
)

logger = logging.getLogger("menteviva")
router = APIRouter()


@router.get("/me")
async def read_my_profile(uid: str = Depends(verify_firebase_token)):
    profile = await get_user_profile(uid)
    if not profile:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return profile.model_dump()


@router.get("/me/diagnostics")
async def read_my_diagnostics(uid: str = Depends(verify_firebase_token)):
    return {"diagnostics": await list_user_diagnostics(uid)}


@router.get("/diagnostic/{diagnostic_id}")
async def read_diagnostic(
    diagnostic_id: int,
    uid: str = Depends(verify_firebase_token),
):
    diag = await get_diagnostic(diagnostic_id, uid)
    if not diag:
        raise HTTPException(status_code=404, detail="Diagnostico no encontrado")
    return diag


# Compatibilidad temporal con clientes anteriores. La identidad efectiva sigue
# siendo la del token; un path con otro UID se responde como recurso inexistente.
@router.get("/user/{user_id}", deprecated=True)
async def read_user_profile_legacy(
    user_id: str,
    uid: str = Depends(verify_firebase_token),
):
    if user_id != uid:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return await read_my_profile(uid)


@router.get("/user/{user_id}/diagnostics", deprecated=True)
async def read_user_diagnostics_legacy(
    user_id: str,
    uid: str = Depends(verify_firebase_token),
):
    if user_id != uid:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return await read_my_diagnostics(uid)
