"""Test de escenarios DIRIGIDOS del diagnóstico — Gemini texto, sin Live/Simli.

Uso:
    poetry run python -m scripts.test_diagnostico_escenarios

Corre 3 conversaciones, cada una con un candidato cuya BRECHA DOMINANTE es
distinta (y que habla en PRIMERA PERSONA, para aislar la brecha de la
externalización ya validada). Verifica si el análisis (Groq) caza cada tipo:

  1. sin_metricas   -> orientación a resultados
  2. evita_conflicto-> inteligencia emocional / manejo de conflicto
  3. salta_solucion -> pensamiento crítico

Sofia = Gemini (gemini-2.5-flash, texto) + prompt conciso. Candidato = Groq.
Análisis = generate_user_profile (Groq). Imprime, por escenario, el transcript
+ el diagnóstico + un HINT de si la brecha esperada aparece (el veredicto fino
lo da quien lee).
"""
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import groq  # noqa: E402
from google import genai  # noqa: E402
from google.genai import types  # noqa: E402
from google.genai import errors as genai_errors  # noqa: E402

from app.config import settings  # noqa: E402
from app.models.user_profile import Registro  # noqa: E402
from app.prompts.entrevistador import build_gemini_entrevistador_prompt  # noqa: E402
from app.services.groq_pool import get_groq_client  # noqa: E402
from app.services.analysis import generate_user_profile  # noqa: E402

# Override por env: el free tier limita ~20 req/DIA *por modelo* y la corrida
# completa (3 escenarios x 7 calls) lo rebasa. GEMINI_TEXT_MODEL=gemini-2.0-flash
# usa otro bucket de cuota (mas holgado) sin tocar el codigo.
GEMINI_TEXT_MODEL = os.environ.get("GEMINI_TEXT_MODEL", "gemini-2.5-flash")
SESSION_VARS = {"idioma": "es-MX", "tono": "calido-profesional", "minutos": 25}
TURNS = 6
GREETING_NUDGE = (
    "[El usuario se acaba de conectar y aún no ha dicho nada. Inicia tú: saluda "
    "brevemente como Sofia y haz tu primera pregunta.]"
)

_BASE = ("Hablas SIEMPRE en primera persona ('yo hice', 'yo decidí', 'yo dije'), "
         "das ejemplos concretos con TU acción individual (no te escondes en 'el equipo'). "
         "Respondes en 2-4 oraciones, conversacional, colaborando. No rompas personaje "
         "ni menciones que eres IA. ")

SCENARIOS = [
    {
        "key": "sin_metricas",
        "expected": "orientación a resultados (sin métricas)",
        "registro": Registro(nombre="Laura Méndez", rol_objetivo="Gerente de Marketing",
                             industria="Retail", experience_level="mid"),
        "persona": _BASE + (
            "TU BRECHA: nunca das números ni métricas al hablar de RESULTADOS. Dices "
            "'funcionó muy bien', 'fue un éxito', 'mejoró bastante', 'el cliente quedó "
            "feliz'. Si te piden un dato concreto (cuánto, qué %, qué indicador), lo "
            "esquivas: 'no tengo el número a la mano', 'se notó la diferencia', 'fue "
            "evidente'. JAMÁS cierras con un indicador medible."),
        "hints": ["metric", "número", "numero", "medi", "cuantif", "indicador",
                  "resultado", "orientaci"],
    },
    {
        "key": "evita_conflicto",
        "expected": "inteligencia emocional / manejo de conflicto",
        "registro": Registro(nombre="Marcos Lara", rol_objetivo="Líder de Proyecto",
                             industria="Construcción", experience_level="senior"),
        "persona": _BASE + (
            "TU BRECHA: cuando surge un CONFLICTO, desacuerdo o tensión con alguien, lo "
            "minimizas y lo esquivas: 'no fue para tanto', 'lo dejé pasar', 'se resolvió "
            "solo', 'prefiero no entrar en eso', 'cada quien siguió con lo suyo'. No "
            "describes la fricción, no cuentas qué se dijo, cambias rápido a algo "
            "positivo. Te incomoda hablar de momentos difíciles con personas."),
        "hints": ["conflicto", "emocional", "fricci", "desacuerdo", "incomod",
                  "tensi", "evita", "evade", "difícil", "dificil"],
    },
    {
        "key": "salta_solucion",
        "expected": "pensamiento crítico (salta a la solución sin análisis)",
        "registro": Registro(nombre="Andrea Soto", rol_objetivo="Analista Senior",
                             industria="Finanzas", experience_level="mid"),
        "persona": _BASE + (
            "TU BRECHA: cuando cuentas cómo resolviste un problema, vas DIRECTO a la "
            "solución sin explicar el análisis. No dices cómo diagnosticaste, qué causas "
            "consideraste, ni qué alternativas descartaste: es 'vi que fallaba, así que "
            "hice X y se arregló'. Si te preguntan cómo llegaste a esa decisión o qué "
            "otras opciones evaluaste, respondes vago: 'era lo lógico', 'se notaba', "
            "'no lo pensé mucho, fluyó'."),
        "hints": ["análisis", "analisis", "pensamiento", "crítico", "critico",
                  "alternativ", "diagnos", "causa", "supuesto", "razon"],
    },
]


def _candidate_reply(persona: str, conversation: list[dict]) -> str:
    msgs = [{"role": "system", "content": persona}]
    for m in conversation:
        role = "user" if m["role"] == "assistant" else "assistant"
        msgs.append({"role": role, "content": m["content"]})
    for _ in range(2):  # 1 reintento si gpt-oss devuelve vacío
        resp = get_groq_client().chat.completions.create(
            model=settings.groq_model_llm, messages=msgs, temperature=0.85, max_tokens=220
        )
        txt = (resp.choices[0].message.content or "").strip()
        if txt:
            return txt
    return "(...)"


def _to_conversation(contents: list[types.Content]) -> list[dict]:
    return [
        {"role": "assistant" if c.role == "model" else "user", "content": c.parts[0].text}
        for c in contents[1:]
    ]


async def _sofia(client, gen_config, contents) -> str:
    for attempt in range(1, 6):
        try:
            r = await client.aio.models.generate_content(
                model=GEMINI_TEXT_MODEL, contents=contents, config=gen_config
            )
            return (r.text or "").strip()
        except genai_errors.APIError as e:
            if getattr(e, "code", None) not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            await asyncio.sleep(3 * attempt)
    return ""


async def run_scenario(client, sc: dict) -> dict:
    reg: Registro = sc["registro"]
    prompt = build_gemini_entrevistador_prompt(user_profile=None, session_vars=SESSION_VARS)
    prompt = prompt.replace("la persona", reg.nombre, 1)
    gen_config = types.GenerateContentConfig(system_instruction=prompt, temperature=0.7)

    print("\n" + "#" * 72)
    print(f"# ESCENARIO: {sc['key']}  ->  brecha esperada: {sc['expected']}")
    print(f"# Candidato: {reg.nombre} ({reg.rol_objetivo}, {reg.industria})")
    print("#" * 72)

    contents = [types.Content(role="user", parts=[types.Part(text=GREETING_NUDGE)])]
    greeting = await _sofia(client, gen_config, contents)
    contents.append(types.Content(role="model", parts=[types.Part(text=greeting)]))
    print(f"\n[SOFIA] {greeting}")

    for _ in range(TURNS):
        cand = _candidate_reply(sc["persona"], _to_conversation(contents))
        contents.append(types.Content(role="user", parts=[types.Part(text=cand)]))
        print(f"\n[{reg.nombre.split()[0].upper()}] {cand}")
        s = await _sofia(client, gen_config, contents)
        contents.append(types.Content(role="model", parts=[types.Part(text=s)]))
        print(f"\n[SOFIA] {s}")

    conversation = _to_conversation(contents)
    diag = await generate_user_profile(conversation=conversation, registro=reg, session_vars=SESSION_VARS)

    # HINT automático: ¿aparece alguna keyword de la brecha esperada en gaps/blind_spot?
    blob = json.dumps(
        {"gaps": diag.get("gaps"), "blind_spot": diag.get("blind_spot"),
         "competencias_foco": diag.get("competencias_foco")},
        ensure_ascii=False,
    ).lower()
    hit = any(h in blob for h in sc["hints"])

    print("\n--- DIAGNÓSTICO ---")
    print(json.dumps(diag, ensure_ascii=False, indent=2))
    print(f"\n>>> HINT brecha esperada ({sc['expected']}): "
          f"{'APARECE' if hit else 'NO aparece (revisar a mano)'}")
    return {"key": sc["key"], "expected": sc["expected"], "hit": hit}


async def main() -> int:
    if not settings.gemini_api_key:
        print("ERROR: falta GEMINI_API_KEY")
        return 1
    client = genai.Client(api_key=settings.gemini_api_key)
    results = []
    for sc in SCENARIOS:
        try:
            results.append(await run_scenario(client, sc))
        except Exception as e:
            print(f"\n[!] Escenario {sc['key']} falló: {type(e).__name__}: {str(e)[:150]}")
            results.append({"key": sc["key"], "expected": sc["expected"], "hit": None})

    print("\n" + "=" * 72)
    print("RESUMEN (hint automático; el veredicto fino es leyendo cada diagnóstico)")
    print("=" * 72)
    for r in results:
        flag = {True: "✓ aparece", False: "✗ no aparece", None: "— error"}[r["hit"]]
        print(f"  [{flag}] {r['key']:18} -> {r['expected']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
