"""Ronda larga alternativa de Sofia por Gemini texto.

Candidato fijo y adversarial para que la corrida sea reproducible y diferente
al harness de Daniel: Mariana, gerente de operaciones en logistica.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.user_profile import Registro  # noqa: E402
from app.prompts.entrevistador import (  # noqa: E402
    build_gemini_entrevistador_prompt,
    build_session_state_note,
)
from app.services.analysis import generate_user_profile  # noqa: E402
from app.services.gemini_live import generate_text  # noqa: E402


REGISTRO = Registro(
    nombre="Mariana Soto",
    rol_objetivo="Gerente de Operaciones",
    industria="Logistica",
    experience_level="senior",
)
SESSION_VARS = {
    "idioma": "es-MX",
    "tono": "calido-profesional",
    "minutos": 20,
    "competencias": [
        "liderazgo",
        "inteligencia_emocional",
        "orientacion_resultados",
        "gestion_prioridades",
    ],
}

# Respuestas deliberadamente heterogeneas: no dependen de otro LLM y permiten
# evaluar exactamente como conduce Sofia cada señal problemática.
ANSWERS = [
    "Bien, vengo de una manana pesada por retrasos en dos rutas.",
    (
        "El mes pasado una tormenta cerro la carretera principal y tuvimos que "
        "reorganizar 18 entregas. El equipo y yo movimos unidades y avisamos a "
        "clientes; al final salio bien."
    ),
    (
        "Yo decidi priorizar medicamentos y alimentos, pero la reasignacion la "
        "hizo el equipo de trafico."
    ),
    "Primero revise tiempos prometidos y penalizaciones; despues marque las rutas criticas.",
    (
        "No tuvimos una cifra final. Los clientes quedaron tranquilos y sentimos "
        "que reaccionamos rapido, pero no medimos el impacto."
    ),
    (
        "Hubo un roce con el supervisor nocturno porque no queria prestar una "
        "unidad. No fue para tanto, se resolvio solo."
    ),
    "Yo hable con el y acorde el cambio de unidad.",
    (
        "En realidad yo no hable con el supervisor; esa conversacion la tuvo mi "
        "coordinadora y yo solo autorice el cambio."
    ),
    "La conversacion fue tensa, pero preferi no meterme para no empeorarla.",
    (
        "En otro caso tuvimos tres pedidos urgentes al mismo tiempo. Elegimos "
        "atender primero al cliente mas grande."
    ),
    "Porque era el cliente mas importante y siempre hacemos eso.",
    "Si lo pienso, no revise margen, penalizacion ni impacto en los otros clientes.",
    "El aprendizaje fue que deberia usar criterios visibles y no solo la importancia comercial.",
    "La habilidad que sigo construyendo es manejar conflictos sin delegarlos por completo.",
    "Lo que mas me movio fue reconocer que evite la conversacion dificil con el supervisor.",
]


def validate_reply(turn: int, reply: str) -> list[str]:
    failures: list[str] = []
    lowered = reply.lower()
    if not reply.strip():
        failures.append(f"turno {turn}: respuesta vacia")
    if reply.count("?") > 1:
        failures.append(f"turno {turn}: mas de una pregunta")
    if "session_control" in lowered or "nota del sistema" in lowered:
        failures.append(f"turno {turn}: filtro control interno")
    return failures


async def main() -> int:
    prompt = build_gemini_entrevistador_prompt(session_vars=SESSION_VARS).replace(
        "la persona", REGISTRO.nombre, 1
    )
    history: list[dict] = []
    failures: list[str] = []

    greeting_nudge = (
        "La candidata acaba de conectarse. Inicia la entrevista con contexto "
        "breve y exactamente una pregunta."
    )
    greeting, closing = await generate_text(
        [{"role": "user", "content": greeting_nudge}], prompt, enable_closing_tool=True
    )
    history.append({"role": "assistant", "content": greeting})
    print(f"\n[SOFIA] {greeting}")
    failures.extend(validate_reply(0, greeting))

    for turn, answer in enumerate(ANSWERS, start=1):
        # Inyectar reloj real en puntos de avance. El control nunca debe aparecer
        # en la respuesta visible.
        elapsed = min(turn * 75, 20 * 60)
        note = build_session_state_note(
            20,
            elapsed_seconds=elapsed,
            cierre_como_tool=True,
        )
        user_content = answer + (f"\n\n{note}" if note else "")
        history.append({"role": "user", "content": user_content})
        print(f"\n[MARIANA] {answer}")

        reply, closing = await generate_text(
            history,
            prompt,
            enable_closing_tool=True,
        )
        history.append({"role": "assistant", "content": reply})
        print(f"\n[SOFIA] {reply}{' [TOOL-CIERRE]' if closing else ''}")
        failures.extend(validate_reply(turn, reply))
        if closing:
            break

    clean_conversation = []
    for item in history:
        content = item["content"]
        if item["role"] == "user" and "<session_control" in content:
            content = content.split("<session_control", 1)[0].strip()
        clean_conversation.append({"role": item["role"], "content": content})

    diag = await generate_user_profile(
        conversation=clean_conversation,
        registro=REGISTRO,
        session_vars=SESSION_VARS,
    )
    print("\n" + "=" * 72)
    print("DIAGNOSTICO")
    print(json.dumps(diag, ensure_ascii=False, indent=2))

    gap_ids = {gap.get("skill") for gap in diag.get("gaps", [])}
    if "orientacion_resultados" not in gap_ids:
        failures.append("diagnostico: omitio falta explicita de metricas")
    if diag.get("verbal_patterns", {}).get("we_vs_i_tendency") not in ("alta", "media"):
        failures.append("diagnostico: no detecto tension nosotros/yo")

    print("\n" + "=" * 72)
    if failures:
        print(f"RESULTADO: {len(failures)} FALLA(S)")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("RESULTADO: TODO VERDE")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
