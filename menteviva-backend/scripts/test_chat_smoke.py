"""Smoke test rapido: chat_complete responde sin crashear."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.groq_llm import chat_complete  # noqa: E402


async def main():
    r = await chat_complete(
        [{"role": "user", "content": "Di hola en una sola palabra."}],
        "Eres un asistente conciso.",
    )
    print(f"respuesta: {r!r}")
    assert r, "respuesta vacia"
    print("OK")


if __name__ == "__main__":
    asyncio.run(main())
