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
