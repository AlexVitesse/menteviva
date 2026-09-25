# 2026-09-25 — Túnel: zombi de Cloudflare fuera, ngrok en paralelo

Pedido de Eric: matar el túnel zombi y, como el quick tunnel de Cloudflare "siempre se cae", sustituirlo por ngrok
("tengo mejores resultados; creo que ya está instalado").

## Qué se hizo

| Paso | Detalle |
|---|---|
| Zombi de Cloudflare | `kill 4006219` (cloudflared del 27-ago). Se confirmó antes con `ps -o lstart` que no era el vivo (1187707, del 23-sep). |
| ngrok ya estaba | `space-user2` tiene ngrok por **snap** (`/snap/bin/ngrok`, con authtoken en `~/snap/ngrok/current/.config/ngrok/ngrok.yml`) y dos agentes corriendo de **otros proyectos** (puertos 4000 y 8765: no tocar). También hay un binario suelto `~/ngrok` v3.39.11 **sin** config: no usarlo. Un tercer ngrok (`/var/lib/ngrok`, usuario `condor-…`) es de otro usuario. |
| Túnel nuevo | `nohup /snap/bin/ngrok http 8005 --log=stdout > ~/ngrok-8005-2026-09-25.log 2>&1 &` → **https://ceda-200-13-25-67.ngrok-free.app** (API local en `:4042`). |
| Verificación | Desde el server: `/health` 200, `/` 200 y upgrade de WebSocket `101` en `/api/conversation/…` (igual que localhost y Cloudflare). |
| Cloudflare | **Se dejó corriendo** (pid 1187707) hasta que Eric confirme el cambio; luego `kill 1187707`. |

## Lo que hay que saber de ngrok free

- **La URL también cambia al reiniciar** el agente (es aleatoria). Solución: cada cuenta free trae **un dominio estático gratis**
  (dashboard de ngrok → *Domains*). Con él: `ngrok http --url=<dominio>.ngrok-free.app 8005`, y Firebase se da de alta una sola vez.
- **Página de aviso** ("You are about to visit…") la primera vez que un navegador abre la URL: el usuario pulsa *Visit Site*.
  No afecta las llamadas a la API ni el WebSocket.
- Tampoco lo revive nada si el proceso muere (nohup, sin systemd), pero el agente de ngrok **se reconecta solo** ante cortes de red,
  que es justo lo que mataba al quick tunnel.
- Firebase: agregar `ceda-200-13-25-67.ngrok-free.app` en *Authentication → Settings → Authorized domains*.
