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

# ============================================================
# Modelo de evaluacion v2 — 6 KPIs ponderados con indicadores
# ============================================================
# Cada escenario define 6 KPIs (peso suma 100). Cada KPI tiene:
#   - id: identificador estable
#   - name: nombre legible
#   - weight: peso porcentual (los 6 deben sumar 100)
#   - indicators: lista de comportamientos verificables en la transcripcion
#   - methodology_refs: marco metodologico al que pertenece (referencia)
#
# El LLM analizador puntea cada KPI 0-100 evaluando cuantos indicadores se
# observan. El overall_score se calcula ponderando: sum(score * weight) / 100.
#
# Roberto = escenario Condor (manufactura, PRAINCODERECI + Lean Six Sigma).
# Maria = negociacion (PRAINCODERECI + 8 tecnicas + Harvard).
# Ambos siguen el mismo formato para que sea facil agregar mas escenarios.
KPIS_BY_SCENARIO = {
    "roberto": {
        "scenario_type": "Venta Consultiva Industrial — Ingenieria Condor",
        "methodology": "PRAINCODERECI · Lean Six Sigma · 5 Porques Toyota · BPMN · KPIs Industriales (OEE/MTBF/COPQ)",
        "kpis": [
            {
                "id": "diagnostico_tecnico",
                "name": "Diagnostico tecnico",
                "weight": 25,
                "indicators": [
                    "Hizo preguntas de recorrido de planta (cuello de botella, paros, tiempos de ciclo)",
                    "Identifico al menos 2 desperdicios Lean (TIMWOODS: transport, inventory, motion, waiting, overproduction, over-processing, defects, skills)",
                    "Aplico los 5 Porques (preguntas '¿por que?' encadenadas) para llegar a causa raiz",
                    "Calculo el COPQ (Cost of Poor Quality) usando datos del propio cliente, no benchmarks genericos",
                ],
                "methodology_refs": ["Lean Manufacturing", "5 Porques Toyota", "Six Sigma — COPQ", "SPIN tipo I y N"],
            },
            {
                "id": "idioma_cliente",
                "name": "Habla el idioma del cliente",
                "weight": 20,
                "indicators": [
                    "Uso vocabulario industrial correcto: OEE, MTBF, MTTR, downtime, WIP, cuello de botella, scrap, retrabajo",
                    "NO hablo de features de software/demos antes del minuto 8",
                    "Adapto el argumento al perfil de operaciones (no al de TI)",
                ],
                "methodology_refs": ["Lean Six Sigma", "PRAINCODERECI etapas IN y CO"],
            },
            {
                "id": "estructura_praincodereci",
                "name": "Estructura PRAINCODERECI",
                "weight": 15,
                "indicators": [
                    "Respeto el orden: Presentacion -> Atencion -> Interes -> Conviccion -> Deseo -> Resolucion -> Cierre",
                    "NO presento la solucion antes de Conviccion (CO)",
                    "Cierre explicito con siguiente paso especifico (CI)",
                ],
                "methodology_refs": ["PRAINCODERECI completo", "AIDA — estados del cliente"],
            },
            {
                "id": "control_presion",
                "name": "Control bajo presion tecnica",
                "weight": 15,
                "indicators": [
                    "No prometio cosas tecnicas que no podia sostener",
                    "No contradijo al cliente sobre su sistema actual (Oracle EBS u otro)",
                    "Manejo el fracaso del proyecto previo de Roberto sin defensividad si aparecio",
                    "Uso silencio activo (T-08) tras pregunta de cierre",
                ],
                "methodology_refs": ["PNL: espejeo y anclas", "T-02 Aikido verbal", "T-08 Silencio activo"],
            },
            {
                "id": "roi_calculado",
                "name": "ROI calculado y defendible",
                "weight": 15,
                "indicators": [
                    "ROI calculado con numeros propios del cliente (no benchmarks genericos)",
                    "Expreso el retorno en semanas o meses, no en porcentajes vagos",
                    "Negocio por fases o con contraprestacion en lugar de descuento directo",
                ],
                "methodology_refs": ["T-04 Comparacion del costo del problema", "Harvard — Negociacion por intereses", "COPQ Six Sigma"],
            },
            {
                "id": "habilitacion_campeon",
                "name": "Habilitacion del campeon interno",
                "weight": 10,
                "indicators": [
                    "Convirtio a Roberto en vendedor interno ante DG y CFO",
                    "Preparo o propuso un one-pager / business case que Roberto puede usar internamente",
                    "Anticipo objeciones del DG y CFO con Roberto",
                ],
                "methodology_refs": ["PRAINCODERECI etapa PV", "PNL: lenguaje de presuposicion", "SPIN: preguntas de Necesidad"],
            },
        ],
    },
    "maria": {
        "scenario_type": "Negociacion de Contrato",
        "methodology": "PRAINCODERECI · 8 Tecnicas de Objeciones (T-01 a T-08) · SPIN · Negociacion Harvard",
        "kpis": [
            {
                "id": "manejo_objeciones",
                "name": "Manejo de objeciones",
                "weight": 25,
                "indicators": [
                    "Aplico tecnicas con nombre identificable (T-01 Boomerang, T-02 Aikido, T-03 Si-Y, T-04 Comparacion, T-05 Clarificadora, T-06 Testimonio, T-07 Posponer, T-08 Silencio)",
                    "Ejecuto los 3 pasos previos: Validar -> Aislar -> Diagnosticar",
                    "No ofrecio descuento antes de construir valor",
                    "Convirtio objeciones en argumentos (Boomerang) cuando aplicaba",
                ],
                "methodology_refs": ["T-01 a T-08", "PNL: Reencuadre"],
            },
            {
                "id": "escucha_activa",
                "name": "Escucha activa y SPIN",
                "weight": 20,
                "indicators": [
                    "Hizo preguntas SPIN distinguibles por tipo (Situacion, Problema, Implicacion, Necesidad)",
                    "Ratio de preguntas Implicacion+Necesidad mayor que Situacion+Problema",
                    "Uso informacion concreta de Maria para personalizar argumentos (no genericos)",
                    "No interrumpio — dejo terminar las oraciones",
                ],
                "methodology_refs": ["SPIN Selling — Rackham", "PRAINCODERECI etapas A e IN"],
            },
            {
                "id": "estructura_praincodereci",
                "name": "Estructura PRAINCODERECI",
                "weight": 15,
                "indicators": [
                    "Sigue las etapas en orden sin saltar ninguna",
                    "No paso de IN a CI sin pasar por CO y DE",
                    "Cierre explicito con CTA especifico",
                ],
                "methodology_refs": ["PRAINCODERECI completo", "AIDA"],
            },
            {
                "id": "control_emocional",
                "name": "Control emocional",
                "weight": 15,
                "indicators": [
                    "Tono uniforme bajo presion",
                    "No respondio con defensividad ante el primer NO",
                    "Uso T-08 Silencio en vez de llenar el espacio",
                    "Espejeo adaptativo del tono de Maria",
                ],
                "methodology_refs": ["PNL: espejeo y anclas", "T-08 Silencio activo"],
            },
            {
                "id": "tecnica_cierre",
                "name": "Tecnica de cierre",
                "weight": 15,
                "indicators": [
                    "Identifico señal de compra antes de cerrar",
                    "Uso lenguaje de presuposicion en el cierre",
                    "No cerro prematuramente (antes de Resolucion)",
                    "Sobrevivio el primer NO sin rendirse si aplicaba",
                ],
                "methodology_refs": ["PRAINCODERECI etapa CI", "PNL: lenguaje de presuposicion"],
            },
            {
                "id": "valor_vs_precio",
                "name": "Valor vs precio",
                "weight": 10,
                "indicators": [
                    "Precio mencionado DESPUES de argumentos de valor",
                    "Uso T-04 (Comparacion del costo del problema) al menos 1 vez",
                    "Negocio con contraprestacion (no descuento directo) si pidio precio menor",
                ],
                "methodology_refs": ["T-04 Comparacion del costo", "Harvard: Negociacion basada en intereses", "SPIN: preguntas tipo N"],
            },
        ],
    },
}

# Alias para mantener referencias antiguas en codigo de rutas/tests viejos.
SKILLS_BY_SCENARIO = KPIS_BY_SCENARIO


ANALYSIS_PROMPT_TEMPLATE = """Eres un coach experto en ventas consultivas que evalua transcripciones segun marcos metodologicos formales (PRAINCODERECI, Lean Six Sigma, SPIN, 8 tecnicas de objeciones T-01 a T-08).

## ESCENARIO
Tipo: {scenario_type}
Marco metodologico: {methodology}
Cliente/Contraparte: {avatar_name} ({avatar_role}) en {avatar_company}
Personalidad del cliente: {avatar_personality}

## KPIs A EVALUAR
{kpis_block}

## CONVERSACION
{conversation}

## INSTRUCCIONES DE EVALUACION

Para cada KPI, evalua cuantos de sus indicadores se observan en la transcripcion. Asigna un score 0-100 segun:
- 0-40: pocos o ningun indicador presente, o uso erroneo
- 41-60: 1 indicador parcial
- 61-80: 2-3 indicadores presentes correctamente
- 81-100: la mayoria/todos los indicadores presentes y bien ejecutados

Para cada KPI lista que indicadores SI viste y cuales NO. Cita ejemplos textuales del vendedor (no del cliente) cuando sea posible.

El "overall_score" se calcula ponderando: sum(kpi.score * kpi.weight) / 100.

Responde UNICAMENTE con un JSON valido con esta estructura exacta:
{{
    "overall_score": <numero 0-100, calculado ponderado>,
    "overall_summary": "<resumen de 2-3 oraciones del desempeno general>",
    "skills": [
        {{
            "id": "<id_kpi>",
            "name": "<nombre_kpi>",
            "weight": <peso del KPI>,
            "score": <numero 0-100>,
            "feedback": "<feedback especifico de 2-3 oraciones citando momentos>",
            "moment": "<cita textual del vendedor que ejemplifica este KPI, o null si no hay>",
            "indicators_met": ["<indicador presente 1>", "..."],
            "indicators_missed": ["<indicador ausente 1>", "..."]
        }}
    ],
    "strengths": ["<fortaleza 1>", "<fortaleza 2>"],
    "improvements": ["<area de mejora 1>", "<area de mejora 2>"],
    "key_moments": [
        {{
            "quote": "<cita textual de la conversacion>",
            "analysis": "<por que fue bueno o malo segun el marco metodologico>",
            "type": "positive" | "negative" | "neutral"
        }}
    ],
    "next_steps": ["<recomendacion accionable 1>", "<recomendacion accionable 2>"]
}}

IMPORTANTE:
- El array "skills" debe contener UNA entrada por cada KPI listado, en el mismo orden, con id y name exactos.
- Se honesto pero constructivo. El feedback debe nombrar tecnicas/etapas especificas (T-04, etapa CO, SPIN-I, etc.) cuando aplique.
- Si la conversacion es muy corta para evaluar, refleja eso en scores bajos pero no inventes evidencia.
- Responde SOLO con el JSON, sin texto adicional, sin markdown."""


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

    kpis_config = KPIS_BY_SCENARIO.get(avatar_id)
    if not kpis_config:
        logger.error(f"[Analysis] Configuracion de KPIs no encontrada: {avatar_id}")
        return _empty_analysis("Configuracion no encontrada")

    # Verificar conversacion minima - si hay menos de 4-5 intercambios, usar demo
    min_exchanges = 4
    actual_exchanges = len(conversation) // 2

    if actual_exchanges < min_exchanges:
        logger.info(f"[Analysis] Conversacion corta ({actual_exchanges} intercambios), generando analisis demo")
        return _demo_analysis(avatar_id, kpis_config, actual_exchanges, duration_seconds)

    # Formatear conversacion para el prompt
    conversation_text = _format_conversation(conversation)

    # Formatear bloque de KPIs con indicadores y peso
    kpis_block_lines = []
    for k in kpis_config["kpis"]:
        kpis_block_lines.append(f"\n### KPI: {k['name']} (id={k['id']}, peso={k['weight']}%)")
        kpis_block_lines.append("Indicadores observables (cada uno presente -> sube el score):")
        for ind in k["indicators"]:
            kpis_block_lines.append(f"  - {ind}")
        if k.get("methodology_refs"):
            kpis_block_lines.append(f"Marcos metodologicos: {', '.join(k['methodology_refs'])}")
    kpis_block = "\n".join(kpis_block_lines)

    # Construir prompt
    prompt = ANALYSIS_PROMPT_TEMPLATE.format(
        scenario_type=kpis_config["scenario_type"],
        methodology=kpis_config.get("methodology", "—"),
        avatar_name=avatar["name"],
        avatar_role=avatar["role"],
        avatar_company=avatar["company"],
        avatar_personality=avatar["personality"],
        kpis_block=kpis_block,
        conversation=conversation_text,
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

        # Recalcular overall_score ponderado por si el LLM lo dejo sin ponderar
        kpi_weights = {k["id"]: k["weight"] for k in kpis_config["kpis"]}
        skills_returned = analysis.get("skills") or []
        if skills_returned and all(isinstance(s, dict) and "score" in s for s in skills_returned):
            weighted_sum = 0
            total_weight = 0
            for s in skills_returned:
                w = s.get("weight") or kpi_weights.get(s.get("id"), 0)
                if w:
                    weighted_sum += s["score"] * w
                    total_weight += w
            if total_weight:
                analysis["overall_score"] = round(weighted_sum / total_weight)

        # Agregar metadatos
        analysis["avatar_id"] = avatar_id
        analysis["scenario_type"] = kpis_config["scenario_type"]
        analysis["methodology"] = kpis_config.get("methodology", "")
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


def _demo_analysis(avatar_id: str, kpis_config: dict, exchanges: int, duration_seconds: int) -> dict:
    """
    Genera un analisis demo realista para sesiones cortas.
    Esto permite mostrar el formato completo del reporte aunque la conversacion sea breve.
    """
    import random

    # Generar scores variados pero realistas para demo
    base_score = random.randint(62, 78)

    skills_analysis = []
    for skill in kpis_config["kpis"]:
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
            "weight": skill.get("weight", 0),
            "score": skill_score,
            "feedback": feedback,
            "moment": None,  # En demo no tenemos citas reales
            "indicators_met": [],
            "indicators_missed": skill.get("indicators", []),
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

    # Recalcular overall_score ponderado para coherencia con el modo real
    weighted_sum = sum(s["score"] * (s.get("weight") or 0) for s in skills_analysis)
    total_weight = sum((s.get("weight") or 0) for s in skills_analysis)
    overall = round(weighted_sum / total_weight) if total_weight else base_score

    return {
        "overall_score": overall,
        "overall_summary": f"Sesion de practica breve ({exchanges} intercambios). Mostraste buena disposicion y profesionalismo. Para un analisis mas profundo, te recomendamos sesiones de al menos 4-5 intercambios donde puedas desarrollar mejor cada KPI.",
        "skills": skills_analysis,
        "strengths": strengths,
        "improvements": improvements,
        "key_moments": key_moments,
        "next_steps": next_steps,
        "avatar_id": avatar_id,
        "scenario_type": kpis_config["scenario_type"],
        "methodology": kpis_config.get("methodology", ""),
        "total_exchanges": exchanges,
        "duration_seconds": duration_seconds,
        "is_demo": True,  # Flag para indicar que es analisis demo
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
   no vio de si mismo. Basada en evidencia especifica del transcript (una
   frase o patron citable). Sin etiquetas de personalidad. Humano, no juez.

   SI NO HAY EVIDENCIA ESPECIFICA suficiente para un blind spot util (ej.
   conversacion corta, respuestas evasivas, sin historias concretas), usa
   literalmente este texto: "No fue posible identificar un punto ciego
   especifico con la informacion compartida en esta sesion."

   PROHIBIDO blind spots genericos tipo "dificultad para reflexionar sobre
   si mismo", "podria mejorar su autoconciencia", "le cuesta expresar
   emociones" cuando no hay evidencia directa. Mejor el sentinel que un
   blind spot inventado.

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


_EVASIVE_MARKERS = (
    "no sé", "no se", "no recuerdo", "es lo mismo", "ya te dije",
    "no tengo", "no he tenido", "paso", "pasa", "para qué", "para que",
    "no quiero", "me obligaron", "no me interesa", "otra vez",
    "sigue", "no se me ocurre", "nada en particular",
)


def _is_inconclusive_session(conversation: list[dict]) -> tuple[bool, str]:
    """
    Detecta sesiones con suficientes intercambios (>=4) pero material pobre
    (respuestas cortas + evasivas). Devuelve (es_inconclusiva, razon).

    Heuristica:
    - Respuestas del usuario con longitud promedio < 30 chars
    - O >=3 respuestas con markers evasivos
    - Y ninguna respuesta sustantiva (>=100 chars)
    """
    user_msgs = [m["content"] for m in conversation if m.get("role") == "user"]
    if len(user_msgs) < 4:
        return False, ""  # otro path maneja conversaciones cortas

    avg_len = sum(len(m) for m in user_msgs) / len(user_msgs)
    evasive_count = sum(
        1
        for m in user_msgs
        if any(marker in m.lower() for marker in _EVASIVE_MARKERS)
    )
    has_substantial = any(len(m) >= 100 for m in user_msgs)

    if has_substantial:
        return False, ""  # hay al menos una historia real

    if avg_len < 30:
        return True, f"respuestas cortas (avg {avg_len:.0f} chars)"
    if evasive_count >= 3:
        return True, f"{evasive_count} respuestas evasivas"
    return False, ""


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

        # Detector de sesion no concluyente: intercambios >=4 pero respuestas
        # cortas / evasivas. Marca is_demo=True para que el frontend muestre
        # el banner de "sesion no concluyente" y el usuario no tome el
        # diagnostico como conclusivo.
        inconclusive, reason = _is_inconclusive_session(conversation)
        if inconclusive:
            logger.info(f"[UserProfile] Sesion no concluyente: {reason}")
            parsed["is_demo"] = True

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
