# 15 — Avatar de video open-source self-hosted (reemplazo de Simli)

**Estado:** propuesta / diseño (no implementado)
**Autor del plan:** sesión de arquitectura 2026-07-16
**Objetivo:** reemplazar el avatar fotorrealista de **Simli (SaaS de pago)** por un
**microservicio self-hosted open-source** de lip-sync en tiempo real, orquestado
por el backend que ya corre Gemini Live. El resto del pipeline (voz, LLM,
análisis) NO cambia.

---

## 0. Contexto: qué ya existe (no reinventar)

El patrón "backend orquesta Gemini Live + microservicio de video hace lip-sync con
caras prediseñadas" **ya está montado**, solo que el microservicio hoy es Simli.

Flujo actual:

```
Frontend (React)                         Backend (FastAPI)
   │                                         │
   │  1. POST /api/simli/session-token       │  routers/simli.py → api.simli.ai
   │◄─────────────────────────────────────────┤  (mint token efímero; la API key NUNCA
   │                                         │   viaja al navegador)
   │  2. WS /api/conversation/{avatar}       │  routers/conversation.py → services/gemini_live.py
   │     (audio bidireccional PCM)           │  Gemini Live speech-to-speech (PCM16 24 kHz out)
   │
   │  3. WebRTC directo a Simli ─────────────┼──►  Simli recibe audio PCM 16 kHz
   │                                         │     y devuelve VIDEO+voz lip-synced (cara preset "Tina")
```

**Punto de integración limpio (clave del plan):** el frontend ya abstrae el avatar
detrás de la interfaz `GeminiAudioSink` (ver `src/hooks/useGeminiLive.ts` y
`src/hooks/useSimliAvatar.ts`):

```ts
interface GeminiAudioSink {
  isActive(): boolean;
  sendPcm24k(b64: string): void;   // cada chunk de audio del avatar (Gemini)
  interrupt(): void;               // barge-in: descartar lo encolado
}
```

Simli es **una** implementación de ese contrato. Reemplazarlo = escribir **otra**
implementación del mismo `GeminiAudioSink` contra nuestro servicio. Nada del flujo
de audio/LLM/análisis se toca.

Archivos que hoy materializan a Simli (referencia para el gemelo OSS):
- Backend: `menteviva-backend/app/routers/simli.py`, config en `app/config.py`
  (`simli_api_key`, `simli_max_session_seconds`).
- Frontend: `src/hooks/useSimliAvatar.ts`, `src/components/avatar/SimliAvatar.tsx`,
  `src/utils/simliFlag.ts` (feature-flag), `src/pages/Diagnostico.tsx`.

---

## 1. Motor de lip-sync recomendado: MuseTalk

Requisitos del caso: self-hosted, tiempo real, base = **imagen o video/loop propio**
(los avatares los creamos nosotros), GPU objetivo = **RTX 5070 Ti 16 GB** en el VPS.

| Motor | Tiempo real | VRAM aprox | Base | Veredicto |
|---|---|---|---|---|
| **MuseTalk** ⭐ | Sí (~30 fps) | ~4–6 GB | imagen **o** video/loop | **Elegido.** Diseñado para lip-sync en vivo sobre streaming de audio; encaja con el chunkeo de Gemini. |
| Wav2Lip | Rápido | ~2 GB | video | Fallback simple para el PoC inicial; calidad de boca inferior. |
| SyncTalk / GeneFace++ (NeRF) | Sí | ~8–12 GB | requiere **entrenar por persona** | Fase 2 si se quiere realismo máximo; setup pesado. |
| Hallo / EchoMimic (difusión) | **No** | 12–16+ GB | foto | Descartado: no es real-time y ahoga la VRAM. |

Decisión: **MuseTalk como motor primario**, con Wav2Lip como red de seguridad para
validar el pipeline antes de pelear con la calidad.

---

## 2. Bloqueadores del VPS (resolver ANTES de escribir el servicio)

Hardware del VPS (confirmado 2026-07-16): Ubuntu 24.04.3 LTS, kernel 6.14,
60 GB RAM (~55 libres), **NVIDIA RTX 5070 Ti 16 GB (Blackwell, sm_120)**,
1.3 TB NVMe libre. Ya corriendo: **Ollama (:11434)**, MySQL, varios Node/Python,
**3× VNC (5904–5906)**, cloudflared + ngrok.

### ⚠️ Bloqueador A — driver NVIDIA roto (`nvidia-smi` no funciona)
Síntoma reportado: *"Driver/library version mismatch"*. Causa típica: un
`apt upgrade` actualizó los archivos del driver en disco mientras el **módulo del
kernel viejo sigue cargado en memoria**. Sin `nvidia-smi` OK, ningún contenedor
CUDA arranca. Ver §3 para el fix (con y sin reboot).

### ⚠️ Bloqueador B — Blackwell (sm_120) exige CUDA 12.8+ / PyTorch cu128
La RTX 5070 Ti es arquitectura **Blackwell (compute capability sm_120)**. Requiere
**CUDA 12.8 o superior** y **PyTorch compilado para `cu128`** (torch ≥ 2.7). Casi
todos los repos de lip-sync (MuseTalk, Wav2Lip) fijan `torch`/`cu118`/`cu121`
viejos que **no arrancan** en Blackwell y fallan con
`CUDA error: no kernel image is available for execution on the device`. Hay que
**parchear los `requirements`** para torch ≥ 2.7 + cu128 e imagen base CUDA 12.8.

### ⚠️ Coexistencia de VRAM con Ollama
Ollama y MuseTalk comparten los mismos 16 GB. Si Ollama tiene cargado un modelo
grande, MuseTalk se queda sin memoria (OOM). Presupuestar: o se limita el modelo de
Ollama, o se hace `ollama stop`/descarga del modelo durante las sesiones de video,
o se fija `OLLAMA_KEEP_ALIVE` corto para que libere VRAM al ociar.

---

## 3. Fase 0 — Desbloquear la GPU

> **⚠️ Restricción operativa: no tenemos acceso `sudo` en el VPS.** El fix del
> mismatch (recargar módulos del kernel, `apt reinstall`, reboot) es **root
> obligado** — no hay workaround desde userspace. Por tanto la Fase 0 **la ejecuta
> quien administra el VPS**, no nosotros. Nuestro rol: entregar el diagnóstico y los
> comandos exactos. El diagnóstico (§3.1) es de solo-lectura y NO necesita sudo.
>
> Excepción: si nuestro usuario está en el grupo `docker` (verificar con `groups`),
> el socket de Docker es *de facto* root y un contenedor privilegiado podría
> recargar los módulos — pero el camino limpio es pedírselo al admin.
>
> **Desacople recomendado:** no bloquear la Fase 1 en esto. Validar la calidad de
> MuseTalk en una **GPU rentada** (RunPod / Vast.ai, CUDA 12.8 lista) mientras el
> admin arregla el driver del VPS. Ver §4.

### 3.1 Diagnóstico (solo-lectura, sin sudo)
```bash
nvidia-smi                          # confirmar el "Driver/library version mismatch"
cat /proc/driver/nvidia/version     # versión del MÓDULO cargado en memoria
dpkg -l | grep -i nvidia            # versión de los paquetes en DISCO
dmesg | grep -i nvrm | tail         # errores del kernel module
```
Si la versión del módulo (en memoria) ≠ la de los paquetes (en disco) → es el
mismatch clásico.

### 3.2 Fix SIN reiniciar (preferido, pero condicionado)
Solo funciona si **ningún proceso usa la GPU** (los módulos deben poder
descargarse). En este VPS eso implica parar primero Ollama, los VNC y cualquier
contenedor/proceso CUDA.

```bash
# 1) Ver quién está usando la GPU (si nvidia-smi no lista, usar fuser/lsof)
sudo fuser -v /dev/nvidia*           # PIDs que tienen la GPU abierta

# 2) Parar los consumidores de GPU
sudo systemctl stop ollama          # (o el service que uses para Ollama)
# parar las sesiones VNC / display manager que tengan la GPU:
#   sudo systemctl stop <vnc-service>@:4 ... (ajustar a tus units 5904-5906)
# parar contenedores docker con --gpus:
#   docker ps --filter "label=com.docker.something" ; docker stop <ids>

# 3) Descargar los módulos NVIDIA en orden (los dependientes primero)
sudo rmmod nvidia_uvm
sudo rmmod nvidia_drm
sudo rmmod nvidia_modeset
sudo rmmod nvidia
# Si alguno dice "Module ... is in use" -> todavía hay un proceso con la GPU:
#   repetir `sudo fuser -v /dev/nvidia*` y matar/parar ese proceso.

# 4) Recargar (o dejar que el sistema los cargue solos al llamar nvidia-smi)
sudo modprobe nvidia
sudo modprobe nvidia_uvm
nvidia-smi                           # debe listar la 5070 Ti ya sin mismatch
```

> Realidad de este VPS: con 3× VNC + Ollama encima de la GPU, liberar todos los
> `rmmod` suele ser difícil (un display manager que auto-reinicia vuelve a tomar la
> GPU). Si `rmmod nvidia` insiste en "in use", el reboot es el camino confiable.

### 3.3 Fix CON reinicio (confiable)
```bash
# Asegurar que los paquetes del driver estén consistentes ANTES de reiniciar:
sudo apt-get update && sudo apt-get install --reinstall nvidia-driver-<versión>
# (o instalar un driver que soporte Blackwell/CUDA 12.8, p.ej. serie 570+)
sudo reboot
# tras el reboot:
nvidia-smi
```

### 3.4 Validar el runtime de contenedores GPU (CUDA 12.8)
```bash
# nvidia-container-toolkit debe estar instalado y docker configurado con él.
docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
```
**Criterio de salida de Fase 0:** `nvidia-smi` lista la 5070 Ti Y el contenedor
CUDA 12.8 ve la GPU.

### 3.5 Diagnóstico real del VPS (2026-07-16)

Salida obtenida (solo-lectura, sin sudo):
```
Módulo del kernel EN MEMORIA:  580.126.09   (cargado hace 136 días — uptime)
Librería/userspace EN DISCO:   580.159.03   (subida por un apt upgrade posterior)
```
- **Es el mismatch clásico por falta de reboot:** el driver en disco se actualizó a
  580.159.03 pero sigue corriendo el módulo viejo 580.126.09 (136 días de uptime).
- **En disco ya está todo consistente en 580.159.03** (`nvidia-dkms-580-open`,
  `nvidia-utils-580`, `libnvidia-*-580`). **No hay que instalar ni reparar nada**,
  solo cargar el módulo nuevo.
- **Driver 580 soporta Blackwell (RTX 5070 Ti) y CUDA 12.8** → sirve para torch
  `cu128`. El `nvidia-cuda-toolkit 12.0` viejo del sistema es irrelevante (los wheels
  cu128 traen su propio runtime; solo dependen del driver).
- **`groups` = `space-user2 users`** → NO estamos en el grupo `docker` ni hay sudo.
  El fix lo ejecuta el admin obligatoriamente.

### 3.6 Impacto de reiniciar vs recargar el módulo

| | Opción A: `reboot` | Opción B: recargar módulo |
|---|---|---|
| Qué para | **TODO el servidor** | Solo los que usan la GPU (Ollama + los 3 VNC) |
| Servicios NO-GPU (MySQL, backend :8005, túneles, SSH) | se caen y deben re-autostart | **siguen corriendo intactos** |
| Riesgo | procesos arrancados **a mano** (no systemd / sin `restart:` en docker) **no vuelven solos** | menor; solo interrumpe Ollama + VNC |
| Cuándo elegirla | si todos los servicios tienen autostart verificado | si el uptime es crítico o hay procesos manuales importantes |

> **Advertencia clave:** un `reboot` reinicia el servidor entero. Solo vuelven solos
> los servicios con autostart (systemd `enable`, o contenedores Docker con
> `restart: unless-stopped`/`always`). Lo que alguien haya lanzado a mano en una
> terminal/VNC/tmux (p.ej. un `python app.py` suelto, un `ngrok` manual) **NO
> vuelve**. Antes de reiniciar, el admin debería confirmar el autostart de cada
> servicio, o usar la Opción B para no tocar los servicios que no dependen de la GPU.

### 3.7 Mensaje listo para el admin

> Hola, la GPU (RTX 5070 Ti) tiene `nvidia-smi` roto por "Driver/library version
> mismatch". Causa: el driver en disco se actualizó a **580.159.03** pero el módulo
> del kernel cargado sigue siendo el viejo **580.126.09** (el server lleva 136 días
> sin reiniciar). En disco ya está todo consistente (dkms 580-open = 580.159.03),
> así que **no hay que instalar nada**.
>
> **Opción A (más limpia, pero reinicia TODO el server):**
> ```bash
> sudo reboot
> ```
> Antes de usarla, confirma que todos los servicios tienen autostart (systemd
> enable / docker restart:), porque lo arrancado a mano no vuelve solo.
>
> **Opción B (sin reiniciar; solo interrumpe la GPU — Ollama + VNC):** recargar el
> módulo. Requiere parar antes TODO lo que use la GPU, si no `rmmod` falla con
> "in use":
> ```bash
> sudo systemctl stop ollama
> # parar los VNC / X que tengan la GPU tomada (units 5904-5906)
> sudo fuser -k /dev/nvidia*
> sudo rmmod nvidia_uvm nvidia_drm nvidia_modeset nvidia
> sudo modprobe nvidia && sudo modprobe nvidia_uvm
> nvidia-smi        # debe listar la 5070 Ti sin error
> ```
> Después, confirmar el runtime de contenedores GPU:
> ```bash
> docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
> ```
> Y si se puede, agregar a `space-user2` al grupo `docker` para no depender de sudo:
> ```bash
> sudo usermod -aG docker space-user2
> ```

---

## 4. Fase 1 — MuseTalk offline (validar calidad y fps)

Objetivo: correr MuseTalk y generar **un clip** con nuestra imagen + un WAV de
prueba. Aún NO se integra nada. Es el gate de calidad.

> **Dónde correrlo, dado que el VPS está bloqueado (sin sudo, driver roto):** usar
> una **GPU rentada por horas** (RunPod / Vast.ai / Lambda, ~US$0.30–0.60/h con
> CUDA 12.8 preinstalada). Esto desacopla el gate de calidad del arreglo del driver
> del VPS y permite avanzar en paralelo. El entorno `conda`/`venv` + `pip` no
> requiere sudo, así que se puede dejar preparado en userspace en cualquier lado.
> Cuando el admin arregle el VPS, se replica el mismo entorno ahí.

Pasos:
1. Clonar MuseTalk y descargar sus pesos.
2. **Parchear dependencias a Blackwell:** instalar `torch`/`torchvision`/`torchaudio`
   desde el índice `cu128` (torch ≥ 2.7) en vez de las versiones fijadas por el repo.
   Verificar en Python: `torch.cuda.get_device_capability()` → `(12, 0)` y
   `torch.cuda.is_available()` → `True`.
3. Preparar una imagen (o loop de video corto) del avatar de prueba.
4. Generar un clip con un WAV de ejemplo.
5. **Medir:** fps de generación, latencia por chunk, VRAM ocupada (con y sin Ollama
   cargado), y calidad subjetiva de la boca.

**Criterio de salida:** clip generado, ≥ ~25–30 fps sostenidos, VRAM dentro de
presupuesto compartido con Ollama, calidad aprobada por producto.

> Si MuseTalk no coopera con cu128/Blackwell tras un esfuerzo razonable → caer a
> Wav2Lip para validar el pipeline y reconsiderar el motor.

---

## 5. Fase 2 — Microservicio `avatar-service` (streaming simple)

Nuevo componente (Docker con GPU). Decisión pendiente: ¿dentro de `Mente Viva/`
como `avatar-service/` o repo aparte? (recomendación: carpeta hermana en el mismo
repo para versionar junto al backend).

Estructura propuesta:
```
avatar-service/
├── Dockerfile            # base nvidia/cuda:12.8.*-runtime-ubuntu24.04 + torch cu128
├── app/
│   ├── main.py           # FastAPI: /session (mint), /health
│   ├── musetalk_engine.py# carga de pesos, warmup, inferencia por chunk
│   └── faces/            # caras prediseñadas: roberto.png, maria.png, sofia.png
└── requirements.txt      # torch cu128 pinneado a Blackwell
```

En esta fase, transporte **simple** para validar end-to-end antes de invertir en
WebRTC: audio de entrada por WebSocket, salida de frames (JPEG/MSE) por WebSocket.
Medir latencia real del lazo Gemini→servicio→navegador.

---

## 6. Fase 3 — WebRTC (aiortc) + sink en el frontend

Para igualar la sensación de videollamada y baja latencia de Simli.

**Backend (`avatar-service`):** `aiortc` expone un `VideoStreamTrack` alimentado por
los frames de MuseTalk y un `AudioStreamTrack` con la voz de Gemini; negocia SDP
con el navegador. Recibe los chunks de audio y produce video sincronizado.

**Backend (`menteviva-backend`):** nuevo router `avatar_provider.py` que sustituye a
`simli.py`. Mismo patrón (mint de sesión efímera contra `avatar-service`), pero con
una pequeña abstracción `AvatarProvider` seleccionable por `.env`:
```
AVATAR_PROVIDER=oss   # oss | simli
```
Así se puede volver a Simli si el self-hosted falla, sin reescribir nada.

**Frontend:** nuevo hook `useOssAvatar.ts`, **gemelo** de `useSimliAvatar.ts`, que
implementa el MISMO `GeminiAudioSink` pero contra `avatar-service` vía WebRTC y
renderiza al mismo `<video>`. `simliFlag.ts` ya da el patrón de feature-flag para
elegir motor en runtime.

**Criterio de salida:** videollamada fluida con lip-sync self-hosted, barge-in
funcional (`interrupt()` descarta lo encolado), latencia comparable a Simli.

---

## 7. Fase 4 — Producción

- Caras por avatar (roberto/maria/sofia + entrevistador), análogo a
  `AVATAR_FACES` de `simli.py`.
- Presupuesto de VRAM vs Ollama (política de descarga durante sesiones de video).
- Límites de sesión (equivalente a `simli_max_session_seconds`).
- Sesión efímera / auth del `avatar-service` (no exponerlo abierto en el VPS).
- Fallback automático a Simli o al avatar 2D si el servicio OSS cae (el frontend ya
  cae al player local + avatar animado cuando el sink está inactivo).
- Observabilidad: fps, latencia, OOM, reconexiones.

---

## 8. Decisiones pendientes

1. ¿`avatar-service` dentro de `Mente Viva/` o repo aparte?
2. Transporte final: WebRTC (recomendado) vs WS+MSE si la latencia de WS resulta
   aceptable.
3. Base del avatar: imagen fija vs loop de video corto (afecta realismo/VRAM).
4. Política de coexistencia con Ollama en la GPU.

---

## 9. Orden de ejecución recomendado

Dado que **no tenemos sudo** y el driver del VPS está roto, las dos pistas corren
en paralelo:

- **Pista A (bloqueada en el admin):** entregar el diagnóstico de §3.1 + los
  comandos de §3.2/§3.3 a quien tenga root para desbloquear la GPU del VPS.
- **Pista B (podemos avanzar ya):** validar la Fase 1 (gate de calidad de MuseTalk)
  en una **GPU rentada**, sin depender del VPS.

No escribir el `avatar-service` (Fase 2+) hasta pasar el gate de calidad de la
Fase 1. Cuando el VPS quede desbloqueado, se replica ahí el entorno validado.
