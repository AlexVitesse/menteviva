"""
Test focalizado: Roberto-Cóndor en sus 3 niveles. Verifica que el módulo de
dificultad se aplica — no solo que el archivo carga.

Verificaciones por nivel (1 escenario sintético cada uno, lo más diferenciador):
  - PRINCIPIANTE: vendedor pide cierre completo tras 2 objeciones manejadas y
    ROI claro -> Roberto cede ("Manda los detalles" / "Lo reviso" / "Suena
    razonable"). Lo que en otros niveles sería rechazado, aquí pasa.
  - INTERMEDIO: vendedor pide cierre completo (sin piloto) tras 3 objeciones
    manejadas -> Roberto exige piloto/POC sin compromiso ANTES de aceptar.
  - AVANZADO: vendedor ofrece descuento prematuro -> Roberto responde corrosivo
    ("precio inflado", "sustento de costo").

Reglas absolutas chequeadas en TODAS las respuestas (heredadas de roberto_base.md):
  - <=4 oraciones (terminadores)
  - <=1 pregunta por respuesta
  - No menciona ser IA / asistente / sistema
  - Sin acotaciones narrativas tipo "(la miro)" ni "(asiento)"
  - Sin "Excelente!" / "Genial!" / "Estoy emocionado"

Ejecutar:
    poetry run python scripts/test_roberto_levels.py
    poetry run python scripts/test_roberto_levels.py --level intermedio
"""

import argparse
import asyncio
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.prompts.scenarios import get_system_prompt  # noqa: E402
from app.services.groq_llm import chat_complete  # noqa: E402


IA_LEAK = [
    "como ia", "como inteligencia artificial", "como modelo",
    "como asistente", "soy una ia", "soy un modelo",
    "no soy un humano", "estoy programado",
]
ENTUSIASMO_LEAK = ["excelente!", "genial!", "estoy emocionado", "que emocionante", "wow!"]
ACOTACION_PATTERN = re.compile(r"\([^)]{1,40}\)")  # cualquier texto entre () corto


def normalize(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def has_any(text: str, keywords: list[str]) -> list[str]:
    norm = normalize(text)
    return [k for k in keywords if normalize(k) in norm]


def count_sentences(text: str) -> int:
    cleaned = re.sub(r"\.\.\.", ".", text)
    return sum(1 for p in re.split(r"[.!?]+", cleaned) if p.strip())


def count_questions(text: str) -> int:
    return text.count("?")


# ============================================================
# PRINCIPIANTE: vendedor pide cierre completo tras objeciones manejadas + ROI claro
# Roberto debe ceder con frase tipo "manda los detalles" / "lo reviso"
# ============================================================
PLAYBOOK_PRINCIPIANTE = [
    {"role": "assistant", "content": "Buenos días. ¿De qué empresa es y en qué les puedo ayudar?"},
    {"role": "user", "content": "Buenos días Roberto, soy de Ingeniería Cóndor. Vengo porque en empresas metalmecánicas como la suya el COPQ por paros suele ser 3-5 veces lo reportado. ¿Tiene 30 minutos para un recorrido de planta?"},
    {"role": "assistant", "content": "Tengo 30 minutos. ¿Qué necesita ver?"},
    {"role": "user", "content": "Mientras caminamos, ¿en qué estación se acumula más WIP, donde la gente o las máquinas esperan más?"},
    {"role": "assistant", "content": "En la estación 4. La prensa falla seguido y se acumula producto."},
    {"role": "user", "content": "Eso es un cuello de botella clásico. ¿Cuántas veces falla por turno y cuánto tarda en reiniciar?"},
    {"role": "assistant", "content": "Unas 3 veces por turno. Cada paro tarda 30 minutos."},
    {"role": "user", "content": "Hagamos el cálculo: 3 paros x 30 min x 2 turnos = 3 horas/día. 3h x 400 piezas/h x MXN 85 = MXN 102k/día. Al mes son MXN 2 millones perdidos. ¿Eso cuadra?"},
    {"role": "assistant", "content": "Honestamente no lo teníamos calculado así. Sí cuadra."},
    {"role": "user", "content": "Entiendo que parar producción no es opción. Nuestra implementación se hace en paralelo, sin tocar la línea — instalación de sensores en domingo. ¿Qué le preocupa más?"},
    {"role": "assistant", "content": "Mi directora de finanzas va a preguntar el ROI en 6 meses."},
    {"role": "user", "content": "Con sus números: la inversión típica para esta línea es MXN 800k. Recuperación en 4 meses al ritmo actual de pérdidas. ROI a 12 meses es 200%. ¿Le sirve ese rango?"},
    {"role": "assistant", "content": "Es un número agresivo pero suena posible. ¿Cómo se compara con clientes similares?"},
    {"role": "user", "content": "Con un cliente del sector metalmecánico de 250 empleados subimos OEE de 58% a 71% en 4 meses. Le propongo: arrancamos con un piloto de 30 días en estación 4, sin compromiso. Si los números no salen, lo apagamos. ¿Avanzamos?"},
]
PRINCIPIANTE_CESION_OK = [
    "manda los detalles", "manda la propuesta", "mande la propuesta",
    "manda el documento", "lo reviso", "tiene sentido", "suena razonable",
    "agendamos", "avanzamos", "confirmo", "consultarlo", "acepto",
    "esta bien", "vamos", "adelante",
]


# ============================================================
# INTERMEDIO: vendedor pide cierre COMPLETO sin piloto tras objeciones
# Roberto debe exigir piloto/POC primero
# ============================================================
PLAYBOOK_INTERMEDIO = [
    {"role": "assistant", "content": "Buenos días. ¿De qué empresa es y en qué les puedo ayudar?"},
    {"role": "user", "content": "Roberto, soy de Cóndor. En su sector, cuando OEE anda en 60%, descomponiendo Disponibilidad x Rendimiento x Calidad, normalmente Disponibilidad es el componente más golpeado. ¿En cuál de los 3 cree que está su problema principal?"},
    {"role": "assistant", "content": "Disponibilidad, sin duda. La estación 4 nos para 3 veces por turno."},
    {"role": "user", "content": "Eso baja Disponibilidad a 88% si los paros son de 30 min. Multiplicado por Rendimiento y Calidad, el OEE real estaría en 60% como ud dice. ¿Tiene MTBF y MTTR de esa prensa medidos?"},
    {"role": "assistant", "content": "MTTR está en 30 min. MTBF nadie lo ha calculado."},
    {"role": "user", "content": "Le propongo medirlo en su piloto. Pero antes: el COPQ con costo directo es MXN 2M/mes; con costo de oportunidad de no producir, sube a MXN 3.4M. ¿Eso cuadra con su tablero?"},
    {"role": "assistant", "content": "Esa parte de oportunidad no la teníamos. Cuadra."},
    {"role": "user", "content": "Entiendo el bloqueo de tiempo por la auditoría IATF. La instalación es offline en domingos, no toca producción. Sobre fracaso previo: nuestro sistema se conecta nativamente con SAP via OData, sin integrador externo. ¿Qué más le preocupa?"},
    {"role": "assistant", "content": "Tengo cotización de otra empresa al 60% del precio que ustedes manejan."},
    {"role": "user", "content": "Esa empresa típicamente entrega sensores sin servicio de implementación; ahí está el delta. Con nosotros incluye DMAIC de 3 meses. Pago desglosado: mes 1 sin pago, mes 2-12 cuotas iguales con ROI positivo desde mes 3. La inversión total con servicio incluido es MXN 1.1M. ¿Avanzamos a firma?"},
]
INTERMEDIO_EXIGE_PILOTO = [
    "piloto", "poc", "prueba", "30 dias", "60 dias",
    "no firmo completo", "no firmo a la primera",
    "fracaso anterior", "necesito ver", "necesito probar",
    "demuestre primero", "pruebe primero", "criterios de exito",
    "go/no-go", "go no go",
]


# ============================================================
# AVANZADO: vendedor ofrece descuento prematuro (sin POC, sin NPV, sin caso)
# Roberto debe responder corrosivo: "precio inflado" / "sustento de costo"
# ============================================================
PLAYBOOK_AVANZADO = [
    {"role": "assistant", "content": "Buenos días. Tengo 25 minutos. ¿Qué problema operativo de los míos vino a resolver?"},
    {"role": "user", "content": "Roberto, soy de Cóndor. Veo que su línea principal arrastra OEE bajo por Disponibilidad, probablemente con Cp/Cpk fuera de control en estación 4. Vengo a proponerle DMAIC sobre esa estación con monitoreo en tiempo real."},
    {"role": "assistant", "content": "Cp/Cpk no lo tengo medido en esa estación. ¿Qué objetivo me recomienda para metalmecánica?"},
    {"role": "user", "content": "Para piezas críticas en metalmecánica, Cp/Cpk objetivo de 1.33 mínimo, idealmente 1.67 si hay tolerancias estrechas. Antes de meterme en eso, pregunte: ¿qué le preocupa más en la decisión?"},
    {"role": "assistant", "content": "Estoy en preparación de auditoría IATF en 6 semanas. No puedo meter cambios operativos hasta después."},
    {"role": "user", "content": "Entendido. La fase de instrumentación se hace en paralelo sin tocar la operación. Mire, voy a ser directo: si firmamos hoy, le bajo el precio 20%. Es una oferta especial de fin de mes."},
]
AVANZADO_CASTIGO_DESCUENTO = [
    "precio inflado", "venia inflado", "venía inflado",
    "sustento de costo", "sustento del costo", "justifique el precio",
    "no me mueve", "fin de mes no me mueve", "fin de quarter",
    "que tan inflado", "qué tan inflado",
    "no firmo nada con descuentos", "no firmo asi", "no firmo así",
    "esos cierres", "tactica", "táctica",
]


SCENARIOS = [
    ("PRINCIPIANTE", "principiante", PLAYBOOK_PRINCIPIANTE, {
        "should_match": PRINCIPIANTE_CESION_OK,
        "label": "cesion (manda detalles / agendamos / suena razonable)",
    }),
    ("INTERMEDIO", "intermedio", PLAYBOOK_INTERMEDIO, {
        "should_match": INTERMEDIO_EXIGE_PILOTO,
        "label": "exige piloto/POC antes de cerrar",
    }),
    ("AVANZADO", "avanzado", PLAYBOOK_AVANZADO, {
        "should_match": AVANZADO_CASTIGO_DESCUENTO,
        "label": "castiga descuento prematuro",
    }),
]


def evaluate(name: str, response: str, expected: dict) -> tuple[bool, list[str]]:
    notes = []
    fails = []

    sent_count = count_sentences(response)
    q_count = count_questions(response)
    leaks_ia = has_any(response, IA_LEAK)
    leaks_entusiasmo = has_any(response, ENTUSIASMO_LEAK)
    acotaciones = ACOTACION_PATTERN.findall(response)

    if sent_count > 4:
        fails.append(f"  FAIL: max 3 oraciones excedido ({sent_count})")
    else:
        notes.append(f"  OK: {sent_count} oraciones")

    if q_count > 1:
        fails.append(f"  FAIL: mas de 1 pregunta ({q_count})")
    else:
        notes.append(f"  OK: {q_count} pregunta(s)")

    if leaks_ia:
        fails.append(f"  FAIL: IA-leak: {leaks_ia}")
    if leaks_entusiasmo:
        fails.append(f"  FAIL: entusiasmo: {leaks_entusiasmo}")
    if acotaciones:
        fails.append(f"  FAIL: acotaciones narrativas: {acotaciones[:2]}")

    matches = has_any(response, expected["should_match"])
    if matches:
        notes.append(f"  OK: marca esperada [{expected['label']}]: {matches[:2]}")
    else:
        fails.append(f"  FAIL: NO muestra marca esperada [{expected['label']}]")

    return (len(fails) == 0), fails + notes


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", choices=["principiante", "intermedio", "avanzado", "all"], default="all")
    args = parser.parse_args()

    selected = SCENARIOS if args.level == "all" else [s for s in SCENARIOS if s[1] == args.level]

    pass_count = 0
    for name, level, playbook, expected in selected:
        print(f"--- NIVEL {name} ---")
        system_prompt = get_system_prompt("roberto", level=level)
        print(f"  Prompt: {len(system_prompt)} chars")
        print(f"  Turnos previos: {len(playbook)}")
        print(f"  Ultimo turno vendedor: \"{playbook[-1]['content'][:80]}...\"")
        try:
            response = await chat_complete(playbook, system_prompt)
        except Exception as e:
            print(f"  ERROR LLM: {e}\n")
            continue
        print(f"  Roberto: \"{response.strip()}\"")
        ok, notes = evaluate(name, response, expected)
        for n in notes:
            print(n)
        if ok:
            pass_count += 1
        print()

    print(f"=== RESULTADO: {pass_count}/{len(selected)} niveles pasan ===")
    if pass_count < len(selected):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
