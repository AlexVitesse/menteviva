# Deploy piloto — PASO A PASO (Ubuntu/Debian)

Guía operativa para deployar Mente Viva en el servidor de la empresa.
Sigue las fases EN ORDEN. Las fases 1-5 NO necesitan dominio; la fase 6 (Cloudflare)
se hace al final.

> Referencia técnica completa: `DEPLOY_PILOTO.md`. Este archivo es el runbook corto.

---

## FASE 0 — Antes de empezar: ten esto a la mano

- [ ] Acceso al servidor por VPN + usuario con `sudo`
- [ ] La connection string de Neon (te la dio Claude por chat — la del `-pooler`)
- [ ] El archivo `firebase-admin.json` (credenciales Firebase Admin — está en tu
      máquina local en `menteviva-backend/secrets/firebase-admin.json`)
- [ ] Tu `GROQ_API_KEY` y `ELEVENLABS_API_KEY` (están en tu `.env` local)

Conéctate por VPN y entra al server por SSH:
```bash
ssh tu_usuario@<ip-del-server>
```

---

## FASE 1 — Preparar el servidor (instalar dependencias)

Copia y pega este bloque completo en el server:

```bash
sudo apt update && sudo apt install -y \
  python3 python3-venv python3-pip \
  nodejs npm \
  postgresql-client \
  git curl ca-certificates

# Poetry (gestor de deps de Python)
curl -sSL https://install.python-poetry.org | python3 -
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/bin:$PATH"
```

Verifica versiones (Python ≥ 3.11, Node ≥ 20):
```bash
python3 --version
node --version
poetry --version
```

> Si `node` es menor a 20, instala Node 20:
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
> sudo apt install -y nodejs
> ```

---

## FASE 2 — Traer el código

```bash
sudo mkdir -p /opt/menteviva && sudo chown $USER:$USER /opt/menteviva
cd /opt/menteviva
git clone https://github.com/AlexVitesse/menteviva.git .
git checkout main
```

---

## FASE 3 — Configurar secretos

### 3.1 Backend `.env`

```bash
cd /opt/menteviva/menteviva-backend
cp .env.example .env
nano .env
```

Deja el `.env` así (reemplaza los valores entre `<>`):
```
GROQ_API_KEY=<tu-groq-key>
ELEVENLABS_API_KEY=<tu-elevenlabs-key>
DEBUG=false
FIREBASE_SERVICE_ACCOUNT_PATH=secrets/firebase-admin.json
DATABASE_URL=<connection-string-de-neon-que-te-dio-claude>
```

Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`.

### 3.2 Credenciales de Firebase

El archivo `firebase-admin.json` NO está en el repo (es secreto). Súbelo desde
tu máquina local. **Desde tu PC (no desde el server)**, en otra terminal:

```bash
scp "C:/Users/pcdec/OneDrive/Documentos/Mente Viva/menteviva-backend/secrets/firebase-admin.json" tu_usuario@<ip-server>:/opt/menteviva/menteviva-backend/secrets/
```

> Si la carpeta `secrets/` no existe en el server, créala primero allá:
> `mkdir -p /opt/menteviva/menteviva-backend/secrets`

Asegura permisos (en el server):
```bash
cd /opt/menteviva/menteviva-backend
chmod 600 .env secrets/firebase-admin.json
```

---

## FASE 4 — Instalar y build

### 4.1 Backend
```bash
cd /opt/menteviva/menteviva-backend
poetry install --without dev
```

### 4.2 Migrar la base de datos (Neon)
```bash
poetry run python -m scripts.test_db_migrator
```
Esperado: imprime `v1 applied`, `v2 applied`, lista de columnas, y `OK`.

> El schema YA fue creado en Neon por Claude. Este comando es idempotente: si
> ya está todo, solo confirma "schema al dia".

### 4.3 Frontend (build estático)
```bash
cd /opt/menteviva/menteviva-frontend
npm ci
npm run build
```
Esperado: crea la carpeta `dist/` con `index.html`, `assets/`, `avatars/`, `vad/`.

---

## FASE 5 — Correr como servicio + VERIFICAR EN LOCAL

Aquí confirmas que la app funciona, ANTES de exponerla a internet.

### 5.1 Crear el servicio systemd

```bash
sudo nano /etc/systemd/system/menteviva-backend.service
```

Pega esto (ajusta `User` y la ruta de poetry si tu usuario no es el que clonó):
```ini
[Unit]
Description=Mente Viva backend (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=TU_USUARIO
WorkingDirectory=/opt/menteviva/menteviva-backend
EnvironmentFile=/opt/menteviva/menteviva-backend/.env
ExecStart=/home/TU_USUARIO/.local/bin/poetry run uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> Reemplaza `TU_USUARIO` (3 veces) por tu usuario real del server.
> Verifica la ruta de poetry con: `which poetry`

### 5.2 Arrancar el servicio
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now menteviva-backend
sudo systemctl status menteviva-backend
```
Esperado: `active (running)`.

### 5.3 Smoke EN EL SERVER (sin URL pública todavía)
```bash
curl http://127.0.0.1:8000/health
# Esperado: {"status":"ok"}

curl -I http://127.0.0.1:8000/
# Esperado: HTTP/1.1 200 OK, content-type: text/html

curl http://127.0.0.1:8000/api/avatars
# Esperado: JSON con roberto y maria
```

**Si los 3 comandos responden bien, la app funciona.** Falta solo exponerla.

> Logs si algo falla: `sudo journalctl -u menteviva-backend -n 50 --no-pager`

---

## FASE 6 — Exponer a internet con Cloudflare Quick Tunnel (sin dominio)

Quick tunnel = URL gratis `https://algo.trycloudflare.com`, instantánea, sin
dominio ni cuenta. Sirve para arrancar el piloto.

> ⚠️ La URL CAMBIA cada vez que el tunnel se reinicia. Mientras el proceso
> siga vivo, la URL es estable. Si cambia, hay que re-agregarla en Firebase
> (paso 6.4). Para un piloto largo conviene migrar a dominio propio después.

### 6.1 Instalar cloudflared
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

### 6.2 Tunnel como servicio
```bash
sudo nano /etc/systemd/system/menteviva-tunnel.service
```
Pega:
```ini
[Unit]
Description=Mente Viva Cloudflare Quick Tunnel
After=menteviva-backend.service network-online.target
Wants=menteviva-backend.service network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --url http://127.0.0.1:8000
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 6.3 Arrancar y obtener la URL
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now menteviva-tunnel
sleep 8
sudo journalctl -u menteviva-tunnel --no-pager | grep -i trycloudflare
```
Esperado: una línea con `https://<algo>.trycloudflare.com` — **esa es tu URL pública.**

### 6.4 Autorizar la URL en Firebase
Firebase Console → Authentication → Settings → Authorized domains →
agregar el hostname (solo `<algo>.trycloudflare.com`, sin `https://`).
**Sin esto el login falla.** Si la URL cambia, repetir este paso.

### 6.5 Smoke final
```bash
curl https://<algo>.trycloudflare.com/health     # {"status":"ok"}
```
Abre la URL en el navegador:
- Carga el landing
- Registro → diagnóstico → Sofía habla con audio
- Terminar → reporte

---

## Actualizaciones futuras (cuando haya código nuevo)

```bash
cd /opt/menteviva
./deploy.sh
```
El script hace: `git pull` + `poetry install` + migración + `npm build` +
reinicio del servicio + smoke `/health`.

---

## Si algo falla

| Síntoma | Comando para diagnosticar |
|---|---|
| Backend no arranca | `sudo journalctl -u menteviva-backend -n 80 --no-pager` |
| Tunnel no conecta | `sudo journalctl -u cloudflared -n 50 --no-pager` |
| `/health` no responde | `sudo systemctl status menteviva-backend` |
| Error de DB | Verifica `DATABASE_URL` en `.env` (connection string de Neon completa) |
| Login falla en el navegador | Falta agregar el dominio en Firebase Authorized domains |
