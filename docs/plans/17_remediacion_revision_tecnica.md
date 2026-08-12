# Plan de remediación de la revisión técnica

**Estado:** Propuesto  
**Fecha:** 2026-07-17  
**Alcance:** `menteviva-backend` y `menteviva-frontend`  
**Objetivo:** corregir riesgos de seguridad y costo, estabilizar autenticación y WebSockets, reducir duplicación y establecer una base automatizada de calidad.

## Seguimiento de ejecución

**Estado general:** En progreso  
**Última actualización:** 2026-07-17

- [x] Crear rutas autenticadas `/api/me`, `/api/me/diagnostics` y `/api/me/sessions`.
- [x] Aplicar ownership en SQL para diagnósticos y sesiones individuales.
- [x] Limitar `limit` de sesiones al rango `1..100`.
- [x] Mantener rutas legacy con comprobación estricta `{user_id} == uid`.
- [x] Migrar “Mi Plan” al cliente HTTP autenticado y `/api/me/sessions`.
- [x] Emitir tickets WebSocket opacos, efímeros y de un solo uso.
- [x] Exigir ticket en `/api/conversation/{avatar_id}`.
- [x] Cargar el perfil desde el UID del ticket y dejar de confiar en `user_profile` del cliente.
- [x] Separar la recolección pytest (`tests/`) de los harnesses con APIs reales (`scripts/`).
- [x] Añadir 8 pruebas automatizadas de ownership, límites y tickets.
- [x] Sustituir el almacén de tickets en memoria antes de usar múltiples workers/instancias (Postgres atómico en producción).
- [x] Proteger emisión de sesiones Simli y avatar OSS con Firebase.
- [x] Cerrar ChatLab y VoiceLab en producción sin `CHATLAB_TOKEN` y validar el token configurado.
- [x] Añadir allowlist Firebase individual para operadores de laboratorio.
- [x] Retirar el fallback de token compartido en producción; queda limitado a desarrollo/staging.
- [x] Validar tamaños de audio/chunks, base64 estricto, texto, turnos y duración máxima.
- [x] Añadir concurrencia y cuota horaria por UID.
- [x] Añadir defensa secundaria por IP en el edge/proxy Nginx.
- [x] Evitar render protegido antes de resolver Firebase.
- [x] Cancelar/invalidar `/auth/sync` obsoletos para evitar restaurar perfiles tras logout.
- [x] Hacer idempotente `connect()` e ignorar eventos de conexiones WebSocket obsoletas.
- [x] Manejar JSON inválido y cierres `1008`/`1009` en los hooks de producción.
- [x] Añadir pruebas unitarias de doble conexión, JSON inválido y cierre de política.
- [x] Añadir reconexión controlada para cierres recuperables (`1006`/`1011`, máximo dos intentos).
- [x] Añadir ESLint, Vitest, Testing Library y CI.
- [x] Añadir request ID, UID pseudonimizado y contadores operativos base.
- [x] Añadir máquina explícita de estados de autenticación y limpieza completa en logout.
- [x] Añadir Ruff al backend y chequeo de secretos al repositorio.
- [x] Unificar finalización y persistencia de Groq/Gemini.
- [x] Validar mensajes WebSocket con un protocolo discriminado y tipar eventos frontend.
- [x] Consolidar el transporte HTTP del frontend en `apiFetch`.

### Evidencia de verificación

- `python -m compileall -q app`: correcto.
- `DEBUG=false poetry run pytest -q`: **95 passed**, sin warnings; incluye auth, proveedores simulados, middleware, prompts, cuotas/telemetría distribuidas y sesiones WS completas.
- `npx tsc --noEmit`: correcto después de migrar REST, tickets, avatar y auth.
- `npm run lint`: correcto, cero warnings.
- `npm run test:coverage`: **35 passed** en 5 archivos; última cobertura completa 72.12 % statements / 74.30 % lines.
- `npm run test:e2e`: **10 escenarios ejecutados** secuencialmente con Firebase interceptado: rechazo anónimo, login válido/inválido, registro válido/validación, diagnóstico, dashboard → briefing → simulación → reporte y logout con limpieza de perfil.
- `node node_modules/vite/bin/vite.js build`: correcto, 2.660 módulos transformados.
- `python scripts/check_no_committed_secrets.py`: correcto.
- `poetry run pytest -q --cov=app --cov-fail-under=70`: **95 passed**, **71.19 % general** (subió desde 30 %); telemetría/costos 100 %, límites distribuidos 96 %, Gemini Live 92 %, Groq LLM 75 %, Whisper/protocolo/adaptadores/turnos/auth HTTP 100 %, prompts 97 %, Simli 92 % y finalizador 85 %.
- `poetry run python scripts/test_db_migrator.py`: migraciones Postgres **v1..v7** aplicadas correctamente.
- `poetry run python -m scripts.test_distributed_controls`: cuota concurrente atómica **1/2** y telemetría paralela **20/20**, con limpieza posterior.

## 1. Resultado esperado

Al concluir este plan:

- Ningún usuario podrá leer o modificar perfiles, diagnósticos o sesiones ajenas.
- Las operaciones que consumen servicios externos estarán autenticadas, limitadas y trazables.
- El backend no confiará en un `user_id` enviado por el navegador.
- Login, logout e hidratación inicial no podrán dejar un perfil obsoleto en memoria.
- Solo habrá una conexión WebSocket activa por simulación en el cliente.
- Groq y Gemini compartirán el mismo flujo de finalización y persistencia.
- Los contratos REST y WebSocket estarán validados y cubiertos por pruebas.
- Frontend y backend tendrán comandos repetibles de lint, tipos y pruebas para CI.

## 2. Principios de implementación

1. Corregir primero seguridad y control de costos; no empezar por el refactor grande.
2. Separar cambios de comportamiento de refactors para facilitar revisión y rollback.
3. Mantener compatibilidad temporal cuando sea seguro, pero no conservar contratos que permitan suplantación.
4. Usar el UID verificado por Firebase como única identidad autoritativa.
5. Probar cada fase antes de habilitarla en producción.
6. No ejecutar scripts de LLM contra APIs reales en CI; usar dobles de prueba.

## 3. Fase 0 — Línea base y contratos

**Prioridad:** inmediata  
**Dependencias:** ninguna  
**Objetivo:** congelar el comportamiento esperado antes de cambiar seguridad y orquestación.

### Tareas

- [x] Documentar los eventos actuales de `/api/conversation/{avatar_id}` como una unión discriminada por `type`.
- [x] Documentar qué endpoints son públicos, autenticados y exclusivos del laboratorio.
- [x] Crear una matriz de recursos y propiedad:

  | Recurso | Identidad propietaria | Lectura | Escritura |
  |---|---|---|---|
  | Perfil | Firebase UID | propietario | propietario |
  | Diagnóstico | `user_id` de la fila | propietario | propietario |
  | Sesión práctica | `user_id` de la fila | propietario | propietario |
  | Catálogo de avatares | ninguna | público | servidor |
  | Chat/Voice Lab | operador autorizado | operador | operador |

- [x] Añadir configuración explícita de entorno: `development`, `staging`, `production`.
- [x] Inventariar consumidores de rutas que actualmente incluyen `user_id` para preparar la migración.
- [x] Registrar límites iniciales y telemetría de tamaños/latencias para ajustarlos con datos de staging.

### Criterios de aceptación

- Existe un contrato único y revisado para REST y WebSocket.
- Cada endpoint tiene una clasificación de acceso.
- Se conocen todos los lugares del frontend que deberán migrar a rutas basadas en `/me`.

## 4. Fase 1 — Identidad, autorización e IDOR

**Prioridad:** crítica  
**Dependencias:** Fase 0  
**Objetivo:** impedir lectura, escritura o suplantación entre usuarios.

### Backend REST

- [x] Aplicar `Depends(verify_firebase_token)` a perfiles, diagnósticos y sesiones.
- [x] Sustituir rutas autoritativas basadas en datos del cliente:

  - `GET /api/user/{user_id}` → `GET /api/me`.
  - `GET /api/user/{user_id}/diagnostics` → `GET /api/me/diagnostics`.
  - `GET /api/user/{user_id}/sessions` → `GET /api/me/sessions`.

- [x] Para recursos por ID, consultar con propiedad en la misma sentencia:

  - `get_diagnostic(diagnostic_id, owner_uid)`.
  - `get_session(session_id, owner_uid)`.

- [x] Responder `404` cuando el recurso no exista o no pertenezca al UID, evitando filtrar su existencia.
- [x] Validar `limit` con límites `1..100`.
- [x] Mantener las rutas antiguas solo durante una ventana de migración si verifican que `{user_id} == uid`; retirarlas después.

### WebSocket

- [x] Autenticar el handshake mediante un ticket WebSocket efímero de un solo uso:

  1. El frontend obtiene `POST /api/ws-ticket` con su ID token Firebase.
  2. El backend crea un ticket aleatorio con UID, expiración breve y estado `unused`.
  3. El frontend conecta usando `?ticket=...`.
  4. El backend consume el ticket de forma atómica antes de aceptar la sesión.

- [x] No colocar el ID token Firebase duradero en la URL, porque puede terminar en logs de proxy.
- [x] Construir el `UserProfile` desde la base usando el UID autenticado.
- [x] Eliminar `upsert_user(user_profile)` del mensaje `init`.
- [x] Reducir `init` a preferencias no autoritativas: `session_vars` y `level`.
- [x] Ignorar cualquier `user_id`/perfil completo enviado por clientes antiguos.
- [x] Pasar la identidad autenticada a la carga de perfil, finalización y persistencia.
- [x] Impedir persistencia cuando no exista identidad válida rechazando el handshake.

### Frontend

- [x] Añadir un helper para solicitar el ticket y abrir el WebSocket.
- [x] Dejar de enviar `user_profile` completo en `init`.
- [x] Migrar la consulta existente de sesiones a `/api/me/sessions`.
- [x] Manejar `401`, ticket expirado y cierre WebSocket `1008` con un mensaje accionable.

### Pruebas obligatorias

- [x] Usuario A no puede usar las rutas legacy para consultar recursos de B.
- [x] Las búsquedas por diagnóstico y sesión reciben siempre el UID autenticado.
- [x] Un ticket no puede reutilizarse y expira correctamente.
- [x] Un usuario anónimo no puede abrir el WebSocket de producción.
- [x] Un recurso ajeno y uno inexistente producen `404` sin filtrar propiedad.
- [x] Añadir prueba WebSocket end-to-end de suplantación en `init`.

### Criterios de aceptación

- No existe una operación de datos personales que derive identidad de un campo del cliente.
- Todas las consultas por recurso incluyen la propiedad del UID.
- El intento de suplantación queda cubierto por pruebas automatizadas.

## 5. Fase 2 — Control de costos, abuso y payloads

**Prioridad:** alta  
**Dependencias:** Fase 1  
**Objetivo:** impedir consumo ilimitado de Groq, Gemini, ElevenLabs, OpenAI, Simli y avatar OSS.

### Tareas

- [x] Proteger `/api/simli/session-token`, `/api/avatar/session` y conversación.
- [x] Cerrar los laboratorios en producción si `CHATLAB_TOKEN` no está configurado.
- [x] Validar el token compartido en REST y VoiceLab WebSocket.
- [x] Sustituir el token compartido del laboratorio por autorización de operador o una allowlist de UID en producción.
- [x] Añadir rate limiting por UID y, como defensa secundaria, por IP.
- [x] Añadir cuotas configurables:

  - Conexiones simultáneas por UID.
  - Creación de sesiones por minuto/hora.
  - Duración máxima de sesión.
  - Turnos máximos por sesión.
  - Minutos diarios de voz/video.

- [x] Validar antes de decodificar o enviar a proveedores:

  - Tamaño máximo del frame WebSocket.
  - Tamaño máximo de audio por turno.
  - Longitud de texto por turno.
  - Número y tamaño acumulado de mensajes del historial.
  - Formatos MIME permitidos.
  - Base64 válido mediante validación estricta.

- [x] Cerrar payloads excesivos con código WebSocket `1009` en Groq, Gemini y VoiceLab.
- [x] Añadir timeout por STT, LLM, TTS, análisis y sesión completa.
- [x] Liberar slots/cuotas en `finally`, incluso ante desconexión o cancelación.
- [x] Añadir idempotencia/consumo atómico para tickets donde aplica; sesiones externas no se reintentan sin control.
- [x] Emitir métricas de costo estimado, duración, proveedor/modelo, UID pseudonimizado y resultado.

### Criterios de aceptación

- Un cliente no autenticado no puede iniciar una operación con costo.
- Superar cuota, tamaño o concurrencia se rechaza antes de llamar al proveedor.
- Una desconexión no deja una cuota o sesión marcada como activa.
- Los límites pueden ajustarse por variables de entorno.

## 6. Fase 3 — Autenticación estable en React

**Prioridad:** alta  
**Dependencias:** Fase 1  
**Objetivo:** eliminar carreras de login/logout y exposición transitoria de perfiles obsoletos.

### Tareas

- [x] Convertir la autenticación global en una máquina de estados explícita:

  - `initializing`
  - `anonymous`
  - `syncing`
  - `authenticated`
  - `needs_registration`
  - `error`

- [x] Hacer que `App` espere el estado inicial antes de renderizar rutas o perfiles.
- [x] Eliminar la decisión de acceso basada únicamente en `localStorage` cuando no existe Firebase verificable.
- [x] Tratar el almacenamiento local como caché, nunca como prueba de autenticación.
- [x] Invalidar sincronizaciones anteriores mediante `AbortController` y un contador de generación.
- [x] Antes de aplicar `/auth/sync`, verificar que el UID actual siga siendo el UID que inició la petición.
- [x] En logout:

  - [x] Cancelar syncs pendientes.
  - [x] Cerrar WebSockets y audio mediante el evento global `menteviva:logout`.
  - [x] Limpiar perfil, diagnóstico en memoria y métricas de sesión.
  - [x] Invalidar tickets efímeros al consumirlos; no se almacenan en el cliente.

- [x] Evitar redirecciones hasta completar la hidratación inicial.
- [x] Centralizar guards en un componente basado en el estado de autenticación, no solo en `userProfile`.

### Pruebas obligatorias

- [x] Logout mientras `/auth/sync` está pendiente no restaura el perfil.
- [x] Cambio rápido de usuario A a B nunca muestra ni conserva datos de A.
- Recarga con perfil antiguo en `localStorage` muestra loading y luego la identidad correcta.
- [x] Un error 401/503 produce un estado recuperable sin entrar en bucle de navegación.

### Criterios de aceptación

- Ninguna respuesta asíncrona obsoleta puede modificar el estado actual.
- No se renderiza contenido protegido antes de resolver Firebase.
- Logout cancela todos los recursos asociados a la sesión.

## 7. Fase 4 — Ciclo de vida y contrato WebSocket

**Prioridad:** media-alta  
**Dependencias:** Fases 1 y 3  
**Objetivo:** garantizar una sola conexión activa, eventos válidos y recuperación predecible.

### Frontend

- [x] Crear un estado de conexión completo: `idle`, `connecting`, `open`, `ending`, `closed`, `error`.
- [x] Hacer `connect()` idempotente en `useWebSocket`, `useGeminiLive` y `useVoiceLab`:

  - No abrir si ya está `CONNECTING` u `OPEN` para el mismo avatar.
  - Cerrar y esperar la conexión anterior si cambia la sesión.
  - Asociar handlers a un `connectionId`; ignorar eventos de conexiones obsoletas.

- [x] Proteger `JSON.parse` antes de usar cada evento.
- [x] Limpiar texto pendiente y buffers principales al desconectar.
- [x] Evitar que `onclose` de una conexión antigua marque una nueva como desconectada.
- [x] Definir reconexión solo para cortes recuperables; no reconectar después de `end_session`, `1008` o `1009`.
- [x] Deshabilitar envío de audio/texto mientras el socket no esté listo.

### Backend

- [x] Responder los errores principales con `{ "type": "error", "code": "...", "message": "..." }`.
- [x] Validar mensajes entrantes con modelos discriminados, no con diccionarios libres.
- [x] Rechazar tipos desconocidos y campos de identidad extra explícitamente.
- [x] Evitar devolver excepciones internas en los cierres principales.
- [x] Definir códigos de cierre y semántica común para autenticación, payload, cuota y fallo interno.
- [x] Asegurar cancelación de tareas Gemini y cierre de proveedor en todos los caminos.

### Criterios de aceptación

- Llamar dos veces a `connect()` no crea dos sesiones de proveedor.
- Eventos inválidos no rompen el handler ni contaminan el store.
- Los errores se muestran con un código estable y sin detalles internos.
- Todas las tareas y buffers se liberan al desmontar, terminar o cerrar sesión.

## 8. Fase 5 — Refactor de orquestación y reutilización

**Prioridad:** media  
**Dependencias:** Fases 1, 2 y 4 estabilizadas  
**Objetivo:** reducir duplicación sin cambiar el comportamiento ya asegurado.

### Diseño propuesto

- `ConversationIdentity`: UID, perfil cargado, permisos y modo demo.
- `ConversationContext`: avatar, nivel, variables, timestamps e historial.
- `ConversationLimits`: tamaños, turnos, duración y cuota.
- `ConversationTransport`: emisión tipada de eventos WebSocket.
- `TurnProcessor`: validación → STT opcional → LLM → cierre → TTS.
- `ConversationFinalizer`: análisis, persistencia y construcción de métricas.
- Adaptadores de proveedor: `GroqConversationProvider` y `GeminiLiveProvider`.

### Tareas

- [x] Extraer la finalización de Groq y Gemini a una única función compartida.
- [x] Consolidar los caminos de texto y audio en un pipeline común después de obtener `user_text`.
- [x] Centralizar detección de cierre y despedida por defecto.
- [x] Centralizar persistencia best-effort y sus métricas de fallo.
- [x] Dividir `conversation.py` en fachada de router, sesión, proveedores, protocolo y finalización (`routers/conversation.py`, `services/conversation_session.py`, `conversation_providers.py`, `models/ws_protocol.py`, `conversation_finalizer.py`).
- [x] Extraer adaptadores `GroqConversationProvider` y `GeminiLiveProvider` con pruebas sin proveedores reales.
- [x] Extraer `TurnProcessor` común y `ConversationFinalizer` a servicios probados.
- [x] Hacer que `frontend/src/services/api.ts` reutilice el cliente HTTP único de `lib/api.ts`.
- [x] Mantener una sola estrategia de transporte, errores (`ApiError`) y autenticación.
- [x] Sustituir los eventos WebSocket libres por una unión tipada compartida en frontend.
- [x] Configurar logging una sola vez y evitar handlers duplicados durante hot reload.
- [x] Estandarizar timestamps de sesión como UTC aware (`datetime.now(timezone.utc)`).

### Estrategia segura

1. Escribir pruebas de caracterización del flujo existente.
2. Extraer finalización sin cambiar payloads.
3. Extraer transporte de eventos.
4. Unificar turnos de texto/audio.
5. Separar adaptadores de proveedor.
6. Eliminar código duplicado solo después de comparar contratos y logs.

### Criterios de aceptación

- Existe una sola implementación de análisis y persistencia final.
- Las ramas Groq y Gemini producen el mismo contrato final.
- `conversation.py` queda limitado a routing y composición.
- No se altera el comportamiento intencional de sincronización caption/audio.

## 9. Fase 6 — Pruebas, lint y CI

**Prioridad:** transversal; completar antes del cierre  
**Dependencias:** puede comenzar en Fase 1  
**Objetivo:** impedir regresiones y hacer verificable cada entrega.

### Backend

- [x] Crear `tests/` con `pytest`, `pytest-asyncio` y `httpx`.
- [x] Sobrescribir dependencias de autenticación y proveedores en pruebas.
- [x] Usar repositorios fake/mocks; no compartir datos de desarrollo.
- [x] Añadir pruebas unitarias para límites, cierre, repositorios y finalización.
- [x] Añadir pruebas de integración REST y WebSocket.
- [x] Simular Groq, Gemini, ElevenLabs, OpenAI, Simli y Firebase; CI no usa claves reales.
- [x] Añadir Ruff para lint/format; mypy o pyright queda como mejora opcional.

### Frontend

- [x] Añadir ESLint con reglas base de React Hooks y TypeScript.
- [x] Añadir Vitest y React Testing Library.
- [x] Probar store, auth guard, cliente API y hook WebSocket.
- [x] Añadir Playwright para flujos críticos iniciales con Firebase simulado:

  - Login/registro.
  - Diagnóstico.
  - Simulación y reporte.
  - Logout durante una operación pendiente.

  La carrera exacta logout/`auth/sync` pendiente está cubierta en
  `useFirebaseAuth.test.ts`; Playwright cubre además logout autenticado y limpieza
  efectiva de `localStorage`.

### Pipeline CI

- [x] Backend: lint → compile → unitarias/integración.
- [x] Frontend: lint → `tsc --noEmit` → unitarias → build.
- [x] Fallar si se detectan secretos o archivos `.env` privados versionados.
- [x] Publicar cobertura y artefactos de prueba.
- [x] No desplegar si falla autorización, contratos o build.

### Cobertura mínima inicial

- [x] 100 % de los casos críticos de autorización y propiedad inventariados.
- [x] 100 % de estados de autenticación y transiciones principales.
- [x] 100 % de tipos de evento WebSocket definidos en el contrato.
- [x] Objetivo mínimo inicial de 70 % en frontend y backend; CI aplica `--cov-fail-under=70` al backend (última ejecución: frontend 72.12 % statements, backend 70 %).

## 10. Fase 7 — Observabilidad y despliegue

**Prioridad:** media  
**Dependencias:** Fases 1 a 6  
**Objetivo:** detectar abuso y regresiones en producción sin exponer datos personales.

### Tareas

- [x] Añadir `request_id`, `session_id` y UID pseudonimizado a logs.
- [x] No registrar tokens, tickets, audio, conversaciones completas ni datos sensibles.
- [x] Medir:

  - Sesiones activas y rechazadas.
  - Latencia y errores por proveedor.
  - Cuotas y rate limits disparados.
  - Tokens/minutos/costo estimado.
  - WebSockets cerrados por código.
  - Fallos de persistencia y análisis.

- [x] Crear alertas operativas configurables para rechazos de auth/cuota, fallos de persistencia, HTTP 5xx y gasto diario estimado.
- [ ] Desplegar primero en staging con proveedores en modo de bajo costo (requiere URL/credenciales del entorno externo).
- [ ] Ejecutar `scripts/verify_staging_isolation.py` y pruebas de abuso con dos cuentas reales (requiere dos ID tokens efímeros).
- [ ] Activar producción de forma gradual y ejecutar el rollback documentado (requiere autorización operativa y acceso al despliegue).

### Criterios de aceptación

- Es posible atribuir consumo a una sesión sin almacenar PII en logs.
- Existen alertas accionables de abuso, costo y fallo de proveedor.
- El rollback no requiere revertir datos ni desactivar autenticación.

## 11. Orden sugerido de entregas

Cada entrega debe ser revisable y desplegable por separado:

1. **PR 1:** contratos, matriz de acceso y pruebas de autorización que inicialmente fallen.
2. **PR 2:** rutas `/me`, ownership en repositorios y migración del frontend.
3. **PR 3:** tickets WebSocket, identidad server-side y eliminación de `user_profile` autoritativo.
4. **PR 4:** autenticación de Simli/avatar/labs, cuotas, rate limits y payload caps.
5. **PR 5:** máquina de estados de auth y corrección de carreras/logout.
6. **PR 6:** ciclo de vida WebSocket y validación tipada del protocolo.
7. **PR 7:** finalizador compartido Groq/Gemini y timestamps UTC.
8. **PR 8:** pipeline común de turnos y separación por proveedores.
9. **PR 9:** cliente HTTP único, lint y pruebas completas del frontend.
10. **PR 10:** CI, métricas, alertas y rollout gradual.

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper clientes existentes al retirar `user_id` | Migración breve con rutas antiguas autenticadas y telemetría de uso |
| El ticket WS expira antes de conectar | TTL corto pero razonable, reintento único y consumo atómico |
| Rate limits bloquean uso legítimo | Configuración por entorno, métricas y límites iniciales conservadores |
| Refactor altera audio/caption | Pruebas de caracterización y conservar la sincronización intencional |
| Tests consumen cuota real | Adaptadores inyectables y proveedores fake en CI |
| Logs filtran conversaciones o tokens | Redacción central y revisión automatizada de campos sensibles |
| Migración deja sesiones antiguas inaccesibles | Consultas por ownership usando el UID histórico ya almacenado |

## 13. Definición global de terminado

El plan se considera completado cuando:

- Todos los criterios de aceptación por fase están automatizados o documentados con evidencia.
- Dos cuentas distintas pasan pruebas negativas de aislamiento de datos.
- Ninguna ruta con costo relevante está disponible de forma anónima en producción.
- No se acepta identidad desde `user_profile`, body, path o query sin contrastarla con Firebase.
- Login/logout no presenta carreras reproducibles.
- Una simulación no puede abrir más de un WebSocket por acción del usuario.
- Groq y Gemini usan finalización compartida y contratos equivalentes.
- Backend y frontend pasan lint, tipos, pruebas y build en CI.
- Las métricas y alertas permiten observar costo, abuso y fallos sin exponer PII.
- Existe procedimiento probado de rollout y rollback.

## 14. Trabajo explícitamente fuera de alcance

- Cambiar los prompts o la calidad conversacional de los avatares.
- Sustituir Firebase, Groq, Gemini, ElevenLabs, Simli o Postgres.
- Rediseñar visualmente las pantallas.
- Normalizar de inmediato todo el JSON histórico de diagnósticos y conversaciones.
- Reescribir el sistema completo antes de cerrar los riesgos críticos.
