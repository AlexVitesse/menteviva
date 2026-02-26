"""
Router para gestion de avatares.

Endpoints:
- GET /api/avatars - Lista todos los avatares
- GET /api/avatars/{avatar_id} - Detalle de un avatar
"""

import logging
from fastapi import APIRouter, HTTPException
from app.prompts.scenarios import get_all_avatars, get_avatar

logger = logging.getLogger("menteviva")
router = APIRouter()


@router.get("/avatars")
async def list_avatars():
    """
    Lista todos los avatares disponibles.

    Returns:
        Lista de avatares con informacion publica (sin system_prompt)
    """
    return {"avatars": get_all_avatars()}


@router.get("/avatars/{avatar_id}")
async def get_avatar_detail(avatar_id: str):
    """
    Obtiene detalle de un avatar especifico.

    Args:
        avatar_id: ID del avatar (roberto, maria, carlos)

    Returns:
        Informacion del avatar sin system_prompt

    Raises:
        404: Si el avatar no existe
    """
    avatar = get_avatar(avatar_id)
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")

    # No exponer system_prompt
    return {k: v for k, v in avatar.items() if k != "system_prompt"}
