"""Verifica la NOTA DEL SISTEMA de ritmo (build_session_state_note) y el cierre por tiempo.

Uso:
    poetry run python -m scripts.test_pacing_policy            # todo (incluye 2 llamadas a Groq)
    poetry run python -m scripts.test_pacing_policy --offline  # solo la parte determinista

Contexto: el LLM es stateless — nunca sabe cuánto tiempo lleva la sesión, así que
"administra el tiempo" era inaccionable: Sofia conducía bien el BEI pero jamás
señalizaba avance ("última pregunta...") ni cerraba, a diferencia del GPT
north-star. El fix inyecta una [NOTA DEL SISTEMA ...] con el avance (tiempo real
del frontend/proxy + intercambios) al último turno del usuario, y los prompts
ganaron reglas de señalización + la excepción por tiempo sobre el piso de
competencias.

Parte 1 (determinista, sin APIs): bandas de la nota, lógica max(tiempo, esfuerzo),
variante tool vs [CIERRE], fallbacks, y que los prompts nuevos rendericen sin
placeholders y con las secciones nuevas.

Parte 2 (live, Groq llama-3.3-70b): conversación sintética corta con nota al
92% -> Sofia debe señalizar cierre ("última pregunta" / pregunta de reflexión) y
emitir [CIERRE] a más tardar en el turno siguiente. Un 429 al re-correr es cuota
agotada, no un bug. OJO: se usa llama-3.3-70b (12k TPM) y NO gpt-oss porque el
free tier de gpt-oss-20b/120b es 8k TPM y el prompt maestro + conversación ya
NO cabe (413) — hallazgo del 2026-07-09, aplica también al ChatLab con Groq.

Resultado en consola Y en logs/pacing_policy.txt (stdout se lo traga la consola
en algunos entornos Windows).
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from app.models.user_profile import Registro, UserProfile  # noqa: E402
from app.prompts.entrevistador import (  # noqa: E402
    build_gemini_entrevistador_prompt,
    build_session_state_note,
    get_entrevistador_prompt,
    target_exchanges,
)

OUT = pathlib.Path(__file__).parent.parent / "logs" / "pacing_policy.txt"

REGISTRO = Registro(
    nombre="Eric Vázquez",
    rol_objetivo="Consultor de Tecnología",
    industria="Tecnología",
    experience_level="mid",
)
USER_PROFILE = UserProfile(
    user_id="chatlab:test-pacing",
    registro=REGISTRO,
    created_at="1970-01-01T00:00:00Z",
    updated_at="1970-01-01T00:00:00Z",
)

lines: list[str] = []


def log(msg: str = "") -> None:
    try:
        print(msg)
    except UnicodeEncodeError:
        # Consola Windows cp1252: degradar a ASCII; el .txt guarda el original.
        print(msg.encode("ascii", "replace").decode())
    lines.append(msg)


def check(cond: bool, label: str) -> int:
    log(f"  {'OK   ' if cond else 'FALLA'} {label}")
    return 0 if cond else 1


def parte_deterministica() -> int:
    fails = 0

    log("=" * 70)
    log("NOTA DE ESTADO — bandas por % de avance (25 min)")
    log("=" * 70)
    # 25 min -> target_exchanges = 8. Solo tiempo:
    casos = [
        (120, "apertura", "primeras historias"),      # 8%
        (750, "profundización", "profundización BEI"),  # 50%
        (1200, "tramo final", "último"),               # 80%
        (1400, "cierre", "TIEMPO AGOTADO"),            # 93%
    ]
    for secs, nombre, needle in casos:
        note = build_session_state_note(25, elapsed_seconds=secs)
        fails += check(note is not None and needle in note,
                       f"a los {secs}s ({nombre}) la nota contiene '{needle}'")

    log("\nVariante de cierre: [CIERRE] vs finalizar_entrevista")
    n_txt = build_session_state_note(25, elapsed_seconds=1400)
    n_tool = build_session_state_note(25, elapsed_seconds=1400, cierre_como_tool=True)
    fails += check("[CIERRE]" in (n_txt or ""), "texto: menciona [CIERRE]")
    fails += check("finalizar_entrevista" in (n_tool or ""), "voz: menciona finalizar_entrevista")
    fails += check("[CIERRE]" not in (n_tool or ""), "voz: NO menciona [CIERRE]")

    log("\nmax(tiempo, esfuerzo): el que llegue primero empuja el cierre")
    # Poco tiempo pero intercambios completos (tecleó rápido) -> agotado.
    n = build_session_state_note(25, elapsed_seconds=300, exchanges=target_exchanges(25))
    fails += check(n is not None and "TIEMPO AGOTADO" in n,
                   "8/8 intercambios a los 5 min -> modo cierre (alineado con la barra)")
    # Mucho tiempo, pocos intercambios (tecleó lento) -> agotado igual.
    n = build_session_state_note(25, elapsed_seconds=1450, exchanges=2)
    fails += check(n is not None and "TIEMPO AGOTADO" in n,
                   "2 intercambios a los 24 min -> modo cierre (el reloj manda)")
    # Ambos a medias -> profundización, no cierre.
    n = build_session_state_note(25, elapsed_seconds=750, exchanges=4)
    fails += check(n is not None and "TIEMPO AGOTADO" not in n,
                   "50% tiempo y 50% intercambios -> aún NO cierra")

    log("\nFallbacks defensivos")
    fails += check(build_session_state_note(25) is None, "sin señales -> None (no inyectar nada)")
    n = build_session_state_note(None, elapsed_seconds=1400)
    fails += check(n is not None and "de 25 (" in n, "minutos inválidos -> fallback 25")
    n = build_session_state_note(25, elapsed_seconds=99999)
    fails += check(n is not None and "100% de la sesión" in n and "~25 de 25" in n,
                   "avance se topa en 100% / minuto 25")

    log("\n" + "=" * 70)
    log("PROMPTS — secciones nuevas presentes y sin placeholders rotos")
    log("=" * 70)
    maestro = get_entrevistador_prompt(USER_PROFILE, session_vars={"minutos": 25})
    fails += check("NOTA DEL SISTEMA (TU RELOJ)" in maestro, "maestro: sección de señalización")
    fails += check("EXCEPCIÓN POR TIEMPO" in maestro, "maestro: excepción por tiempo en CIERRE")
    fails += check("{{" not in maestro.replace("{{nombre}}", ""),
                   "maestro: sin placeholders sin sustituir")
    voz = build_gemini_entrevistador_prompt(USER_PROFILE, session_vars={"minutos": 25})
    fails += check("RITMO Y SEÑALIZACIÓN" in voz, "voz: sección de ritmo/señalización")
    fails += check("NOTA DEL SISTEMA" in voz, "voz: explica la nota del sistema")
    fails += check("el tiempo se agotó" in voz, "voz: excepción por tiempo en CIERRE")
    return fails


# Conversación sintética corta: rapport + una historia a medias. Con la nota al
# 92%, Sofia debe pasar a cierre aunque el material sea poco (excepción por tiempo).
_CONVO = [
    {"role": "assistant", "content": "Hola, soy Sofia, tu coach de Mente Viva. ¿Cómo va tu día?"},
    {"role": "user", "content": "Bien, tranquilo, con poco trabajo esta semana."},
    {"role": "assistant", "content": "Me alegra. Cuéntame de un problema reciente en tu trabajo en el que no tenías claro por dónde empezar."},
    {"role": "user", "content": "En un proyecto tuve que quitar el aviso de sitio inseguro de la página de un cliente; yo no sabía de Apache así que me dediqué a investigar y documentar para el equipo."},
    {"role": "assistant", "content": "Ok, investigar y documentar sobre Apache. ¿Qué hiciste tú exactamente con lo que encontraste?"},
]


async def parte_live() -> int:
    from app.services.groq_llm import chat_complete  # import tardío: solo si hay live

    fails = 0
    log("\n" + "=" * 70)
    log("LIVE (Groq llama-3.3-70b) — con nota al 92%, Sofia señaliza y cierra en <=2 turnos")
    log("=" * 70)

    # gpt-oss-20b/120b free tier = 8k TPM y el prompt maestro solo ya pide ~8.2k
    # tokens -> 413 garantizado. llama-3.3-70b (12k TPM) sí lo acepta.
    model = "llama-3.3-70b-versatile"
    system_prompt = get_entrevistador_prompt(USER_PROFILE, session_vars={"minutos": 25})

    convo = [dict(m) for m in _CONVO]
    convo.append({
        "role": "user",
        "content": (
            "Le compartí mis hallazgos al líder técnico y armé un documento para el PM.\n\n"
            + build_session_state_note(25, elapsed_seconds=1390, exchanges=3)
        ),
    })
    reply1 = await chat_complete(convo, system_prompt, model=model)
    log(f"\nTurno 1 de Sofia:\n  {reply1[:400]}")
    señal = any(k in reply1.lower() for k in ("última pregunta", "ultima pregunta", "para cerrar", "antes de cerrar", "antes de terminar"))
    cerro1 = "[CIERRE]" in reply1
    fails += check(señal or cerro1, "turno 1: señaliza el cierre ('última pregunta'...) o cierra")
    fails += check("NOTA DEL SISTEMA" not in reply1, "turno 1: no menciona la nota del sistema")

    if not cerro1:
        convo.append({"role": "assistant", "content": reply1})
        convo.append({
            "role": "user",
            "content": (
                "La historia que más me movió fue la de mi PM, porque sentí que dudaban "
                "de mi capacidad y hablarlo me dio otra perspectiva.\n\n"
                + build_session_state_note(25, elapsed_seconds=1500, exchanges=4)
            ),
        })
        reply2 = await chat_complete(convo, system_prompt, model=model)
        log(f"\nTurno 2 de Sofia:\n  {reply2[:400]}")
        fails += check("[CIERRE]" in reply2, "turno 2: emite [CIERRE] (cierre por tiempo)")
        fails += check("NOTA DEL SISTEMA" not in reply2, "turno 2: no menciona la nota del sistema")
    return fails


def main() -> int:
    offline = "--offline" in sys.argv
    fails = parte_deterministica()

    if offline:
        log("\n(parte live saltada por --offline)")
    else:
        try:
            fails += asyncio.run(parte_live())
        except Exception as e:
            log(f"\nLIVE no corrió ({type(e).__name__}: {str(e)[:160]})")
            log("Si es 429/cuota: es el free tier, no un bug. Re-correr más tarde o usar --offline.")
            fails += 1

    log("\n" + "=" * 70)
    log(f"RESULTADO: {'TODO OK' if fails == 0 else f'{fails} FALLA(S)'}")
    log("=" * 70)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
