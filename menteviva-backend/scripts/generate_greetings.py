"""
Pre-genera los MP3 de saludo de Sofia con ElevenLabs.

Correr una vez (o cuando se modifique GREETING_TEMPLATES):

    cd menteviva-backend
    poetry run python scripts/generate_greetings.py

Los MP3 se guardan en app/static/greetings/sofia_greet_{idx}.mp3 y se
sirven desde disco en cada session_init del entrevistador (cero costo
de ElevenLabs por sesion, latencia minima).
"""
import asyncio
import sys
from pathlib import Path

# Permite correr el script desde menteviva-backend/
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.prompts.entrevistador import GREETING_TEMPLATES
from app.services.edge_tts import text_to_speech


OUT_DIR = Path(__file__).parent.parent / "app" / "static" / "greetings"


async def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Generando {len(GREETING_TEMPLATES)} saludos en {OUT_DIR}")

    for i, text in enumerate(GREETING_TEMPLATES):
        print(f"\n[{i}] '{text[:70]}...'")
        mp3_bytes = await text_to_speech(text, "entrevistador")
        out_path = OUT_DIR / f"sofia_greet_{i}.mp3"
        out_path.write_bytes(mp3_bytes)
        print(f"    -> {out_path.name} ({len(mp3_bytes):,} bytes)")

    print("\nListo.")


if __name__ == "__main__":
    asyncio.run(main())
