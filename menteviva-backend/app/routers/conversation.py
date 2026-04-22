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
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.models import UserProfile
from app.services.groq_whisper import transcribe_audio
from app.services.groq_llm import chat_stream
from app.services.edge_tts import text_to_speech, text_to_speech_stream
from app.services.analysis import analyze_conversation, generate_user_profile
from app.prompts.scenarios import get_avatar, get_system_prompt

logger = logging.getLogger("menteviva")
router = APIRouter()


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
                if raw_profile:
                    try:
                        user_profile = UserProfile(**raw_profile)
                        logger.info(
                            f"[WS] Init - usuario: {user_profile.registro.nombre}, "
                            f"diagnostico: {'si' if user_profile.diagnostico else 'no'}"
                        )
                    except Exception as e:
                        logger.warning(f"[WS] user_profile invalido en init: {e}")
                        user_profile = None
                system_prompt = get_system_prompt(
                    avatar_id,
                    user_profile=user_profile,
                    session_vars=session_vars,
                )
                await websocket.send_json({"type": "status", "status": "ready"})
                continue

            elif msg_type == "audio":
                exchange_count += 1
                logger.info(f"[WS] === Intercambio #{exchange_count} (audio) ===")

                # 1. Decodificar audio
                audio_base64 = data.get("audio")
                audio_bytes = base64.b64decode(audio_base64)
                logger.debug(f"[WS] Audio recibido: {len(audio_bytes)} bytes")

                # 2. Transcribir con Whisper
                await websocket.send_json({
                    "type": "status",
                    "status": "transcribing"
                })

                t_start = time.time()
                user_text = await transcribe_audio(audio_bytes)
                t_whisper = time.time() - t_start
                logger.info(f"[STT] Transcripcion ({t_whisper:.2f}s): \"{user_text[:100]}...\"" if len(user_text) > 100 else f"[STT] Transcripcion ({t_whisper:.2f}s): \"{user_text}\"")

                await websocket.send_json({
                    "type": "user_message",
                    "content": user_text
                })

                # 3. Agregar al historial
                conversation_history.append({
                    "role": "user",
                    "content": user_text
                })

                # 4. Generar respuesta con LLM (streaming)
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
                logger.info(f"[LLM] Respuesta generada ({t_llm:.2f}s, {token_count} tokens): \"{full_response[:100]}...\"" if len(full_response) > 100 else f"[LLM] Respuesta generada ({t_llm:.2f}s, {token_count} tokens): \"{full_response}\"")

                # 5. Agregar respuesta al historial
                conversation_history.append({
                    "role": "assistant",
                    "content": full_response
                })

                # 6. Generar audio con TTS
                await websocket.send_json({
                    "type": "status",
                    "status": "generating_audio"
                })

                t_start = time.time()
                await _stream_tts_over_ws(websocket, full_response, avatar_id)
                t_tts = time.time() - t_start

                logger.info(f"[WS] Intercambio #{exchange_count} completado - Total: STT={t_whisper:.2f}s + LLM={t_llm:.2f}s + TTS={t_tts:.2f}s = {t_whisper+t_llm+t_tts:.2f}s")

                await websocket.send_json({
                    "type": "status",
                    "status": "ready"
                })

            elif msg_type == "text":
                # Modo texto (sin audio del usuario)
                exchange_count += 1
                user_text = data.get("text", "")
                logger.info(f"[WS] === Intercambio #{exchange_count} (texto) ===")
                logger.info(f"[WS] Texto usuario: \"{user_text[:100]}...\"" if len(user_text) > 100 else f"[WS] Texto usuario: \"{user_text}\"")

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
                logger.info(f"[LLM] Respuesta generada ({t_llm:.2f}s, {token_count} tokens): \"{full_response[:100]}...\"" if len(full_response) > 100 else f"[LLM] Respuesta generada ({t_llm:.2f}s, {token_count} tokens): \"{full_response}\"")

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
                    if not user_profile or not user_profile.registro:
                        logger.error("[WS] Diagnostico sin registro: se requiere 'init' con user_profile")
                        await websocket.send_json({
                            "type": "session_end",
                            "metrics": {
                                **base_metrics,
                                "user_profile_update": None,
                                "error": "Diagnostico requiere registro: envia 'init' con user_profile antes de la conversacion.",
                            },
                        })
                        break

                    logger.info("[WS] Generando user_profile desde diagnostico...")
                    diagnostico = await generate_user_profile(
                        conversation=conversation_history,
                        registro=user_profile.registro,
                        session_vars=session_vars,
                    )
                    logger.info(
                        f"[WS] Diagnostico generado - recommended: "
                        f"{diagnostico.get('recommended_next_scenario')}/"
                        f"{diagnostico.get('recommended_next_level')}"
                    )
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
