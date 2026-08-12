# 2026-08-11 — Restauración del acceso público en prod (tunnel caído)

## Síntoma

El link del piloto (`*.trycloudflare.com`) no abría. Reportado como "se cayó el
servicio".

## Diagnóstico

El backend **nunca murió**. Estado real en el server (`space-user2@condor-ia`):

```
ss -tlnp | grep 8005   -> LISTEN 0.0.0.0:8005  (python pid 2616153/2616158)
pgrep -af "python -m app" -> 2616153 ... /bin/python -m app
curl 127.0.0.1:8005/health -> {"status":"ok"}
```

El único `cloudflared` vivo (pid 2177732) apuntaba a `http://localhost:5001`,
que pertenece a **otro proyecto** del server — no a Mente Viva. O sea: no había
ningún tunnel exponiendo el 8005.

`menteviva-backend/backend.log` confirma la ventana del outage: el último
tráfico real es del **2026-07-30 20:00** (una sesión de VoiceLab + diagnóstico
persistido `id=5`), y después nada hasta los `/health` del diagnóstico de hoy.
El link estuvo muerto ~12 días.

## Causa

Misma clase de falla que el outage del 2026-06-03 (ver
[`prod_deploy_setup`](../../CLAUDE.md) y el changelog del 2026-07-15): el quick
tunnel corre por `nohup`, sin supervisor. Cuando el proceso muere —por
cualquier razón— nada lo revive, el acceso público cae y el backend queda sano
pero inalcanzable. Esta vez el proceso ya no existía (no hubo autoupdate: el
que corría el 5001 sí tenía `--no-autoupdate`).

## Arreglo

Relanzar el quick tunnel apuntando al 8005, sin tocar el del 5001:

```bash
nohup ~/cloudflared --no-autoupdate --protocol http2 tunnel --url http://localhost:8005 > ~/tunnel.log 2>&1 &
sleep 10; grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' ~/tunnel.log | head -1
```

URL nueva: **https://varied-cattle-tables-shelter.trycloudflare.com**

Agregada en Firebase Console → Authentication → Settings → Authorized domains
(`varied-cattle-tables-shelter.trycloudflare.com`, sin `https://`). Sin ese
paso el login falla.

## Verificación (desde fuera del server)

| Ruta | Resultado |
|---|---|
| `/health` | `{"status":"ok"}` |
| `/` | HTML del SPA (`<title>Mente Viva…`), `dist/` servido por StaticFiles |
| `/api/avatars` | JSON con `roberto`, `maria`, … |
| `/chat-lab` | HTML del SPA (navegación directa OK) |
| `/voice-lab` | HTML del SPA (navegación directa OK) |

Nota: `HEAD /` responde `405 Allow: GET` — es el catch-all de StaticFiles, no
un error.

## Cambios en el repo

- `docs/BATERIA_PRUEBAS.md`: actualizado el link del piloto
  (`controversy-essential-dish-tower` → `varied-cattle-tables-shelter`).

## Pendiente (misma recomendación que en junio, sigue sin hacerse)

`systemd --user` con `Restart=always` + `loginctl enable-linger` para backend y
tunnel — no requiere sudo. Mientras siga en `nohup`, cada muerte del proceso
repite este ciclo: link caído, URL nueva, re-autorizar en Firebase, y a los
testers hay que pasarles otra dirección.
