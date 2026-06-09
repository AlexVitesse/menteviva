"""Smoke test del endpoint de session tokens de Simli (avatar fotorrealista).

Llama al router directo (sin levantar uvicorn) y verifica que la SIMLI_API_KEY
del .env emite un token valido contra api.simli.ai (API LIVE — consume una
creacion de sesion, no minutos de streaming). Uso:

    cd menteviva-backend
    poetry run python -m scripts.test_simli_token
"""

import asyncio

from app.config import settings
from app.routers.simli import AVATAR_FACES, SimliTokenRequest, create_simli_session_token


async def main() -> None:
    print(f"SIMLI_API_KEY configurada: {'si' if settings.simli_api_key else 'NO'}")
    print(f"Caras mapeadas: {AVATAR_FACES}")

    resp = await create_simli_session_token(SimliTokenRequest(avatar_id="entrevistador"))
    token = resp["session_token"]
    print(f"face_id: {resp['face_id']}")
    print(f"token:   {token[:24]}... ({len(token)} chars)")
    assert len(token) > 100, "token sospechosamente corto"
    print("OK: Simli emitio session token para el entrevistador")


if __name__ == "__main__":
    asyncio.run(main())
