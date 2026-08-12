"""
Avatar "roberto": Roberto Garza, Director de Operaciones — escenario Cóndor.

El system prompt se ensambla en runtime: roberto_base.md (identidad y contexto)
+ roberto_{nivel}.md (dificultad) + roberto_caso_{caso}.md (objetivo concreto).
El módulo de caso se coloca al final para que sus reglas de conducción tengan
prioridad sobre las reglas generales del nivel.

Niveles soportados: "principiante" (default), "intermedio", "avanzado".

Marco metodológico: PRAINCODERECI · Lean Six Sigma · 5 Porques Toyota · BPMN ·
KPIs Industriales (OEE/MTBF/MTTR/COPQ).
"""

from pathlib import Path

VALID_LEVELS = {"principiante", "intermedio", "avanzado"}
VALID_SALES_CASES = {"descubrimiento", "objeciones"}

_PROMPTS_DIR = Path(__file__).parent
_BASE_PATH = _PROMPTS_DIR / "roberto_base.md"

# Cache: leemos los .md una vez al import. Si quieres reload en dev, reinicia
# uvicorn. Esto evita IO en cada apertura de sesion.
_BASE: str = _BASE_PATH.read_text(encoding="utf-8")
_LEVEL_MODULES: dict[str, str] = {
    level: (_PROMPTS_DIR / f"roberto_{level}.md").read_text(encoding="utf-8")
    for level in VALID_LEVELS
}
_CASE_MODULES: dict[str, str] = {
    sales_case: (_PROMPTS_DIR / f"roberto_caso_{sales_case}.md").read_text(
        encoding="utf-8"
    )
    for sales_case in VALID_SALES_CASES
}


def get_roberto_prompt(
    level: str = "principiante",
    sales_case: str = "descubrimiento",
) -> str:
    """
    System prompt de Roberto-Cóndor para el nivel pedido.

    Args:
        level: "principiante" | "intermedio" | "avanzado".
        sales_case: "descubrimiento" | "objeciones". Roberto siempre conserva
            el contexto fijo de manufactura; esto solo cambia el ejercicio.

    Returns:
        Prompt completo: base + módulo del nivel + módulo del caso.
    """
    if level not in VALID_LEVELS:
        level = "principiante"
    if sales_case not in VALID_SALES_CASES:
        sales_case = "descubrimiento"
    return f"{_BASE}\n\n{_LEVEL_MODULES[level]}\n\n{_CASE_MODULES[sales_case]}"


# Backwards-compat: codigo viejo importa ROBERTO_PROMPT como string estatico.
ROBERTO_PROMPT: str = get_roberto_prompt("principiante")
