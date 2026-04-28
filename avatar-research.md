# Investigación de avatar — Mente Viva

Fecha: 2026-04-27
Rama de trabajo: `feature/avatar-talkinghead`
Contexto: el avatar actual es un Lottie 2D genérico. Se evalúa cómo subir el realismo / sensación de entrevista real sin sobre-invertir en infra.

---

## 1. Disparador: LivePortrait-Audio

Modelo open-source de KwaiVGI (Kuaishou) que genera video talking-head con lip-sync a partir de:
- 1 imagen de retrato (cara del avatar)
- 1 stream/clip de audio (lo que dice)

Salida: video ~25–30 fps con boca sincronizada y micro-movimientos de cabeza/cejas.
Variante audio-driven del LivePortrait original (que era video-driven).

### Por qué NO ahora

| Dimensión | Hoy (Lottie SVG) | LivePortrait-Audio |
|---|---|---|
| Realismo | Cartoon 2D, loop genérico | Foto-realista, lip-sync real |
| Latencia añadida | 0 ms (loop local) | 500–2000 ms extra por turno |
| Backend | FastAPI sin GPU | Requiere GPU (A10/A100/4090) |
| Costo marginal | ~$0 | $0.5–2/hr GPU dedicada o $/min vía API |
| Ancho de banda móvil | KB (SVG) | 1–3 Mbps por turno (480p video) |
| Complejidad WS | Solo audio blob | Video chunks o URL pre-generada |
| Tiempo a producción | — | 2–4 semanas de integración honesta |

### Riesgos concretos para Mente Viva

1. **Latencia conversacional**: el flow ya tiene STT (Groq ~400 ms) → LLM streaming → TTS. Añadir generación de video por turno empuja "tiempo hasta que Sofia hable" a 3–5 s. Para entrevistas de soft-skills donde el ritmo importa, rompe la naturalidad que estamos peleando con el prompt.
2. **Infra**: hoy todo el backend corre sin GPU (Groq + ElevenLabs son APIs). Meter LivePortrait local implica RunPod/Replicate/fal.ai o servidor propio con GPU. Cold starts de 30–60 s en serverless GPU = killer.
3. **Móvil**: caso de uso real es Chrome Android sobre ngrok. Streaming de 1–3 Mbps de video por respuesta es frágil en redes móviles típicas.
4. **Uncanny valley**: un frame raro o desync de boca destruye más confianza que el SVG cartoon. En entrevistas, donde el usuario juzga si "Sofia entiende", esto es peor que un avatar claramente estilizado.
5. **Licencia**: LivePortrait original es CC-BY-NC (no comercial). Hay que verificar la licencia exacta del fork audio-driven antes de meterlo en producto que cobra B2B.

### Restricción adicional confirmada por el usuario

> "no tengo gpu tendria que usar gpu externa"

Esto descarta self-hosting de LivePortrait-Audio sin antes asumir un costo de infra externa.

---

## 2. Opciones evaluadas (similar fin, sin GPU local)

### A. Avatares 3D con lip-sync en el browser **(elegida)**

#### TalkingHead.js (`met4citizen/talkinghead` en GitHub)
- Librería JS open-source que usa avatares **Ready Player Me** (gratis, generador web)
- Lip-sync 100% client-side: analiza el audio con Web Audio API y mueve visemas (boca + mandíbula + ojos)
- Soporta gestos, micro-expresiones, blinks, head sway
- **El backend no cambia**: sigue mandando el mp3 de ElevenLabs por WebSocket; el frontend reproduce el audio y anima el avatar al mismo tiempo
- Three.js bajo el cocho — ya hay precedentes corriendo en móvil decente
- Costo: $0. Licencia MIT.

#### Ready Player Me + viseme propio
Si TalkingHead.js queda corto, integración manual con Three.js y los blendshapes ARKit que vienen con el avatar RPM. Más trabajo pero control total.

### B. 2D animado con lip-sync (Live2D)

#### Live2D Cubism
- Tecnología detrás de los VTubers (Hololive, etc.)
- Personaje 2D dibujado con "huesos" y mouth shapes
- SDK web oficial, lip-sync por amplitud de audio en browser
- Estilizado pero **muy pulido** y con personalidad
- Free para proyectos chicos; licencia comercial paga si superas umbrales de revenue
- **Costo oculto**: necesitas un artista (o comprar un modelo)

#### Rive + visemas
- Animación 2D vector, similar a Lottie pero con state machines
- Defines 8–10 mouth shapes y switcheas según amplitud/phoneme detectado
- Mucho más expresivo que Lottie sin cambiar stack

### C. APIs cloud "real-time avatar" (alternativas a Azure)

| API | Modelo | Costo aprox | Latencia |
|---|---|---|---|
| **Simli** | Real-time talking head streaming | ~$0.03/min | ~200 ms |
| **HeyGen Streaming Avatar** | Foto-realista | ~$0.10/min | ~500 ms |
| **D-ID Real-time** | Foto-realista | ~$0.05–0.15/min | ~400 ms |
| **Beyond Presence** | Foto-realista, nuevo | ~$0.05/min | ~300 ms |
| **Hedra Character-3** | Estilizado/realista | varía | ~1 s |

Todas exponen WebRTC/WebSocket con video stream listo. No requieren GPU propia. Más caro a largo plazo que self-hosting, pero cero infra.

### D. Otras opciones consideradas y descartadas

- **Wav2Lip**: corre en CPU pero ~1–2 fps. No viable real-time.
- **SadTalker**: requiere GPU realmente.
- **MuseTalk** (Tencent): más rápido que Wav2Lip pero sigue requiriendo GPU.
- **NVIDIA Audio2Face**: requiere GPU NVIDIA con Omniverse.
- **Azure Avatar (Speech Service)**: confirmado por usuario como "última opción".

---

## 3. Decisión inicial: Opción A (browser-side 3D)

Cero costo de infra, backend intacto, salto de calidad real vs Lottie genérico.

### Hallazgo al verificar TalkingHead.js (met4citizen)

Después de revisar la librería real:
- **Requiere timing de fonemas/visemas** (palabra/viseme con timestamps), no funciona solo con amplitud de audio.
- Tiene un add-on `HeadAudio` para análisis amplitud → visemas, pero como módulo separado.
- Pide Three.js 0.180; el proyecto usa 0.166 (drei 9.122 + r3f 8.18). Riesgo de mismatch.
- Es vanilla JS (no React) → necesitaría wrapper con su propio canvas WebGL.
- Licencia MIT.

### Las 3 sub-rutas dentro de Opción A

| Ruta | Cómo | Lip-sync | Costo implementación | Riesgo |
|---|---|---|---|---|
| **A1** TalkingHead.js + ElevenLabs streaming con timestamps | Refactor backend a streaming WS de ElevenLabs y reenviar timestamps al front | Mejor (fonemas reales) | Alto (toca backend, WS protocol, mismatch Three.js) | Compatibilidad + cambio invasivo |
| **A2** TalkingHead.js + add-on HeadAudio (amplitud) | Librería como wrapper con su Three propio | Media (boca abre/cierra por loudness) | Medio | Mismatch versión Three.js, dos canvas WebGL |
| **A3** Componente propio con react-three-fiber + RPM GLB + AnalyserNode | `useGLTF` carga el avatar; `AudioContext.createMediaElementSource` sobre `audioRef` → `AnalyserNode` → modular morphTargets `jawOpen`/`mouthOpen`/`viseme_*` por amplitud | Media (igual que A2) | Bajo (todo en el stack ya instalado) | Mínimo |

### Decisión final: **A3**

Misma calidad visual que A2, sin agregar deps pesadas, sin conflictos de versión, código React idiomático. Si la calidad amplitud-based no convence, A1 (visemas reales con timestamps de ElevenLabs) queda como fase 2.

Plan de fallback si A3 no convence:
- **A1** como upgrade dentro de la misma línea (visemas reales, mismo avatar).
- **Simli o HeyGen Streaming** (cloud, no Azure) como segundo escalón si queremos foto-realismo.
- LivePortrait self-hosted solo como tercer escalón si los costos por minuto de las APIs dejan de servir a escala.

### Paso manual requerido del usuario
1. Generar avatar de Sofia en https://readyplayer.me (login + creator).
2. Exportar GLB (formato por defecto sirve, half-body recomendado).
3. Guardar como `menteviva-frontend/public/avatars/sofia.glb`.
4. Mientras tanto el componente carga ese path por defecto y muestra un placeholder si no existe.

---

## 5. Calibración del lip-sync amplitud-based

### Síntoma observado en la primera prueba
La boca quedaba ligeramente abierta con vibración constante incluso entre sílabas, dando un efecto "raro" / poco natural.

### Diagnóstico

Tres bugs combinándose:

1. **`AnalyserNode.minDecibels` por defecto (-100 dB)**: el ruido de compresión de los MP3 que entrega ElevenLabs entra como amplitud no-cero constante. El gate por código (`if (rawAmp < 0.05) rawAmp = 0`) no era suficiente porque el ruido a veces caía en `0.05–0.10`.
2. **Baseline persistente de `mouthSmile = 0.05`**: ese morph en RPM/Wolf3D parte sutilmente los labios incluso sin amplitud. La intención era que no se viera "enojada", pero efectivamente bloqueaba el cierre completo.
3. **Release lerp lento (0.18)**: combinado con un `rawAmp` que oscilaba sobre 0, la mandíbula no alcanzaba a llegar a 0 antes del siguiente pico → "abierta vibrando".

### Soluciones aplicadas

| Cambio | Por qué funciona |
|---|---|
| `analyser.minDecibels = -55` | Establece un noise gate real al nivel del DSP. Cualquier cosa <-55 dB se mapea a byte 0 → no llega como amplitud al loop. Mata el piso de ruido del MP3. |
| `analyser.maxDecibels = -10` | Mejor rango dinámico para voz típica (que ronda -20 dB peak). |
| `fftSize = 1024` (antes 512) | Más resolución frecuencial → mejor banda 280-3000 Hz. |
| RMS sobre band-pass en vez de media simple | RMS es más estable contra picos espurios. |
| Hysteresis temporal: si amp <0.13 por >100 ms → snap a 0 | Evita reabrir la boca por micro-picos de compresión durante silencios entre sílabas. |
| Power curve `Math.pow(amp, 1.4)` | Comprime amplitudes bajas, amplifica las medias-altas. La voz se siente más expresiva sin amplificar el ruido. |
| Release lerp 0.18 → 0.32 | Boca cierra rápido al silencio. |
| Snap final: si `ampRef < 0.015` → 0 | Garantiza cierre absoluto, cero "tremor residual". |
| Quitar `mouthSmile` baseline; ahora escala con amp | Labios completamente neutros en silencio. |
| Quitar `mouthFunnel` baseline | Mismo motivo: era una capa de ruido visual en silencio. |

### Limitaciones inherentes a la amplitud-only

Aun con todo lo anterior, la lip-sync por amplitud tiene techo:
- **No distingue fonemas**: la boca siempre se abre "vocal abierta" estilo `aa`. La "u" o la "p" se ven igual que la "a".
- **No ajusta por contexto**: una "s" larga abre la mandíbula igual que una vocal.
- **Cualquier audio fuerte abre la boca**: si hubiese música o efectos, la boca se movería con ellos.

Esto es OK para una primera versión que demuestra el formato 3D. Para más realismo el upgrade es lip-sync por fonemas.

### Upgrade path para mejor realismo (no aplicado todavía)

Tres opciones, en orden de costo creciente:

#### a) `wawa-lipsync` — drop-in con detección de visemas en browser
- Lib MIT en GitHub (`wass08/wawa-lipsync`).
- API: `lipsync.connectAudio(audioRef.current); lipsync.processAudio(); lipsync.viseme;` por frame.
- Detecta visemes por features de audio (formantes / energía por banda) sin requerir backend.
- Costo: agregar dep + reemplazar el bloque de cálculo de `amp` por `lipsync.viseme` y mapear el viseme actual al morph correspondiente.

#### b) ElevenLabs `text-to-speech/with-timestamps`
- ElevenLabs ofrece endpoint con timestamps por carácter junto al audio.
- Backend tendría que cambiar de stream-mp3 a stream-mp3+timestamps y reenviarlos al WS frontend.
- Mapear caracteres a fonemas (regla simple para español: vocales = visemas, consonantes según punto de articulación) y modular morphs por timing exacto.
- Costo: cambio invasivo en `services/edge_tts.py` + `routers/conversation.py` + `useWebSocket.ts`.
- Calidad: la mejor posible sin GPU.

#### c) TalkingHead.js `streamStart/streamAudio` API + Audio Worklet
- Reemplazar el componente actual por un wrapper de TalkingHead.js (vanilla JS).
- Costo: integración compleja por mismatch de Three.js (0.166 vs 0.180), dos canvas WebGL, refactor.
- Calidad: similar a (a) pero con más infra.

**Recomendación cuando llegue el momento**: probar (a) primero (1 día de trabajo), saltar a (b) si el realismo importa más que la simplicidad.

---

## 4. Plan de implementación (resumen)

1. Crear avatar de Sofia en readyplayer.me — exportar GLB.
2. Instalar TalkingHead.js (o equivalente) en `menteviva-frontend`.
3. Reemplazar/coexistir con el componente actual `AnimatedAvatar.tsx` detrás de un flag.
4. Conectar el audio de ElevenLabs (`assistant_audio` event en `useWebSocket`) al motor de visemas.
5. Validar en Chrome Android sobre ngrok.
6. Comparar lado a lado con el Lottie actual antes de declarar reemplazo.
