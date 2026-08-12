# Integracion preparada: Mente Viva -> AvatarAI en RunPod

La implementacion ya soporta el proveedor `oss` con transporte WebRTC y
WebSocket. Para RunPod se activa primero WebSocket, que atraviesa el mismo tunel
HTTPS y no depende de TURN.

No se realizo ningun despliegue. Estos son los valores que deben aplicarse cuando
el pod este listo.

## Backend

En `menteviva-backend/.env`:

```dotenv
REALTIME_PROVIDER=gemini
AVATAR_PROVIDER=oss
AVATAR_SERVICE_URL=https://URL-PUBLICA-DEL-PUERTO-8090
AVATAR_SERVICE_TOKEN=EL_MISMO_TOKEN_DE_AVATARAI
AVATAR_MAX_SESSION_SECONDS=1800
```

`AVATAR_SERVICE_TOKEN` se usa solo en la llamada servidor-a-servidor a
`POST /session`; el backend nunca lo devuelve al navegador. El navegador recibe
un `session_id` efimero para negociar `/ws/demo` o `/rtc/{id}`.

## Frontend

Vite fija estas variables durante el build:

```dotenv
VITE_REALTIME_PROVIDER=gemini
VITE_AVATAR_PROVIDER=oss
VITE_AVATAR_TRANSPORT=ws
```

El Dockerfile y Compose aceptan ahora esos build args. En PowerShell:

```powershell
$env:VITE_AVATAR_PROVIDER='oss'
$env:VITE_AVATAR_TRANSPORT='ws'
$env:VITE_SIMLI_AVATAR='0'
docker compose -f docker/docker-compose.yml build backend
```

En bash:

```bash
VITE_AVATAR_PROVIDER=oss \
VITE_AVATAR_TRANSPORT=ws \
VITE_SIMLI_AVATAR=0 \
docker compose -f docker/docker-compose.yml build backend
```

Despues se levanta Mente Viva con su flujo habitual. Si se cambia el provider o
transport, hay que reconstruir el frontend porque son variables `VITE_*`.

## Orden de validacion

1. Desde el pod: `GET http://localhost:8090/health` devuelve `status=ok`,
   `engine_loaded=true` y `auth_required=true`.
2. Desde donde corre Mente Viva: `GET <AVATAR_SERVICE_URL>/health` responde 200.
3. Con un usuario autenticado, `POST /api/avatar/session` en Mente Viva devuelve
   `provider=oss`, `session_id` y `signaling_url`.
4. Abrir Diagnostico con provider `oss`; confirmar video, voz, indicador de habla,
   interrupcion y cierre limpio.
5. Confirmar en `/health` que `session_count` vuelve a cero al cerrar.

El script `AvatarAI/scripts/check_contract.py` automatiza los pasos 1 y 2 y puede
probar la creacion de sesion con `--create-session`.

## Rollback rapido

Backend:

```dotenv
AVATAR_PROVIDER=simli
```

Frontend y rebuild:

```dotenv
VITE_AVATAR_PROVIDER=simli
VITE_AVATAR_TRANSPORT=webrtc
```

Simli permanece intacto como fallback; `none` mantiene disponible el avatar 2D.

