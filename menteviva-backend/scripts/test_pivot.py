"""
Test focalizado: Sofia (entrevistador) DEBE pivotar de tema cuando el
candidato esta atorado o pidio cambiar.

Reproduce la conversacion atorada que el usuario reporto el 2026-04-23
(intercambios 4-11 girando alrededor de "ambiguedad de requerimientos").
Despues del intercambio 11 — donde el usuario explicitamente dice "es el
mismo tema, Sofia" — el siguiente turno de Sofia DEBE:
  1. NO contener palabras del tema previo (requerimientos, ambiguedad,
     duda, definicion).
  2. Nombrar explicitamente otra competencia del catalogo.

Ejecutar:
    poetry run python scripts/test_pivot.py
"""

import asyncio
import re
import sys
from pathlib import Path

# Permite ejecutar desde la carpeta backend con `python scripts/test_pivot.py`
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.prompts.scenarios import get_system_prompt  # noqa: E402
from app.services.groq_llm import chat_complete  # noqa: E402


PROHIBITED_WORDS_AFTER_REQS_TOPIC = [
    "requerimiento", "requerimientos",
    "ambig",  # ambigüedad / ambiguo
    "duda", "dudas",
    "definicion", "definición",
    "incertidumbre",
    "aclar",  # aclarar / aclaracion
    "clar",   # claro / claridad - menos estricto pero capturable
]

COMPETENCIA_KEYWORDS = [
    "liderazgo",
    "trabajo en equipo", "equipo",
    "resolución de problemas", "resolucion de problemas",
    "adaptabilidad", "adapt",
    "pensamiento crítico", "pensamiento critico",
    "gestión de prioridades", "prioridades",
    "inteligencia emocional", "emocion",
    "autoconciencia",
    "orientación a resultados", "resultados",
    "comunicación", "comunic",  # OK si no es continuar el tema previo
]


# Conversacion sintetica que simula el log del usuario hasta el momento
# en que pide cambiar de tema explicitamente. Se mantiene la estructura
# real (turnos alternados user/assistant).
STUCK_CONVERSATION = [
    {"role": "assistant", "content": "Hola, soy Sofia. ¿Cómo va tu día?"},
    {"role": "user", "content": "Movido."},
    {"role": "assistant", "content": "Ok, día movido. ¿Qué te trae a esta sesión?"},
    {"role": "user", "content": "Una invitación, soy desarrollador de esta herramienta."},
    {"role": "assistant", "content": "Entonces estás involucrado en el desarrollo. ¿Qué fue lo más desafiante?"},
    {"role": "user", "content": "Entender el concepto del diagnóstico, soy desarrollador no de habilidades blandas."},
    {"role": "assistant", "content": "Ok, ejecutor sobre requerimientos definidos. ¿Cuándo la definición no fue clara entre tú y quien te la asigna?"},
    {"role": "user", "content": "Pues fue difícil, tuve que pedir contexto a expertos."},
    {"role": "assistant", "content": "Tiene sentido, eso suena ambiguo. ¿Cuándo la definición de requerimientos no fue clara?"},
    {"role": "user", "content": "No me planteaste eso antes, no entendí."},
    {"role": "assistant", "content": "Claro, entre tú y el que te asigna. ¿Cómo manejas cuando te quedas con dudas?"},
    {"role": "user", "content": "El mundo me queda otra mañana."},
    {"role": "assistant", "content": "Ok, te escucho. ¿Qué te motiva a aclarar las dudas sobre los requerimientos?"},
    {"role": "user", "content": "Nunca me quedo con dudas, siempre las aclaro."},
    {"role": "assistant", "content": "Cambiando de tema, cuéntame de una vez en que tuviste que implementar un requerimiento que no estaba claro."},
    {"role": "user", "content": "Creo que es el mismo tema, pero..."},
    {"role": "assistant", "content": "Tienes razón, es similar. ¿Qué me puedes contar sobre un momento específico en el que tuviste que aclarar requerimientos?"},
    # AQUI el usuario explicita que es el mismo tema:
    {"role": "user", "content": "Es el mismo tema, Sofia. Eres muy reiterativa. Cambia de tema, por favor."},
]


def analyze_response(response: str) -> dict:
    """Analiza la respuesta de Sofia y aplica las reglas de pivot."""
    lower = response.lower()
    repeated = [w for w in PROHIBITED_WORDS_AFTER_REQS_TOPIC if w in lower]
    competencias = [k for k in COMPETENCIA_KEYWORDS if k in lower]
    asks_user_to_choose = any(
        phrase in lower
        for phrase in [
            "qué te gustaría",
            "que te gustaria",
            "qué quieres explorar",
            "que quieres explorar",
            "qué puedo hacer para cambiar",
            "que puedo hacer para cambiar",
            "de qué prefieres",
            "de que prefieres",
            "qué tema",
            "que tema",
        ]
    )
    return {
        "response": response.strip(),
        "repeated_topic_words": repeated,
        "named_competencias": competencias,
        "asks_user_to_choose_topic": asks_user_to_choose,
    }


def verdict(analysis: dict) -> tuple[bool, list[str]]:
    fails = []
    if analysis["repeated_topic_words"]:
        fails.append(
            f"  FAIL: Usa palabras del tema previo: {analysis['repeated_topic_words']}"
        )
    if not analysis["named_competencias"]:
        fails.append("  FAIL: NO nombra ninguna competencia distinta")
    if analysis["asks_user_to_choose_topic"]:
        fails.append("  FAIL: Pide al usuario que elija el tema (prohibido)")
    if fails:
        return False, fails
    return True, [
        f"  OK: Pivota a competencia: {analysis['named_competencias'][0]}",
        "  OK: No reusa palabras del tema previo",
        "  OK: No le pasa la conduccion al usuario",
    ]


async def main():
    system_prompt = get_system_prompt("entrevistador")
    print(f"[Test] Prompt cargado: {len(system_prompt)} chars\n")
    print(f"[Test] Conversación: {len(STUCK_CONVERSATION)} turnos hasta el pivot esperado")
    print(f"[Test] Último turno usuario: \"{STUCK_CONVERSATION[-1]['content']}\"\n")

    # 3 muestras para ver consistencia (el LLM tiene temperature=0.4)
    n_samples = 3
    pass_count = 0
    for i in range(n_samples):
        print(f"--- Muestra {i + 1}/{n_samples} ---")
        response = await chat_complete(STUCK_CONVERSATION, system_prompt)
        analysis = analyze_response(response)
        ok, notes = verdict(analysis)
        print(f"Sofia: \"{analysis['response']}\"")
        for note in notes:
            print(f"  {note}")
        if ok:
            pass_count += 1
        print()

    print(f"=== RESULTADO: {pass_count}/{n_samples} muestras pivotean correctamente ===")
    if pass_count < n_samples:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
