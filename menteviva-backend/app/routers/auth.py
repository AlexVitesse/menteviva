"""
Endpoints de autenticacion via Firebase.

# Flujo
1. El frontend llama a Firebase JS SDK -> signInWithEmailAndPassword o
   createUserWithEmailAndPassword -> obtiene un ID token.
2. El frontend llama a estos endpoints mandando `Authorization: Bearer <token>`.
3. El backend verifica el token contra los certs de Google (firebase-admin)
   y extrae el UID. Devuelve el UserProfile completo.

# Endpoints
- POST /api/auth/register : tras el primer signup en Firebase. Body con la
                             info de registro; crea/actualiza la fila en SQLite.
- POST /api/auth/sync     : tras login. Solo verifica el token y devuelve
                             el UserProfile existente (404 si no se ha registrado).

No emitimos tokens propios: confiamos en el ID token de Firebase. Renovacion
la maneja el cliente con onIdTokenChanged.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.models.user_profile import Registro
from app.services.firebase_auth import get_firebase_user, verify_firebase_token
from app.services.user_repo import (
    get_user_profile,
    register_firebase_user,
    touch_last_login,
)

logger = logging.getLogger("menteviva")
router = APIRouter()


class RegisterBody(BaseModel):
    """Datos de registro adicionales (no estan en Firebase). El email lo
    leemos del token verificado, no del body — evita inconsistencias."""

    nombre: str
    rol_objetivo: str
    industria: str
    experience_level: str  # entry|junior|mid|senior|lead|executive


@router.post("/auth/register")
async def auth_register(
    body: RegisterBody,
    uid: str = Depends(verify_firebase_token),
):
    """Crea el UserProfile en SQLite tras el signup en Firebase.

    Idempotente: si el usuario ya existe lo actualiza con los datos nuevos
    (util si el frontend reintenta tras un crash entre Firebase y backend).
    """
    fb_user = await get_firebase_user(uid)
    registro = Registro(
        nombre=body.nombre,
        email=fb_user.get("email"),
        rol_objetivo=body.rol_objetivo,
        industria=body.industria,
        experience_level=body.experience_level,
    )
    profile = await register_firebase_user(
        firebase_uid=uid,
        email=fb_user.get("email"),
        email_verified=bool(fb_user.get("email_verified")),
        registro=registro,
    )
    return profile.model_dump()


@router.post("/auth/sync")
async def auth_sync(uid: str = Depends(verify_firebase_token)):
    """Devuelve el UserProfile asociado al UID del token.

    Si el usuario nunca llamo /auth/register tras su signup en Firebase,
    devuelve 404 — el frontend debe redirigir a /registro para completar
    el flujo (Firebase ya creo la cuenta de auth pero falta la fila en
    nuestra DB).
    """
    profile = await get_user_profile(uid)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario autenticado en Firebase pero sin registro en Mente Viva. "
                   "Completa el formulario de registro.",
        )
    await touch_last_login(uid)
    return profile.model_dump()
