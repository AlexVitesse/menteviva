"""
Avatar "celeste": Celeste Vargas — Clínica de Ventas (cliente difícil genérico).

Puerto del GEM de Gemini que Brandon validó a mano ("MenteViva_GEM_GEMINI_Ventas
_Instructions"). A diferencia de Roberto (contexto fijo de manufactura Cóndor),
Celeste se calibra al rubro que el vendedor traiga: en su primer turno pregunta
qué vende, a quién, a qué precio y qué etapa quiere practicar (Paso 0), y de ahí
en adelante no sale de personaje hasta el feedback final.

Existe en paralelo a Roberto a propósito: los dos son CAT-01 Ventas y el punto es
compararlos en los labs (/chat-lab) con el mismo motor y el mismo nivel.

El prompt es un solo .md con el marcador {{NIVEL}}; aquí se sustituye por el
bloque del nivel pedido para no mandarle los tres al modelo.
"""

from pathlib import Path

VALID_LEVELS = {"principiante", "intermedio", "avanzado"}

_TEMPLATE: str = (Path(__file__).parent / "celeste.md").read_text(encoding="utf-8")

_LEVELS = {
    "principiante": (
        "PRINCIPIANTE (~15 min): escéptica pero no hostil. Solo 2 objeciones "
        "(precio + tiempo). Tus señales de apertura son visibles. Cierras si el "
        "vendedor resolvió las 2 objeciones, hizo al menos una pregunta de "
        "necesidad y llegó a intentar un cierre."
    ),
    "intermedio": (
        "INTERMEDIO (~20 min): ya tienes una propuesta de un competidor y lo "
        "mencionas al abrir. 3 objeciones encadenadas (precio → confianza → "
        "tiempo). Si te ofrece descuento sin haber demostrado valor, subes la "
        "presión. Cierras solo si agenda un siguiente paso con fecha concreta."
    ),
    "avanzado": (
        "AVANZADO (~25 min): abres exigiendo 30% de descuento (\"mi directora "
        "financiera me lo pidió\"). 5 objeciones. Dices que NO al primer intento "
        "de cierre aunque la propuesta sea buena. Solo cedes con un descuento "
        "máximo de 15% CON contraprestación y con la confianza ya construida."
    ),
}


def get_celeste_prompt(level: str = "principiante") -> str:
    """System prompt de Celeste con el bloque del nivel pedido sustituido."""
    if level not in VALID_LEVELS:
        level = "principiante"
    return _TEMPLATE.replace("{{NIVEL}}", _LEVELS[level])
