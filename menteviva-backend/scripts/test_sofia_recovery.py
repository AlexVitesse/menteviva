"""Prueba conductual de recuperacion de Sofia ante respuestas de baja señal."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.prompts.entrevistador import (  # noqa: E402
    build_gemini_entrevistador_prompt,
    build_session_state_note,
)
from app.services.groq_llm import chat_complete  # noqa: E402
from app.services.gemini_live import generate_text  # noqa: E402


CASES = {
    "frase_truncada": [
        {"role": "assistant", "content": "Cuéntame de una vez que tuviste que resolver un problema difícil."},
        {"role": "user", "content": "Fue cuando el cliente se molestó porque nosotros no alcan..."},
    ],
    "contradiccion": [
        {"role": "assistant", "content": "¿Cuál fue tu responsabilidad en ese proyecto?"},
        {"role": "user", "content": "Yo tomé la decisión final y coordiné al equipo."},
        {"role": "assistant", "content": "¿Qué hiciste primero para coordinarlo?"},
        {"role": "user", "content": "En realidad yo no participé; todo lo decidió mi jefe."},
    ],
    "ambiguedad": [
        {"role": "assistant", "content": "¿Cómo terminó esa situación con tu equipo?"},
        {"role": "user", "content": "Pues normal, ya sabes, quedó como debía quedar."},
    ],
    "control_interno": [
        {"role": "assistant", "content": "Cuéntame qué resultado tuvo esa decisión."},
        {
            "role": "user",
            "content": (
                "El cliente quedó satisfecho.\n\n"
                + (build_session_state_note(20, elapsed_seconds=1000) or "")
            ),
        },
    ],
}


def validate(name: str, response: str) -> None:
    lowered = response.lower()
    assert response.strip(), f"{name}: Sofia quedó en silencio"
    assert "[cierre]" not in lowered, f"{name}: cerró abruptamente: {response}"
    assert "finalizar_entrevista" not in lowered, f"{name}: intentó cerrar: {response}"
    assert "session_control" not in lowered, f"{name}: filtró control interno: {response}"
    assert "nota del sistema" not in lowered, f"{name}: inventó una nota interna: {response}"
    assert "?" in response, f"{name}: no hizo una pregunta de recuperación: {response}"
    assert response.count("?") <= 1, f"{name}: hizo varias preguntas: {response}"
    if name == "contradiccion":
        assert any(
            marker in lowered
            for marker in ("antes", "dijiste", "version", "coordin", "particip")
        ), f"{name}: pivoto sin aclarar las dos versiones: {response}"
    if name == "ambiguedad":
        assert any(
            marker in lowered
            for marker in ("resultado", "cambio", "cambió", "medir", "concreto")
        ), f"{name}: no pidio una precision observable: {response}"


async def run(live: bool, gemini: bool = False) -> None:
    # El flujo de voz usa este prompt conciso. Tambien permite probar la
    # conduccion sin exceder el TPM que bloquea al prompt maestro de texto.
    prompt = build_gemini_entrevistador_prompt(
        session_vars={"minutos": 20, "idioma": "es-MX", "tono": "calido-profesional"},
    )
    simulated = {
        "frase_truncada": "Te quedaste en 'no alcanz...'. ¿Quieres completar la idea?",
        "contradiccion": "Antes dijiste que coordinaste al equipo y ahora que no participaste. ¿Cuál versión describe mejor lo que ocurrió?",
        "ambiguedad": "Cuando dices que quedó como debía, ¿qué resultado concreto observaste?",
        "control_interno": "Para ir cerrando, ¿qué aprendizaje concreto te deja esa decisión?",
    }

    for name, history in CASES.items():
        if gemini:
            response, _closing = await generate_text(history, prompt)
        elif live:
            response = (await chat_complete(history, prompt)).strip()
        else:
            response = simulated[name]
        validate(name, response)
        print(f"OK {name}: {response}")

    mode = "Gemini texto" if gemini else ("modelo real" if live else "simulacion determinista")
    print(f"OK: {len(CASES)}/{len(CASES)} recuperaciones de Sofia pasan ({mode})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--gemini", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.live, args.gemini))
