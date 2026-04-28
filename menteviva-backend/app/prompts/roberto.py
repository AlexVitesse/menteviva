"""
Avatar "roberto": Roberto Garza, Director de Operaciones — escenario Cóndor.

El system prompt se ensambla en runtime: roberto_base.md (identidad, personalidad,
reglas absolutas, formato de respuesta) + roberto_{nivel}.md (módulo de
dificultad: vocabulario esperado, banco de objeciones, reacciones calibradas,
criterios de cesión).

Niveles soportados: "principiante" (default), "intermedio", "avanzado".

Marco metodológico: PRAINCODERECI · Lean Six Sigma · 5 Porques Toyota · BPMN ·
KPIs Industriales (OEE/MTBF/MTTR/COPQ).
"""

from pathlib import Path

VALID_LEVELS = {"principiante", "intermedio", "avanzado"}

_PROMPTS_DIR = Path(__file__).parent
_BASE_PATH = _PROMPTS_DIR / "roberto_base.md"

# Cache: leemos los .md una vez al import. Si quieres reload en dev, reinicia
# uvicorn. Esto evita IO en cada apertura de sesion.
_BASE: str = _BASE_PATH.read_text(encoding="utf-8")
_LEVEL_MODULES: dict[str, str] = {
    level: (_PROMPTS_DIR / f"roberto_{level}.md").read_text(encoding="utf-8")
    for level in VALID_LEVELS
}


def get_roberto_prompt(level: str = "principiante") -> str:
    """
    System prompt de Roberto-Cóndor para el nivel pedido.

    Args:
        level: "principiante" | "intermedio" | "avanzado". Cualquier valor
            invalido cae a "principiante" (silencioso, no rompe sesion).

    Returns:
        Prompt completo: base + módulo del nivel.
    """
    if level not in VALID_LEVELS:
        level = "principiante"
    return f"{_BASE}\n\n{_LEVEL_MODULES[level]}"


# Backwards-compat: codigo viejo importa ROBERTO_PROMPT como string estatico.
ROBERTO_PROMPT: str = get_roberto_prompt("principiante")
