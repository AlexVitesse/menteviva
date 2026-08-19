# 2026-08-19 — Restauración del acceso público en prod (tunnel zombie)

## Síntoma

El link del piloto no abría. Reportado como "se volvió a caer el servicio".
Tercera vez (03-jun, 11-ago, hoy).

## Diagnóstico

Backend **sano**, como en agosto:

```
ss -tlnp | grep 8005      -> LISTEN 0.0.0.0:8005 (python pid 189522/189526)
pgrep -af "python -m app" -> 189522 ~/envs/deepseek/bin/python -m app
curl 127.0.0.1:8005/health -> {"status":"ok"}
```

**Diferencia con el 11-ago**: esta vez el `cloudflared` del 8005 **sí existía**
(pid 4182877, con `--url http://localhost:8005`). Estaba zombie: en bucle
infinito de reintentos contra un quick tunnel que Cloudflare ya había
reciclado.

```
ERR Register tunnel error from server side error="Unauthorized: Tunnel not found"
INF Retrying connection in up to 1m4s
ERR Connection terminated error="Unauthorized: Tunnel not found"
```

Ese estado nunca se recupera solo — el hostname efímero ya no existe del lado
de Cloudflare, así que reintentar no sirve. Un `pgrep` "vive el proceso" da
**falso verde**: hay que mirar el log, no la lista de procesos.

Ventana del outage según `backend.log`: último tráfico real **2026-08-14
08:59** (navegación a `/voice-lab` y `/chat-lab`). ~5 días caído.

## Arreglo

Matar solo el del 8005 (el pid 1813281 apunta a `localhost:5001` y es de
**otro proyecto** del server — no tocar) y relanzar:

```bash
kill 4182877
sleep 2; pgrep -af cloudflared
> ~/tunnel.log
nohup ~/cloudflared --no-autoupdate --protocol http2 tunnel --url http://localhost:8005 > ~/tunnel.log 2>&1 &
sleep 12; grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' ~/tunnel.log | head -1
```

URL nueva: **https://planets-finance-hugo-excited.trycloudflare.com**

Agregada en Firebase Console → Authentication → Settings → Authorized domains
(`planets-finance-hugo-excited.trycloudflare.com`, sin `https://`). Sin ese
paso el login falla.

## Verificación

| Chequeo | Resultado |
|---|---|
| `pgrep -af cloudflared` | 2 procesos: el del 5001 (ajeno) y el nuevo del 8005 (1814784) |
| `curl https://planets-…/health` (público) | `{"status":"ok"}` |

Notas de campo:
- `grep` sobre `~/tunnel.log` avisa "coincidencia en fichero binario" — son los
  códigos ANSI de color de cloudflared, no corrupción. Usar `grep -a`.
- El `pgrep` inmediato tras el `kill` todavía lista el pid viejo; cloudflared
  tarda unos segundos en cerrar. Reconfirmar antes de asumir doble proceso.

## Consulta de evidencia: cero pruebas desde el redeploy

Consultado en Neon (`menteviva-piloto`) tras restaurar el acceso.

**El build que corre hoy en prod nunca ha sido probado por un tester.** El
deploy fue el **12-ago 16:05 local** (commit `22eef1d`) y desde entonces no hay
**ni una** fila en `chatlab_conversations` ni en `diagnostics`.

| Corte | Sesiones en labs | Diagnosticos |
|---|---|---|
| Desde el fix del tunnel (11-ago 21:00 UTC) | 5 | 5 (ids 6-10) |
| **Desde el deploy a prod (12-ago 22:05 UTC)** | **0** | **0** |

Las 5 sesiones existentes son todas **anteriores** al deploy:

| Cuando (UTC) | Quien | Lab | Avatar | Duracion |
|---|---|---|---|---|
| 11-ago 21:21 | Sophia | ChatLab "Prueba 1: General" | entrevistador | 1 s (abandonada, `closed=false`) |
| 11-ago 21:45 | Sophia | VoiceLab | roberto | 148 s (1 error) |
| 11-ago 21:55 | Sophia | VoiceLab | roberto | 474 s |
| 12-ago 00:07 | Brandon | ChatLab "Prueba 1: General" | entrevistador | 211 s |
| 12-ago 00:43 | Brandon | VoiceLab | roberto | 292 s |

Agravante: el **13 y 14 de agosto si entro gente** (`GET /`, `/chat-lab`,
`/voice-lab`, `/api/chat/avatars` x2 el 14-ago 08:59) y no quedo ninguna
conversacion. O se asomaron y se fueron, o la sesion reventaba al arrancar y no
dejaba registro. Sin revisar los errores de esos dos dias en `backend.log` no
se puede distinguir.

**Consecuencia:** prod esta sin validar. Hay que pasarle el link nuevo a Sophia
y Brandon y pedir una prueba de humo sobre el build actual (merge de `dev`:
avatar-oss, roberto-sales-cases, login/reset password, CORS y WS).

## Cambios en el repo

- `docs/BATERIA_PRUEBAS.md`: link del piloto
  (`varied-cattle-tables-shelter` → `planets-finance-hugo-excited`).

## Pendiente (tercera vez que se recomienda lo mismo)

`systemd --user` con `Restart=always` + `loginctl enable-linger` (no requiere
sudo). Con el modo zombie de hoy, además, `Restart=always` **por sí solo no
basta**: el proceso no muere, se cuelga. Hace falta un healthcheck externo que
tumbe el tunnel cuando `Tunnel not found` aparezca en el log. La solución de
fondo sigue siendo un **named tunnel** con hostname fijo (elimina el
re-registro en Firebase y pasarle otra dirección a los testers cada vez), pero
requiere cuenta de Cloudflare con dominio — hoy no la hay en ese server.
