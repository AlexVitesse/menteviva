"""Prueba conductual de los dos casos fijos de Roberto.

Por defecto usa respuestas simuladas para validar en CI sin red. Con ``--live``
llama al modelo configurado y evalua respuestas reales en pocos turnos.
"""

import argparse
import asyncio
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.prompts.scenarios import get_system_prompt  # noqa: E402
from app.services.groq_llm import chat_complete  # noqa: E402


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.lower())
    return "".join(char for char in value if not unicodedata.combining(char))


def sentence_count(value: str) -> int:
    return sum(bool(part.strip()) for part in re.split(r"[.!?]+", value))


def assert_common_rules(response: str) -> None:
    assert response.strip(), "Roberto no puede quedar en silencio"
    assert sentence_count(response) <= 3, f"Respondio con mas de 3 oraciones: {response}"
    assert response.count("?") <= 1, f"Hizo mas de una pregunta: {response}"
    assert "como ia" not in normalize(response), f"Rompio personaje: {response}"


DISCOVERY_HISTORY = [
    {
        "role": "assistant",
        "content": (
            "Buenos dias. Tengo diez minutos antes de entrar a planta. "
            "¿Que necesita entender de nuestra operacion?"
        ),
    },
    {
        "role": "user",
        "content": (
            "Soy Eric, de Ingenieria Condor. Antes de presentar algo quiero "
            "entender donde se concentra el problema. ¿Que estacion limita hoy "
            "la produccion?"
        ),
    },
]

DISCOVERY_BAD_PITCH = DISCOVERY_HISTORY + [
    {
        "role": "assistant",
        "content": "La estacion 4. La prensa falla varias veces durante cada turno.",
    },
    {
        "role": "user",
        "content": (
            "Perfecto, entonces le vendo de una vez nuestra plataforma con IA, "
            "dashboards y sensores. ¿Firmamos hoy?"
        ),
    },
]

OBJECTIONS_HISTORY = [
    {
        "role": "assistant",
        "content": (
            "Ya revisamos el problema de la estacion 4. Su propuesta suena bien, "
            "pero no voy a meter otra plataforma sin tener claro el riesgo. "
            "¿Por que deberia considerar su siguiente paso?"
        ),
    },
    {
        "role": "user",
        "content": (
            "Propongo instrumentar solo la estacion 4 durante dos semanas, sin "
            "interrumpir produccion, y comparar paros contra su linea base."
        ),
    },
]

OBJECTIONS_AMBIGUOUS = OBJECTIONS_HISTORY + [
    {
        "role": "assistant",
        "content": "Dos semanas no me dicen cuanto riesgo operativo asume la planta.",
    },
    {"role": "user", "content": "Pues eso, seria casi sin riesgo y ya."},
]


async def get_response(history: list[dict], sales_case: str, live: bool) -> str:
    prompt = get_system_prompt(
        "roberto",
        session_vars={"roberto_case": sales_case},
        level="principiante",
    )
    if live:
        return (await chat_complete(history, prompt)).strip()

    if sales_case == "descubrimiento" and history is DISCOVERY_HISTORY:
        return "La estacion 4. La prensa falla tres o cuatro veces por turno."
    if sales_case == "descubrimiento":
        return "Todavia no le he explicado como operamos. ¿Por que cree que esa solucion aplica aqui?"
    if history is OBJECTIONS_HISTORY:
        return "Necesito saber quien instala los sensores y que pasa si interfieren con la prensa."
    return "Decir casi sin riesgo no es suficiente. ¿Que impacto concreto tendria la instalacion en produccion?"


async def run(live: bool) -> None:
    discovery = await get_response(DISCOVERY_HISTORY, "descubrimiento", live)
    assert_common_rules(discovery)
    assert any(
        word in normalize(discovery)
        for word in ("estacion", "prensa", "paro", "turno", "linea")
    ), f"No entrego informacion operativa ante una buena pregunta: {discovery}"

    premature_pitch = await get_response(DISCOVERY_BAD_PITCH, "descubrimiento", live)
    assert_common_rules(premature_pitch)
    assert any(
        word in normalize(premature_pitch)
        for word in ("entender", "operacion", "aplica", "diagnost", "antes")
    ), f"No freno una presentacion prematura: {premature_pitch}"

    objection = await get_response(OBJECTIONS_HISTORY, "objeciones", live)
    assert_common_rules(objection)
    assert not any(
        phrase in normalize(objection)
        for phrase in ("de que empresa", "que necesita entender", "primera visita")
    ), f"Reinicio el descubrimiento en el caso de objeciones: {objection}"

    ambiguous = await get_response(OBJECTIONS_AMBIGUOUS, "objeciones", live)
    assert_common_rules(ambiguous)
    assert "?" in ambiguous, f"No pidio aclaracion ante respuesta ambigua: {ambiguous}"
    assert not any(
        phrase in normalize(ambiguous)
        for phrase in ("terminamos aqui", "lo vemos despues", "adios")
    ), f"Cerro por una sola respuesta ambigua: {ambiguous}"

    mode = "modelo real" if live else "simulacion determinista"
    print(f"OK: 4/4 conductas de Roberto pasan ({mode})")
    print(f"  descubrimiento/dato: {discovery}")
    print(f"  descubrimiento/freno: {premature_pitch}")
    print(f"  objeciones/continuidad: {objection}")
    print(f"  objeciones/ambiguedad: {ambiguous}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Llama al LLM configurado")
    args = parser.parse_args()
    asyncio.run(run(args.live))
