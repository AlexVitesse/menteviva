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
from app.prompts.entrevistador import (
    build_user_context_block,
    get_entrevistador_prompt,
)


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
        "name": "Roberto Martinez",
        "role": "Director de TI",
        "company": "Grupo Industrial Norte",
        "personality": "Esceptico pero abierto. Directo, no le gusta perder tiempo.",
        "voice": "es-MX-JorgeNeural",
        "avatar_type": "animated",  # Indica que usa avatar animado SVG
        "kind": "practica",
        "system_prompt": """Eres Roberto Martinez, Director de Tecnologia de Grupo Industrial Norte.

PERSONALIDAD:
- Esceptico pero abierto a escuchar
- Muy ocupado, valoras tu tiempo
- Directo y practico
- Necesitas ver ROI claro antes de invertir
- Tienes malas experiencias con vendedores que prometen de mas

CONTEXTO:
- Te contactaron para una reunion de 15 minutos
- Tu empresa tiene problemas con sistemas legacy
- Tienes presupuesto pero necesitas justificarlo ante el CFO

COMPORTAMIENTO:
- Responde de forma breve y directa (maximo 2-3 oraciones)
- Haz UNA SOLA pregunta por respuesta, nunca multiples preguntas
- Haz preguntas dificiles sobre precio, implementacion, soporte
- Si el vendedor es generico, muestra desinteres
- Si el vendedor hace buenas preguntas, abre mas la conversacion
- Menciona objeciones reales: "Ya tenemos un sistema", "Es muy caro", "No tenemos tiempo"

IMPORTANTE:
- Manten el roleplay. Nunca rompas el personaje. Nunca digas que eres una IA.
- NUNCA hagas listas de preguntas. Una pregunta a la vez, como en una conversacion real.
- Responde coherentemente al contexto. Si te dicen "adios" o "chao", responde a eso, no saludes.
- Si el mensaje no tiene sentido o es muy corto, pide clarificacion de forma natural."""
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


def get_all_avatars(include_diagnostico: bool = False) -> list[dict]:
    """
    Obtiene avatares sin exponer system_prompt.

    Por defecto solo devuelve los de kind="practica" (son los que el usuario
    elige en el catalogo). El entrevistador se accede por ruta propia y no
    aparece en la grilla de escenarios.

    Args:
        include_diagnostico: si True, incluye al entrevistador en la lista.
    """
    return [
        {k: v for k, v in avatar.items() if k != "system_prompt"}
        for avatar in AVATARS.values()
        if include_diagnostico or avatar.get("kind") != "diagnostico"
    ]


def get_system_prompt(
    avatar_id: str,
    user_profile: Optional[UserProfile] = None,
    session_vars: Optional[dict] = None,
) -> str:
    """
    Obtiene el system prompt ensamblado para el avatar.

    - Para avatares de kind="diagnostico" (entrevistador): carga el prompt
      maestro y sustituye las variables de sesion ({{nombre}}, {{rol}}, etc.)
      usando user_profile.registro y session_vars.
    - Para avatares de kind="practica" (Roberto, Maria, Carlos): toma el
      system_prompt estatico y, si user_profile.diagnostico existe, le agrega
      el bloque "CONTEXTO DEL USUARIO" para que presione brechas especificas.

    Args:
        avatar_id: ID del avatar.
        user_profile: perfil completo del usuario (registro + diagnostico?).
        session_vars: dict con keys opcionales idioma, tono, minutos,
            competencias para el diagnostico.

    Returns:
        System prompt final, o string vacio si el avatar no existe.
    """
    avatar = AVATARS.get(avatar_id)
    if not avatar:
        return ""

    if avatar.get("kind") == "diagnostico":
        return get_entrevistador_prompt(user_profile, session_vars)

    base_prompt = avatar.get("system_prompt") or ""
    if user_profile and user_profile.diagnostico:
        base_prompt += build_user_context_block(user_profile)
    return base_prompt
