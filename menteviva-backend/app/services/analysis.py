"""
Servicio de analisis de conversaciones usando LLM con razonamiento.

Evalua habilidades blandas basado en la conversacion y el escenario.
"""

import json
import logging
from groq import Groq
from app.config import settings
from app.prompts.scenarios import get_avatar

logger = logging.getLogger("menteviva")

client = Groq(api_key=settings.groq_api_key)

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
