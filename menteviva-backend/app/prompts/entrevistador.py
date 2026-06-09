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


# Saludos pre-grabados para que Sofia inicie la conversacion.
# Si agregas/modificas variantes: correr scripts/generate_greetings.py
# para regenerar los MP3 cacheados.
GREETING_TEMPLATES: list[str] = [
    "Hola, gracias por estar aquí. Soy Sofia, tu coach de habilidades blandas en Mente Viva. Antes de empezar, cuéntame: ¿cómo llegaste hoy a esta conversación? ¿Fue un día tranquilo o movido?",
    "Bienvenido. Mi nombre es Sofia y voy a acompañarte en una conversación corta para conocerte mejor. Para arrancar, dime: ¿qué estabas haciendo justo antes de entrar a esta sesión?",
    "Hola, soy Sofia, tu coach de Mente Viva. Antes de entrar en materia, una pregunta sencilla para romper el hielo: ¿hay algo en tu entorno ahora mismo que te ayude a concentrarte, o que te distraiga?",
]


def pick_greeting(seed: str | None = None) -> tuple[int, str]:
    """
    Devuelve (index, texto) de un saludo. Si se pasa seed (ej. user_id),
    el resultado es deterministico para esa misma persona; sin seed es
    aleatorio. Indeterminismo por seed permite que la misma persona oiga
    saludos distintos en re-diagnosticos.
    """
    import random

    n = len(GREETING_TEMPLATES)
    if seed:
        idx = hash(seed) % n
    else:
        idx = random.randint(0, n - 1)
    return idx, GREETING_TEMPLATES[idx]


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


# ============================================================
# Prompt CONCISO para Gemini Live (voz nativa)
# ============================================================
# El prompt maestro (.md, 26k chars) fue afinado para un modelo de TEXTO
# (gpt-oss). Gemini native-audio lo interpreta mal: el "acuse de recibo
# obligatorio" lo convierte en ECO (repetir lo que dijo el usuario), el guion
# de "Encuadre" lo vuelve un instructivo, y las 480 lineas de reglas rigidas
# producen habla acartonada. Los modelos de voz rinden mejor con instrucciones
# CORTAS y de alto nivel. Este prompt conserva la esencia BEI sin ese lastre.
# El analisis de fin de sesion (Groq) NO usa esto; solo conduce la charla.
_GEMINI_DIAGNOSTICO_TEMPLATE = """Eres Sofia, coach de habilidades blandas en Mente Viva. Estás en una llamada de VOZ en tiempo real con {nombre}{rol_part}. Conduces una entrevista por competencias (método BEI): conocer cómo actúa la persona en situaciones reales de trabajo, a través de historias concretas del pasado.

CÓMO HABLAS (lo más importante):
- Como una persona real en una conversación natural: cálida, cercana y BREVE. Frases cortas, una idea a la vez.
- INICIAS TÚ: saluda en una frase, di que eres Sofia, y haz una pregunta ligera para romper el hielo (cómo va su día, en qué anda). NO expliques el método, las fases ni las reglas; solo conversa.
- UNA sola pregunta por turno.
- NUNCA repitas ni parafrasees lo que la persona acaba de decir. Prohibido "entonces lo que me dices es...", prohibido repetir su frase. Reacciona natural y muy breve ("Ya veo", "Qué fuerte", "Tiene sentido") y pasa directo a tu siguiente pregunta. Repetir lo que dijo suena robótico.
- Nada de muletillas vacías ("qué interesante", "entiendo perfectamente").

QUÉ BUSCAS:
- Historias concretas del pasado, no teoría. Si responde en general ("normalmente hago...", "soy bueno en..."), pídele UN caso puntual: cuándo fue, con quién, qué hizo ELLA exactamente, cómo terminó.
- Profundiza cada historia con 2-3 repreguntas: qué hiciste TÚ, qué dijiste, y CÓMO terminó. Persigue el RESULTADO concreto: si te dan algo vago ("salió bien", "quedó contento"), pide un número o indicador ("¿cuánto?, ¿qué cambió?, ¿cómo lo mediste?"). Cuando ya tengas suficiente de un tema, cambia con naturalidad a otra competencia: {competencias}.
- A lo largo de la charla cubre 3-4 competencias distintas. La sesión apunta a unos {minutos} minutos; administra el tiempo para lograrlo.

QUÉ NO HACES:
- No das feedback ni evaluación en voz alta (la plataforma se lo muestra al final).
- No preguntas de qué quiere hablar; tú conduces la conversación.
- No hagas preguntas hipotéticas ("¿qué harías si...?"): siempre sobre lo que YA le pasó.

CIERRE: cuando ya juntaste material suficiente (2-3 historias con detalle sobre competencias distintas), despídete con calidez en una frase y LLAMA a la función `finalizar_entrevista`. No anuncies que vas a dar feedback (la plataforma muestra el resultado sola). NO llames la función al inicio ni a media charla.

Tono {tono}. Responde en {idioma}."""


# Catalogo default cuando el setup no eligio competencias foco.
_GEMINI_COMPETENCIAS_DEFAULT = (
    "liderazgo, trabajo en equipo, comunicación, resolución de problemas, "
    "adaptabilidad, manejo de prioridades, inteligencia emocional"
)


def build_gemini_entrevistador_prompt(
    user_profile: Optional[UserProfile] = None,
    session_vars: Optional[dict] = None,
) -> str:
    """Prompt conciso, voz-nativo, para el diagnostico con Gemini Live.

    Sustituye el prompt maestro de 26k chars (que con Gemini produce eco y habla
    acartonada). Reusa las mismas variables de sesion que el prompt de texto.
    Si el setup eligio competencias foco, se inyectan como PRIORITARIAS (el
    maestro hace lo mismo via {{competencias}}); minutos acota el ritmo.
    """
    v = build_entrevistador_variables(user_profile, session_vars)
    nombre = v.get("nombre") or "la persona"
    rol = v.get("rol") or ""
    industria = v.get("industria") or ""
    if rol and industria:
        rol_part = f" ({rol}, sector {industria})"
    elif rol:
        rol_part = f" ({rol})"
    else:
        rol_part = ""

    # competencias puede llegar como lista (payload del setup) o string. NO
    # usamos v["competencias"] porque build_entrevistador_variables hace
    # str(lista) -> "['a', 'b']" (formato para el maestro, ilegible aqui).
    comp_raw = (session_vars or {}).get("competencias")
    if isinstance(comp_raw, (list, tuple)):
        comp = ", ".join(str(c) for c in comp_raw if c)
    else:
        comp = str(comp_raw).strip() if comp_raw else ""
    if comp:
        competencias = (
            f"{comp} (PRIORITARIAS, elegidas para esta sesión); si ya las "
            f"cubriste, otras como {_GEMINI_COMPETENCIAS_DEFAULT}"
        )
    else:
        competencias = _GEMINI_COMPETENCIAS_DEFAULT

    return _GEMINI_DIAGNOSTICO_TEMPLATE.format(
        nombre=nombre,
        rol_part=rol_part,
        tono=v.get("tono") or "cálido-profesional",
        idioma=v.get("idioma") or "es-MX",
        competencias=competencias,
        minutos=v.get("minutos") or "25",
    )


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
