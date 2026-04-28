"""
Sesion larga end-to-end: vendedor recorre PRAINCODERECI completo (17 turnos)
contra Roberto-Condor con Llama 8B. Mide:

  - Cumplimiento de reglas mecanicas POR TURNO (max 3 oraciones, max 1 pregunta).
  - Drift del personaje: ¿se mantiene seco/operativo o empieza a divagar?
  - Reacciones calibradas en los puntos esperados (5 Porques, COPQ, T-04, T-08).
  - Banco de objeciones: ¿aparecen en el orden establecido (tiempo -> ROI -> fracaso previo)?

Al final ejecuta analyze_conversation con los 6 KPIs nuevos para ver el
overall_score ponderado y feedback por KPI.

Ejecutar:
    poetry run python scripts/test_roberto_long_session.py
"""

import argparse
import asyncio
import re
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings  # noqa: E402
from app.prompts.scenarios import get_system_prompt  # noqa: E402
from app.services.analysis import analyze_conversation  # noqa: E402
from app.services.groq_llm import chat_complete  # noqa: E402


def normalize(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def count_sentences(text: str) -> int:
    cleaned = re.sub(r"\.\.\.", ".", text)
    parts = re.split(r"[.!?]+", cleaned)
    return sum(1 for p in parts if p.strip())


def count_questions(text: str) -> int:
    return text.count("?")


def has_any(text: str, keywords: list[str]) -> list[str]:
    norm = normalize(text)
    return [k for k in keywords if normalize(k) in norm]


# Roberto abre la sesion. Su primera linea no la genera el LLM (lo plantamos).
INITIAL_ASSISTANT = "Buenos dias. ¿De que empresa es y en que les puedo ayudar?"


# 17 turnos de vendedor siguiendo PRAINCODERECI.
# Cada entry: (etapa, lo que dice el vendedor)
VENDOR_PLAYBOOK = [
    # PR — Presentacion (curiosidad)
    ("PR", "Buenos dias Roberto. Soy Eric, de Ingenieria Condor. Vengo porque en empresas metalmecanicas como la suya, el costo real de los paros no planeados suele estar 3 a 8 veces mas alto de lo que aparece en los reportes. ¿Tiene 30 minutos para un recorrido de planta?"),

    # A — Atencion (recorrido + observacion Lean)
    ("A", "Mientras caminamos, ¿me puede mostrar la linea donde tienen mas problemas? Quiero ver el flujo desde la materia prima hasta el producto terminado."),
    ("A", "¿Donde se acumula mas producto en proceso o donde la gente o las maquinas esperan mas?"),

    # IN — Interes (SPIN P + I)
    ("IN", "¿Cuantas veces se detiene esa prensa al dia y cuanto tarda en reiniciar?"),
    ("IN", "Cuando la prensa se detiene, ¿que hace el resto de la linea? ¿Para todo o hay otra estacion que absorbe el ritmo?"),

    # IN -> CO — 5 Porques
    ("5P", "Eso es un cuello de botella clasico. ¿Por que cree que la prensa falla tan seguido?"),
    ("5P", "¿Y por que el mantenimiento no le da abasto? ¿Es falta de personal o falta de informacion?"),
    ("5P", "¿Tienen algun sistema que monitoree las condiciones de la prensa en tiempo real, o el monitoreo es manual?"),

    # CO — Articulacion de causa raiz + setup para COPQ
    ("CO", "Roberto, ahi esta la causa raiz: sin datos continuos de condicion del equipo, el mantenimiento tiene que ser reactivo por definicion. Antes de proponer nada, ¿me puede ayudar con un par de numeros para entender el costo real?"),

    # CO — COPQ calculation con datos del cliente
    ("CO", "Dijiste 3 paros por turno de unos 30 minutos. ¿Cuantos turnos tienen al dia y cuanto produce esta linea por hora?"),
    ("CO", "Hagamos el calculo juntos. 3 paros por 30 minutos por 2 turnos = 3 horas de downtime al dia. 3 horas por 400 piezas por MXN 85 = MXN 102,000 al dia. Al mes son mas de MXN 2 millones. ¿Eso cuadra con lo que tienen registrado?"),

    # DE — Motivacion dominante: certeza, no tecnologia
    ("DE", "Lo que nuestra solucion resuelve no es un software — es no volver a recibir la llamada del gerente diciendo que la linea paro. Sensores en sus equipos criticos, alerta al celular del tecnico antes de que la maquina falle. ¿Cuanto vale para usted tener eso bajo control?"),

    # RE Obj1 — Precio/ROI con T-04
    ("RE-T04", "Entiendo perfectamente — es la pregunta correcta. Hicimos el calculo: MXN 2 millones al mes en downtime evitable. Si la solucion cuesta MXN 180,000 anuales y recupera el 60% de ese costo, el ROI es en menos de 2 semanas. ¿Su directora de finanzas aprobaria una inversion con ese retorno?"),

    # RE Obj2 — Tiempo/interrupcion con T-03 Si-Y
    ("RE-T03", "Tiene razon en revisarlo, y por eso el primer paso que propongo no es la implementacion. Es una sesion diagnostica de 2 horas con un tablero KPI temporal usando los datos que ya tienen — sin instalar nada, sin tocar produccion. Si no convence, no hay compromiso. ¿Eso le quita el riesgo de interrumpir la planta?"),

    # CI — Cierre con lenguaje de presuposicion
    ("CI", "Perfecto. Para programar la sesion diagnostica necesito 2 cosas: su correo y el nombre del gerente de mantenimiento que deberia estar en esa sesion. ¿Cuando tienen disponibilidad, esta semana o la proxima?"),

    # CI — confirmar fecha
    ("CI", "Martes confirmado entonces. Le mando la confirmacion hoy con lo que necesitamos preparar de su lado, basicamente acceso a sus registros de paros de los ultimos 3 meses si los tienen en Excel o en su sistema."),

    # PV — Preview de habilitacion del campeon
    ("PV", "Roberto, una cosa mas para que el martes salga lo mejor posible: ¿quien firma este tipo de iniciativas internamente, su director general o pasa por finanzas tambien? Si me lo dice ahora, le preparo el one-pager para que usted lo presente con los numeros listos."),
]


# Senales esperadas por etapa
APERTURA_KEYWORDS = ["estacion", "linea", "turno", "prensa", "minutos", "horas", "exactamente", "asi es", "correcto"]
COPQ_RECONOCIMIENTO = ["no lo teniamos calculado", "honestamente", "cuadra", "se acerca", "tiene sentido", "no se nos habia ocurrido"]
OBJ_TIEMPO = ["no podemos parar", "interrumpir", "interrupcion", "tiempo de implementacion"]
OBJ_ROI = ["roi", "cuando se recupera", "presupuesto", "inversion grande", "directora de finanzas", "director de finanzas"]
OBJ_FRACASO = ["antes no funciono", "no salio bien", "fracaso", "ya intentamos", "proyecto que fallo"]
IA_LEAK = ["como ia", "como inteligencia artificial", "como modelo", "como asistente", "soy una ia", "soy un modelo"]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        default=settings.groq_model_llm,
        help="Slug del modelo Groq (ej. meta-llama/llama-4-scout-17b-16e-instruct, openai/gpt-oss-20b)",
    )
    args = parser.parse_args()

    # Override global del modelo del avatar (chat_complete lee settings.groq_model_llm).
    # NO toca el modelo del analizador (settings.groq_model_analysis sigue Llama 70B).
    original_model = settings.groq_model_llm
    settings.groq_model_llm = args.model
    print(f"[Test] Modelo del avatar: {args.model}")
    print(f"[Test] Modelo del analizador (sin cambio): {settings.groq_model_analysis}")

    system_prompt = get_system_prompt("roberto")
    print(f"[Test] System prompt cargado: {len(system_prompt)} chars")
    print(f"[Test] Playbook: {len(VENDOR_PLAYBOOK)} turnos del vendedor\n")

    conversation = [{"role": "assistant", "content": INITIAL_ASSISTANT}]
    print(f"ROBERTO (apertura): {INITIAL_ASSISTANT}\n")

    # Stats por turno
    stats = []
    objection_order = []  # ('tiempo'|'roi'|'fracaso', turn_number)
    persona_breaks = []

    t_start = time.time()

    for i, (etapa, vendor_turn) in enumerate(VENDOR_PLAYBOOK, start=1):
        conversation.append({"role": "user", "content": vendor_turn})
        print(f"--- Turno {i} [{etapa}] ---")
        print(f"VENDEDOR: {vendor_turn[:140]}{'...' if len(vendor_turn) > 140 else ''}")

        t0 = time.time()
        response = await chat_complete(conversation, system_prompt)
        latency = time.time() - t0

        response = response.strip()
        conversation.append({"role": "assistant", "content": response})

        sent = count_sentences(response)
        qs = count_questions(response)
        leaks = has_any(response, IA_LEAK)
        opens = has_any(response, APERTURA_KEYWORDS)
        copq = has_any(response, COPQ_RECONOCIMIENTO)
        obj_t = has_any(response, OBJ_TIEMPO)
        obj_r = has_any(response, OBJ_ROI)
        obj_f = has_any(response, OBJ_FRACASO)

        if obj_t and ("tiempo", i) not in [(t, _) for t, _ in objection_order]:
            if not any(o == "tiempo" for o, _ in objection_order):
                objection_order.append(("tiempo", i))
        if obj_r and not any(o == "roi" for o, _ in objection_order):
            objection_order.append(("roi", i))
        if obj_f and not any(o == "fracaso" for o, _ in objection_order):
            objection_order.append(("fracaso", i))
        if leaks:
            persona_breaks.append((i, leaks))

        flags = []
        if sent > 3: flags.append(f"oraciones={sent}>3")
        if qs > 1: flags.append(f"preguntas={qs}>1")
        if leaks: flags.append(f"IA-LEAK={leaks}")

        stats.append({
            "turn": i, "etapa": etapa, "sentences": sent, "questions": qs,
            "latency": latency, "violations": flags,
        })

        print(f"ROBERTO: {response}")
        marker = "  ".join([f"oraciones={sent}", f"preguntas={qs}", f"latencia={latency:.2f}s"])
        if flags:
            marker += "  WARN: " + ", ".join(flags)
        if opens: marker += f"  apertura:{opens[:2]}"
        if copq: marker += f"  COPQ-OK:{copq[:1]}"
        print(f"  [{marker}]\n")

    elapsed_total = time.time() - t_start

    # ============================================================
    # Resumen de la sesion
    # ============================================================
    print("=" * 70)
    print("RESUMEN DE SESION")
    print("=" * 70)
    total_turns = len(stats)
    violators_oraciones = sum(1 for s in stats if s["sentences"] > 3)
    violators_preguntas = sum(1 for s in stats if s["questions"] > 1)
    avg_latency = sum(s["latency"] for s in stats) / total_turns
    avg_sentences = sum(s["sentences"] for s in stats) / total_turns
    avg_questions = sum(s["questions"] for s in stats) / total_turns

    print(f"Turnos del bot: {total_turns}")
    print(f"Tiempo wall-clock total: {elapsed_total:.1f}s")
    print(f"Latencia promedio LLM: {avg_latency:.2f}s/turno")
    print(f"Promedio oraciones: {avg_sentences:.1f}")
    print(f"Promedio preguntas: {avg_questions:.1f}")
    print(f"Violaciones max-3-oraciones: {violators_oraciones}/{total_turns} ({violators_oraciones * 100 // total_turns}%)")
    print(f"Violaciones max-1-pregunta: {violators_preguntas}/{total_turns} ({violators_preguntas * 100 // total_turns}%)")
    print(f"Persona breaks (IA-leak): {len(persona_breaks)}")

    print(f"\nOrden de objeciones (esperado: tiempo -> roi -> fracaso):")
    if objection_order:
        for kind, turn in objection_order:
            print(f"  - {kind} (turno {turn})")
    else:
        print("  - (no se detectaron objeciones explicitas en las respuestas)")

    # ============================================================
    # Analisis post-sesion con los 6 KPIs nuevos
    # ============================================================
    print("\n" + "=" * 70)
    print("ANALISIS POST-SESION (6 KPIs ponderados, Llama 70B)")
    print("=" * 70)
    duration_seconds = int(elapsed_total)
    try:
        analysis = await analyze_conversation("roberto", conversation, duration_seconds=duration_seconds)
    except Exception as e:
        print(f"ERROR en analyze_conversation: {e}")
        sys.exit(1)

    print(f"\nOverall score: {analysis.get('overall_score')}/100")
    print(f"Resumen: {analysis.get('overall_summary')}\n")

    print("KPI breakdown:")
    for k in analysis.get("skills", []):
        weight = k.get("weight", "?")
        score = k.get("score", 0)
        name = k.get("name", "?")
        print(f"  {name} (peso {weight}%): {score}/100")
        feedback = k.get("feedback", "")
        if feedback:
            print(f"    -> {feedback[:200]}")
        met = k.get("indicators_met", [])
        missed = k.get("indicators_missed", [])
        if met:
            print(f"    indicadores OK ({len(met)}): {met[:2]}")
        if missed:
            print(f"    indicadores FALTAN ({len(missed)}): {missed[:2]}")

    print(f"\nFortalezas:")
    for s in analysis.get("strengths", []):
        print(f"  + {s}")
    print(f"\nMejoras:")
    for m in analysis.get("improvements", []):
        print(f"  - {m}")
    print(f"\nNext steps:")
    for n in analysis.get("next_steps", []):
        print(f"  > {n}")


if __name__ == "__main__":
    asyncio.run(main())
