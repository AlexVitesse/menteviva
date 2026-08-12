"""
Modelo UserProfile: perfil del usuario compuesto por identidad (registro)
y resultados del diagnostico BEI (generado por el LLM).

El contrato esta espejeado en menteviva-frontend/src/types/index.ts.
Cualquier cambio aqui debe reflejarse alla.
"""

from typing import Literal, Optional

from pydantic import BaseModel

ExperienceLevel = Literal["entry", "junior", "mid", "senior", "lead", "executive"]
VerbalTendency = Literal["alta", "media", "baja"]
# Carlos esta definido en el roadmap pero aun sin system_prompt ni rubrica,
# asi que no se recomienda. Agregar "carlos" cuando se implemente.
RecommendedScenario = Literal["roberto", "maria"]
RecommendedLevel = Literal["facil", "intermedio", "dificil"]


class Registro(BaseModel):
    """Identidad del usuario. Se captura una vez desde /registro."""
    nombre: str
    email: Optional[str] = None
    rol_objetivo: str
    industria: str
    experience_level: ExperienceLevel


class Strength(BaseModel):
    """Fortaleza observada con evidencia textual citable."""
    skill: str
    evidence: str
    why_matters: str


class Gap(BaseModel):
    """Area de oportunidad con micro-practica accionable."""
    skill: str
    evidence: str
    impact: str
    micro_practice: str


class VerbalPatterns(BaseModel):
    """Patrones linguisticos detectados durante el diagnostico."""
    vague_verbs_detected: list[str] = []
    we_vs_i_tendency: VerbalTendency
    filler_frequency: VerbalTendency


class Diagnostico(BaseModel):
    """Resultado del diagnostico BEI. Generado por el LLM al cerrar /diagnostico."""
    completed_at: str  # ISO8601
    # Narrativa-espejo de apertura (2-5 frases): caracteriza a la persona y
    # NOMBRA el patron dominante que emergio en la entrevista. Es la pieza que
    # el dueño de producto destaco del GPT de referencia ("el resumen
    # diagnostico me parecio genial"). Optional con default "" por
    # retrocompatibilidad con perfiles ya guardados antes de existir el campo.
    resumen_ejecutivo: str = ""
    competencias_foco: list[str]
    strengths: list[Strength]
    gaps: list[Gap]
    blind_spot: str
    reflection_question: str
    # Nota final cálida "como coach" (analoga a la "Observacion adicional como
    # coach" del GPT de referencia): retoma una frase concreta que dijo la
    # persona y le da una perspectiva alentadora y humana. Cierra el diagnostico
    # en tono de acompañamiento, no de evaluacion. Optional (default "") por
    # retrocompatibilidad con perfiles guardados antes de existir el campo.
    coach_note: str = ""
    verbal_patterns: VerbalPatterns
    recommended_next_scenario: RecommendedScenario
    recommended_next_level: RecommendedLevel
    # True cuando la sesion fue muy corta (<4 intercambios) y el diagnostico
    # es un placeholder, no un analisis real. El frontend muestra un aviso.
    is_demo: bool = False


class UserProfile(BaseModel):
    """Perfil completo del usuario: registro + diagnostico (si existe)."""
    user_id: str
    created_at: str  # ISO8601
    updated_at: str  # ISO8601
    registro: Registro
    diagnostico: Optional[Diagnostico] = None
