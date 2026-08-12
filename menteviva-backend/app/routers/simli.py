"""Tokens de sesion para Simli (avatar fotorrealista en video, WebRTC).

El frontend NUNCA ve la SIMLI_API_KEY: pide aqui un session token efimero
(POST /api/simli/session-token) y con el abre la conexion WebRTC directa
contra api.simli.ai usando el SDK `simli-client`. El audio PCM del avatar
(Gemini Live, 24 kHz) se remuestrea a 16 kHz en el cliente y Simli devuelve
video+voz lip-synced.

Docs: https://docs.simli.com/api-reference/compose-session-token
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.services.firebase_auth import verify_firebase_token

logger = logging.getLogger("menteviva")

router = APIRouter()

SIMLI_TOKEN_URL = "https://api.simli.ai/compose/token"

# faceId de Simli por avatar_id. Catalogo de caras predefinidas:
# https://docs.simli.com/api-reference/preset-faces
# Sofia (entrevistadora del diagnostico) usa "Tina". Avatares sin cara propia
# caen al DEFAULT_FACE_ID hasta que se les asigne una.
AVATAR_FACES: dict[str, str] = {
    "entrevistador": "cace3ef7-a4c4-425d-a8cf-a5358eb0c427",  # Tina
}
DEFAULT_FACE_ID = "cace3ef7-a4c4-425d-a8cf-a5358eb0c427"


class SimliTokenRequest(BaseModel):
    avatar_id: str = "entrevistador"


async def mint_simli_session(avatar_id: str) -> dict:
    """Emite un session token efimero de Simli para el avatar pedido.

    Helper reutilizable: lo llama tanto el endpoint legacy
    (POST /api/simli/session-token) como el router unificado
    (POST /api/avatar/session, provider=simli). Devuelve
    {"session_token": ..., "face_id": ...} o lanza HTTPException
    (503 sin config, 502 si Simli falla) — mismo contrato de errores.
    """
    if not settings.simli_api_key:
        raise HTTPException(status_code=503, detail="SIMLI_API_KEY no configurada")

    face_id = AVATAR_FACES.get(avatar_id, DEFAULT_FACE_ID)
    payload = {
        "faceId": face_id,
        "maxSessionLength": settings.simli_max_session_seconds,
        "maxIdleTime": 300,
        # handleSilence=True: Simli mantiene el avatar "vivo" (idle) cuando no
        # le mandamos audio, en vez de congelar el ultimo frame.
        "handleSilence": True,
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                SIMLI_TOKEN_URL,
                json=payload,
                headers={"x-simli-api-key": settings.simli_api_key},
            )
    except httpx.HTTPError as e:
        logger.error("[Simli] error de red pidiendo session token type=%s", type(e).__name__)
        raise HTTPException(status_code=502, detail="No se pudo contactar a Simli")

    if resp.status_code != 200:
        logger.error("[Simli] token rechazado status=%s", resp.status_code)
        raise HTTPException(status_code=502, detail="Simli rechazo la creacion de sesion")

    token = resp.json().get("session_token", "")
    if not token or token == "FAIL TOKEN":
        logger.error("[Simli] respuesta sin token valido")
        raise HTTPException(status_code=502, detail="Simli no devolvio un token valido")

    logger.info(f"[Simli] session token emitido (avatar={avatar_id}, face={face_id[:8]}...)")
    return {"session_token": token, "face_id": face_id}


@router.post("/simli/session-token")
async def create_simli_session_token(
    req: SimliTokenRequest,
    _uid: str = Depends(verify_firebase_token),
):
    """Endpoint legacy de session token de Simli.

    Requiere Firebase porque cada token permite consumir minutos facturables
    de la cuenta del proyecto.

    Se conserva intacto (aunque el router unificado /api/avatar/session ya
    cubre el camino simli) hasta validar el OSS en produccion.
    """
    return await mint_simli_session(req.avatar_id)
