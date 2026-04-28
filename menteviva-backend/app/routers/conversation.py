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

import json
import base64
import logging
import time
from pathlib import Path
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.models import UserProfile
from app.models.user_profile import Registro
from app.services.groq_whisper import transcribe_audio
from app.services.groq_llm import chat_stream
from app.services.edge_tts import text_to_speech, text_to_speech_stream
from app.services.analysis import analyze_conversation, generate_user_profile
from app.services.user_repo import save_diagnostic, upsert_user
from app.prompts.scenarios import get_avatar, get_system_prompt
from app.prompts.entrevistador import pick_greeting

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

    user_profile: UserProfile | None = None
    session_vars: dict | None = None
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
                    await websocket.send_json({
                        "type": "session_end",
                        "metrics": {**base_metrics, "analysis": analysis},
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
