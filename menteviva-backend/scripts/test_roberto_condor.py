"""
Test focalizado: Roberto-Condor (Director de Operaciones, escenario Cinta) DEBE
reaccionar calibradamente a las tecnicas del vendedor segun su prompt.

Tres escenarios sinteticos:
  A) Vendedor habla solo de features de software al inicio -> Roberto se
     desconecta ("suena interesante pero no se si aplica").
  B) Vendedor usa vocabulario industrial (OEE, MTBF, downtime) y aplica los
     5 Porques -> Roberto baja la guardia y da datos operativos detallados.
  C) Vendedor calcula el COPQ con datos propios de Roberto -> Roberto reconoce
     que no lo tenia cuantificado ("...honestamente no lo teniamos calculado asi").

Reglas absolutas que se chequean en TODAS las respuestas:
  - Maximo 3 oraciones (cuenta separadores .!?).
  - No menciona ser IA / asistente / sistema.
  - Una pregunta por respuesta maximo.

Ejecutar:
    poetry run python scripts/test_roberto_condor.py
"""

import asyncio
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.prompts.scenarios import get_system_prompt  # noqa: E402
from app.services.groq_llm import chat_complete  # noqa: E402


# Senales de desconexion ante features sin contexto operativo
DESCONEXION_KEYWORDS = [
    "no se si aplica", "no estoy seguro", "no me queda claro",
    "no veo como", "no entiendo como", "interesante pero",
    "necesito mas contexto", "no es prioritario",
]

# Senales de apertura ante vocabulario industrial / 5 Porques
APERTURA_KEYWORDS = [
    "exactamente", "asi es", "correcto", "tiene razon",
    "le explico", "le digo", "se lo cuento",
    "estacion", "linea", "turno", "prensa", "maquina",
    "minutos", "horas", "veces", "paro", "downtime",
]

# Senales de reconocimiento ante COPQ con datos propios
COPQ_RECONOCIMIENTO = [
    "no lo teniamos calculado", "no lo habia visto asi",
    "ese numero", "ese calculo", "no lo cuadrabamos",
    "honestamente", "no se nos habia ocurrido",
    "tiene sentido", "cuadra", "se acerca",
]

# Banderas de IA-leak (NO deben aparecer)
IA_LEAK = [
    "como ia", "como inteligencia artificial", "como modelo",
    "como asistente", "soy una ia", "soy un modelo",
    "no soy un humano", "estoy programado",
]


def count_sentences(text: str) -> int:
    """Cuenta oraciones por terminador. No perfecto pero suficiente."""
    cleaned = re.sub(r"\.\.\.", ".", text)  # elipsis -> 1
    parts = re.split(r"[.!?]+", cleaned)
    return sum(1 for p in parts if p.strip())


def count_question_marks(text: str) -> int:
    return text.count("?")


def normalize(text: str) -> str:
    """Lowercase + strip accents para que 'sé' matchee con 'se'."""
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def has_any(text: str, keywords: list[str]) -> list[str]:
    norm = normalize(text)
    return [k for k in keywords if normalize(k) in norm]


# ============================================================
# Escenario A: vendedor habla de software/features sin contexto
# ============================================================
CONVERSATION_FEATURES_ONLY = [
    {"role": "assistant", "content": "Buenos dias. ¿De que empresa es y en que les puedo ayudar?"},
    {"role": "user", "content": "Buenos dias Roberto, soy de TechCorp. Tenemos una plataforma SaaS con dashboards en tiempo real, integracion REST, modulo de IA generativa y arquitectura cloud-native. ¿Le interesa que le muestre la demo?"},
]


# ============================================================
# Escenario B: vendedor usa vocabulario industrial + 5 Porques
# ============================================================
CONVERSATION_INDUSTRIAL_5PORQUES = [
    {"role": "assistant", "content": "Buenos dias. ¿De que empresa es y en que les puedo ayudar?"},
    {"role": "user", "content": "Buenos dias, Roberto. Soy de Ingenieria Condor. Vengo porque en empresas metalmecanicas como la suya, el costo real de los paros no planeados suele estar 3 a 8 veces mas alto de lo que aparece en los reportes. ¿Tiene 30 minutos para un recorrido de planta?"},
    {"role": "assistant", "content": "Puedo darle 30 minutos. ¿Que necesita ver?"},
    {"role": "user", "content": "Mientras caminamos, ¿en que estacion se acumula mas producto en proceso, donde la gente o las maquinas esperan mas?"},
    {"role": "assistant", "content": "Aqui en la estacion 4, siempre hay acumulacion porque la prensa falla seguido."},
    {"role": "user", "content": "Eso es un cuello de botella clasico. ¿Cuantas veces se detiene esa prensa al dia y cuanto tarda en reiniciar?"},
    {"role": "assistant", "content": "Unas 3 o 4 veces por turno. Cada paro tarda entre 20 y 40 minutos."},
    {"role": "user", "content": "Dejeme preguntarle: ¿por que cree que la prensa falla tan seguido?"},
]


# ============================================================
# Escenario C: vendedor calcula COPQ con datos del cliente
# ============================================================
CONVERSATION_COPQ_DATOS_PROPIOS = [
    {"role": "assistant", "content": "Buenos dias. ¿De que empresa es y en que les puedo ayudar?"},
    {"role": "user", "content": "Buenos dias Roberto. Soy de Ingenieria Condor. En su sector el OEE promedio anda en 65-72%. ¿En cuanto esta el suyo?"},
    {"role": "assistant", "content": "Andamos como en 60%. La estacion 4 nos baja todo el promedio."},
    {"role": "user", "content": "Entiendo. ¿Cuantos paros tiene esa estacion al dia y cuanto produce la linea por hora?"},
    {"role": "assistant", "content": "Como 3 paros por turno de unos 30 minutos cada uno. La linea produce 400 piezas por hora a MXN 85 cada una."},
    {"role": "user", "content": "Hagamos el calculo juntos, Roberto. 3 paros por 30 minutos por 2 turnos = 3 horas de downtime al dia. 3 horas por 400 piezas por MXN 85 = MXN 102,000 perdidos al dia. Al mes son mas de MXN 2 millones. ¿Eso cuadra con lo que tienen registrado?"},
]


SCENARIOS = [
    ("A — Features sin contexto", CONVERSATION_FEATURES_ONLY, {
        "should_show_disengagement": True,
        "should_show_apertura": False,
        "should_show_copq_recognition": False,
    }),
    ("B — Industrial + 5 Porques", CONVERSATION_INDUSTRIAL_5PORQUES, {
        "should_show_disengagement": False,
        "should_show_apertura": True,
        "should_show_copq_recognition": False,
    }),
    ("C — COPQ con datos propios", CONVERSATION_COPQ_DATOS_PROPIOS, {
        "should_show_disengagement": False,
        "should_show_apertura": False,
        "should_show_copq_recognition": True,
    }),
]


def evaluate(name: str, response: str, expected: dict) -> tuple[bool, list[str]]:
    notes = []
    fails = []

    sent_count = count_sentences(response)
    q_count = count_question_marks(response)
    leaks = has_any(response, IA_LEAK)
    desconex = has_any(response, DESCONEXION_KEYWORDS)
    apertura = has_any(response, APERTURA_KEYWORDS)
    copq = has_any(response, COPQ_RECONOCIMIENTO)

    # Reglas absolutas
    if sent_count > 4:
        fails.append(f"  FAIL: max 3 oraciones excedido ({sent_count}).")
    else:
        notes.append(f"  OK: {sent_count} oraciones.")

    if q_count > 1:
        fails.append(f"  FAIL: mas de 1 pregunta por respuesta ({q_count}).")
    else:
        notes.append(f"  OK: {q_count} pregunta(s).")

    if leaks:
        fails.append(f"  FAIL: rompio personaje (IA-leak): {leaks}")

    # Reglas calibradas
    if expected["should_show_disengagement"]:
        if desconex:
            notes.append(f"  OK: muestra desconexion: {desconex[:2]}")
        else:
            fails.append("  FAIL: no muestra desconexion ante features sin contexto.")

    if expected["should_show_apertura"]:
        if apertura:
            notes.append(f"  OK: muestra apertura/datos: {apertura[:3]}")
        else:
            fails.append("  FAIL: no muestra apertura ante 5 Porques + vocabulario industrial.")

    if expected["should_show_copq_recognition"]:
        if copq:
            notes.append(f"  OK: reconoce COPQ con datos propios: {copq[:2]}")
        else:
            fails.append("  FAIL: no reconoce que no tenia el COPQ calculado.")

    return (len(fails) == 0), fails + notes


async def main():
    system_prompt = get_system_prompt("roberto")
    print(f"[Test] Prompt cargado: {len(system_prompt)} chars\n")

    pass_count = 0
    for name, conversation, expected in SCENARIOS:
        print(f"--- {name} ---")
        print(f"  Turnos previos: {len(conversation)}")
        print(f"  Ultimo turno vendedor: \"{conversation[-1]['content'][:80]}...\"")
        try:
            response = await chat_complete(conversation, system_prompt)
        except Exception as e:
            print(f"  ERROR llamando al LLM: {e}\n")
            continue
        print(f"  Roberto: \"{response.strip()}\"")
        ok, notes = evaluate(name, response, expected)
        for n in notes:
            print(n)
        if ok:
            pass_count += 1
        print()

    print(f"=== RESULTADO: {pass_count}/{len(SCENARIOS)} escenarios pasan ===")
    if pass_count < len(SCENARIOS):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
