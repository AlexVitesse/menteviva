"""
Modelo UserProfile: perfil del usuario compuesto por identidad (registro)
y resultados del diagnostico BEI (generado por el LLM).

El contrato esta espejeado en menteviva-frontend/src/types/index.ts.
Cualquier cambio aqui debe reflejarse alla.
"""

from pydantic import BaseModel
from typing import Literal, Optional


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
    competencias_foco: list[str]
    strengths: list[Strength]
    gaps: list[Gap]
    blind_spot: str
    reflection_question: str
    verbal_patterns: VerbalPatterns
    recommended_next_scenario: RecommendedScenario
    recommended_next_level: RecommendedLevel


class UserProfile(BaseModel):
    """Perfil completo del usuario: registro + diagnostico (si existe)."""
    user_id: str
    created_at: str  # ISO8601
    updated_at: str  # ISO8601
    registro: Registro
    diagnostico: Optional[Diagnostico] = None
