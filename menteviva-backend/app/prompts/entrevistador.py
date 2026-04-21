"""
Avatar "entrevistador": diagnostico BEI previo a las pruebas.

Carga el prompt maestro (Behavioral Event Interview + STAR + Creswell) desde
entrevistador_prompt.md y expone helpers para sustituir variables de sesion
({{nombre}}, {{rol}}, {{industria}}, {{nivel}}, {{idioma}}, {{minutos}},
{{competencias}}, {{tono}}).

El prompt vive en .md aparte por tamano (~14 KB) y para que sea editable sin
tocar codigo Python.
"""

from pathlib import Path
from typing import Optional

from app.models.user_profile import UserProfile


_PROMPT_PATH = Path(__file__).parent / "entrevistador_prompt.md"
ENTREVISTADOR_PROMPT_TEMPLATE: str = _PROMPT_PATH.read_text(encoding="utf-8")


# Valores por defecto para variables del prompt maestro.
# Si alguna llega vacia, la seccion 1 del prompt indica que el avatar la infiere
# durante rapport, pero damos defaults razonables para no dejar huecos visibles.
_DEFAULT_VARIABLES: dict[str, str] = {
    "nombre": "",
    "rol": "",
    "industria": "",
    "nivel": "",
    "idioma": "es-MX",
    "minutos": "25",
    "competencias": "",
    "tono": "calido-profesional",
}


def render_prompt_variables(template: str, variables: dict[str, str]) -> str:
    """
    Sustituye {{clave}} por su valor en el template. Claves no presentes en
    variables quedan sin tocar (el prompt mismo indica que el avatar las infiere).
    """
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", str(value))
    return rendered


def build_entrevistador_variables(
    user_profile: Optional[UserProfile] = None,
    session_vars: Optional[dict] = None,
) -> dict[str, str]:
    """
    Construye el dict de variables para el prompt maestro combinando:
    - registro del user_profile (nombre, rol_objetivo, industria, experience_level)
    - session_vars de /diagnostico/setup (idioma, tono, minutos, competencias)
    - defaults en _DEFAULT_VARIABLES para los huecos restantes
    """
    vars_dict = dict(_DEFAULT_VARIABLES)

    if user_profile and user_profile.registro:
        r = user_profile.registro
        vars_dict["nombre"] = r.nombre
        vars_dict["rol"] = r.rol_objetivo
        vars_dict["industria"] = r.industria
        vars_dict["nivel"] = r.experience_level

    if session_vars:
        for key in ("idioma", "tono", "minutos", "competencias"):
            value = session_vars.get(key)
            if value:
                vars_dict[key] = str(value)

    return vars_dict


def get_entrevistador_prompt(
    user_profile: Optional[UserProfile] = None,
    session_vars: Optional[dict] = None,
) -> str:
    """System prompt final del entrevistador con variables ya sustituidas."""
    variables = build_entrevistador_variables(user_profile, session_vars)
    return render_prompt_variables(ENTREVISTADOR_PROMPT_TEMPLATE, variables)


def build_user_context_block(user_profile: UserProfile) -> str:
    """
    Bloque de contexto que se inyecta al final del system_prompt de los avatares
    de PRUEBA (Roberto, Maria, Carlos) cuando el usuario ya tiene diagnostico.
    Hace que el avatar presione las brechas especificas, no un patron generico.
    """
    d = user_profile.diagnostico
    if d is None:
        return ""

    foco = ", ".join(d.competencias_foco) if d.competencias_foco else "sin foco definido"
    vague = (
        ", ".join(d.verbal_patterns.vague_verbs_detected)
        if d.verbal_patterns.vague_verbs_detected
        else "ninguno detectado"
    )

    return (
        "\n\n"
        "CONTEXTO DEL USUARIO (de diagnostico previo):\n"
        f"- Brechas a estresar en esta prueba: {foco}\n"
        f'- Punto ciego observado: "{d.blind_spot}"\n'
        f"- Tics verbales a cazar si aparecen: {vague}\n"
        f'- Tendencia a decir "nosotros" en vez de "yo": {d.verbal_patterns.we_vs_i_tendency}\n'
        "Presiona especialmente esas dimensiones. Si detectas los tics verbales, "
        "repregunta para forzar que hable en primera persona con acciones concretas."
    )
