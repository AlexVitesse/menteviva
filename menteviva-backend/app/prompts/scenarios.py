"""
Escenarios y prompts para los avatares de Mente Viva.

Cada avatar tiene:
- Informacion basica (nombre, rol, empresa)
- Personalidad y contexto
- System prompt completo para el LLM

Tipos de avatar:
- "diagnostico": entrevistador BEI que corre antes de las pruebas. Su prompt
  se sustituye con variables de sesion y NO recibe contexto de usuario previo
  (el diagnostico ES el que lo produce).
- "practica": avatares que ponen al usuario a prueba (Roberto, Maria, Carlos).
  Su prompt recibe un bloque "CONTEXTO DEL USUARIO" al final cuando ya hay
  diagnostico, para que estresen brechas especificas.
"""

from typing import Optional

from app.models.user_profile import UserProfile
from app.prompts.celeste import get_celeste_prompt
from app.prompts.entrevistador import (
    build_user_context_block,
    get_entrevistador_prompt,
)
from app.prompts.roberto import get_roberto_prompt

AVATARS = {
    "entrevistador": {
        "id": "entrevistador",
        "name": "Sofia",
        "role": "Coach de Habilidades Blandas",
        "company": "Mente Viva",
        "personality": "Entrevistadora profesional. Calida, metodica, observadora. Escucha mucho mas de lo que habla.",
        "voice": "es-MX-DaliaNeural",
        "avatar_type": "animated",
        "kind": "diagnostico",
        # system_prompt se genera dinamicamente desde entrevistador_prompt.md;
        # la funcion get_system_prompt() lo arma con variables sustituidas.
        "system_prompt": None,
    },

    "roberto": {
        "id": "roberto",
        "name": "Roberto Garza",
        "role": "Director de Operaciones",
        "company": "Manufacturera metalmecanica (cliente Ingenieria Condor)",
        "personality": (
            "Pragmatico, orientado a operaciones. Habla Lean/Six Sigma (OEE, MTBF, "
            "downtime, COPQ). Desconecta a vendedores que hablan de software antes "
            "de entender el proceso. Tiene una cicatriz de un proyecto digital previo "
            "que fallo."
        ),
        "voice": "es-MX-JorgeNeural",
        "avatar_type": "animated",
        "kind": "practica",
        # system_prompt se resuelve dinamicamente en get_system_prompt() segun el
        # nivel pedido (principiante/intermedio/avanzado). Roberto es el unico
        # avatar con niveles de dificultad por ahora.
        "system_prompt": None,
        "supports_levels": True,
    },

    "celeste": {
        "id": "celeste",
        "name": "Celeste Vargas",
        "role": "Clienta difícil (se adapta a tu rubro)",
        "company": "Definida en el Paso 0 de la sesion",
        "personality": (
            "Analitica y orientada a numeros: compra por logica, no por simpatia. "
            "Directa, poca tolerancia al relleno, esceptica con quien habla del "
            "producto antes de preguntar por su situacion. Un proveedor anterior la "
            "defraudo. Lanza objeciones escalonadas y sube la presion ante un "
            "descuento prematuro."
        ),
        "voice": "es-MX-DaliaNeural",
        "avatar_type": "animated",
        "kind": "practica",
        # Puerto del GEM de ventas validado a mano. Alterna con Roberto para
        # comparar dos enfoques de CAT-01: contexto fijo vs. calibrado por el
        # vendedor. El prompt se resuelve por nivel en get_system_prompt().
        "system_prompt": None,
        "supports_levels": True,
        # Solo el banco de pruebas. En el catalogo de produccion abriria un
        # flujo de voz que nadie ha probado: el Briefing no le da selector de
        # nivel ni texto de escenario, y su feedback final es un bloque Markdown
        # largo que el TTS leeria literal. Quitar cuando se decida promoverla.
        "lab_only": True,
    },

    "maria": {
        "id": "maria",
        "name": "Maria Gonzalez",
        "role": "Gerente de Compras",
        "company": "Retail Express",
        "personality": "Amable pero exigente. Busca el mejor trato.",
        "voice": "es-MX-DaliaNeural",
        "avatar_type": "animated",  # Indica que usa avatar animado SVG
        "kind": "practica",
        "system_prompt": """Eres Maria Gonzalez, Gerente de Compras de Retail Express.

PERSONALIDAD:
- Amable y profesional
- Muy orientada a numeros y descuentos
- Negocia fuerte pero justa
- Le gusta construir relaciones de largo plazo
- No le gustan las tacticas de presion

CONTEXTO:
- Buscas renovar contrato con proveedor
- Tienes 3 cotizaciones de la competencia
- Tu jefe te presiona por reducir costos 15%

COMPORTAMIENTO:
- Responde amablemente pero siempre pregunta por precio
- Haz UNA SOLA pregunta por respuesta, nunca multiples preguntas
- Menciona a la competencia como palanca
- Si el vendedor cede muy rapido, pide mas
- Si el vendedor defiende su valor, respeta eso
- Busca win-win, no destruir al proveedor

IMPORTANTE:
- Manten el roleplay. Nunca rompas el personaje.
- NUNCA hagas listas de preguntas. Una pregunta a la vez, como en una conversacion real.
- Responde coherentemente al contexto. Si te dicen "adios" o "chao", responde a eso, no saludes.
- Si el mensaje no tiene sentido o es muy corto, pide clarificacion de forma natural."""
    }
}


def get_avatar(avatar_id: str) -> dict | None:
    """Obtiene un avatar por su ID."""
    return AVATARS.get(avatar_id)


def get_all_avatars(
    include_diagnostico: bool = False,
    include_lab_only: bool = False,
) -> list[dict]:
    """
    Obtiene avatares sin exponer system_prompt.

    Por defecto solo devuelve los de kind="practica" que ya estan listos para el
    catalogo del usuario. El entrevistador se accede por ruta propia y no
    aparece en la grilla de escenarios; los avatares marcados lab_only solo
    existen en el banco de pruebas.

    Args:
        include_diagnostico: si True, incluye al entrevistador en la lista.
        include_lab_only: si True, incluye los avatares de solo-laboratorio.
    """
    return [
        {k: v for k, v in avatar.items() if k != "system_prompt"}
        for avatar in AVATARS.values()
        if (include_diagnostico or avatar.get("kind") != "diagnostico")
        and (include_lab_only or not avatar.get("lab_only"))
    ]


def get_system_prompt(
    avatar_id: str,
    user_profile: Optional[UserProfile] = None,
    session_vars: Optional[dict] = None,
    level: Optional[str] = None,
) -> str:
    """
    Obtiene el system prompt ensamblado para el avatar.

    - Para avatares de kind="diagnostico" (entrevistador): carga el prompt
      maestro y sustituye las variables de sesion ({{nombre}}, {{rol}}, etc.)
      usando user_profile.registro y session_vars.
    - Para avatares de kind="practica" con supports_levels=True (Roberto):
      ensambla el prompt segun `level` (principiante/intermedio/avanzado).
    - Para los demas avatares de kind="practica" (Maria, Carlos): toma el
      system_prompt estatico de AVATARS.
    - En todos los casos, si user_profile.diagnostico existe, agrega el
      bloque "CONTEXTO DEL USUARIO" para que el avatar presione brechas.

    Args:
        avatar_id: ID del avatar.
        user_profile: perfil completo del usuario (registro + diagnostico?).
        session_vars: dict con keys opcionales idioma, tono, minutos,
            competencias para el diagnostico.
        level: nivel de dificultad para avatares con supports_levels.
            "principiante" (default) | "intermedio" | "avanzado".

    Returns:
        System prompt final, o string vacio si el avatar no existe.
    """
    avatar = AVATARS.get(avatar_id)
    if not avatar:
        return ""

    if avatar.get("kind") == "diagnostico":
        return get_entrevistador_prompt(user_profile, session_vars)

    if avatar.get("supports_levels") and avatar_id == "roberto":
        sales_case = str((session_vars or {}).get("roberto_case", "descubrimiento"))
        base_prompt = get_roberto_prompt(level or "principiante", sales_case)
    elif avatar.get("supports_levels") and avatar_id == "celeste":
        base_prompt = get_celeste_prompt(level or "principiante")
    else:
        base_prompt = avatar.get("system_prompt") or ""

    if user_profile and user_profile.diagnostico:
        base_prompt += build_user_context_block(user_profile)
    return base_prompt
