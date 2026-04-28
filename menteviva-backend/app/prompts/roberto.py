"""
Avatar "roberto": Roberto Garza, Director de Operaciones — escenario Cóndor.

Carga el system prompt desde roberto_prompt.md. El prompt vive en .md aparte
para poder editarlo sin tocar codigo Python y porque es largo (banco de
objeciones, reacciones calibradas, reglas absolutas).

Marco metodologico: PRAINCODERECI · Lean Six Sigma · 5 Porques Toyota · BPMN ·
KPIs Industriales (OEE/MTBF/MTTR/COPQ).
"""

from pathlib import Path


_PROMPT_PATH = Path(__file__).parent / "roberto_prompt.md"
ROBERTO_PROMPT: str = _PROMPT_PATH.read_text(encoding="utf-8")


def get_roberto_prompt() -> str:
    """System prompt estatico de Roberto-Condor (nivel Principiante v1)."""
    return ROBERTO_PROMPT
