"""Verifica que la duración (25/40/60) SÍ diferencia el prompt del entrevistador.

Uso:
    poetry run python -m scripts.test_duracion_policy

Contexto: antes, elegir 25, 40 o 60 min solo cambiaba el número {{minutos}} que
el modelo veía; el disparador real del fin de la charla es la regla [CIERRE], que
estaba FIJA en "2-3 competencias con STAR". Resultado: una sesión de 60 min
cerraba con el mismo umbral que una de 25. Este fix deriva de la duración cuántas
competencias exigir antes de poder cerrar y qué tan profundo sondear
(build_duration_policy), y lo inyecta en el prompt maestro (texto) y en el
conciso (voz Gemini).

Este test es DETERMINISTA (no llama a Groq/Gemini): arma los tres prompts para la
misma conversación sintética y comprueba que el umbral de cierre escala
2 -> 3 -> 4 competencias y que el texto de política difiere. Correr conversaciones
reales para ver el [CIERRE] disparado quemaría cuota (Gemini 20 req/día por modelo)
y sería no determinista; lo que importa aquí es que el prompt ensamblado cambie.

Resultado en consola Y en logs/duracion_policy.txt (la consola se traga el stdout
en algunos entornos Windows).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from app.models.user_profile import Registro, UserProfile  # noqa: E402
from app.prompts.entrevistador import (  # noqa: E402
    build_duration_policy,
    build_gemini_entrevistador_prompt,
    get_entrevistador_prompt,
)

OUT = pathlib.Path(__file__).parent.parent / "logs" / "duracion_policy.txt"

REGISTRO = Registro(
    nombre="Eric Vázquez",
    rol_objetivo="Gerente de Ventas",
    industria="Tecnología",
    experience_level="mid",
)
USER_PROFILE = UserProfile(
    user_id="chatlab:test-duracion",
    registro=REGISTRO,
    created_at="1970-01-01T00:00:00Z",
    updated_at="1970-01-01T00:00:00Z",
)

DURACIONES = [25, 40, 60]
# competencias_min esperado por duración (piso duro antes de poder cerrar).
EXPECTED_MIN = {25: 2, 40: 3, 60: 4}

lines: list[str] = []


def log(msg: str = "") -> None:
    print(msg)
    lines.append(msg)


def main() -> int:
    fails = 0

    log("=" * 70)
    log("POLÍTICA DE DURACIÓN — build_duration_policy()")
    log("=" * 70)
    for m in DURACIONES:
        p = build_duration_policy(m)
        ok = p["competencias_min"] == EXPECTED_MIN[m]
        fails += 0 if ok else 1
        log(f"\n[{m} min] competencias_min={p['competencias_min']} "
            f"target={p['competencias_target']}  {'OK' if ok else 'FALLA'}")
        log(f"  política: {p['politica_duracion']}")

    # Defaults defensivos: minutos vacío/basura -> 25 (piso 2).
    for bad in (None, "", "abc"):
        p = build_duration_policy(bad)
        ok = p["competencias_min"] == 2
        fails += 0 if ok else 1
        log(f"\n[minutos={bad!r}] fallback competencias_min={p['competencias_min']} "
            f"{'OK' if ok else 'FALLA'}")

    # --- Prompt MAESTRO (texto: Groq/ChatGPT) --------------------------------
    log("\n" + "=" * 70)
    log("PROMPT MAESTRO (texto) — el umbral de [CIERRE] debe escalar")
    log("=" * 70)
    maestros = {}
    for m in DURACIONES:
        prompt = get_entrevistador_prompt(
            USER_PROFILE, session_vars={"minutos": m}
        )
        maestros[m] = prompt
        # No deben quedar placeholders sin sustituir.
        for ph in ("{{minutos}}", "{{politica_duracion}}",
                   "{{competencias_min}}", "{{competencias_target}}"):
            if ph in prompt:
                fails += 1
                log(f"  [{m} min] FALLA: placeholder sin sustituir {ph}")
        # El piso de competencias debe aparecer literal en el texto.
        needle = f"cubrir {EXPECTED_MIN[m]} competencias"
        ok = needle in prompt
        fails += 0 if ok else 1
        log(f"[{m} min] contiene '{needle}': {'OK' if ok else 'FALLA'}")

    # Los tres prompts deben ser DISTINTOS entre sí (antes eran idénticos salvo
    # el número suelto).
    if len({maestros[25], maestros[40], maestros[60]}) != 3:
        fails += 1
        log("FALLA: los prompts maestros de 25/40/60 no son todos distintos")
    else:
        log("Los tres prompts maestros son distintos: OK")

    # --- Prompt CONCISO (voz Gemini) -----------------------------------------
    log("\n" + "=" * 70)
    log("PROMPT CONCISO (voz Gemini) — mismo escalamiento")
    log("=" * 70)
    geminis = {}
    for m in DURACIONES:
        prompt = build_gemini_entrevistador_prompt(
            USER_PROFILE, session_vars={"minutos": m}
        )
        geminis[m] = prompt
        needle = f"No cierres antes de {EXPECTED_MIN[m]} competencias"
        ok = needle in prompt
        fails += 0 if ok else 1
        log(f"[{m} min] contiene '{needle}': {'OK' if ok else 'FALLA'}")

    if len({geminis[25], geminis[40], geminis[60]}) != 3:
        fails += 1
        log("FALLA: los prompts Gemini de 25/40/60 no son todos distintos")
    else:
        log("Los tres prompts Gemini son distintos: OK")

    log("\n" + "=" * 70)
    log(f"RESULTADO: {'TODO OK' if fails == 0 else f'{fails} FALLA(S)'}")
    log("=" * 70)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
