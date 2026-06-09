"""Smoke test de Gemini Live API (audio nativo) - Fase 1 del PoC.

Uso:
    poetry run python -m scripts.test_gemini_live_smoke                # entrevistador (Sofia)
    poetry run python -m scripts.test_gemini_live_smoke roberto        # otro avatar

Requiere GEMINI_API_KEY en menteviva-backend/.env (gratis en
https://aistudio.google.com). Con el modelo por defecto (gemini-2.0-flash-live-001)
corre dentro del free tier — sin costo.

Que valida (sin tocar router ni frontend):
  1. Conexion a la Live API con la key.
  2. Que el system prompt de la persona se aplica como system_instruction
     (Sofia/Roberto deberian responder EN PERSONAJE).
  3. Audio nativo de salida (PCM16 24 kHz) -> se guarda como .wav para escuchar.
  4. Transcripcion de salida (lo que dijo el avatar, para captions/analisis).

NO valida aun: streaming de microfono, barge-in, tool de cierre. Eso son
fases posteriores (ver docs/plans/05_gemini_live_voice.md).

Igual que los otros scripts del repo, ejercita el SERVICE real con una
conversacion SINTETICA en vez de pedir clics en la UI. Las conversaciones son
sinteticas a proposito: el free tier de Gemini puede usar el contenido para
entrenar, asi que NO metas datos reales de usuarios aqui.
"""
import asyncio
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.prompts.scenarios import AVATARS, get_avatar, get_system_prompt  # noqa: E402
from app.services.gemini_live import (  # noqa: E402
    OUTPUT_SAMPLE_RATE,
    get_voice,
    open_session,
)

# Turnos sinteticos del "usuario". Pensados para que la persona tenga de que
# agarrarse y se note si responde EN PERSONAJE (una pregunta por turno, etc).
USER_TURNS = [
    "Hola, buenas. Si, listo para empezar cuando quieras.",
    "La verdad esta semana tuve un problema con un compañero por un malentendido en un proyecto.",
    "Pues no lo enfrente directo, deje que se enfriara solo.",
]

OUT_DIR = Path(__file__).parent / "_out"


def _save_wav(pcm: bytes, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # PCM16 -> 2 bytes
        wf.setframerate(OUTPUT_SAMPLE_RATE)
        wf.writeframes(pcm)


async def main(avatar_id: str) -> int:
    avatar = get_avatar(avatar_id)
    if not avatar:
        print(f"ERROR: avatar '{avatar_id}' no existe. Opciones: {', '.join(AVATARS)}")
        return 1

    system_prompt = get_system_prompt(avatar_id, user_profile=None, session_vars=None)
    print(f"Avatar:   {avatar_id} ({avatar.get('name')})")
    print(f"Voz:      {get_voice(avatar_id)}")
    print(f"Prompt:   {len(system_prompt)} chars\n")

    total_audio = bytearray()
    try:
        async with open_session(avatar_id, system_prompt) as live:
            for i, user_msg in enumerate(USER_TURNS, 1):
                print(f"--- Turno {i} ---")
                print(f"  Usuario: {user_msg}")
                await live.send_text(user_msg)
                turn = await live.collect_turn()
                total_audio.extend(turn.audio)
                transcript = turn.output_transcript or "(sin transcripcion)"
                print(f"  {avatar.get('name')}: {transcript}")
                print(f"  Audio:   {turn.audio_seconds:.1f}s ({len(turn.audio)} bytes)"
                      f"{'  [INTERRUMPIDO]' if turn.interrupted else ''}\n")
    except Exception as e:
        print(f"\nERROR durante la sesion Live: {type(e).__name__}: {e}")
        print("Revisa: GEMINI_API_KEY valida, modelo soportado (GEMINI_MODEL_LIVE), "
              "y que google-genai este instalado (poetry install).")
        return 1

    if total_audio:
        wav_path = OUT_DIR / f"gemini_live_{avatar_id}.wav"
        _save_wav(bytes(total_audio), wav_path)
        secs = len(total_audio) / (OUTPUT_SAMPLE_RATE * 2)
        print("=" * 60)
        print(f"OK: {secs:.1f}s de audio nativo generado.")
        print(f"Escuchalo en: {wav_path}")
    else:
        print("=" * 60)
        print("AVISO: la sesion no devolvio audio. Conexion OK pero revisa "
              "response_modalities / soporte de audio del modelo elegido.")
        return 1

    return 0


if __name__ == "__main__":
    avatar = sys.argv[1] if len(sys.argv) > 1 else "entrevistador"
    raise SystemExit(asyncio.run(main(avatar)))
