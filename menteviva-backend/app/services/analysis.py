"""
Servicio de analisis de conversaciones usando LLM con razonamiento.

Evalua habilidades blandas basado en la conversacion y el escenario.

Dos entry points principales:
- analyze_conversation(): analisis post-PRUEBA (Roberto/Maria/Carlos),
  produce scores por habilidad del SKILLS_BY_SCENARIO.
- generate_user_profile(): analisis post-DIAGNOSTICO (entrevistador),
  produce el bloque 'diagnostico' del UserProfile (strengths/gaps/blind_spot
  con evidencia textual, conforme a la seccion 11 del prompt maestro).
"""

import json
import logging
from datetime import datetime, timezone

from app.config import settings
from app.models.user_profile import Diagnostico, Registro, VerbalPatterns
from app.prompts.scenarios import get_avatar
from app.services.groq_pool import get_groq_client

logger = logging.getLogger("menteviva")

# Definicion de habilidades por escenario
SKILLS_BY_SCENARIO = {
    "roberto": {
        "scenario_type": "Venta Consultiva B2B",
        "skills": [
            {
                "id": "escucha_activa",
                "name": "Escucha Activa",
                "description": "Demuestra atencion genuina, hace preguntas de seguimiento, parafrasea"
            },
            {
                "id": "manejo_objeciones",
                "name": "Manejo de Objeciones",
                "description": "Responde a objeciones sin ponerse defensivo, usa tecnicas de reencuadre"
            },
            {
                "id": "rapport",
                "name": "Construccion de Rapport",
                "description": "Genera conexion personal, usa el nombre del cliente, muestra empatia"
            },
            {
                "id": "claridad",
                "name": "Claridad de Propuesta",
                "description": "Explica beneficios claramente, adapta el mensaje al cliente, es conciso"
            },
            {
                "id": "cierre",
                "name": "Cierre Efectivo",
                "description": "Propone siguiente paso concreto, maneja la urgencia sin presionar"
            }
        ]
    },
    "maria": {
        "scenario_type": "Negociacion de Contrato",
        "skills": [
            {
                "id": "defensa_valor",
                "name": "Defensa de Valor",
                "description": "Defiende el valor del producto sin ceder facilmente, justifica el precio"
            },
            {
                "id": "negociacion_winwin",
                "name": "Negociacion Win-Win",
                "description": "Busca acuerdos mutuamente beneficiosos, ofrece concesiones inteligentes"
            },
            {
                "id": "manejo_presion",
                "name": "Manejo de Presion",
                "description": "Mantiene la calma ante tacticas de presion, no cede por panico"
            },
            {
                "id": "creatividad",
                "name": "Creatividad en Soluciones",
                "description": "Propone alternativas, piensa fuera de la caja, ofrece opciones"
            },
            {
                "id": "cierre",
                "name": "Cierre Efectivo",
                "description": "Cierra con terminos claros, confirma acuerdos, establece siguientes pasos"
            }
        ]
    }
}


ANALYSIS_PROMPT_TEMPLATE = """Eres un coach experto en habilidades de comunicacion y ventas.
Tu tarea es analizar una conversacion de practica y dar feedback detallado y constructivo.

## ESCENARIO
Tipo: {scenario_type}
Cliente/Contraparte: {avatar_name} - {avatar_role} en {avatar_company}
Personalidad del cliente: {avatar_personality}

## HABILIDADES A EVALUAR
{skills_list}

## CONVERSACION
{conversation}

## INSTRUCCIONES
Analiza la conversacion evaluando cada habilidad. Se especifico y cita ejemplos concretos.

Responde UNICAMENTE con un JSON valido con esta estructura exacta:
{{
    "overall_score": <numero 0-100>,
    "overall_summary": "<resumen de 2-3 oraciones del desempeno general>",
    "skills": [
        {{
            "id": "<id_habilidad>",
            "name": "<nombre_habilidad>",
            "score": <numero 0-100>,
            "feedback": "<feedback especifico de 2-3 oraciones>",
            "moment": "<cita textual de la conversacion que ejemplifica esta habilidad, o null si no hay ejemplo>"
        }}
    ],
    "strengths": ["<fortaleza 1>", "<fortaleza 2>"],
    "improvements": ["<area de mejora 1>", "<area de mejora 2>"],
    "key_moments": [
        {{
            "quote": "<cita de la conversacion>",
            "analysis": "<porque fue bueno o malo>",
            "type": "positive" | "negative" | "neutral"
        }}
    ],
    "next_steps": ["<recomendacion accionable 1>", "<recomendacion accionable 2>"]
}}

IMPORTANTE:
- Puntuaciones: 0-40 = Necesita trabajo, 41-60 = En desarrollo, 61-80 = Competente, 81-100 = Excelente
- Se honesto pero constructivo. El objetivo es ayudar a mejorar.
- Cita ejemplos especificos de la conversacion
- Si la conversacion es muy corta, indica que necesitas mas interacciones para evaluar
- Responde SOLO con el JSON, sin texto adicional"""


async def analyze_conversation(
    avatar_id: str,
    conversation: list[dict],
    duration_seconds: int = 0
) -> dict:
    """
    Analiza una conversacion usando el modelo de razonamiento.

    Args:
        avatar_id: ID del avatar (determina el escenario)
        conversation: Lista de mensajes [{"role": "user", "content": "..."}, ...]
        duration_seconds: Duracion de la sesion en segundos

    Returns:
        Diccionario con el analisis completo
    """
    logger.info(f"[Analysis] Iniciando analisis - Avatar: {avatar_id}, Mensajes: {len(conversation)}")

    # Obtener datos del escenario
    avatar = get_avatar(avatar_id)
    if not avatar:
        logger.error(f"[Analysis] Avatar no encontrado: {avatar_id}")
        return _empty_analysis("Avatar no encontrado")

    skills_config = SKILLS_BY_SCENARIO.get(avatar_id)
    if not skills_config:
        logger.error(f"[Analysis] Configuracion de habilidades no encontrada: {avatar_id}")
        return _empty_analysis("Configuracion no encontrada")

    # Verificar conversacion minima - si hay menos de 4-5 intercambios, usar demo
    min_exchanges = 4
    actual_exchanges = len(conversation) // 2

    if actual_exchanges < min_exchanges:
        logger.info(f"[Analysis] Conversacion corta ({actual_exchanges} intercambios), generando analisis demo")
        return _demo_analysis(avatar_id, skills_config, actual_exchanges, duration_seconds)

    # Formatear conversacion para el prompt
    conversation_text = _format_conversation(conversation)

    # Formatear lista de habilidades
    skills_list = "\n".join([
        f"- {s['name']}: {s['description']}"
        for s in skills_config["skills"]
    ])

    # Construir prompt
    prompt = ANALYSIS_PROMPT_TEMPLATE.format(
        scenario_type=skills_config["scenario_type"],
        avatar_name=avatar["name"],
        avatar_role=avatar["role"],
        avatar_company=avatar["company"],
        avatar_personality=avatar["personality"],
        skills_list=skills_list,
        conversation=conversation_text
    )

    try:
        logger.info(f"[Analysis] Llamando a Groq con modelo: {settings.groq_model_analysis}")

        client = get_groq_client()
        response = client.chat.completions.create(
            model=settings.groq_model_analysis,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,  # Baja temperatura para respuestas mas consistentes
            max_tokens=2000,
            response_format={"type": "json_object"}
        )

        result_text = response.choices[0].message.content
        logger.debug(f"[Analysis] Respuesta raw: {result_text[:500]}...")

        # Parsear JSON
        analysis = json.loads(result_text)

        # Agregar metadatos
        analysis["avatar_id"] = avatar_id
        analysis["scenario_type"] = skills_config["scenario_type"]
        analysis["total_exchanges"] = len(conversation) // 2
        analysis["duration_seconds"] = duration_seconds

        logger.info(f"[Analysis] Analisis completado - Score: {analysis.get('overall_score', 'N/A')}")
        return analysis

    except json.JSONDecodeError as e:
        logger.error(f"[Analysis] Error parseando JSON: {e}")
        return _empty_analysis("Error al procesar el analisis")
    except Exception as e:
        logger.error(f"[Analysis] Error en analisis: {e}", exc_info=True)
        return _empty_analysis(f"Error: {str(e)}")


def _format_conversation(conversation: list[dict], max_chars: int = 8000) -> str:
    """
    Formatea la conversacion para incluir en el prompt.
    Si es muy larga, la trunca manteniendo inicio y fin.
    """
    lines = []
    for msg in conversation:
        role = "USUARIO" if msg["role"] == "user" else "CLIENTE"
        lines.append(f"{role}: {msg['content']}")

    full_text = "\n".join(lines)

    # Si cabe completa, retornar
    if len(full_text) <= max_chars:
        return full_text

    # Si es muy larga, mantener inicio y fin
    logger.info(f"[Analysis] Conversacion larga ({len(full_text)} chars), truncando...")

    # Tomar primeros y ultimos intercambios
    half = max_chars // 2
    truncated = (
        full_text[:half] +
        "\n\n[... conversacion truncada para brevedad ...]\n\n" +
        full_text[-half:]
    )
    return truncated


def _empty_analysis(reason: str) -> dict:
    """Retorna un analisis vacio con razon."""
    return {
        "overall_score": 0,
        "overall_summary": reason,
        "skills": [],
        "strengths": [],
        "improvements": [],
        "key_moments": [],
        "next_steps": ["Completa una sesion mas larga para obtener un analisis detallado"],
        "error": True
    }


def _demo_analysis(avatar_id: str, skills_config: dict, exchanges: int, duration_seconds: int) -> dict:
    """
    Genera un analisis demo realista para sesiones cortas.
    Esto permite mostrar el formato completo del reporte aunque la conversacion sea breve.
    """
    import random

    # Generar scores variados pero realistas para demo
    base_score = random.randint(62, 78)

    skills_analysis = []
    for skill in skills_config["skills"]:
        # Variar score alrededor del base para que sea realista
        skill_score = max(45, min(95, base_score + random.randint(-15, 15)))

        # Feedbacks demo por habilidad
        demo_feedbacks = {
            "escucha_activa": "Demostraste interes haciendo preguntas de seguimiento. Considera parafrasear mas las respuestas del cliente para confirmar entendimiento.",
            "manejo_objeciones": "Manejaste las objeciones iniciales con calma. Podrias profundizar mas en entender la raiz de las preocupaciones antes de responder.",
            "rapport": "Buen uso del nombre del cliente y tono profesional. Intenta encontrar puntos de conexion personal para fortalecer la relacion.",
            "claridad": "Tu propuesta fue clara y directa. Recuerda adaptar el nivel de detalle tecnico segun las senales del cliente.",
            "cierre": "Propusiste un siguiente paso concreto. Considera manejar mejor la urgencia sin parecer presionado.",
            "defensa_valor": "Defendiste el valor de tu propuesta con argumentos solidos. Evita ceder demasiado rapido ante la primera objecion de precio.",
            "negociacion_winwin": "Mostraste disposicion a encontrar soluciones. Explora mas opciones creativas antes de hacer concesiones.",
            "manejo_presion": "Mantuviste la compostura ante la presion. Practica tecnicas de pausa para ganar tiempo cuando necesites pensar.",
            "creatividad": "Ofreciste algunas alternativas. Prepara un menu de opciones antes de la negociacion para tener mas flexibilidad."
        }

        feedback = demo_feedbacks.get(
            skill["id"],
            f"Tu desempeno en {skill['name'].lower()} fue adecuado. Continua practicando para mejorar la fluidez."
        )

        skills_analysis.append({
            "id": skill["id"],
            "name": skill["name"],
            "score": skill_score,
            "feedback": feedback,
            "moment": None  # En demo no tenemos citas reales
        })

    # Ordenar por score para identificar fortalezas y areas de mejora
    sorted_skills = sorted(skills_analysis, key=lambda x: x["score"], reverse=True)

    strengths = [
        f"Buena base en {sorted_skills[0]['name'].lower()}",
        f"Actitud profesional y receptiva durante la conversacion",
    ]

    improvements = [
        f"Profundizar en {sorted_skills[-1]['name'].lower()}",
        "Practicar sesiones mas largas para desarrollar ritmo conversacional",
    ]

    key_moments = [
        {
            "quote": "Sesion de practica - modo demo",
            "analysis": "Esta es una sesion de demostracion. Para un analisis completo con citas reales, completa al menos 4-5 intercambios.",
            "type": "neutral"
        }
    ]

    next_steps = [
        "Completa una sesion de 5+ intercambios para obtener feedback mas detallado",
        f"Enfocate en mejorar '{sorted_skills[-1]['name']}' en tu proxima practica",
        "Revisa las tecnicas de escucha activa antes de tu siguiente sesion"
    ]

    return {
        "overall_score": base_score,
        "overall_summary": f"Sesion de practica breve ({exchanges} intercambios). Mostraste buena disposicion y profesionalismo. Para un analisis mas profundo, te recomendamos sesiones de al menos 4-5 intercambios donde puedas desarrollar mejor cada habilidad.",
        "skills": skills_analysis,
        "strengths": strengths,
        "improvements": improvements,
        "key_moments": key_moments,
        "next_steps": next_steps,
        "avatar_id": avatar_id,
        "scenario_type": skills_config["scenario_type"],
        "total_exchanges": exchanges,
        "duration_seconds": duration_seconds,
        "is_demo": True  # Flag para indicar que es analisis demo
    }


# ============================================================
# Diagnostico post-entrevistador (M2)
# Implementa el output final del prompt maestro (secciones 10 y 11).
# ============================================================

# Catalogo de habilidades blandas del prompt maestro seccion 10.
# Cada entry tiene evidencia positiva + senal de brecha (comportamiento observable).
SOFT_SKILLS_CATALOG = [
    {
        "id": "comunicacion",
        "name": "Comunicacion",
        "positive": "Estructura idea-ejemplo-cierre; adapta vocabulario al interlocutor.",
        "gap": "Divaga, usa jergas sin contexto, no sintetiza.",
    },
    {
        "id": "autoconciencia",
        "name": "Autoconciencia",
        "positive": "Distingue su rol del rol del equipo; reconoce errores sin culpar.",
        "gap": "Usa 'nosotros' evasivo, externaliza responsabilidad.",
    },
    {
        "id": "inteligencia_emocional",
        "name": "Inteligencia emocional",
        "positive": "Nombra emociones propias y ajenas; describe como las gestiono.",
        "gap": "Minimiza el componente humano; respuesta puramente tecnica.",
    },
    {
        "id": "trabajo_en_equipo",
        "name": "Trabajo en equipo",
        "positive": "Describe como sumo al grupo y como recibio aportes de otros.",
        "gap": "Protagonismo excesivo o invisibilidad total en el equipo.",
    },
    {
        "id": "liderazgo",
        "name": "Liderazgo / influencia",
        "positive": "Describe como movio a otros sin imponer.",
        "gap": "Autoridad por cargo; o ausencia de iniciativa.",
    },
    {
        "id": "resolucion_problemas",
        "name": "Resolucion de problemas",
        "positive": "Diagnostico - opciones consideradas - decision - revision.",
        "gap": "Salta a la solucion sin explicar el analisis.",
    },
    {
        "id": "pensamiento_critico",
        "name": "Pensamiento critico",
        "positive": "Cuestiona supuestos, pide datos, cambia de opinion con evidencia.",
        "gap": "Respuestas dogmaticas; no separa hecho de interpretacion.",
    },
    {
        "id": "adaptabilidad",
        "name": "Adaptabilidad / aprendizaje",
        "positive": "Cuenta un cambio real en su comportamiento tras un error o nuevo contexto.",
        "gap": "Repite patron; aprende la teoria, no el habito.",
    },
    {
        "id": "orientacion_resultados",
        "name": "Orientacion a resultados",
        "positive": "Define la meta en terminos medibles; cierra el ciclo con outcome.",
        "gap": "Procesos sin metrica; no sabe si logro lo que buscaba.",
    },
    {
        "id": "gestion_prioridades",
        "name": "Gestion de prioridades",
        "positive": "Criterio explicito para decidir que si y que no.",
        "gap": "Responde 'todo era urgente' sin filtros.",
    },
]


USER_PROFILE_PROMPT_TEMPLATE = """Eres un coach experto en diagnostico de habilidades blandas.
Acabas de conducir una entrevista por competencias (metodologia BEI + STAR) al
candidato {nombre}. Tu tarea es analizar la conversacion y producir un diagnostico
estructurado que se le dara al candidato como espejo de lo observado.

## PERFIL DEL CANDIDATO
- Nombre: {nombre}
- Rol objetivo: {rol}
- Industria: {industria}
- Nivel de experiencia: {nivel}

## CATALOGO DE HABILIDADES (usa estos IDs, no inventes otros)
{skills_catalog}

## CONVERSACION COMPLETA
{conversation}

## EVALUACION DE LA CONVERSACION

Antes de analizar, verifica si el candidato realmente entrego material evaluable:
- ¿Dio al menos 2 historias concretas con contexto, accion y resultado?
- ¿Respondio con ejemplos especificos o solo con teoria/generalidades?
- ¿Respondio las repreguntas de profundizacion o evadio?

Si la conversacion fue superficial (respuestas teoricas, sin ejemplos concretos,
sin profundizacion exitosa), el blind_spot debe reflejar este patron ("el candidato
se mantuvo en abstracto", "evito dar ejemplos personales", etc.) y los gaps deben
incluir "claridad narrativa" o "autoconciencia" segun corresponda. No inventes
fortalezas si no las hay — mejor menos strengths que strengths sin evidencia.

## REGLAS INVIOLABLES (seccion 11 del prompt maestro)

1. EVIDENCIA TEXTUAL OBLIGATORIA. Cada strength y gap DEBE citar una frase real
   del candidato como 'evidence'. Si no hay cita que respalde una observacion,
   NO la incluyas. Mejor 2 fortalezas con evidencia que 5 genericas.

   PROHIBIDO: "evidence" que describa ausencia ("No se menciono X", "No hubo Y",
   "El candidato no hizo Z"). Eso no es evidencia, es falta de ella. Si no
   encuentras una frase real del candidato que respalde el gap, NO incluyas
   ese gap. Si solo detectas 1 gap con evidencia real, devuelve solo 1 gap.

   STRENGTHS REQUIEREN EJEMPLO CONCRETO (no solo afirmacion). Una habilidad se
   marca como strength SOLO si el candidato dio un momento especifico con
   situacion + accion + resultado. Si solo afirmo la habilidad en abstracto
   ("desarrolle comunicacion", "soy bueno negociando") sin historia respaldando,
   NO la incluyas en strengths. En su lugar, agrega "claridad narrativa" o la
   habilidad afirmada a gaps con micro_practice de contar un caso real con STAR.

2. CONDUCTA, NO ETIQUETA. Describe lo que OBSERVASTE.
   Malo: "eres desordenado" / "tienes baja autoestima" / "eres tecnico".
   Bueno: "no mencionaste metricas en ningun ejemplo" / "usaste 'nosotros' al
   explicar tu rol individual en el proyecto X".

3. MICRO-PRACTICA ACCIONABLE. Cada gap tiene 'micro_practice': un ejercicio
   concreto para esta semana. Ejemplo: "grabate contando un caso personal y
   cuenta cuantas veces dices 'nosotros' vs 'yo'; repite hasta lograr 80% 'yo'".

4. BLIND SPOT CON CUIDADO. UNA sola observacion que el candidato probablemente
   no vio de si mismo. Basada en evidencia. Sin etiquetas de personalidad.
   Humano, no juez.

5. PREGUNTA PARA LLEVARSE. Una pregunta abierta que invite a reflexionar
   despues. No una pregunta cerrada de si/no.

6. LIMITES: maximo 3 strengths, maximo 3 gaps. Calidad sobre cantidad.

7. COMPETENCIAS_FOCO (3-6 ids del catalogo): las habilidades que este usuario
   debe trabajar prioritariamente en sus siguientes sesiones de practica.

8. RECOMMENDED_NEXT_SCENARIO: elige solo entre "roberto" y "maria".
   - "roberto": venta consultiva B2B. Bueno para practicar manejo_objeciones,
     comunicacion, pensamiento_critico, resolucion_problemas.
   - "maria": negociacion de contrato. Bueno para orientacion_resultados,
     gestion_prioridades, adaptabilidad, inteligencia_emocional.

9. RECOMMENDED_NEXT_LEVEL: "facil" | "intermedio" | "dificil" segun la madurez
   conductual observada. Si las brechas son grandes o basicas, empezar "facil".

10. PATRONES VERBALES observables en la conversacion. Analiza literalmente los
    mensajes del candidato (rol=user):

    - vague_verbs_detected: revisa CADA mensaje del candidato y lista los
      verbos genericos que haya usado (gestione, maneje, coordine, hice,
      logramos, utilice, trabaje, participe, encargue). Si no encuentras
      ninguno, lista vacia. No inventes.

    - we_vs_i_tendency: cuenta mentalmente ocurrencias de "nosotros / nos /
      nuestro / nuestra / teniamos / logramos / fuimos / eramos" vs "yo / me /
      mi / tuve / logre / fui / era" en los mensajes del candidato.
      - Si hay MUCHO mas "nosotros" que "yo" -> "alta"
      - Si hay balance -> "media"
      - Si domina "yo" claramente -> "baja"
      Antes de responder, haz la cuenta.

    - filler_frequency: muletillas ("este", "osea", "bueno", "como que",
      "digamos") observadas en los mensajes del candidato. "alta" | "media" |
      "baja" segun corresponda.

## OUTPUT

Responde UNICAMENTE con un JSON valido con esta estructura exacta:

{{
  "completed_at": "<ISO8601 ahora>",
  "competencias_foco": ["id_catalogo", "..."],
  "strengths": [
    {{
      "skill": "<id_catalogo>",
      "evidence": "<cita textual del candidato>",
      "why_matters": "<por que importa en su rol objetivo>"
    }}
  ],
  "gaps": [
    {{
      "skill": "<id_catalogo>",
      "evidence": "<cita textual o patron observado>",
      "impact": "<consecuencia si no se trabaja>",
      "micro_practice": "<ejercicio concreto para esta semana>"
    }}
  ],
  "blind_spot": "<observacion conductual con cuidado>",
  "reflection_question": "<pregunta abierta>",
  "verbal_patterns": {{
    "vague_verbs_detected": ["verbo1", "verbo2"],
    "we_vs_i_tendency": "alta|media|baja",
    "filler_frequency": "alta|media|baja"
  }},
  "recommended_next_scenario": "roberto|maria",
  "recommended_next_level": "facil|intermedio|dificil"
}}

NO agregues texto fuera del JSON. NO agregues comentarios en el JSON.
NO inventes skill ids; usa solo los del catalogo."""


_SKILLS_CATALOG_FORMATTED: str = "\n".join(
    f"- {s['id']}: {s['name']}\n"
    f"  Evidencia positiva: {s['positive']}\n"
    f"  Senal de brecha: {s['gap']}"
    for s in SOFT_SKILLS_CATALOG
)


_ABSENCE_EVIDENCE_PREFIXES = (
    "no se ", "no hay ", "no hubo ", "no menciono ", "no describe ",
    "no se menciona", "no se mencionan", "no se observa", "no se observan",
    "el candidato no ", "la candidata no ",
)


def _drop_absence_gaps(gaps: list[dict]) -> list[dict]:
    """
    Elimina gaps cuyo 'evidence' describe ausencia en vez de una observacion.
    El prompt ya lo prohibe pero el LLM es terco; aqui filtramos por seguridad.
    """
    filtered: list[dict] = []
    for g in gaps:
        ev = g.get("evidence", "").strip().lower()
        if any(ev.startswith(p) for p in _ABSENCE_EVIDENCE_PREFIXES):
            logger.info(
                f"[UserProfile] Descartado gap '{g.get('skill')}' por evidencia "
                f"de ausencia: \"{ev[:80]}\""
            )
            continue
        filtered.append(g)
    return filtered


def _demo_diagnostico(reason_in_blind_spot: str | None = None) -> dict:
    """
    Diagnostico placeholder schema-valid para:
    - conversaciones con <4 intercambios
    - errores de parseo o validacion
    El resultado cumple el schema Diagnostico.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    blind_spot = reason_in_blind_spot or (
        "Conversacion muy corta para diagnosticar. Completa una entrevista de "
        "al menos 4-5 intercambios para obtener observaciones basadas en evidencia."
    )
    return Diagnostico(
        completed_at=now_iso,
        competencias_foco=["comunicacion", "autoconciencia"],
        strengths=[],
        gaps=[],
        blind_spot=blind_spot,
        reflection_question=(
            "Cuando tengas unos minutos, intenta una entrevista mas completa. "
            "Que historia de tu trabajo te gustaria revisar contigo mismo?"
        ),
        verbal_patterns=VerbalPatterns(
            vague_verbs_detected=[],
            we_vs_i_tendency="media",
            filler_frequency="media",
        ),
        recommended_next_scenario="roberto",
        recommended_next_level="facil",
        is_demo=True,
    ).model_dump()


async def generate_user_profile(
    conversation: list[dict],
    registro: Registro,
    session_vars: dict | None = None,
) -> dict:
    """
    Genera el bloque 'diagnostico' del UserProfile a partir de la conversacion
    del entrevistador BEI.

    Args:
        conversation: historial [{"role": "user"|"assistant", "content": str}, ...].
        registro: datos del usuario ya validados como Registro. Si el caller
            tiene un dict crudo (ej. WS payload), debe hacer Registro(**data)
            antes de llamar.
        session_vars: reservado para futura personalizacion del analisis
            (hoy no se usa; competencias preseleccionadas podrian entrar aqui).

    Returns:
        Dict que cumple el schema Diagnostico (user_profile.py). La llamada
        tipica es:
            user_profile["diagnostico"] = await generate_user_profile(...)

    Comportamiento:
    - Conversacion <4 intercambios: devuelve demo schema-valid.
    - Error de parseo JSON o de validacion: devuelve demo con nota en blind_spot.
    - Exito: devuelve el dict del LLM tras validarlo contra Diagnostico.
    """
    logger.info(
        f"[UserProfile] Generando diagnostico - usuario: {registro.nombre}, "
        f"rol: {registro.rol_objetivo}, intercambios: {len(conversation) // 2}"
    )

    actual_exchanges = len(conversation) // 2
    if actual_exchanges < 4:
        logger.info(f"[UserProfile] Conversacion corta ({actual_exchanges}), devolviendo demo")
        return _demo_diagnostico()

    conversation_text = _format_conversation(conversation)

    prompt = USER_PROFILE_PROMPT_TEMPLATE.format(
        nombre=registro.nombre,
        rol=registro.rol_objetivo,
        industria=registro.industria,
        nivel=registro.experience_level,
        skills_catalog=_SKILLS_CATALOG_FORMATTED,
        conversation=conversation_text,
    )

    try:
        logger.info(f"[UserProfile] Llamando Groq modelo {settings.groq_model_analysis}")
        client = get_groq_client()
        response = client.chat.completions.create(
            model=settings.groq_model_analysis,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=3000,
            response_format={"type": "json_object"},
        )
        result_text = response.choices[0].message.content
        logger.debug(f"[UserProfile] Raw response: {result_text[:500]}...")

        parsed = json.loads(result_text)

        # Forzamos completed_at del servidor: el LLM tiende a inventar fechas
        # pasadas aunque el prompt diga "ahora".
        parsed["completed_at"] = datetime.now(timezone.utc).isoformat()

        # Filtro de seguridad: descartar gaps con evidencia por ausencia aunque
        # el prompt lo prohiba.
        if isinstance(parsed.get("gaps"), list):
            parsed["gaps"] = _drop_absence_gaps(parsed["gaps"])

        try:
            validated = Diagnostico(**parsed)
        except Exception as e:
            logger.error(f"[UserProfile] JSON no cumple schema Diagnostico: {e}")
            return _demo_diagnostico(
                reason_in_blind_spot=(
                    "No pudimos estructurar el diagnostico esta vez. "
                    "Intenta de nuevo o contacta soporte si persiste."
                )
            )

        logger.info(
            f"[UserProfile] Diagnostico generado OK - "
            f"foco: {validated.competencias_foco}, "
            f"recommended: {validated.recommended_next_scenario}/{validated.recommended_next_level}"
        )
        return validated.model_dump()

    except json.JSONDecodeError as e:
        logger.error(f"[UserProfile] JSON decode error: {e}")
        return _demo_diagnostico(
            reason_in_blind_spot="Error procesando la respuesta. Intenta de nuevo."
        )
    except Exception as e:
        logger.error(f"[UserProfile] Error general: {e}", exc_info=True)
        return _demo_diagnostico(
            reason_in_blind_spot="Error temporal generando diagnostico. Intenta de nuevo."
        )
