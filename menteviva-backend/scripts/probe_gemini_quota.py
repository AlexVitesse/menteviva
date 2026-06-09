"""Sonda mínima: ¿hay cuota de Gemini? Escribe el resultado a logs/probe_gemini.txt."""
import asyncio
import pathlib
import sys
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

OUT = pathlib.Path(__file__).parent.parent / "logs" / "probe_gemini.txt"


async def main() -> str:
    from google import genai
    from app.config import settings

    client = genai.Client(api_key=settings.gemini_api_key)
    r = await client.aio.models.generate_content(model="gemini-2.5-flash", contents="di OK")
    return "CUOTA OK: " + (r.text or "")[:40]


if __name__ == "__main__":
    try:
        OUT.write_text(asyncio.run(main()), encoding="utf-8")
    except Exception:
        OUT.write_text("ERROR:\n" + traceback.format_exc()[-800:], encoding="utf-8")
