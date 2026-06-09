"""Prueba de integracion del proxy WebSocket de Gemini Live (Fase 2).

Uso (requiere el backend corriendo en modo gemini):
    # terminal 1 - backend:
    REALTIME_PROVIDER=gemini MENTEVIVA_PORT=8001 MENTEVIVA_RELOAD=false poetry run python -m app
    # terminal 2:
    poetry run python -m scripts.test_gemini_ws            # roberto, puerto 8001
    poetry run python -m scripts.test_gemini_ws maria 8001

Que valida (sin frontend): que el router (conversation.py) hace de proxy contra
Gemini Live de punta a punta — manda turnos de TEXTO por el WS, recibe audio
nativo (assistant_audio_chunk, PCM24) + transcripts (output_transcript), y al
end_session recibe session_end con el analisis de Groq (que NO migramos).

Es la version "por script" de la convencion del repo: en vez de clicar la UI,
un cliente WS sintetico ejercita el path real. Conversacion SINTETICA a
proposito (el free tier de Gemini puede entrenar con el contenido).
"""
import asyncio
import base64
import json
import os
import sys
import wave
from pathlib import Path

import websockets

sys.path.insert(0, str(Path(__file__).parent.parent))

OUTPUT_SAMPLE_RATE = 24000  # PCM nativo de Gemini (coincide con gemini_live.OUTPUT_SAMPLE_RATE)
OUT_DIR = Path(__file__).parent / "_out"

USER_TURNS = [
    "Hola Roberto, gracias por recibirme. Vengo de DataFlow, vendemos software de gestion de inventario.",
    "Entiendo que el precio importa, pero deja que te muestre el retorno: nuestros clientes reducen quiebres de stock 30%.",
]


def _save_wav(pcm: bytes, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(OUTPUT_SAMPLE_RATE)
        wf.writeframes(pcm)


async def _recv_until(ws, stop_types: set[str], timeout: float = 90.0) -> tuple[list[dict], str]:
    """Recibe mensajes hasta toparse con uno cuyo type este en stop_types.

    Devuelve (mensajes_recibidos, type_que_paro). Lanza TimeoutError si no llega.
    """
    msgs: list[dict] = []
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise TimeoutError(f"No llego ninguno de {stop_types} en {timeout}s")
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        data = json.loads(raw)
        msgs.append(data)
        if data.get("type") in stop_types:
            return msgs, data["type"]


def _summarize(msgs: list[dict]) -> tuple[bytes, str, list[str]]:
    """Extrae (audio_pcm, transcript_concatenado, tipos_vistos) de un lote."""
    audio = bytearray()
    transcript_parts: list[str] = []
    types_seen: list[str] = []
    for m in msgs:
        t = m.get("type")
        types_seen.append(t)
        if t == "assistant_audio_chunk":
            audio.extend(base64.b64decode(m["audio"]))
        elif t == "output_transcript":
            transcript_parts.append(m.get("content", ""))
        elif t == "user_message":
            pass
    return bytes(audio), "".join(transcript_parts).strip(), types_seen


async def main(avatar_id: str, port: int) -> int:
    uri = f"ws://127.0.0.1:{port}/api/conversation/{avatar_id}"
    print(f"Conectando a {uri}\n")
    all_audio = bytearray()
    try:
        async with websockets.connect(uri, max_size=None) as ws:
            for i, text in enumerate(USER_TURNS, 1):
                print(f"--- Turno {i} ---")
                print(f"  Usuario: {text}")
                await ws.send(json.dumps({"type": "text", "text": text}))
                msgs, _ = await _recv_until(ws, {"turn_complete"})
                audio, transcript, _ = _summarize(msgs)
                all_audio.extend(audio)
                print(f"  {avatar_id}: {transcript or '(sin transcript)'}")
                print(f"  Audio: {len(audio)} bytes ({len(audio)/(OUTPUT_SAMPLE_RATE*2):.1f}s)\n")
                if not audio:
                    print("  AVISO: turno sin audio.")

            print("--- end_session ---")
            await ws.send(json.dumps({"type": "end_session"}))
            msgs, _ = await _recv_until(ws, {"session_end"}, timeout=120.0)
            end = msgs[-1]
            metrics = end.get("metrics", {})
            analysis = metrics.get("analysis") or metrics.get("user_profile_update") or {}
            score = analysis.get("overall_score", analysis.get("recommended_next_scenario", "N/A"))
            print(f"  session_end recibido. intercambios={metrics.get('total_exchanges')}, "
                  f"score/diag={score}")
    except Exception as e:
        print(f"\nERROR: {type(e).__name__}: {e}")
        print("Revisa: backend corriendo con REALTIME_PROVIDER=gemini en el puerto correcto, "
              "y GEMINI_API_KEY valida.")
        return 1

    print("=" * 60)
    if all_audio:
        wav = OUT_DIR / f"gemini_ws_{avatar_id}.wav"
        _save_wav(bytes(all_audio), wav)
        print(f"OK: proxy WS funcional. {len(all_audio)/(OUTPUT_SAMPLE_RATE*2):.1f}s de audio.")
        print(f"Audio agregado: {wav}")
        return 0
    print("FALLO: no se recibio audio del avatar.")
    return 1


if __name__ == "__main__":
    avatar = sys.argv[1] if len(sys.argv) > 1 else "roberto"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.getenv("MENTEVIVA_PORT", "8001"))
    raise SystemExit(asyncio.run(main(avatar, port)))
