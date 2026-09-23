# 2026-09-23 — Deploy a prod: landing "cerebro como ambiente" (6335ed8)

Pedido de Eric tras aprobar el port en local: "Ponlo en el vps". Prod estaba en `9cac768` (punto de rollback).

## Qué subió

| Qué | Detalle |
|---|---|
| Commit | `6335ed8` — todo el trabajo de landing (planes 20 y 21, copy directo, docs). Un solo commit; incluye lo que llevaba sin commitear desde el 22-sep. |
| Push | `origin/main` estaba en `d2d2efb`: subieron también `77eec65` (dispatcher TTS, default elevenlabs, sin deps nuevas en `pyproject`) y `cb0919c` (docs). |
| Backend | El watcher recargó solo (`edge_tts.py`, `conversation_*.py`, `config.py`); `/health` OK. Sin cambio de `.env`: `TTS_PROVIDER` no está definido y cae al default `elevenlabs`. |
| Frontend | `npm run build` sobre el `node_modules` existente (node 20.20.2 / npm 10.8.2 vía **nvm**, no conda). 4.65 s. `dist/` con el copy nuevo, `models/brain.glb` (0.95 MB) y `landing/brain-poster.webp`. |
| Túnel | Nuevo: **https://adelaide-benchmark-information-calcium.trycloudflare.com** (log en `~/tunnel-2026-09-23.log`). |

## Cómo se llega al server (no estaba documentado)

`ssh -p 2222 space-user2@100.87.103.87` — IP de **Tailscale** (la máquina de Eric está en la misma tailnet).
`node`/`npm` viven en `~/.nvm`: en una sesión no interactiva hay que hacer
`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` antes de `npm run build`. `poetry` está en `~/.local/bin`.

## Túnel: quinto zombi

`~/tunnel.log` terminaba el 27-ago 17:15 con `Unauthorized: Tunnel not found` y el proceso 4006219 seguía vivo;
la URL vieja (`solved-bid-tribunal-sonic`) daba `000`. Se lanzó un cloudflared nuevo (pid 1187707) con **su propio log**
(`~/tunnel-2026-09-23.log`) para no envenenar el diagnóstico.

**Quedó pendiente matar el zombi 4006219**: el asistente no tiene permiso para `kill` en el server. Hacerlo a mano:

```bash
kill 4006219            # solo ese; el 1187707 es el túnel vivo
pgrep -af "cloudflared.*8005"   # debe quedar uno
```

Sigue pendiente lo de siempre: named tunnel + `systemd --user` para que backend y túnel revivan solos.

## Pendiente tras el deploy

- Dar de alta `adelaide-benchmark-information-calcium.trycloudflare.com` en Firebase → Authentication → Authorized domains (sin eso el login falla; la landing pública no lo necesita).
- Ver la landing en un teléfono real (bloom en gama media).
- Copy: revisión de Brandon; respuesta de ejemplo: Sophia.
