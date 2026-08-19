# Estado de sesión — 2026-08-18

Dos frentes independientes: (1) revisión y test del trabajo pendiente de
`docs/05_plan_correcciones_rendimiento.md` **del repo AvatarAI** (no de este), y
(2) sustitución del cerebro 3D de la landing por un modelo real.

---

## 1. Resumen ejecutivo

| Trabajo | Descripción | Estado |
|---|---|---|
| **Revisión del diff sin commitear de AvatarAI** | 10 archivos: venv del multi-stage, symlink `sd-vae`, `AVATAR_SERVICE_TOKEN`, gating del `/ws/demo`, `MAX_SESSION_SECONDS` en WS, `LIPSYNC_STRIDE` + alineación de `datagen`. | ✅ Revisado, todo correcto |
| **Bloqueador de T8/T9 (deps de la imagen)** | `service/` importa `fastapi`, `aiortc`, `av`, `aiohttp` y ninguna estaba en `requirements-lock.txt` ni en el Dockerfile: la imagen moría en `import fastapi`. Anotado como bug #1 el 2026-08-11, seguía sin corregir. | ✅ Corregido |
| **Bloqueador de T8/T9 (arranque)** | `CMD ["python","-m","service.server"]` no levantaba nada: `server.py` no tiene bloque `__main__`, el contenedor salía con código 0. | ✅ Corregido (uvicorn) |
| **Test estático de dependencias** | `scripts/check_image_deps.py`: falla si `service/` importa algo que la imagen no instala. Sin deps, sin GPU, sin docker. | ✅ Nuevo, probado en ambos sentidos |
| **T8 / T9 (smoke de la imagen en GPU)** | Los dos bloqueadores están fuera, pero el `docker build` + arranque necesita máquina con GPU. | ⏳ Pendiente (no hay `nvidia-smi` local) |
| **Cerebro 3D de la landing** | Procedural (icosfera + simplex noise) → `brain.glb` real de 377k triángulos. | ✅ Completado |

---

## 2. Inventario de archivos

### AvatarAI (`C:\Users\pcdec\OneDrive\Documentos\AvatarAI`)
- `requirements-lock.txt` — sección "Servicio (FastAPI + WebRTC)": `fastapi==0.115.12`,
  `uvicorn==0.34.0`, `aiortc==1.9.0`, `av==12.3.0`, `aiohttp==3.10.11`, `hf_transfer==0.1.8`.
- `Dockerfile` — `CMD` pasa a `sh -c "exec uvicorn service.server:app --host 0.0.0.0 --port ${SERVICE_PORT:-8090}"`.
- `scripts/check_image_deps.py` — **nuevo**, chequeo estático de dependencias de la imagen.
- `docs/sessions/2026-08-18_revision_cambios_y_deps_imagen.md` — **nuevo**, la revisión completa.

### Mente Viva (este repo)
- `menteviva-frontend/public/models/brain.glb` — **nuevo**, 2.5 MB.
- `menteviva-frontend/src/components/landing/brain-scene.tsx` — 277 → 185 líneas.
- `docs/changelog/2026-08-18_landing_cerebro_glb.md` — **nuevo**, el detalle del cambio.

Nada está commiteado en ninguno de los dos repos.

---

## 3. Verificaciones que sí corrieron

| Check | Resultado |
|---|---|
| `py_compile` de los 5 archivos tocados de AvatarAI | OK |
| Resolución de los 6 pines nuevos para cp310/manylinux | OK; aiortc 1.9 exige `av<13` → el par 1.9.0/12.3.0 es consistente |
| `python -m scripts.check_image_deps` | OK con el lock actual; exit 1 al quitar `fastapi` (probado) |
| `npm run build` (tsc + vite) del frontend | OK; el chunk `brain-scene` baja a 2.8 kB |
| Screenshot con Playwright (chromium + swiftshader) contra `vite preview` | El cerebro renderiza en la landing, con pliegues y tronco visibles |
| Peticiones a `/models/brain.glb` | 1 (el `useGLTF.preload` no duplica la descarga) |

No se pudo correr: el smoke de la imagen Docker en GPU (T8/T9) y la medición fina
de desfase A/V — ambos necesitan el pod de RunPod o el VPS Blackwell.

---

## 4. Notas para la próxima sesión

- **AvatarAI**: queda `docker build` + arranque en GPU para cerrar T8/T9, y refrescar
  `README.md` y `docs/03` con los números de `LIPSYNC_STRIDE` (T14).
- **Landing**: el `.glb` viene de `github.com/thebuggeddev/anatomy`, que **no tiene
  LICENSE** (todos los derechos reservados por defecto). Se advirtió y se decidió
  usarlo igual. El mesh está generado con Tripo AI; sustituirlo por uno propio o CC0
  sería cambiar solo el archivo, el código no.
- El modelo trae sus texturas propias (tono rosado-marrón); teñirlo de violeta para
  que case con la paleta es una línea en `Brain()`.
