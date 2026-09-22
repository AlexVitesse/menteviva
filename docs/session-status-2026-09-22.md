# Estado de sesión — 2026-09-18/22

Tres frentes encadenados: (1) **revisión del plan de ejecución**, que resultó
estar desactualizado desde mayo, (2) la **decisión de proveedor** — Gemini y no
OpenAI, (3) la **implementación y medición** del swap de TTS, que terminó
descartando a Gemini para el turno en vivo con datos.

---

## 1. Resumen ejecutivo

| Trabajo | Descripción | Estado |
|---|---|---|
| **Revisión del plan** | `roadmap.md` y `TODO_PILOTO.md` son de abril/mayo y ya no describen el trabajo real. Dos items del plan nunca se hicieron. | ✅ Auditado y anotado |
| **Decisión de proveedor** | No vamos por OpenAI; de momento Gemini. Plan 02 marcado `SUPERSEDED`. | ✅ Documentada |
| **Dispatcher de TTS** | `TTS_PROVIDER=elevenlabs\|gemini`, con WAV y propagación del `mime` al front. | ✅ Implementado y probado |
| **A/B de latencia** | Gemini 17–34s contra 2s de ElevenLabs. | ⛔ Gemini descartado para el vivo |
| **Diagnóstico del porqué** | Tres causas aisladas; dos bugs propios encontrados y corregidos. | ✅ Cerrado |
| **`/code-review`** | Reventó por un conector MCP, no por el código. | ⚠️ Requiere fix de config |
| **Commit** | Nada commiteado todavía: 15 archivos en el working tree. | ⏳ Decisión del usuario |

---

## 2. El plan de ejecución estaba viejo

El plan de record son `docs/roadmap.md` (producto) y `docs/TODO_PILOTO.md`
(operativo, bloques P0→P4). Ambos describen el piloto de la **semana del 28-abr
al 1-may 2026**.

**El P0 se cumplió, pero por otro camino:** Neon en vez de SQLite, Firebase Auth
(que el plan decía explícitamente *no* hacer), `nohup` en Debian sin systemd,
cloudflared quick tunnel efímero en vez del subdominio. Eso vive en las bitácoras,
no en el roadmap.

**Dos items del plan nunca se hicieron** y seguían marcados como pendientes:

| Item | Estado real |
|---|---|
| P1.1 TTS swap (costo ~6× menor) | Cero referencias a `TTS_PROVIDER`. **Atacado en esta sesión.** |
| P2.1 Loop adaptativo | Cero referencias a `mergeAnalysisIntoProfile`. **Sigue abierto.** |

El roadmap llama al loop adaptativo literalmente *"bloqueador del piloto"*: el
perfil queda congelado tras el diagnóstico y las sesiones de práctica no lo
actualizan. La desalineación de catálogos (10 habilidades en diagnóstico vs 5
hardcoded en `SKILLS_BY_SCENARIO`) también sigue viva.

En su lugar entró todo lo de los plans 05→19: labs, Gemini Live, avatar OSS,
Celeste, landing B2B.

---

## 3. Decisión: Gemini, no OpenAI

Detalle: [`changelog/2026-09-18_decision_tts_gemini_no_openai`](changelog/2026-09-18_decision_tts_gemini_no_openai.md).

El pendiente P1.1 proponía OpenAI como TTS, justificado sólo por precio.
**Decisión del usuario: no nos vamos por OpenAI, de momento Gemini.**

Técnicamente se sostiene solo: `google-genai` ya es dependencia y el pool de 4
`GEMINI_API_KEY*` con rotación ya vive en `config.py`. OpenAI habría sumado key,
SDK y un cuarto lugar donde vigilar cuota.

`app/services/openai_llm.py` **se queda**: es proveedor de comparación del
ChatLab, no camino de producción. La decisión no lo toca.

---

## 4. El swap: lo que se implementó

Detalle: [`changelog/2026-09-22_tts_dispatcher_gemini`](changelog/2026-09-22_tts_dispatcher_gemini.md).

`TTS_PROVIDER=elevenlabs|gemini`. Gemini reusa el pool de keys y las voces de
`gemini_live.GEMINI_VOICES` ya validadas por escucha. **Default sin cambios:
`elevenlabs`** — desplegar esto no mueve nada en prod.

### El trabajo real no fue el dispatcher, fue el contenedor

ElevenLabs devuelve MP3; Gemini devuelve **PCM16 crudo sin header**. El front
armaba el Blob con `audio/mpeg` hardcodeado y Chrome decodifica según el type del
Blob: **un WAV mal etiquetado no suena y no lanza error**.

Por eso el cambio cruza los dos repos:

1. `_pcm_to_wav()` envuelve el PCM (stdlib `wave`). El sample rate se **lee del
   mime de la respuesta**, no se hardcodea.
2. `output_mime()` expone el contenedor del proveedor activo.
3. El WS lo manda en `assistant_audio_start.mime` → `useAudioPlayer` arma el Blob
   con eso.
4. El saludo cacheado de Sofía siempre es MP3, así que ahí el mime se resuelve por
   rama, no por proveedor.
5. **El fallback también cambió de formato:** si Gemini falla, el cliente ya
   recibió `mime=audio/wav`, así que devolver MP3 reproduciría silencio. El
   fallback pide `pcm_24000` a ElevenLabs y lo envuelve igual.

---

## 5. La medición mató la idea

`scripts/test_tts.py --live`:

| Avatar | ElevenLabs TTFB | Gemini TTFB |
|---|---|---|
| roberto | 2.39s | **17.14s** |
| entrevistador (Sofía) | 1.95s | **33.73s** |

### Por qué tarda: tres causas

1. **No hay streaming incremental.** ElevenLabs tiene `/stream` y empieza a mandar
   audio mientras genera; Gemini genera el clip completo y luego responde. El
   TTFB *es* el total. Estructural.
2. **La latencia base es alta y variable:** 6s → 18s → 20s+ para la misma clase de
   request. Modelo **preview** en **free tier**: capacidad compartida sin
   prioridad. Los `ReadTimeout` y el `finish_reason=OTHER` sin audio son firma de
   backend saturado.
3. **La primera versión lo amplificaba — bug propio.** No le pasé
   `_GEMINI_HTTP_OPTIONS` al cliente, así que el SDK aplicaba su retry con backoff
   exponencial por dentro. Ese objeto existe en `gemini_live.py:71` justo por eso
   (el comentario documenta un cuelgue de ~46s). Convertía una llamada lenta en
   17-34s.

### Dos bugs propios, encontrados por el diagnóstico

| Bug | Efecto | Arreglo |
|---|---|---|
| Cliente sin `_GEMINI_HTTP_OPTIONS` | Retry interno con backoff: 17-34s en vez de fallar rápido | Se pasa el objeto; falla rápido y cae a ElevenLabs |
| Guard incompleto (`content=None`) | `AttributeError` sobre `None`, error que no nombra la causa | `RuntimeError` con el `finish_reason` + test de regresión |

**Medido después de los arreglos: 23.27s vs 2.03s.** El bug propio explicaba la
diferencia entre "malo" y "peor", no entre "sirve" y "no sirve".

**Conclusión: Gemini queda descartado para el turno en vivo.** El dispatcher queda
listo y probado para uso **offline** — pre-generar audio, que es exactamente el
caso de los saludos cacheados de Sofía.

Si el objetivo sigue siendo bajar el costo del turno en vivo, la palanca es el
**streaming**, no el proveedor: hay que medir un TTS con streaming real y tier
pagado.

---

## 6. Test

`scripts/test_tts.py`, siguiendo la convención del repo (script que ejercita el
service, no clicks en la UI):

- **Sin API (default, cero cuota):** mime por proveedor, WAV parseable con
  rate/canales/ancho correctos, rate leído del mime, la rama Gemini emite WAV, el
  fallback también, y el caso de respuesta degradada. **Verde 13/13.**
- **`--live`:** A/B real, mide TTFB/total y deja los audios en `scripts/_out/`.

Lo que el test cubre y el oído no: un WAV mal etiquetado suena a silencio **sin
error en el backend**. Se detecta por contenedor, no escuchando.

Regresiones: `npm run build` verde, `vitest` 35/35, `test_prompt_contracts` verde.

---

## 7. Archivos tocados (sin commitear)

**Backend**
- `app/config.py` — `tts_provider`, `gemini_model_tts`
- `app/services/edge_tts.py` — dispatcher, WAV, `output_mime()`, fallback en WAV (+166 líneas)
- `app/services/conversation_turn.py` — `mime` en `assistant_audio_start`
- `app/services/conversation_session.py` — mime del saludo resuelto por rama
- `scripts/test_tts.py` — **nuevo**
- `.env.example` — `TTS_PROVIDER` documentado

**Frontend**
- `hooks/useAudioPlayer.ts` — `streamMimeRef`, Blob con el mime anunciado
- `hooks/useWebSocket.ts` — `onAudioStart(mime?)`
- `types/wsProtocol.ts` — `mime` en el evento
- `pages/Simulation.tsx`, `pages/Diagnostico.tsx` — forward del mime

**Docs**
- `changelog/2026-09-18_decision_tts_gemini_no_openai.md` — **nueva**
- `changelog/2026-09-22_tts_dispatcher_gemini.md` — **nueva**
- `TODO_PILOTO.md` — §1.1 reescrito + resultado medido
- `plans/02_tts_swap_openai.md` — banner `SUPERSEDED`

12 modificados + 3 nuevos, 288 inserciones. **Nada commiteado: el working tree
está sucio y `origin/main` está al día con `d2d2efb`.**

---

## 8. Pendientes

| Qué | Quién | Nota |
|---|---|---|
| **Commitear esta sesión** | usuario | 15 archivos en el working tree, todo verde en tests |
| **Escuchar los audios del A/B** | usuario | `menteviva-backend/scripts/_out/` — la calidad de voz no la mide el test |
| **`/code-review` está roto** | usuario | El conector MCP de TheirStack usa un JWT crudo como nombre de servidor, así que sus tools pasan de 128 chars y la API rechaza el request completo (`400 tools.16.custom.name`). Rompe **cualquier** subagente, no sólo el review. Fix: renombrar la key a `theirstack` en `mcpServers` o quitar el conector |
| **Decidir si seguir con TTS barato** | producto | Como está, Gemini sólo sirve offline. La palanca es streaming + tier pagado |
| **Cuota de Gemini sin medir** | pendiente | El free tier es por modelo y Live ya lo consume. ~12 requests en esta sesión, sin tocar el techo; con tráfico real es otra historia |
| **Reescribir roadmap.md** | pendiente | Sigue describiendo el piloto de abril. Lo cumplido no está marcado y el trabajo real (plans 05→19) no aparece |
| **Loop adaptativo (P2.1)** | producto | El propio roadmap lo llama "bloqueador del piloto" y sigue sin empezar |
| **Voz propia para Celeste** | pendiente | Hoy comparte la de María en ambos proveedores |
