"""
Inicializacion del Firebase Admin SDK + verificacion de ID tokens.

# Como se configura
Lee de settings:
- firebase_service_account_path: ruta a JSON descargado de Firebase Console.
- firebase_service_account_json: contenido del JSON como string (alternativa
  para hosts donde no puedes subir archivos, ej. Render).

Si ninguna esta seteada, el modulo NO inicializa Firebase y `verify_id_token`
levanta HTTPException(503). Esto permite levantar el backend sin Firebase
configurado todavia (util mientras Firebase Console se configura aparte).

# Como se usa
En endpoints protegidos:

    from app.services.firebase_auth import verify_firebase_token

    @router.post("/some-endpoint")
    async def my_endpoint(uid: str = Depends(verify_firebase_token)):
        ...

El frontend manda `Authorization: Bearer <id_token>`. La funcion verifica
contra los certs publicos de Google (con cache interno) y devuelve el UID.
"""

import json
import logging
from typing import Optional

from fastapi import Header, HTTPException, status

from app.config import settings

logger = logging.getLogger("menteviva")

_initialized = False
_init_error: Optional[str] = None


def _try_init() -> bool:
    """Inicializa Firebase Admin una sola vez. Devuelve True si OK.

    No levanta excepcion si falla — la guarda en `_init_error` para que
    `verify_firebase_token` pueda devolver un 503 con explicacion.
    """
    global _initialized, _init_error
    if _initialized:
        return True

    try:
        import firebase_admin
        from firebase_admin import credentials
    except ImportError as e:
        _init_error = f"firebase-admin no instalado: {e}"
        logger.error(f"[firebase_auth] {_init_error}")
        return False

    cred = None
    if settings.firebase_service_account_path:
        path = settings.firebase_service_account_path
        try:
            cred = credentials.Certificate(path)
            logger.info(f"[firebase_auth] credenciales cargadas desde {path}")
        except Exception as e:
            _init_error = f"no pude leer service account JSON en {path}: {e}"
            logger.error(f"[firebase_auth] {_init_error}")
            return False
    elif settings.firebase_service_account_json:
        try:
            data = json.loads(settings.firebase_service_account_json)
            cred = credentials.Certificate(data)
            logger.info("[firebase_auth] credenciales cargadas desde env JSON")
        except Exception as e:
            _init_error = f"no pude parsear FIREBASE_SERVICE_ACCOUNT_JSON: {e}"
            logger.error(f"[firebase_auth] {_init_error}")
            return False
    else:
        _init_error = (
            "Firebase no configurado. Setea FIREBASE_SERVICE_ACCOUNT_PATH "
            "o FIREBASE_SERVICE_ACCOUNT_JSON en .env. Ver FIREBASE_SETUP.md."
        )
        logger.warning(f"[firebase_auth] {_init_error}")
        return False

    try:
        firebase_admin.initialize_app(cred)
        _initialized = True
        logger.info("[firebase_auth] Firebase Admin SDK inicializado")
        return True
    except ValueError as e:
        # ya estaba inicializado (puede pasar con hot-reload de uvicorn)
        if "already exists" in str(e).lower():
            _initialized = True
            return True
        _init_error = f"initialize_app fallo: {e}"
        logger.error(f"[firebase_auth] {_init_error}")
        return False


def is_configured() -> bool:
    """True si Firebase esta listo para verificar tokens."""
    if not _initialized:
        _try_init()
    return _initialized


async def verify_firebase_token(
    authorization: Optional[str] = Header(None),
) -> str:
    """
    Dependency de FastAPI: extrae el ID token del header Authorization,
    lo verifica contra los certs de Google y devuelve el UID.

    Errores:
    - 503 si Firebase no esta configurado en el server (.env vacio).
    - 401 si el header falta o el token es invalido/expirado.
    """
    if not is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Firebase Auth no disponible: {_init_error}",
        )

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header requerido (Bearer <id_token>)",
        )

    token = authorization[7:].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token vacio",
        )

    try:
        from firebase_admin import auth as fb_auth

        decoded = fb_auth.verify_id_token(token)
        return decoded["uid"]
    except fb_auth.ExpiredIdTokenError:
        raise HTTPException(401, "Token expirado")
    except fb_auth.InvalidIdTokenError as e:
        raise HTTPException(401, f"Token invalido: {e}")
    except Exception as e:
        logger.error(f"[firebase_auth] verify_id_token fallo: {e}")
        raise HTTPException(401, "Token no verificable")


async def get_firebase_user(uid: str) -> dict:
    """Trae datos basicos del user desde Firebase (email, email_verified, etc).

    Util para enriquecer registro tras /auth/register sin volver a pedirle
    el email al cliente.
    """
    if not is_configured():
        raise HTTPException(503, f"Firebase Auth no disponible: {_init_error}")
    from firebase_admin import auth as fb_auth

    record = fb_auth.get_user(uid)
    return {
        "uid": record.uid,
        "email": record.email,
        "email_verified": record.email_verified,
        "display_name": record.display_name,
    }
