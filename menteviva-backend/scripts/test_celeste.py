"""
Test focalizado: Celeste (clinica de ventas) — el avatar nuevo de CAT-01 que se
compara contra Roberto.

Dos capas:

1. SIN LLM (siempre corre, `--assembly-only`):
   - El prompt sustituye {{NIVEL}} por el bloque pedido y NO filtra los otros.
   - Celeste es lab_only: sale en el banco, no en el catalogo de produccion.
   - Regresion: el limpiador de acotaciones no se come el Markdown del feedback.

2. CONDUCTA (4 llamadas al LLM):
   - PRINCIPIANTE / Paso 0: con greet, Celeste pide los datos de calibracion y
     NO pregunta el nivel (lo da la plataforma).
   - INTERMEDIO: descuento prematuro sin valor demostrado -> sube la presion
     (pregunta por el margen / no lo acepta como cierre).
   - AVANZADO: primer intento de cierre con propuesta buena -> no lo acepta.
   - INTERMEDIO / "Fin": sale de personaje y entrega el feedback completo con
     [CIERRE]. Regresion del cupo de tokens: con max_tokens=500 el razonamiento
     de gpt-oss-20b se comia el turno entero y salia el re-enganche.

   Reglas absolutas chequeadas solo EN personaje: <=4 oraciones, <=1 pregunta,
   sin acotaciones narrativas, sin [CIERRE] a media sesion. La fuga de IA se
   revisa en todos los turnos.

Ejecutar:
    poetry run python scripts/test_celeste.py
    poetry run python scripts/test_celeste.py --level avanzado
    poetry run python scripts/test_celeste.py --assembly-only   # sin cuota
"""

import argparse
import asyncio
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# La consola de Windows es cp1252 y revienta con los guiones/comillas tipograficas
# que emite el modelo. El detalle completo va al log; aqui solo el resumen.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LOG_PATH = Path(__file__).parent.parent / "logs" / "test_celeste.txt"

from app.prompts.celeste import _LEVELS  # noqa: E402
from app.prompts.scenarios import get_all_avatars, get_system_prompt  # noqa: E402
from app.routers.chat_text import _strip_stage_directions  # noqa: E402
from app.services.groq_llm import chat_complete  # noqa: E402

IA_LEAK = [
    "como ia", "como inteligencia artificial", "como modelo", "como asistente",
    "soy una ia", "soy un modelo", "no soy un humano", "estoy programado",
]
ACOTACION_PATTERN = re.compile(r"\([^)]{1,40}\)|\*[^*\n]{1,40}\*")

GREET_NUDGE = (
    "[El usuario se acaba de conectar y aun no ha dicho nada. Inicia tu la "
    "conversacion: saluda brevemente y comienza segun tu rol, con UNA sola "
    "pregunta.]"
)


def normalize(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def has_any(text: str, keywords: list[str]) -> list[str]:
    norm = normalize(text)
    return [k for k in keywords if normalize(k) in norm]


def count_sentences(text: str) -> int:
    cleaned = re.sub(r"\.\.\.", ".", text)
    return sum(1 for p in re.split(r"[.!?]+", cleaned) if p.strip())


# ============================================================
# 1. Ensamblado del prompt (sin LLM)
# ============================================================
def test_prompt_assembly() -> bool:
    ok = True
    for level, block in _LEVELS.items():
        prompt = get_system_prompt("celeste", level=level)
        marker = block.split("(")[0].strip()  # "PRINCIPIANTE", "INTERMEDIO"...
        otros = [m.split("(")[0].strip() for lv, m in _LEVELS.items() if lv != level]
        if "{{NIVEL}}" in prompt:
            print(f"  FAIL [{level}]: quedo el marcador {{{{NIVEL}}}} sin sustituir")
            ok = False
        elif marker not in prompt:
            print(f"  FAIL [{level}]: no aparece el bloque del nivel")
            ok = False
        elif any(o in prompt for o in otros):
            print(f"  FAIL [{level}]: se filtraron otros niveles al prompt")
            ok = False
        else:
            print(f"  OK [{level}]: {len(prompt)} chars, solo su bloque de nivel")
    # Nivel invalido cae a principiante en vez de reventar.
    if "PRINCIPIANTE" not in get_system_prompt("celeste", level="experto"):
        print("  FAIL: nivel invalido no cae a principiante")
        ok = False
    else:
        print("  OK: nivel invalido -> principiante")
    return ok


def test_solo_en_el_banco() -> bool:
    """Celeste vive en el banco, no en el catalogo de produccion (lab_only)."""
    ok = True
    prod = {a["id"] for a in get_all_avatars()}
    lab = {a["id"] for a in get_all_avatars(include_diagnostico=True, include_lab_only=True)}
    if "celeste" in prod:
        print("  FAIL: celeste aparece en el catalogo de produccion")
        ok = False
    else:
        print(f"  OK: fuera de produccion (catalogo: {sorted(prod)})")
    if "celeste" not in lab:
        print("  FAIL: celeste NO aparece en el banco de pruebas")
        ok = False
    else:
        print("  OK: visible en el banco")
    if "roberto" not in prod:
        print("  FAIL: se rompio el catalogo de produccion (falta roberto)")
        ok = False
    return ok


def test_feedback_sobrevive_al_post_proceso() -> bool:
    """El limpiador de acotaciones no debe comerse el Markdown del feedback.

    Regresion: `\\*...\\*` casaba dentro de `**negrita**` y dejaba "- * *: 5/10",
    borrando el nombre del KPI — justo la parte que el equipo compara.
    """
    ok = True
    muestra = (
        "## PUNTUACION POR KPI\n"
        "- **KPI-1 Manejo de objeciones (25%)**: 5/10\n"
        "- **KPI-4 Control emocional (15%)**: 8/10\n"
    )
    limpio = _strip_stage_directions(muestra)
    if "KPI-1 Manejo de objeciones" not in limpio or "KPI-4 Control emocional" not in limpio:
        print(f"  FAIL: el post-proceso mutilo el feedback -> {limpio!r}")
        ok = False
    else:
        print("  OK: el Markdown del feedback sobrevive intacto")
    # Y sigue limpiando acotaciones de verdad (asterisco simple).
    if _strip_stage_directions("Claro. *asiente* Sigamos.").count("asiente"):
        print("  FAIL: dejo de limpiar acotaciones *asiente*")
        ok = False
    else:
        print("  OK: sigue limpiando acotaciones de asterisco simple")
    return ok


# ============================================================
# 2. Conducta por nivel
# ============================================================
PASO_0_MARKS = ["que vende", "que producto", "vendes", "vende", "calibrar", "a quien"]
NIVEL_LEAK = ["principiante", "intermedio", "avanzado", "que nivel"]

PLAYBOOK_DESCUENTO = [
    {"role": "assistant", "content": "Soy Celeste, tu cliente para esta practica. Antes de comenzar, ayudame a calibrar el escenario: que vendes, a quien, a que precio y que etapa quieres practicar?"},
    {"role": "user", "content": "Vendo un CRM para pymes, a empresas, unos 3,000 USD al ano, quiero practicar objeciones."},
    {"role": "assistant", "content": "Perfecto, empecemos. Soy una clienta ocupada y esceptica. Buenos dias, ya tengo una propuesta de otro proveedor. Cuanto tiempo necesita?"},
    {"role": "user", "content": "Diez minutos. Nuestro CRM cuesta 3,000 USD al ano e incluye soporte."},
    {"role": "assistant", "content": "Esta muy caro, vi opciones mas baratas por la mitad."},
    {"role": "user", "content": "Le puedo dar 25% de descuento ahora mismo si firma hoy. Cerramos?"},
]

PLAYBOOK_PRIMER_CIERRE = [
    {"role": "assistant", "content": "Soy Celeste, tu cliente para esta practica. Antes de comenzar, ayudame a calibrar el escenario: que vendes, a quien, a que precio y que etapa quieres practicar?"},
    {"role": "user", "content": "Vendo software de gestion de flotillas a empresas, 8,000 USD al ano, quiero practicar el cierre."},
    {"role": "assistant", "content": "Perfecto, empecemos. Soy una clienta ocupada y esceptica. Buenos dias. Mi directora financiera me pidio 30% de descuento antes de cualquier conversacion."},
    {"role": "user", "content": "Entiendo la instruccion. Antes del precio, cuantas unidades tiene en ruta y cuanto le cuesta un dia de flotilla parada?"},
    {"role": "assistant", "content": "Sesenta unidades. Un dia parado nos cuesta unos 40 mil pesos."},
    {"role": "user", "content": "Con 60 unidades, evitar dos dias de paro al mes son 80 mil pesos; el sistema cuesta 13 mil al mes. Se paga solo en seis semanas. Firmamos hoy y arrancamos el lunes?"},
]

# El vendedor escribe "Fin": Celeste debe salir de personaje y entregar el
# feedback completo. Es la parte que el equipo compara contra el GEM, y la que
# se rompia con max_tokens=500 (el razonamiento se comia el cupo y salia vacio).
PLAYBOOK_FEEDBACK = PLAYBOOK_DESCUENTO + [
    {"role": "assistant", "content": "Si lo da tan facil, cuanto margen escondia?"},
    {"role": "user", "content": "Tiene razon, retiro el descuento. El precio se sostiene por los 100 mil al mes que recupera. Fin"},
]

CASTIGO_DESCUENTO = ["margen", "tan facil", "tan rapido", "inflado", "escondia", "de entrada", "por que baja"]
FEEDBACK_MARKS = ["retroalimentacion", "kpi-1", "puntuacion por kpi"]
# Si el LLM devuelve vacio, groq_llm entrega una de estas de re-enganche. Que
# aparezcan aqui significa que el turno de feedback nunca se genero.
REENGANCHE = ["algo mas concreto", "cambiemos el angulo", "para arrancar facil", "bajemoslo a algo chico"]
# En avanzado no exigimos una negativa literal: basta con que NO acepte el primer
# cierre. Devolver una objecion del banco tambien es rechazarlo.
ACEPTA_CIERRE = [
    "firmamos", "trato hecho", "de acuerdo, arrancamos", "acepto", "vamos a firmar",
    "mandame el contrato", "cuando empezamos", "listo, lo tomamos",
]

SCENARIOS = [
    ("PRINCIPIANTE / Paso 0", "principiante", [{"role": "user", "content": GREET_NUDGE}], {
        "should_match": PASO_0_MARKS,
        "label": "pide datos de calibracion",
        "roleplay": False,
        "no_nivel": True,
    }),
    ("INTERMEDIO / descuento prematuro", "intermedio", PLAYBOOK_DESCUENTO, {
        "should_match": CASTIGO_DESCUENTO,
        "label": "castiga el descuento prematuro",
        "roleplay": True,
    }),
    ("AVANZADO / primer cierre", "avanzado", PLAYBOOK_PRIMER_CIERRE, {
        "should_not_match": ACEPTA_CIERRE,
        "label": "no acepta el primer cierre",
        "roleplay": True,
    }),
    ("INTERMEDIO / feedback final", "intermedio", PLAYBOOK_FEEDBACK, {
        "should_match": FEEDBACK_MARKS,
        "should_not_match": REENGANCHE,
        "label": "entrega el feedback completo",
        "roleplay": False,
        "needs_cierre": True,
    }),
]


def evaluate(response: str, expected: dict) -> tuple[bool, list[str]]:
    notes: list[str] = []
    fails: list[str] = []

    if expected["roleplay"]:
        # Reglas absolutas del avatar: solo aplican EN personaje. El Paso 0 y el
        # feedback final son bloques largos y legitimamente fuera de personaje.
        sent = count_sentences(response)
        if sent > 4:
            fails.append(f"  FAIL: max 3 oraciones excedido ({sent})")
        else:
            notes.append(f"  OK: {sent} oraciones")

        q = response.count("?")
        if q > 1:
            fails.append(f"  FAIL: mas de 1 pregunta ({q})")
        else:
            notes.append(f"  OK: {q} pregunta(s)")

        # Los parentesis solo son acotacion en personaje: en el Paso 0 son
        # enumeraciones ("a quien (B2C/B2B/B2G)") y en el feedback, pesos ("25%").
        if acot := ACOTACION_PATTERN.findall(response):
            fails.append(f"  FAIL: acotaciones narrativas: {acot[:2]}")

    # [CIERRE] solo es valido en el turno de feedback.
    if expected.get("needs_cierre"):
        if "[CIERRE]" in response:
            notes.append("  OK: cierra la sesion con [CIERRE]")
        else:
            fails.append("  FAIL: el feedback no trae la marca [CIERRE]")
    elif "[CIERRE]" in response:
        fails.append("  FAIL: emitio [CIERRE] a media sesion")

    # El nivel lo manda la plataforma; Celeste no debe preguntarlo en el Paso 0.
    # (En el feedback SI puede recomendar un nivel para la proxima sesion.)
    if expected.get("no_nivel"):
        if leak := has_any(response, NIVEL_LEAK):
            fails.append(f"  FAIL: pregunta/menciona el nivel: {leak}")
        else:
            notes.append("  OK: no pregunta el nivel")

    if leaks := has_any(response, IA_LEAK):
        fails.append(f"  FAIL: IA-leak: {leaks}")

    if marks := expected.get("should_match"):
        if matches := has_any(response, marks):
            notes.append(f"  OK: marca esperada [{expected['label']}]: {matches[:2]}")
        else:
            fails.append(f"  FAIL: NO muestra marca esperada [{expected['label']}]")

    if forbidden := expected.get("should_not_match"):
        if hits := has_any(response, forbidden):
            fails.append(f"  FAIL: marca prohibida [{expected['label']}]: {hits[:2]}")
        else:
            notes.append(f"  OK: [{expected['label']}]")

    return (len(fails) == 0), fails + notes


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--level",
        choices=["principiante", "intermedio", "avanzado", "all"],
        default="all",
    )
    parser.add_argument(
        "--assembly-only",
        action="store_true",
        help="Solo el chequeo de ensamblado (no llama al LLM).",
    )
    args = parser.parse_args()

    print("--- ENSAMBLADO DEL PROMPT ---")
    assembly_ok = test_prompt_assembly()
    print("--- VISIBILIDAD DEL AVATAR ---")
    assembly_ok = test_solo_en_el_banco() and assembly_ok
    print("--- POST-PROCESO DEL FEEDBACK ---")
    assembly_ok = test_feedback_sobrevive_al_post_proceso() and assembly_ok
    print()
    if args.assembly_only:
        sys.exit(0 if assembly_ok else 1)

    selected = (
        SCENARIOS if args.level == "all" else [s for s in SCENARIOS if s[1] == args.level]
    )

    pass_count = 0
    transcript = ""
    for i, (name, level, playbook, expected) in enumerate(selected):
        # El free tier de Groq son 8k TPM y el turno de feedback solo ya pide
        # ~4.5k. Sin pausa entre escenarios pega 429 (cuota, no bug del prompt).
        if i:
            await asyncio.sleep(30)
        print(f"--- {name} ---")
        system_prompt = get_system_prompt("celeste", level=level)
        print(f"  Prompt: {len(system_prompt)} chars | turnos previos: {len(playbook)}")
        print(f"  Ultimo turno vendedor: \"{playbook[-1]['content'][:80]}...\"")
        try:
            response = await chat_complete(playbook, system_prompt)
        except Exception as e:
            print(f"  ERROR LLM: {e}\n")
            continue
        reply = response.strip()
        transcript += f"=== {name} ===\n{reply}\n\n"
        # El feedback final son ~2.5k chars: a consola va un extracto, completo
        # al log (que ademas es lo que el equipo lee para comparar con el GEM).
        preview = reply if len(reply) <= 400 else f"{reply[:400]}... [+{len(reply) - 400} chars, ver log]"
        print(f"  Celeste: \"{preview}\"")
        ok, notes = evaluate(response, expected)
        for n in notes:
            print(n)
        if ok:
            pass_count += 1
        print()

    if transcript:
        LOG_PATH.parent.mkdir(exist_ok=True)
        LOG_PATH.write_text(transcript, encoding="utf-8")
        print(f"Transcripcion completa: {LOG_PATH}")
    print(f"=== RESULTADO: ensamblado={'OK' if assembly_ok else 'FAIL'} | "
          f"conducta {pass_count}/{len(selected)} ===")
    if not assembly_ok or pass_count < len(selected):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
