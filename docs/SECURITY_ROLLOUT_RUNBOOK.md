# Runbook de rollout y rollback de seguridad

## Preparación de staging

1. Configurar `APP_ENVIRONMENT=staging`, Firebase Admin y Postgres aislado.
2. Configurar `CHATLAB_OPERATOR_UIDS` con los UID del equipo autorizado.
3. Mantener `CHATLAB_TOKEN` solo durante la migración de operadores.
4. Usar cuotas conservadoras y proveedores/cuentas de bajo costo.
5. Ejecutar CI y pruebas con dos cuentas Firebase distintas.
6. Confirmar `WS_TICKET_STORE=auto`, `RESOURCE_LIMIT_STORE=auto` y
   `TELEMETRY_STORE=auto`; en producción los tres resuelven a Postgres.

La prueba reproducible de aislamiento se ejecuta con:

```bash
STAGING_BASE_URL=https://staging.example \
STAGING_TOKEN_A='<id-token-cuenta-a>' \
STAGING_TOKEN_B='<id-token-cuenta-b>' \
poetry run python scripts/verify_staging_isolation.py
```

Ambas cuentas deben tener perfil registrado en staging. El verificador prueba
ownership REST en ambos sentidos, ticket WebSocket de un solo uso, concurrencia
por UID y cierre `1009` antes de proveedor. Los tokens deben ser efímeros y
suministrarse por variables de entorno; nunca se guardan ni se imprimen.

## Pruebas previas

- A no puede consultar perfil, diagnóstico ni sesión de B.
- Un ticket WebSocket usado o expirado se rechaza con `1008`.
- Dos conexiones simultáneas del mismo UID disparan el límite.
- Un payload excesivo se cierra con `1009` antes de invocar proveedores.
- Logout elimina perfil, mensajes, métricas, audio y conexión activa.
- ChatLab y VoiceLab rechazan usuarios fuera de la allowlist.

## Rollout

1. Desplegar backend y verificar `/health`.
2. Desplegar frontend compatible con tickets y rutas `/me`.
3. Observar durante 30 minutos los contadores de sesiones iniciadas,
   terminadas y rechazadas.
4. Aumentar gradualmente el tráfico y mantener disponibles las rutas legacy
   autenticadas durante una ventana corta.
5. Retirar `CHATLAB_TOKEN` cuando todos los operadores usen Firebase.

## Alertas mínimas

- Aumento sostenido de `ws_auth_rejected` o `ws_limit_rejected`.
- Sesiones iniciadas muy superiores a sesiones terminadas.
- Picos de HTTP 401, 429 o 5xx.
- Aumento de gasto/minutos por proveedor fuera del presupuesto diario.
- Fallos de persistencia o análisis superiores al 2 %.

## Rollback

1. Desactivar video con `AVATAR_PROVIDER=none` si el proveedor de avatar falla.
2. Cambiar `REALTIME_PROVIDER` al proveedor estable anterior si falla voz.
3. Revertir frontend y backend como una unidad si el contrato WebSocket cambia.
4. No desactivar autenticación ni ownership como mecanismo de rollback.
5. Conservar datos; las migraciones de este plan son aditivas y no requieren
   borrado o reversión destructiva.

## Escalado horizontal

Tickets, cuotas y contadores agregados usan Postgres atómico en producción.
El contador de concurrencia recupera leases huérfanos después del máximo de
sesión más 60 segundos. Redis sigue siendo una optimización futura si el volumen
de escrituras de telemetría supera la capacidad de Postgres, no un requisito
para habilitar múltiples workers.
