# 2026-08-05 — Preparacion de AvatarAI para RunPod

Se dejo preparada, sin desplegar, la integracion de Mente Viva con el servicio
AvatarAI/MuseTalk alojable posteriormente en RunPod.

## Cambios en Mente Viva

- Nuevo `AVATAR_SERVICE_TOKEN` exclusivo del backend.
- El router `/api/avatar/session` envia el Bearer al servicio AvatarAI.
- El token no se devuelve al navegador ni se expone mediante variables `VITE_*`.
- El transporte OSS WebSocket consume un `session_id` efimero y de un solo uso.
- El build Docker del frontend acepta `VITE_AVATAR_PROVIDER` y
  `VITE_AVATAR_TRANSPORT`.
- Se actualizaron los ejemplos de entorno y la guia
  `docs/AVATARAI_RUNPOD_INTEGRATION.md`.

## Configuracion prevista para RunPod

Backend:

```dotenv
REALTIME_PROVIDER=gemini
AVATAR_PROVIDER=oss
AVATAR_SERVICE_URL=https://URL-PUBLICA-DEL-POD
AVATAR_SERVICE_TOKEN=SECRETO_COMPARTIDO
```

Frontend durante el build:

```dotenv
VITE_REALTIME_PROVIDER=gemini
VITE_AVATAR_PROVIDER=oss
VITE_AVATAR_TRANSPORT=ws
```

## Validacion

- 95 pruebas del backend aprobadas.
- 35 pruebas del frontend aprobadas.
- Typecheck de TypeScript limpio.
- Configuracion Docker Compose valida.

No se construyeron imagenes, descargaron modelos, arrancaron servicios ni
realizaron cambios en un pod. El registro tecnico completo esta en
`AvatarAI/docs/sessions/2026-08-05_preparacion_runpod_mente_viva.md`.

