# Dispatcher de TTS: Gemini junto a ElevenLabs (apagado por default)

**Fecha:** 2026-09-22
**Alcance:** `menteviva-backend` (`edge_tts.py`, `config.py`, `conversation_turn.py`,
`conversation_session.py`) + `menteviva-frontend` (propagación del `mime`)
**Sigue a:** [`2026-09-18_decision_tts_gemini_no_openai`](2026-09-18_decision_tts_gemini_no_openai.md)

---

## Qué se implementó

`TTS_PROVIDER=elevenlabs|gemini` en el pipeline clásico. Gemini reusa el pool de
`GEMINI_API_KEY*` que ya rota `gemini_live.py` y las voces prebuilt de
`GEMINI_VOICES` (ya validadas por escucha en el smoke de junio). Sin key nueva,
sin SDK nuevo, sin catálogo de voces duplicado.

**Default sin cambios: `elevenlabs`.** Nada en prod se mueve al desplegar esto.

## El problema real no era el dispatcher, era el contenedor

ElevenLabs devuelve MP3; Gemini devuelve **PCM16 crudo de 24kHz, sin header**.
El front armaba el Blob con `type: "audio/mpeg"` hardcodeado, y Chrome decodifica
según el type del Blob: un WAV etiquetado como MP3 **no suena y no lanza error**.

Por eso el cambio no se queda en el backend:

1. `edge_tts._pcm_to_wav()` envuelve el PCM en WAV (stdlib `wave`, 44 bytes de
   header). El sample rate se **lee del mime de la respuesta**
   (`audio/L16;codec=pcm;rate=24000`) en vez de hardcodearse: si Google cambia el
   default, un rate equivocado se oye acelerado en vez de fallar de forma visible.
2. `edge_tts.output_mime()` expone el contenedor del proveedor activo.
3. El WS lo anuncia en `assistant_audio_start.mime`; `useAudioPlayer` lo guarda en
   `streamMimeRef` y arma el Blob con eso.
4. El saludo cacheado de Sofía **siempre es MP3** (sale de un `.mp3` en disco), así
   que ahí el mime se resuelve antes de anunciar el audio, no por proveedor.

### El fallback también tuvo que cambiar de formato

Cuando Gemini falla se cae a ElevenLabs — pero el cliente **ya recibió
`mime=audio/wav`**, así que devolver MP3 ahí reproduce silencio. El fallback del
path de Gemini pide `output_format="pcm_24000"` a ElevenLabs y lo envuelve en el
mismo WAV. Mismo contenedor, otro proveedor. Está cubierto por test: el caso
"gemini falla → el fallback NO sale en MP3".

## Medición: Gemini no sirve para el path en vivo

`scripts/test_tts.py --live`, misma frase, dos corridas:

| Avatar | ElevenLabs TTFB | Gemini TTFB |
|---|---|---|
| roberto | 2.39s | **17.14s** |
| entrevistador (Sofía) | 1.95s | **33.73s** |

~8.5s de audio generado en 17–34s. No es cold start: la segunda corrida fue peor.

### Por qué tarda: tres causas, no una

Diagnóstico del 2026-09-22 aislando cada hipótesis (misma frase, distinto setup):

| Setup | Resultado |
|---|---|
| Sin `http_options` (como salió la 1ª versión) | 17.1s / 33.7s |
| `attempts=1`, frase larga | 6.06s |
| `attempts=1`, frase larga (otra corrida) | 20.02s → ReadTimeout |
| `attempts=1`, frase media (3.45s de audio) | 17.94s — ratio **5.2×** |
| `attempts=1`, frase corta | 8.86s y **sin contenido** (`finish_reason=OTHER`) |

1. **El modelo no hace streaming incremental.** Genera el clip completo antes de
   responder, así que el TTFB *es* el total. Estructural, no se optimiza.
2. **La latencia base es alta y muy variable:** 6s → 18s → 20s+ para la misma
   clase de request. Es un modelo **preview** en **free tier**: capacidad
   compartida y sin prioridad. Los `ReadTimeout` y el `finish_reason=OTHER` sin
   audio son firma de backend saturado, no de una request mal armada.
3. **La primera versión lo amplificaba.** No le pasé `_GEMINI_HTTP_OPTIONS` al
   cliente, así que el SDK aplicaba su retry con backoff exponencial por dentro
   antes de propagar nada — exactamente el problema que ese objeto existe para
   evitar en `gemini_live.py`. Eso convertía una llamada lenta en 17-34s.

**Corregido en esta versión:** el cliente de TTS ya usa `_GEMINI_HTTP_OPTIONS`
(sin backoff interno, timeout duro) para fallar rápido y caer a ElevenLabs en vez
de tener al usuario esperando media conversación. Aun así, medido después del
arreglo: **23.27s vs 2.03s**. El problema de fondo son las causas 1 y 2.

**Conclusión: el ahorro de costo no es alcanzable con esta latencia en una
conversación en vivo.** 17s de silencio entre turnos rompe el producto más de lo
que la factura de ElevenLabs lo justifica.

Dónde sí sirve tal cual está:
- Pre-generar audio offline (los saludos cacheados de Sofía son exactamente ese caso).
- Cualquier texto que no se escuche en el turno en que se pide.

## Test

`scripts/test_tts.py` — dos capas, siguiendo la convención del repo:

- **Sin API (default, cero cuota):** mime por proveedor, WAV parseable con
  rate/canales/ancho correctos, rate leído del mime, la rama Gemini emite WAV, el
  fallback también, y el caso de respuesta degradada. Verde 13/13.
- **Regresión de `content=None`:** el modelo devuelve candidato sin contenido de
  forma intermitente (`finish_reason=OTHER`). Sin guard eso reventaba con un
  `AttributeError` sobre `None` que no nombra la causa; ahora levanta un
  `RuntimeError` con el `finish_reason` y el fallback entra con log legible.
- **`--live`:** A/B real, mide TTFB/total y deja los audios en `scripts/_out/`
  para escucharlos.

Lo que este test cubre y el oído no: un WAV mal etiquetado suena a silencio sin
error en el backend. Eso se detecta por contenedor, no escuchando.

Regresiones corridas: `npm run build` verde, `vitest` 35/35, `test_prompt_contracts` verde.

## Pendiente / próximo paso

- **Decidir si vale la pena seguir.** Como está, Gemini sólo sirve offline. Si el
  objetivo sigue siendo bajar el costo del turno en vivo, el camino es medir otro
  modelo de TTS, no este.
- **No medido: la cuota.** El free tier de Gemini es por modelo y Live ya lo
  consume. Con 2 requests no se toca el techo; con tráfico real sí.
- Voz propia para Celeste (hoy comparte la de María en ambos proveedores).
