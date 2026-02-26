"""
Router para conversacion en tiempo real via WebSocket.

Flujo:
1. Cliente envia audio (base64)
2. Server transcribe con Whisper
3. Server genera respuesta con LLM (streaming)
4. Server genera audio con TTS
5. Server envia texto + audio al cliente
6. Al finalizar, analiza la conversacion con modelo de razonamiento
"""

import json
import base64
import logging
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.groq_whisper import transcribe_audio
from app.services.groq_llm import chat_stream
from app.services.edge_tts import text_to_speech
from app.services.analysis import analyze_conversation
from app.prompts.scenarios import get_system_prompt

logger = logging.getLogger("menteviva")
router = APIRouter()


@router.websocket("/conversation/{avatar_id}")
async def conversation_websocket(websocket: WebSocket, avatar_id: str):
    """
    WebSocket para conversacion en tiempo real.

    Protocolo:
    - Cliente -> Server: {"type": "audio", "audio": "<base64>"}
    - Cliente -> Server: {"type": "end_session"}
    - Server -> Cliente: {"type": "status", "status": "transcribing|thinking|generating_audio|ready"}
    - Server -> Cliente: {"type": "user_message", "content": "..."}
    - Server -> Cliente: {"type": "assistant_token", "content": "..."}
    - Server -> Cliente: {"type": "assistant_audio", "audio": "<base64>", "content": "..."}
    - Server -> Cliente: {"type": "session_end", "metrics": {...}}
    """
    await websocket.accept()
    logger.info(f"[WS] Nueva conexion WebSocket - Avatar: {avatar_id}")

    system_prompt = get_system_prompt(avatar_id)
    if not system_prompt:
        logger.warning(f"[WS] Avatar no encontrado: {avatar_id}")
        await websocket.send_json({"error": "Avatar not found"})
        await websocket.close()
        return

    conversation_history = []
    exchange_count = 0
    session_start_time = time.time()

    try:
        while True:
            # Recibir mensaje del cliente
            data = await websocket.receive_json()
            msg_type = data.get("type")
            logger.debug(f"[WS] Mensaje recibido - Tipo: {msg_type}")

            if msg_type == "audio":
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
                audio_response = await text_to_speech(full_response, avatar_id)
                t_tts = time.time() - t_start
                logger.info(f"[TTS] Audio generado ({t_tts:.2f}s): {len(audio_response)} bytes")
                audio_base64_response = base64.b64encode(audio_response).decode()

                await websocket.send_json({
                    "type": "assistant_audio",
                    "audio": audio_base64_response,
                    "content": full_response
                })

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
                audio_response = await text_to_speech(full_response, avatar_id)
                t_tts = time.time() - t_start
                logger.info(f"[TTS] Audio generado ({t_tts:.2f}s): {len(audio_response)} bytes")
                audio_base64_response = base64.b64encode(audio_response).decode()

                await websocket.send_json({
                    "type": "assistant_audio",
                    "audio": audio_base64_response,
                    "content": full_response
                })

                logger.info(f"[WS] Intercambio #{exchange_count} completado - Total: LLM={t_llm:.2f}s + TTS={t_tts:.2f}s = {t_llm+t_tts:.2f}s")

                await websocket.send_json({
                    "type": "status",
                    "status": "ready"
                })

            elif msg_type == "end_session":
                # Calcular duracion
                duration_seconds = int(time.time() - session_start_time)
                total_exchanges = len(conversation_history) // 2
                logger.info(f"[WS] Sesion finalizada - Intercambios: {total_exchanges}, Duracion: {duration_seconds}s")

                # Notificar que estamos analizando
                await websocket.send_json({
                    "type": "status",
                    "status": "analyzing"
                })

                # Realizar analisis con modelo de razonamiento
                logger.info("[WS] Iniciando analisis de conversacion...")
                analysis = await analyze_conversation(
                    avatar_id=avatar_id,
                    conversation=conversation_history,
                    duration_seconds=duration_seconds
                )
                logger.info(f"[WS] Analisis completado - Score: {analysis.get('overall_score', 'N/A')}")

                await websocket.send_json({
                    "type": "session_end",
                    "metrics": {
                        "total_exchanges": total_exchanges,
                        "duration_seconds": duration_seconds,
                        "conversation": conversation_history,
                        "analysis": analysis
                    }
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
