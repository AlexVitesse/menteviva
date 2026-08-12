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
import re
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


# ============================================================
# Politica de duracion: hace que 25 / 40 / 60 min NO sean el mismo guion
# ============================================================
# Antes, la duracion elegida solo cambiaba el numero {{minutos}} que el modelo
# "veia"; el disparador real del fin de la charla es la regla [CIERRE], que
# estaba fija en "2-3 competencias con STAR". Resultado: una sesion de 60 min
# cerraba igual que una de 25 (mismo umbral de contenido). Aqui derivamos de la
# duracion cuantas competencias exigir antes de poder cerrar y que tan profundo
# sondear, y lo inyectamos en el prompt (maestro y conciso de voz).
def build_duration_policy(minutos) -> dict:
    """
    Deriva de la duracion objetivo (min) la politica de cobertura/profundidad:
    - competencias_min: piso duro de competencias distintas antes de [CIERRE]
    - competencias_target: rango a apuntar (texto)
    - politica_duracion: instruccion completa de ritmo y profundidad de sondeo
    """
    try:
        m = int(float(minutos))
    except (TypeError, ValueError):
        m = 25

    if m <= 30:
        return {
            "minutos": m,
            "competencias_min": 2,
            "competencias_target": "2-3",
            "politica_duracion": (
                "Cubre 2-3 competencias distintas con 1-2 repreguntas BEI por "
                "historia. Prioriza amplitud sobre profundidad extrema: es mejor "
                "cerrar 3 historias solidas que agotar 1 sola. Puedes emitir "
                "[CIERRE] al reunir 2-3 competencias con STAR completo."
            ),
        }
    if m <= 50:
        return {
            "minutos": m,
            "competencias_min": 3,
            "competencias_target": "3-4",
            "politica_duracion": (
                "Cubre 3-4 competencias distintas con 2-3 repreguntas BEI por "
                "historia; en cada una persigue el resultado concreto (numeros, "
                "indicadores, que cambio exactamente). NO cierres antes de reunir "
                "3 competencias con STAR completo."
            ),
        }
    return {
        "minutos": m,
        "competencias_min": 4,
        "competencias_target": "4-5",
        "politica_duracion": (
            "Cubre 4-5 competencias distintas con sondeo profundo por historia: "
            "accion individual exacta, obstaculos, decisiones alternativas, un "
            "contraejemplo (una vez que salio mal) y el resultado medible. NO "
            "cierres antes de reunir 4 competencias con STAR completo; aprovecha "
            "el tiempo para profundizar, no para acelerar el cierre."
        ),
    }


# ============================================================
# Nota de estado de sesion: el "reloj" que el modelo no tiene
# ============================================================
# El LLM es stateless: en cada turno ve el historial pero nunca cuanto tiempo ha
# pasado, asi que "administra el tiempo" era una instruccion imposible de cumplir
# (el sintoma: Sofia conducia bien el BEI pero jamas señalizaba avance ni cerraba,
# a diferencia del GPT north-star que anuncia "ultima pregunta antes de cerrar").
# Esta nota se anexa al ultimo turno del usuario (texto) o se inyecta como
# contexto en la sesion Live (voz) para darle percepcion de avance y ordenes de
# ritmo concretas por tramo. Los prompts (maestro y conciso) explican que la nota
# es invisible para el candidato y prohiben mencionarla.


def target_exchanges(minutos: int) -> int:
    """Meta de intercambios (turnos del usuario) para una sesion de `minutos`.

    ~1 intercambio cada 3 min, minimo 4. DEBE ir en espejo con targetExchanges()
    de ChatLab.tsx: es el mismo denominador que completa la barra de progreso,
    para que cuando la barra llegue a 100% Sofia tambien entre en modo cierre.
    """
    return max(4, round(minutos / 3))


def build_session_state_note(
    minutos,
    elapsed_seconds: int | None = None,
    exchanges: int | None = None,
    *,
    cierre_como_tool: bool = False,
) -> str | None:
    """Control interno de ritmo con el avance de la sesion.

    - elapsed_seconds: tiempo real transcurrido (cronometro del frontend o del
      proxy de voz). None si no se conoce.
    - exchanges: turnos del usuario ya respondidos. En TEXTO conviene pasarlo
      (el usuario puede teclear mas rapido/lento que el ritmo hablado y la barra
      de progreso se completa por intercambios); en VOZ dejarlo en None (los
      turnos hablados son cortos y frecuentes — ahi el reloj manda solo).
    - cierre_como_tool: True cuando el cierre es via finalizar_entrevista (voz /
      prompt conciso); False cuando es via la marca [CIERRE] (prompt maestro).

    El avance es el MAXIMO de ambos porcentajes disponibles: quien llegue
    primero (tiempo o esfuerzo) empuja la entrevista hacia el cierre.
    Devuelve None si no hay ninguna señal con la que calcular el avance.
    """
    try:
        m = int(float(minutos))
    except (TypeError, ValueError):
        m = 25
    if m <= 0:
        m = 25

    pcts: list[float] = []
    if elapsed_seconds is not None and elapsed_seconds >= 0:
        pcts.append(elapsed_seconds / (m * 60))
    if exchanges is not None and exchanges >= 0:
        pcts.append(exchanges / target_exchanges(m))
    if not pcts:
        return None
    pct = max(pcts)

    if pct >= 0.9:
        cierre = (
            "llama a la función finalizar_entrevista"
            if cierre_como_tool
            else "agrega la marca [CIERRE] al final de tu mensaje"
        )
        guia = (
            "TIEMPO AGOTADO. Si aún no lo hiciste, anuncia que viene tu última "
            "pregunta ('Con esto tengo muy buen material; déjame hacerte una "
            "última pregunta antes de cerrar') y haz UNA pregunta final de "
            "reflexión (p. ej. qué historia le movió más al contarla). Si ya la "
            f"respondió, agradece con calidez, despídete y {cierre}. Esto aplica "
            "AUNQUE no hayas cubierto el mínimo de competencias: al final, el "
            "tiempo manda."
        )
    elif pct >= 0.75:
        guia = (
            "Tramo final. Si abres un tema nuevo, anúncialo como el último "
            "('para ir cerrando, pasemos a...'); no abras más de un tema nuevo. "
            "Después viene tu pregunta final de reflexión y el cierre."
        )
    elif pct >= 0.4:
        guia = (
            "Fase esperada: profundización BEI — persigue la acción individual "
            "y el resultado concreto de las historias; pivota si una se agota."
        )
    else:
        guia = (
            "Fase esperada: apertura breve y primeras historias — no te quedes "
            "en small talk."
        )

    minuto = min(int(round(pct * m)), m)
    pct_display = min(int(round(pct * 100)), 100)
    # Formato deliberadamente opaco: no contiene una frase humana que el modelo
    # pueda aprender e inventar en voz alta (hallazgo de pruebas largas).
    return (
        "<session_control hidden=\"true\" "
        f"minute=\"{minuto}\" target=\"{m}\" progress=\"{pct_display}\">"
        f"{guia}</session_control>"
    )


_INTERNAL_CONTROL_RE = re.compile(
    r"(?:\[NOTA DEL SISTEMA[^\]]*\]|<session_control\b[^>]*>.*?</session_control>)",
    flags=re.IGNORECASE | re.DOTALL,
)


def sanitize_interviewer_text(text: str) -> str:
    """Elimina controles internos y fuerza una sola pregunta visible.

    Es una defensa adicional para proveedores de texto. El prompt sigue siendo
    la defensa principal en audio nativo, donde el modelo sintetiza directamente.
    """
    clean = _INTERNAL_CONTROL_RE.sub("", text or "").strip()
    if clean.count("?") > 1:
        clean = clean[: clean.find("?") + 1].strip()
    return clean


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

    # Politica derivada de la duracion: parametriza la regla [CIERRE] del maestro
    # (competencias minimas + profundidad) para que 25/40/60 min difieran de
    # verdad, no solo en el numero {{minutos}} mostrado.
    policy = build_duration_policy(vars_dict.get("minutos"))
    vars_dict["competencias_min"] = str(policy["competencias_min"])
    vars_dict["competencias_target"] = policy["competencias_target"]
    vars_dict["politica_duracion"] = policy["politica_duracion"]

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
- Si la frase llega truncada, pregunta si quiere completarla. AMBIGÜEDAD: pide UNA precisión observable (qué resultado hubo, qué cambió o cómo lo midió); PROHIBIDO inventar opciones o reinterpretar sus palabras como versiones distintas. CONTRADICCIÓN: tu siguiente turno DEBE mencionar brevemente las dos versiones incompatibles y preguntar cuál describe mejor lo ocurrido; PROHIBIDO cambiar de tema, pivotar o hacer una pregunta nueva hasta aclararla. Nunca cierres por una sola respuesta corta, confusa, incongruente o fuera de tema: aclara una vez, reformula desde otro ángulo y luego pivota a otra competencia. Solo considera falta de material tras intentar 2-3 competencias distintas.
- La sesión apunta a unos {minutos} minutos; administra el tiempo para lograrlo. {politica_duracion}

RITMO Y SEÑALIZACIÓN (guía a la persona en el tiempo):
- La plataforma puede enviarte un bloque técnico `<session_control hidden="true">`. Es control interno, no diálogo: NUNCA generes, reproduzcas, describas ni inventes etiquetas, minutos o porcentajes. Úsalo solo para ajustar tu ritmo.
- Como un buen entrevistador humano, di dónde van: al entrar al último tema, anúncialo ("para ir cerrando, hablemos de..."); antes de terminar, anuncia tu última pregunta ("déjame hacerte una última pregunta") y haz UNA pregunta de reflexión: qué historia le movió más al contarla y por qué.

QUÉ NO HACES:
- No das feedback ni evaluación en voz alta (la plataforma se lo muestra al final).
- No preguntas de qué quiere hablar; tú conduces la conversación.
- No hagas preguntas hipotéticas ("¿qué harías si...?"): siempre sobre lo que YA le pasó.

CIERRE: cuando ya juntaste material suficiente ({competencias_target} historias con detalle sobre competencias distintas), usa DOS turnos: primero anuncia y haz UNA pregunta final de reflexión; solo después de escuchar la respuesta, despídete con calidez y LLAMA a `finalizar_entrevista`. PROHIBIDO hacer la pregunta final y llamar la función en el mismo turno. No cierres antes de {competencias_min} competencias con detalle — EXCEPTO si la nota del sistema indica que el tiempo se agotó: conserva los dos turnos y cierra con lo que tengas aunque no llegues al mínimo. No anuncies que vas a dar feedback. NO llames la función al inicio ni a media charla.

CONTROL DEL TURNO ACTUAL (ULTIMA REGLA, MAXIMA PRIORIDAD): antes de formular una pregunta nueva, compara la ultima respuesta con el historial. Elige SOLO UNA accion de recuperacion y formula EXACTAMENTE UNA pregunta. Si contradice una afirmacion anterior, NO pivotes: menciona ambas afirmaciones y pregunta cual ocurrio realmente. Si solo es ambigua, NO inventes interpretaciones: pide un resultado, cambio o medida concreta. Si quedo truncada, limitate a invitarla a completar; NO agregues otra pregunta de detalle. Estas recuperaciones tienen prioridad sobre variedad, ritmo y cambio de competencia.

VALIDACION FINAL DE SALIDA: cuenta los signos "?". Si hay mas de uno, conserva solo la pregunta mas importante y elimina las demas. Tu respuesta final debe contener como maximo un solo "?". Nunca respondas con texto vacio: ante silencio o turno vacio, di brevemente "Parece que no te escuche" y formula UNA invitacion para continuar.

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

    policy = build_duration_policy(v.get("minutos"))
    return _GEMINI_DIAGNOSTICO_TEMPLATE.format(
        nombre=nombre,
        rol_part=rol_part,
        tono=v.get("tono") or "cálido-profesional",
        idioma=v.get("idioma") or "es-MX",
        competencias=competencias,
        minutos=policy["minutos"],
        competencias_target=policy["competencias_target"],
        competencias_min=policy["competencias_min"],
        politica_duracion=policy["politica_duracion"],
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
