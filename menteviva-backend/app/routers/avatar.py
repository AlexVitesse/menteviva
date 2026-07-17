"""Router unificado de sesion de avatar de video (/api/avatar/session).

Punto de entrada UNICO para el frontend: segun `settings.avatar_provider`
despacha al proveedor correspondiente y responde con un shape auto-descrito
por `provider`. Asi el navegador no necesita saber que motor hay detras — pide
una sesion y actua segun el `provider` que recibe.

Contrato (NO cambiar sin avisar al lado de AvatarAI, que construye el
avatar-service contra este mismo contrato — ver docs/plans/16_...md §1):

    POST /api/avatar/session   body: { "avatar_id": "entrevistador" }

    provider=simli -> { "provider": "simli", "session_token": "...", "face_id": "..." }
    provider=oss   -> { "provider": "oss", "session_id": "...", "signaling_url": "...",
                        "ice_servers": [...], "max_session_seconds": 1800 }
    provider=none  -> { "provider": "none" }

Los secretos (SIMLI_API_KEY, AVATAR_SERVICE_URL) viven SOLO en el backend: el
navegador solo ve tokens efimeros / URLs de senalizacion ya resueltas.
"""

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.routers.simli import AVATAR_FACES, DEFAULT_FACE_ID, mint_simli_session

logger = logging.getLogger("menteviva")

router = APIRouter()

# STUN publico por defecto para el camino OSS. El avatar-service puede sobrescribir
# los ice_servers en su respuesta de /session; si no, el backend inyecta este.
DEFAULT_ICE_SERVERS = [{"urls": "stun:stun.l.google.com:19302"}]

# v2: el avatar-service es multi-sesion. Un 409 en POST /session ya NO significa
# "una a la vez", sino que se alcanzo MAX_SESSIONS concurrentes (capacidad
# temporal). Reintentamos con backoff corto; si persiste devolvemos 503 y el
# frontend cae al fallback 2D/Simli.
_CAP_BACKOFFS = (0.4, 0.8)  # segundos entre reintentos (2 reintentos)


class AvatarSessionRequest(BaseModel):
    avatar_id: str = "entrevistador"


async def _oss_session(avatar_id: str) -> dict:
    """Crea una sesion contra el avatar-service OSS (WebRTC self-hosted).

    Hace POST {avatar_service_url}/session server-side y devuelve la
    signaling_url que el navegador usara para negociar WebRTC directo.
    """
    if not settings.avatar_service_url:
        raise HTTPException(status_code=503, detail="AVATAR_SERVICE_URL no configurada")

    base = settings.avatar_service_url.rstrip("/")
    payload = {
        "avatar_id": avatar_id,
        # face_id: mismo mapeo que Simli por ahora (el avatar-service decide como
        # resolverlo a su cara prediseñada; ver §7 del plan — rostros sinteticos).
        "face_id": AVATAR_FACES.get(avatar_id, DEFAULT_FACE_ID),
        "max_session_seconds": settings.avatar_max_session_seconds,
    }

    resp = None
    for attempt in range(len(_CAP_BACKOFFS) + 1):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(f"{base}/session", json=payload)
        except httpx.HTTPError as e:
            logger.error(f"[AvatarOSS] error de red pidiendo sesion: {e}")
            raise HTTPException(status_code=502, detail="No se pudo contactar al avatar-service")

        # 409 = servicio lleno (MAX_SESSIONS). Reintento con backoff; si persiste, 503.
        if resp.status_code != 409:
            break
        if attempt < len(_CAP_BACKOFFS):
            logger.info(
                f"[AvatarOSS] servicio lleno (409), reintento {attempt + 1}/{len(_CAP_BACKOFFS)}"
            )
            await asyncio.sleep(_CAP_BACKOFFS[attempt])
            continue
        logger.warning(f"[AvatarOSS] servicio lleno (409) tras reintentos: {resp.text[:200]}")
        raise HTTPException(
            status_code=503,
            detail="El avatar-service esta lleno (capacidad maxima). Reintenta en unos segundos.",
        )

    if resp.status_code != 200:
        logger.error(f"[AvatarOSS] sesion rechazada {resp.status_code}: {resp.text[:200]}")
        raise HTTPException(status_code=502, detail="El avatar-service rechazo la sesion")

    try:
        data = resp.json()
    except ValueError:
        logger.error(f"[AvatarOSS] respuesta no-JSON: {resp.text[:200]}")
        raise HTTPException(status_code=502, detail="El avatar-service devolvio una respuesta invalida")

    session_id = data.get("session_id")
    signaling_url = data.get("signaling_url")
    if not session_id or not signaling_url:
        logger.error(f"[AvatarOSS] respuesta incompleta: {data}")
        raise HTTPException(status_code=502, detail="El avatar-service no devolvio session_id/signaling_url")

    logger.info(f"[AvatarOSS] sesion creada (avatar={avatar_id}, session={str(session_id)[:8]}...)")
    return {
        "provider": "oss",
        "session_id": session_id,
        "signaling_url": signaling_url,
        # El servicio puede fijar sus propios ICE servers; si no, usamos STUN publico.
        "ice_servers": data.get("ice_servers") or DEFAULT_ICE_SERVERS,
        "max_session_seconds": data.get("max_session_seconds", settings.avatar_max_session_seconds),
    }


@router.post("/avatar/session")
async def create_avatar_session(req: AvatarSessionRequest):
    """Crea una sesion de avatar segun el proveedor configurado.

    Endpoint agnostico del motor: el frontend lee `provider` de la respuesta y
    se comporta segun corresponda (mint token Simli, negociar WebRTC OSS, o caer
    al avatar 2D). Ver el contrato en el docstring del modulo.
    """
    provider = settings.avatar_provider.lower()

    if provider == "simli":
        session = await mint_simli_session(req.avatar_id)
        return {"provider": "simli", **session}

    if provider == "oss":
        return await _oss_session(req.avatar_id)

    if provider == "none":
        return {"provider": "none"}

    logger.error(f"[Avatar] AVATAR_PROVIDER desconocido: {settings.avatar_provider!r}")
    raise HTTPException(status_code=503, detail=f"AVATAR_PROVIDER invalido: {settings.avatar_provider!r}")
