"""
Router para conversacion en tiempo real via WebSocket.

Flujo basico (avatares de practica: Roberto, Maria, Carlos):
1. Cliente opcionalmente envia {"type": "init", "user_profile": {...}}
   para que el avatar tenga contexto del usuario (brechas a estresar).
2. Cliente envia audio (base64) o texto.
3. Server transcribe con Whisper si es audio.
4. Server genera respuesta con LLM (streaming).
5. Server genera audio con TTS.
6. Server envia texto + audio al cliente.
7. Al end_session: analyze_conversation() -> score por habilidades.

Flujo diagnostico (avatar "entrevistador"):
- Igual que arriba, pero el mensaje init es REQUERIDO (para tener el registro).
- Al end_session: generate_user_profile() -> bloque "diagnostico" del UserProfile.
"""

import asyncio
import json
import base64
import logging
import time
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.config import settings
from app.models import UserProfile
from app.models.user_profile import Registro
from app.services.groq_whisper import transcribe_audio
from app.services.groq_llm import chat_stream
from app.services.edge_tts import text_to_speech, text_to_speech_stream
from app.services.gemini_live import open_session as open_gemini_session
from app.services.analysis import analyze_conversation, generate_user_profile
from app.services.user_repo import save_diagnostic, upsert_user
from app.services.session_repo import save_practice_session
from app.prompts.scenarios import get_avatar, get_system_prompt
from app.prompts.entrevistador import pick_greeting, build_gemini_entrevistador_prompt

GREETINGS_DIR = Path(__file__).parent.parent / "static" / "greetings"

# Marca que el LLM (Sofia) emite al final de su mensaje cuando considera
# terminada la entrevista. La plataforma la detecta, la strip-ea del texto
# y audio, y dispara una cuenta regresiva de cierre en el frontend.
CLOSING_MARKER = "[CIERRE]"


def _detect_closing(text: str) -> tuple[str, bool]:
    """Devuelve (texto sin marca, should_close)."""
    if CLOSING_MARKER in text:
        return text.replace(CLOSING_MARKER, "").strip(), True
    return text, False

logger = logging.getLogger("menteviva")
router = APIRouter()


async def _send_sofia_greeting(
    websocket: WebSocket,
    user_profile: UserProfile | None,
) -> str:
    """
    Sofia inicia la conversacion con uno de 3 saludos pre-grabados.
    Devuelve el texto del saludo elegido para que el caller lo agregue
    al conversation_history.

    Streamea desde el MP3 cacheado en disk (cero costo de ElevenLabs por
    sesion). Si por alguna razon el archivo no existe (ej. nuevo deploy
    sin generar greetings), cae a generar live con el TTS normal.
    """
    seed = user_profile.user_id if user_profile else None
    idx, text = pick_greeting(seed)
    cached = GREETINGS_DIR / f"sofia_greet_{idx}.mp3"

    await websocket.send_json({"type": "assistant_audio_start", "content": text})

    if cached.exists():
        logger.info(f"[Greeting] Sirviendo cacheado: {cached.name}")
        with open(cached, "rb") as f:
            chunks = 0
            total = 0
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                chunks += 1
                total += len(chunk)
                await websocket.send_json({
                    "type": "assistant_audio_chunk",
                    "audio": base64.b64encode(chunk).decode(),
                })
        logger.info(f"[Greeting] Stream cacheado enviado: {chunks} chunks, {total} bytes")
    else:
        logger.warning(f"[Greeting] No existe {cached.name}, generando live")
        try:
            async for chunk in text_to_speech_stream(text, "entrevistador"):
                await websocket.send_json({
                    "type": "assistant_audio_chunk",
                    "audio": base64.b64encode(chunk).decode(),
                })
        except Exception as e:
            logger.error(f"[Greeting] Error en TTS live: {e}", exc_info=True)

    await websocket.send_json({"type": "assistant_audio_end"})
    return text


async def _stream_tts_over_ws(
    websocket: WebSocket,
    text: str,
    avatar_id: str,
) -> None:
    """
    Streamea audio TTS al cliente con el protocolo assistant_audio_*.

    Protocolo:
    - assistant_audio_start: content = texto completo (caption puede mostrarse ya)
    - assistant_audio_chunk: audio = base64 de un chunk MP3
    - assistant_audio_end: fin del stream, cliente finaliza playback

    Si ocurre un error a medio streaming, loggeamos y siempre enviamos
    assistant_audio_end para que el cliente no quede colgado.
    """
    await websocket.send_json({"type": "assistant_audio_start", "content": text})
    total_bytes = 0
    chunk_count = 0
    try:
        async for chunk in text_to_speech_stream(text, avatar_id):
            total_bytes += len(chunk)
            chunk_count += 1
            await websocket.send_json({
                "type": "assistant_audio_chunk",
                "audio": base64.b64encode(chunk).decode(),
            })
    except Exception as e:
        logger.error(f"[TTS-Stream] Error a medio streaming: {e}", exc_info=True)
    finally:
        await websocket.send_json({"type": "assistant_audio_end"})
    logger.info(f"[TTS] Stream enviado: {chunk_count} chunks, {total_bytes} bytes")


# ============================================================
# Rama Gemini Live (realtime_provider == "gemini")
# ============================================================
# Proxy bidireccional: el cliente streamea audio (PCM16 16k) o texto; Gemini
# responde con audio nativo (PCM24) + transcripts. Reconstruimos el
# conversation_history desde los transcripts para que el analisis de Groq al
# final NO cambie. Ver docs/plans/05_gemini_live_voice.md (Fase 2).


async def _finalize_and_analyze(
    websocket: WebSocket,
    avatar: dict,
    avatar_id: str,
    conversation_history: list,
    session_start_time: float,
    user_profile: UserProfile | None,
    session_vars: dict | None,
    level: str | None,
) -> None:
    """Cierre de sesion + analisis. Compartido por la rama Gemini.

    Misma logica que el bloque end_session de la rama Groq (analisis en Groq,
    persistencia best-effort), extraida para no duplicar. La rama Groq sigue
    con su bloque inline intacto para no arriesgar el rollback.
    """
    duration_seconds = int(time.time() - session_start_time)
    total_exchanges = len(conversation_history) // 2
    logger.info(f"[WS-Gemini] Sesion finalizada - Intercambios: {total_exchanges}, Duracion: {duration_seconds}s")

    await websocket.send_json({"type": "status", "status": "analyzing"})

    base_metrics = {
        "total_exchanges": total_exchanges,
        "duration_seconds": duration_seconds,
        "conversation": conversation_history,
    }

    if avatar.get("kind") == "diagnostico":
        registro_for_analysis = user_profile.registro if user_profile and user_profile.registro else None
        used_placeholder = False
        if registro_for_analysis is None:
            logger.warning("[WS-Gemini] Diagnostico sin registro valido — usando placeholder")
            registro_for_analysis = Registro(
                nombre="Candidato",
                rol_objetivo="Profesional",
                industria="General",
                experience_level="mid",
            )
            used_placeholder = True

        diagnostico = await generate_user_profile(
            conversation=conversation_history,
            registro=registro_for_analysis,
            session_vars=session_vars,
        )
        if used_placeholder:
            diagnostico["is_demo"] = True
        if user_profile and user_profile.user_id:
            try:
                await save_diagnostic(
                    user_id=user_profile.user_id,
                    diagnostico=diagnostico,
                    conversation=conversation_history,
                )
            except Exception as e:
                logger.error(f"[WS-Gemini] save_diagnostic fallo: {e}")
        await websocket.send_json({
            "type": "session_end",
            "metrics": {**base_metrics, "user_profile_update": diagnostico},
        })
    else:
        analysis = await analyze_conversation(
            avatar_id=avatar_id,
            conversation=conversation_history,
            duration_seconds=duration_seconds,
        )
        logger.info(f"[WS-Gemini] Analisis completado - Score: {analysis.get('overall_score', 'N/A')}")
        session_id = None
        if user_profile and user_profile.user_id:
            try:
                session_id = await save_practice_session(
                    user_id=user_profile.user_id,
                    avatar_id=avatar_id,
                    level=level,
                    started_at=datetime.fromtimestamp(session_start_time).isoformat(),
                    ended_at=datetime.utcnow().isoformat(),
                    duration_seconds=duration_seconds,
                    total_exchanges=total_exchanges,
                    analysis=analysis,
                    conversation=conversation_history,
                )
            except Exception as e:
                logger.error(f"[WS-Gemini] save_practice_session fallo: {e}")
        metrics_payload = {**base_metrics, "analysis": analysis}
        if session_id:
            metrics_payload["session_id"] = session_id
        await websocket.send_json({"type": "session_end", "metrics": metrics_payload})


async def _gemini_handle_upstream_msg(data: dict, websocket, state: dict, history: list) -> str | None:
    """Procesa UN mensaje del cliente hacia Gemini. Devuelve 'end' en end_session.

    Forwardea a state["live"] (la sesion Gemini ACTUAL), que cambia en cada
    reconexion. Durante el breve hueco de reconexion state["live"] es None y el
    audio se descarta (sub-segundo, inaudible).
    """
    t = data.get("type")
    live = state.get("live")
    if t == "audio_chunk":
        pcm = base64.b64decode(data.get("pcm", "") or "")
        if pcm and live:
            await live.send_audio_chunk(pcm)
    elif t == "text":
        # Modo texto (pruebas / fallback sin mic). El turno de usuario por texto
        # NO genera input_transcription, asi que lo agregamos al historial aqui.
        text = (data.get("text") or "").strip()
        if text and live:
            history.append({"role": "user", "content": text})
            await websocket.send_json({"type": "user_message", "content": text})
            await live.send_text(text)
    elif t == "end_session":
        return "end"
    # tipos desconocidos se ignoran (init ya se proceso antes de abrir la sesion)
    return None


async def _gemini_upstream(websocket, state: dict, history: list, initial: dict | None) -> str:
    """Lee mensajes del cliente y los reenvia a la sesion Gemini actual.

    PERSISTE a traves de reconexiones (no se reinicia cuando se reabre la sesion
    Gemini); devuelve 'end' en end_session.
    """
    if initial is not None:
        if await _gemini_handle_upstream_msg(initial, websocket, state, history) == "end":
            return "end"
    while True:
        data = await websocket.receive_json()
        if await _gemini_handle_upstream_msg(data, websocket, state, history) == "end":
            return "end"


def _flush_partial_transcripts(state: dict, history: list) -> None:
    """Vuelca al historial los transcripts PARCIALES que quedaron en el state.

    Sin esto, si el usuario habla y presiona Terminar (o se cae el WS) antes de
    que Sofia responda, su ultimo turno vive solo en los buffers del downstream
    y se pierde del analisis. Se llama antes de finalizar la sesion; en las
    reconexiones por go_away no hace falta (los buffers persisten en state y el
    siguiente downstream continua acumulando sobre ellos).
    """
    user_text = "".join(state.get("cur_user") or []).strip()
    if user_text:
        history.append({"role": "user", "content": user_text})
        state["cur_user"].clear()
    asst_text = "".join(state.get("cur_asst") or []).strip()
    if asst_text:
        history.append({"role": "assistant", "content": asst_text})
        state["cur_asst"].clear()


async def _gemini_downstream(websocket, live, state: dict, history: list) -> str:
    """Reenvia los eventos de Gemini al cliente y reconstruye el historial.

    Los buffers de transcript viven en `state` (no en locales) para que
    sobrevivan reconexiones y se puedan volcar al historial en el cierre
    (_flush_partial_transcripts) — sin eso el ultimo turno del usuario se
    perdia si terminaba la sesion antes de la respuesta de Sofia.

    Devuelve el motivo por el que termino la sesion Gemini:
      - "go_away": el servidor avisa corte (limite de sesion) -> reconectar.
      - "closed":  la sesion se cerro (events() se agoto).
    """
    cur_user: list[str] = state.setdefault("cur_user", [])
    cur_asst: list[str] = state.setdefault("cur_asst", [])
    audio_started = False
    turn_interrupted = False

    async def _flush_user() -> None:
        # Materializa el turno del usuario apenas el modelo empieza a responder
        # (= fin real de su habla), en vez de esperar al turn_complete de Sofia.
        # Asi el mensaje aparece en el chat ANTES de la respuesta, no despues.
        # user_text solo llega por audio (input_transcription); el modo texto
        # ya lo agrego en upstream, asi que aqui no se duplica.
        user_text = "".join(cur_user).strip()
        cur_user.clear()
        if user_text:
            history.append({"role": "user", "content": user_text})
            await websocket.send_json({"type": "user_message", "content": user_text})

    async for ev in live.events():
        et = ev["type"]
        if et == "audio":
            if not audio_started:
                await _flush_user()
                await websocket.send_json({"type": "assistant_audio_start"})
                audio_started = True
            await websocket.send_json({
                "type": "assistant_audio_chunk",
                "audio": base64.b64encode(ev["data"]).decode(),
            })
        elif et == "input_text":
            cur_user.append(ev["text"])
        elif et == "output_text":
            if not audio_started and not cur_asst:
                await _flush_user()  # por si el texto llega antes que el audio
            cur_asst.append(ev["text"])
            await websocket.send_json({"type": "output_transcript", "content": ev["text"]})
        elif et == "interrupted":
            # Barge-in: el cliente debe vaciar su cola de audio y parar el playback.
            await websocket.send_json({"type": "interrupted"})
            audio_started = False
            turn_interrupted = True
        elif et == "turn_complete":
            await _flush_user()  # restos tardios de input_transcription (raro)
            asst_text = "".join(cur_asst).strip()
            cur_asst.clear()
            if asst_text:
                # Turno cortado por barge-in: el transcript incluye texto que el
                # usuario NO escucho (el cliente vacio su cola de audio). Lo
                # marcamos para que el analisis no asuma que Sofia dijo todo eso.
                if turn_interrupted:
                    asst_text += " [...el usuario interrumpio y no escucho el final]"
                history.append({"role": "assistant", "content": asst_text})
            if audio_started:
                await websocket.send_json({"type": "assistant_audio_end"})
            await websocket.send_json({"type": "turn_complete"})
            audio_started = False
            turn_interrupted = False
        elif et == "tool_call":
            # Cierre del diagnostico: Sofia llamo finalizar_entrevista. Avisamos al
            # cliente (dispara su countdown de cierre) y respondemos el tool-call
            # para que el modelo pueda rematar su despedida.
            if ev.get("name") == "finalizar_entrevista":
                logger.info("[WS-Gemini] tool finalizar_entrevista -> closing_intent")
                await websocket.send_json({"type": "closing_intent"})
            try:
                await live.send_tool_response(ev["call"])
            except Exception as e:
                logger.warning(f"[WS-Gemini] send_tool_response fallo: {e}")
        elif et == "go_away":
            logger.info("[WS-Gemini] go_away (limite de sesion) -> reconectar")
            return "go_away"

    return "closed"


async def _run_gemini_conversation(websocket: WebSocket, avatar: dict, avatar_id: str) -> None:
    """Orquesta una conversacion completa via Gemini Live (rama del proxy)."""
    user_profile: UserProfile | None = None
    session_vars: dict | None = None
    level: str | None = None
    system_prompt = get_system_prompt(avatar_id)
    history: list = []
    session_start_time = time.time()

    # El system_instruction se fija al abrir la sesion, asi que necesitamos el
    # primer mensaje (init) ANTES del connect. Si el primero no es init, lo
    # procesamos como primer turno una vez abierta la sesion.
    first = await websocket.receive_json()
    initial: dict | None = None
    if first.get("type") == "init":
        raw_profile = first.get("user_profile")
        session_vars = first.get("session_vars")
        level = first.get("level")
        if raw_profile:
            try:
                user_profile = UserProfile(**raw_profile)
                try:
                    await upsert_user(user_profile)
                except Exception as e:
                    logger.error(f"[WS-Gemini] upsert_user fallo: {e}")
            except Exception as e:
                logger.warning(f"[WS-Gemini] user_profile invalido en init: {e}")
                user_profile = None
        system_prompt = get_system_prompt(
            avatar_id, user_profile=user_profile, session_vars=session_vars, level=level,
        )
    else:
        initial = first

    # Diagnostico (Sofia) en voz: usar el prompt CONCISO de Gemini en vez del
    # maestro de 26k chars (que con native-audio produce eco — repetir lo que
    # dice el usuario — y habla acartonada). Ver entrevistador.py.
    if avatar.get("kind") == "diagnostico":
        system_prompt = build_gemini_entrevistador_prompt(user_profile, session_vars)

    enable_closing = avatar.get("kind") == "diagnostico"
    logger.info(
        f"[WS-Gemini] Abriendo sesion Live - avatar={avatar_id}, "
        f"prompt={len(system_prompt)} chars, closing_tool={enable_closing}"
    )

    # Holder mutable de la sesion Gemini ACTUAL. El upstream (reader del cliente)
    # forwardea a state["live"] y persiste a traves de reconexiones; la sesion
    # Gemini se re-crea en el bucle de abajo (sesiones largas via resumption).
    state: dict = {"live": None}
    # El reader NO procesa `initial`: si lo hiciera ahora, state["live"] aun seria
    # None (la sesion no abre hasta el bucle) y se perderia el primer turno. Se
    # procesa abajo, en la 1a iteracion, ya con la sesion abierta.
    reader = asyncio.create_task(_gemini_upstream(websocket, state, history, None))
    result = "disconnect"
    resume_handle: str | None = None
    greeted = False
    initial_pending = initial

    try:
        while True:
            async with open_gemini_session(
                avatar_id,
                system_prompt,
                enable_closing_tool=enable_closing,
                resume_handle=resume_handle,
            ) as live:
                state["live"] = live
                if resume_handle is None:
                    await websocket.send_json({"type": "status", "status": "ready"})

                down = asyncio.create_task(_gemini_downstream(websocket, live, state, history))

                # Primer turno del cliente (cuando el 1er mensaje no fue init),
                # ahora que la sesion ya esta abierta.
                if initial_pending is not None:
                    ip, initial_pending = initial_pending, None
                    if await _gemini_handle_upstream_msg(ip, websocket, state, history) == "end":
                        down.cancel()
                        try:
                            await down
                        except (asyncio.CancelledError, Exception):
                            pass
                        result = "end"
                        break

                # Saludo proactivo SOLO en la primera sesion (no en reconexiones).
                # Se manda como turno de usuario para gatillar el primer turno del
                # avatar, pero NO entra al conversation_history (el texto-trigger
                # no genera input_transcription -> no aparece como mensaje).
                if not greeted and initial is None:
                    greeted = True
                    try:
                        await live.send_text(
                            "[El usuario se acaba de conectar y aun no ha dicho nada. "
                            "Inicia tu la conversacion: saluda brevemente y comienza segun tu rol.]"
                        )
                    except Exception as e:
                        logger.warning(f"[WS-Gemini] saludo inicial fallo: {e}")

                done, _ = await asyncio.wait({reader, down}, return_when=asyncio.FIRST_COMPLETED)
                # Guardar el handle mas reciente por si toca reconectar.
                resume_handle = live.resume_handle or resume_handle
                state["live"] = None

                if reader in done:
                    # El cliente termino (end_session) o se desconecto.
                    down.cancel()
                    try:
                        await down
                    except (asyncio.CancelledError, Exception):
                        pass
                    try:
                        result = reader.result()  # "end"
                    except WebSocketDisconnect:
                        result = "disconnect"
                    except Exception as e:
                        logger.error(f"[WS-Gemini] upstream fallo: {e}", exc_info=True)
                        result = "error"
                    break

                # El downstream termino: la sesion Gemini se cerro (go_away/limite).
                try:
                    reason = down.result()
                except Exception as e:
                    logger.error(f"[WS-Gemini] downstream fallo: {e}", exc_info=True)
                    reason = "closed"

                if resume_handle:
                    # Reconectar con el handle: el reader sigue vivo, el cliente
                    # solo percibe (si acaso) un micro-hueco de audio.
                    logger.info(f"[WS-Gemini] reconectando sesion (motivo={reason})")
                    continue

                logger.info(f"[WS-Gemini] sesion Gemini cerro sin handle (motivo={reason})")
                result = "gemini_closed"
                break
    finally:
        if not reader.done():
            reader.cancel()
            try:
                await reader
            except (asyncio.CancelledError, Exception):
                pass

    if result == "end":
        # Ultimo turno hablado sin respuesta de Sofia (el usuario presiono
        # Terminar de inmediato): volcar los transcripts parciales al historial
        # para que SI entren al analisis.
        _flush_partial_transcripts(state, history)
        await _finalize_and_analyze(
            websocket, avatar, avatar_id, history,
            session_start_time, user_profile, session_vars, level,
        )
    else:
        logger.info(f"[WS-Gemini] Sesion terminada sin analisis (motivo={result})")


@router.websocket("/conversation/{avatar_id}")
async def conversation_websocket(websocket: WebSocket, avatar_id: str):
    """
    WebSocket para conversacion en tiempo real.

    Protocolo:
    - Cliente -> Server: {"type": "init", "user_profile": {...}, "session_vars": {...}}
        (opcional; debe ser el primer mensaje si se envia)
    - Cliente -> Server: {"type": "audio", "audio": "<base64>"}
    - Cliente -> Server: {"type": "text", "text": "..."}
    - Cliente -> Server: {"type": "end_session"}
    - Server -> Cliente: {"type": "status", "status": "transcribing|thinking|generating_audio|ready|analyzing"}
    - Server -> Cliente: {"type": "user_message", "content": "..."}
    - Server -> Cliente: {"type": "assistant_token", "content": "..."}
    - Server -> Cliente: {"type": "assistant_audio", "audio": "<base64>", "content": "..."}
    - Server -> Cliente: {"type": "session_end", "metrics": {...}}
        metrics.analysis para avatares de practica; metrics.user_profile_update para diagnostico.
    """
    await websocket.accept()
    logger.info(f"[WS] Nueva conexion WebSocket - Avatar: {avatar_id}")

    avatar = get_avatar(avatar_id)
    if not avatar:
        logger.warning(f"[WS] Avatar no encontrado: {avatar_id}")
        await websocket.send_json({"error": "Avatar not found"})
        await websocket.close()
        return

    # Rama Gemini Live (audio nativo). Aislada bajo el flag para poder volver a
    # Groq+ElevenLabs sin tocar este path. Ver docs/plans/05_gemini_live_voice.md.
    if settings.realtime_provider == "gemini":
        logger.info(f"[WS] Provider=gemini - Avatar: {avatar_id}")
        try:
            await _run_gemini_conversation(websocket, avatar, avatar_id)
        except WebSocketDisconnect:
            logger.info(f"[WS-Gemini] Cliente desconectado - Avatar: {avatar_id}")
        except Exception as e:
            logger.error(f"[WS-Gemini] Error con {avatar_id}: {e}", exc_info=True)
            try:
                await websocket.send_json({"type": "error", "error": str(e)})
            except Exception:
                pass
        return

    user_profile: UserProfile | None = None
    session_vars: dict | None = None
    level: str | None = None
    system_prompt = get_system_prompt(avatar_id)

    conversation_history = []
    exchange_count = 0
    session_start_time = time.time()

    try:
        while True:
            # Recibir mensaje del cliente
            data = await websocket.receive_json()
            msg_type = data.get("type")
            logger.debug(f"[WS] Mensaje recibido - Tipo: {msg_type}")

            if msg_type == "init":
                if exchange_count > 0:
                    logger.warning("[WS] 'init' recibido despues de mensajes, ignorando")
                    continue
                raw_profile = data.get("user_profile")
                session_vars = data.get("session_vars")
                level = data.get("level")  # principiante|intermedio|avanzado (Roberto)
                if raw_profile:
                    try:
                        user_profile = UserProfile(**raw_profile)
                        logger.info(
                            f"[WS] Init - usuario: {user_profile.registro.nombre}, "
                            f"diagnostico: {'si' if user_profile.diagnostico else 'no'}, "
                            f"level: {level or 'default'}"
                        )
                        # Persistir registro en SQLite (no bloquea si falla)
                        try:
                            await upsert_user(user_profile)
                        except Exception as e:
                            logger.error(f"[WS] upsert_user fallo: {e}")
                    except Exception as e:
                        logger.warning(f"[WS] user_profile invalido en init: {e}")
                        user_profile = None
                system_prompt = get_system_prompt(
                    avatar_id,
                    user_profile=user_profile,
                    session_vars=session_vars,
                    level=level,
                )
                await websocket.send_json({"type": "status", "status": "ready"})

                # Si es el entrevistador, Sofia arranca con un saludo cacheado
                # (evita esperar al usuario y hace la apertura mas natural).
                if avatar.get("kind") == "diagnostico":
                    greeting_text = await _send_sofia_greeting(websocket, user_profile)
                    conversation_history.append({"role": "assistant", "content": greeting_text})
                continue

            elif msg_type == "audio":
                exchange_count += 1
                logger.info(f"[WS] === Intercambio #{exchange_count} (audio) ===")

                # Todo el intercambio va en un try/except para que un fallo
                # de STT/LLM/TTS NO cierre el WS. Asi el cliente puede seguir
                # mandando audio o un end_session aunque un turno haya fallado.
                try:
                    # 1. Decodificar audio
                    audio_base64 = data.get("audio")
                    audio_format = data.get("format", "audio.webm")
                    audio_bytes = base64.b64decode(audio_base64)
                    logger.debug(f"[WS] Audio recibido: {len(audio_bytes)} bytes ({audio_format})")

                    # 2. Transcribir con Whisper
                    await websocket.send_json({"type": "status", "status": "transcribing"})

                    t_start = time.time()
                    user_text = await transcribe_audio(audio_bytes, filename=audio_format)
                    t_whisper = time.time() - t_start
                    # Blindaje: transcribe_audio ya normaliza a str, pero por si acaso
                    if not isinstance(user_text, str):
                        user_text = str(user_text) if user_text is not None else ""
                    preview = user_text[:100] + "..." if len(user_text) > 100 else user_text
                    logger.info(f"[STT] Transcripcion ({t_whisper:.2f}s): \"{preview}\"")

                    # Si el STT salio vacio (audio silente/ruido), no molestamos al
                    # LLM. Emitimos ready y seguimos esperando el proximo turno.
                    if not user_text:
                        logger.info("[STT] Transcripcion vacia, saltando turno")
                        exchange_count -= 1  # este turno no cuenta
                        await websocket.send_json({"type": "status", "status": "ready"})
                        continue

                    await websocket.send_json({"type": "user_message", "content": user_text})

                    # 3. Agregar al historial
                    conversation_history.append({"role": "user", "content": user_text})

                    # 4. Generar respuesta con LLM (streaming)
                    await websocket.send_json({"type": "status", "status": "thinking"})

                    t_start = time.time()
                    full_response = ""
                    token_count = 0
                    async for token in chat_stream(conversation_history, system_prompt):
                        full_response += token
                        token_count += 1
                        await websocket.send_json({"type": "assistant_token", "content": token})
                    t_llm = time.time() - t_start
                    llm_preview = full_response[:100] + "..." if len(full_response) > 100 else full_response
                    logger.info(f"[LLM] Respuesta generada ({t_llm:.2f}s, {token_count} tokens): \"{llm_preview}\"")

                    # Detectar [CIERRE] y limpiar texto antes de TTS/historial
                    full_response, should_close = _detect_closing(full_response)

                    # Si Sofia solo emitio [CIERRE] sin despedida, sintetizamos una
                    # despedida breve para que el usuario oiga algo amable antes
                    # del countdown de la plataforma.
                    if should_close and not full_response.strip():
                        nombre = (
                            user_profile.registro.nombre.split()[0]
                            if user_profile and user_profile.registro
                            else None
                        )
                        full_response = (
                            f"Muchas gracias, {nombre}. Tengo buen material para darte tu mapa."
                            if nombre
                            else "Muchas gracias. Tengo buen material para darte tu mapa."
                        )
                        logger.info("[WS] [CIERRE] sin texto, usando despedida default")

                    # 5. Agregar respuesta al historial (sin la marca)
                    conversation_history.append({"role": "assistant", "content": full_response})

                    # 6. Generar audio con TTS
                    await websocket.send_json({"type": "status", "status": "generating_audio"})

                    t_start = time.time()
                    await _stream_tts_over_ws(websocket, full_response, avatar_id)
                    t_tts = time.time() - t_start

                    if should_close:
                        logger.info("[WS] Sofia emitio [CIERRE], enviando closing_intent")
                        await websocket.send_json({"type": "closing_intent"})

                    logger.info(f"[WS] Intercambio #{exchange_count} completado - Total: STT={t_whisper:.2f}s + LLM={t_llm:.2f}s + TTS={t_tts:.2f}s = {t_whisper+t_llm+t_tts:.2f}s")

                    await websocket.send_json({"type": "status", "status": "ready"})
                except Exception as e:
                    # No cerramos el WS por un turno fallido. Reportamos y seguimos.
                    logger.error(f"[WS] Error procesando intercambio #{exchange_count}: {e}", exc_info=True)
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "error": f"Hubo un problema procesando tu ultimo audio. Puedes seguir hablando o presionar Terminar.",
                        })
                        await websocket.send_json({"type": "status", "status": "ready"})
                    except Exception:
                        pass

            elif msg_type == "text":
                # Modo texto (sin audio del usuario)
                exchange_count += 1
                user_text = data.get("text") or ""
                if not isinstance(user_text, str):
                    user_text = str(user_text)
                logger.info(f"[WS] === Intercambio #{exchange_count} (texto) ===")
                preview_u = user_text[:100] + "..." if len(user_text) > 100 else user_text
                logger.info(f"[WS] Texto usuario: \"{preview_u}\"")

                await websocket.send_json({
                    "type": "user_message",
                    "content": user_text
                })

                conversation_history.append({
                    "role": "user",
                    "content": user_text
                })

                await websocket.send_json({
                    "type": "status",
                    "status": "thinking"
                })

                t_start = time.time()
                full_response = ""
                token_count = 0
                async for token in chat_stream(conversation_history, system_prompt):
                    full_response += token
                    token_count += 1
                    await websocket.send_json({
                        "type": "assistant_token",
                        "content": token
                    })
                t_llm = time.time() - t_start
                preview_a = full_response[:100] + "..." if len(full_response) > 100 else full_response
                logger.info(f"[LLM] Respuesta generada ({t_llm:.2f}s, {token_count} tokens): \"{preview_a}\"")

                # Detectar [CIERRE] y limpiar texto antes de TTS/historial
                full_response, should_close = _detect_closing(full_response)

                # Despedida default si Sofia solo emitio [CIERRE]
                if should_close and not full_response.strip():
                    nombre = (
                        user_profile.registro.nombre.split()[0]
                        if user_profile and user_profile.registro
                        else None
                    )
                    full_response = (
                        f"Muchas gracias, {nombre}. Tengo buen material para darte tu mapa."
                        if nombre
                        else "Muchas gracias. Tengo buen material para darte tu mapa."
                    )
                    logger.info("[WS] [CIERRE] sin texto (modo texto), usando despedida default")

                conversation_history.append({
                    "role": "assistant",
                    "content": full_response
                })

                await websocket.send_json({
                    "type": "status",
                    "status": "generating_audio"
                })

                t_start = time.time()
                await _stream_tts_over_ws(websocket, full_response, avatar_id)
                t_tts = time.time() - t_start

                if should_close:
                    logger.info("[WS] Sofia emitio [CIERRE], enviando closing_intent")
                    await websocket.send_json({"type": "closing_intent"})

                logger.info(f"[WS] Intercambio #{exchange_count} completado - Total: LLM={t_llm:.2f}s + TTS={t_tts:.2f}s = {t_llm+t_tts:.2f}s")

                await websocket.send_json({
                    "type": "status",
                    "status": "ready"
                })

            elif msg_type == "end_session":
                duration_seconds = int(time.time() - session_start_time)
                total_exchanges = len(conversation_history) // 2
                logger.info(f"[WS] Sesion finalizada - Intercambios: {total_exchanges}, Duracion: {duration_seconds}s")

                await websocket.send_json({"type": "status", "status": "analyzing"})

                base_metrics = {
                    "total_exchanges": total_exchanges,
                    "duration_seconds": duration_seconds,
                    "conversation": conversation_history,
                }

                if avatar.get("kind") == "diagnostico":
                    # Si el init rechazo el user_profile (validacion pydantic),
                    # NO descartamos la conversacion. Construimos un Registro
                    # placeholder para que el analysis pueda correr, y marcamos
                    # el diagnostico como is_demo para que el UI muestre el aviso.
                    registro_for_analysis = user_profile.registro if user_profile and user_profile.registro else None
                    used_placeholder = False
                    if registro_for_analysis is None:
                        logger.warning(
                            "[WS] Diagnostico sin registro valido — usando placeholder "
                            "para no descartar la conversacion"
                        )
                        registro_for_analysis = Registro(
                            nombre="Candidato",
                            rol_objetivo="Profesional",
                            industria="General",
                            experience_level="mid",
                        )
                        used_placeholder = True

                    logger.info("[WS] Generando user_profile desde diagnostico...")
                    diagnostico = await generate_user_profile(
                        conversation=conversation_history,
                        registro=registro_for_analysis,
                        session_vars=session_vars,
                    )
                    if used_placeholder:
                        # Forzamos is_demo=true para que el frontend muestre
                        # el banner "esto es un ejemplo, rehaz para tu real".
                        diagnostico["is_demo"] = True
                    logger.info(
                        f"[WS] Diagnostico generado - recommended: "
                        f"{diagnostico.get('recommended_next_scenario')}/"
                        f"{diagnostico.get('recommended_next_level')}"
                    )
                    # Persistir en SQLite (mejor esfuerzo — no bloquea flujo)
                    try:
                        await save_diagnostic(
                            user_id=user_profile.user_id,
                            diagnostico=diagnostico,
                            conversation=conversation_history,
                        )
                    except Exception as e:
                        logger.error(f"[WS] save_diagnostic fallo: {e}")
                    await websocket.send_json({
                        "type": "session_end",
                        "metrics": {**base_metrics, "user_profile_update": diagnostico},
                    })
                else:
                    logger.info("[WS] Iniciando analisis de conversacion...")
                    analysis = await analyze_conversation(
                        avatar_id=avatar_id,
                        conversation=conversation_history,
                        duration_seconds=duration_seconds,
                    )
                    logger.info(f"[WS] Analisis completado - Score: {analysis.get('overall_score', 'N/A')}")
                    # Persistir sesion de practica (mejor esfuerzo — no bloquea respuesta).
                    # Solo si tenemos user_id real; sesiones anonimas se descartan
                    # porque no caben en el dashboard /mi-plan.
                    session_id = None
                    if user_profile and user_profile.user_id:
                        try:
                            session_id = await save_practice_session(
                                user_id=user_profile.user_id,
                                avatar_id=avatar_id,
                                level=level,
                                started_at=datetime.fromtimestamp(session_start_time).isoformat(),
                                ended_at=datetime.utcnow().isoformat(),
                                duration_seconds=duration_seconds,
                                total_exchanges=total_exchanges,
                                analysis=analysis,
                                conversation=conversation_history,
                            )
                        except Exception as e:
                            logger.error(f"[WS] save_practice_session fallo: {e}")
                    metrics_payload = {**base_metrics, "analysis": analysis}
                    if session_id:
                        metrics_payload["session_id"] = session_id
                    await websocket.send_json({
                        "type": "session_end",
                        "metrics": metrics_payload,
                    })
                break

    except WebSocketDisconnect:
        logger.info(f"[WS] Cliente desconectado - Avatar: {avatar_id} - Intercambios: {exchange_count}")
    except Exception as e:
        logger.error(f"[WS] Error en conversacion con {avatar_id}: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "error": str(e)
            })
        except:
            pass
