# Estado de la rama `feature/avatar-oss` — 2026-07-16

Documentación de los cambios realizados el **2026-07-16**: integración del **avatar OSS self-hosted** (MuseTalk + WebRTC/WebSocket), robustecimiento de la conexión, configuración del selector de duración de VoiceLab y fixes del backend.

---

## 1. Resumen ejecutivo

Se completó la capa de integración del **avatar OSS self-hosted** para Mente Viva. Ahora el sistema puede despachar la generación de avatar a un servicio propio en lugar de depender únicamente de Simli (SaaS). Se implementó soporte para WebRTC (producción en VPS con TURN) y un transporte de WebSocket interino para desarrollo en RunPod. Adicionalmente, se robusteció el flujo de Diagnóstico en el frontend (control de doble clic y feedback de conexión), se fijó el modelo default de Gemini a 2.5-flash y se añadió un selector de duración para las simulaciones.

| Característica / Fix | Descripción | Estado |
|---|---|---|
| **Capa de integración Avatar OSS (§1)** | Despacho backend (`/api/avatar/session`) según `AVATAR_PROVIDER` e inyección de STUN. | ✅ Completado |
| **Transporte WebRTC para OSS** | Hook `useOssAvatar.ts` con DataChannel para control de interrupciones, `end_utterance` y estados. | ✅ Completado |
| **Transporte WebSocket (RunPod)** | Hook `useOssAvatarWs.ts` con renderizado vía Canvas y reproducción local del audio de Gemini. | ✅ Completado |
| **Control de doble-click e inactividad** | Deshabilitación del botón e indicador "Conectando con Sofía..." en `Diagnostico.tsx`. | ✅ Completado |
| **Fix de cuelgues (Connect)** | Guard de reentrancia síncrono y timeout de 12s para evitar bloqueos eternos si el avatar-service cae. | ✅ Completado |
| **Mensaje `bye` al desconectar** | Mensaje de control `{"type":"bye"}` al cerrar sesión/cierre de pestaña para liberar GPU de inmediato. | ✅ Completado |
| **Mapeo de error 409 (Lleno)** | Conversión de HTTP 409 en reintentos rápidos con backoff y fallback final a error HTTP 503 (Servicio lleno). | ✅ Completado |
| **Selector de duración VoiceLab** | Selector de duración (25, 40 o 60 minutos) integrado en la interfaz de usuario. | ✅ Completado |
| **API key pin en re-conexión** | Pin de la API key durante el resume de sesión de Gemini Live para evitar pérdidas de contexto. | ✅ Completado |
| **Cambio default Gemini** | Default de ChatLab cambiado a `gemini-2.5-flash` para mayor estabilidad y consistencia. | ✅ Completado |

---

## 2. Inventario de archivos modificados/creados

### Nuevos archivos
- [utils.ts](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-frontend/src/utils/avatarTransport.ts) (`src/utils/avatarTransport.ts`): Selector de transporte `"webrtc" | "ws"` para el proveedor OSS.
- [useOssAvatarWs.ts](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-frontend/src/hooks/useOssAvatarWs.ts): Hook de comunicación WebSocket para MuseTalk/RunPod.
- [test_avatar_session.py](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-backend/scripts/test_avatar_session.py): Pruebas automáticas de despacho de sesiones de avatar y reintentos ante error 409.
- [consultar_datos_piloto.md](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/docs/consultar_datos_piloto.md): Guía de consulta de base de datos Neon (actividad del piloto, satisfacción, diagnósticos).

### Archivos modificados
- **Backend (`menteviva-backend`)**:
  - [config.py](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-backend/app/config.py): Configuración de `avatar_provider`, `avatar_service_url` y `avatar_max_session_seconds`.
  - [main.py](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-backend/app/main.py): Registro del nuevo enrutador de avatar (`app.routers.avatar`).
  - [avatar.py](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-backend/app/routers/avatar.py): Endpoint `/api/avatar/session` con lógica de multi-proveedor y reintentos ante colisiones 409 (GPU ocupada).
  - [conversation.py](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-backend/app/routers/conversation.py): Lógica de persistencia de la API key durante re-conexiones de Gemini.

- **Frontend (`menteviva-frontend`)**:
  - [useOssAvatar.ts](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-frontend/src/hooks/useOssAvatar.ts): Comunicación WebRTC y envío/recepción de eventos por DataChannel.
  - [Diagnostico.tsx](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-frontend/src/pages/Diagnostico.tsx): Overlay de carga ("Conectando con Sofía..."), guard en click del botón e instanciación de los hooks WebRTC y WS.
  - [pcm.ts](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-frontend/src/utils/pcm.ts): Nuevos helpers `concatInt16()` y `pcm16ToWavBlob()` para reproducción local de audio en WebSocket.
  - [VideoAvatar.tsx](file:///C:/Users/pcdec/OneDrive/Documentos/Mente%20Viva/menteviva-frontend/src/components/avatar/VideoAvatar.tsx): Componente visual unificado para renderizar streams de Simli, WebRTC u OSS-WebSocket.

---

## 3. Decisiones y Detalles Técnicos Clave

1. **Liberación ágil de GPU (`bye`)**:
   Para evitar que el servidor de GPU mantenga ocupada una sesión hasta el timeout de inactividad de ICE (lo cual es sumamente costoso), el cliente ahora envía un mensaje JSON `{"type": "bye"}` al colgar o al cerrar/recargar la pestaña (`beforeunload`). Esto fuerza la liberación inmediata del cupo.
2. **Sincronía de Audio Local en WebSocket**:
   Dado que el endpoint WebSocket solo envía fotogramas de video JPEG binarios, la voz generada por Gemini se reproduce localmente. Para evitar que el audio comience antes de que cargue el primer frame de video (desfase de ~3.5 s por latencia de inferencia de MuseTalk), el audio se almacena temporalmente y se reproduce justamente al recibir el primer frame del video.
3. **Manejo de Reentrancia y Timeouts**:
   Se implementó un guard síncrono (`connectingRef`) en los hooks del avatar para prevenir que se instancien dos conexiones concurrentes al hacer doble clic rápido. Además, se añadió un timeout de 12 segundos para descartar la conexión si el WebSocket del avatar no abre rápido, haciendo un fallback inmediato a audio puro.

---

## 4. Cómo probar las nuevas funcionalidades

### Configuración en `.env` (Frontend)
Para forzar el uso del transporte WebSocket interino de RunPod:
```env
VITE_AVATAR_PROVIDER=oss
VITE_AVATAR_TRANSPORT=ws
```

### Ejecutar Pruebas del Backend
```bash
cd menteviva-backend
poetry run python -m scripts.test_avatar_session
```
