"""Test de PURO TEXTO del diagnóstico (Sofia) — Gemini, SIN sesión Live ni Simli.

Uso:
    poetry run python -m scripts.test_diagnostico_texto            # 10 turnos
    poetry run python -m scripts.test_diagnostico_texto 8

Evalúa la CALIDAD del diagnóstico con el MISMO modelo y prompt que producción
(Gemini + prompt conciso de voz), pero por TEXTO — usa la API generate_content,
no la sesión Live de audio. Así se mide la lógica de la entrevista + el análisis
sin la capa de voz/avatar.

  1. Sofia = Gemini (gemini-2.5-flash, texto) con build_gemini_entrevistador_prompt
     (el prompt conciso real de la rama gemini).
  2. CANDIDATO sintético = Groq gpt-oss-20b con persona + brechas CONOCIDAS (es
     solo el harness del test, no parte del producto).
  3. Análisis = generate_user_profile (Groq llama-3.3-70b) — igual que producción.

Imprime el transcript + el diagnóstico para evaluar:
  - ¿Sofia conduce bien (1 pregunta/turno, repreguntas, pivoteo, sin eco)?
  - ¿El diagnóstico DETECTA las brechas sembradas?
"""
import asyncio
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

# Modelo de texto de Gemini (hermano del native-audio que usa Live). No es
# idéntico al de audio, pero comparte familia + el MISMO prompt, así que es un
# buen proxy para evaluar la lógica de la entrevista sin tocar Live.
GEMINI_TEXT_MODEL = "gemini-2.5-flash"

REGISTRO = Registro(
    nombre="Daniel Reyes",
    rol_objetivo="Ejecutivo de Ventas",
    industria="Tecnología B2B",
    experience_level="mid",
)
SESSION_VARS = {"idioma": "es-MX", "tono": "calido-profesional", "minutos": 25}

GAPS_SEMBRADAS = [
    "Externaliza: dice 'el equipo'/'nosotros' en vez de 'yo' (autoconciencia).",
    "Sin métricas: 'salió bien'/'funcionó' sin números (orientación a resultados).",
    "Evita el conflicto: minimiza los roces (inteligencia emocional).",
    "Salta a la solución sin explicar el análisis (pensamiento crítico).",
]

# Candidato MÁS marcado en sus brechas que la versión anterior (para que haya
# evidencia clara que el análisis deba cazar).
CANDIDATE_PERSONA = """Eres Daniel Reyes, 29, Ejecutivo de Ventas mid-level en tecnología B2B. Estás en una práctica de habilidades blandas; respondes como persona REAL, no perfecta.

Exhibe estas tendencias de forma NATURAL y CONSISTENTE (no las anuncies):
- Hablas casi siempre en plural: "el equipo", "nosotros", "se logró", "lo sacamos". Rara vez dices "yo hice/decidí/dije". Te cuesta separar tu aporte del grupo.
- Cuando te preguntan por RESULTADOS, nunca das números ni métricas: "salió bien", "el cliente quedó contento", "funcionó", "sin problemas". Si te insisten por un dato concreto, lo esquivas con otra generalidad.
- Si surge un CONFLICTO o desacuerdo, lo minimizas: "no fue para tanto", "se resolvió solo", "ya ni me acuerdo". Evitas dar detalles de la fricción.
- Cuando cuentas cómo resolviste algo, vas directo a la solución sin explicar cómo analizaste el problema ni qué alternativas consideraste.

Reglas: responde SOLO lo que diría Daniel, en 2-4 oraciones, conversacional. Colabora (no seas hostil), pero con esas tendencias. No rompas personaje ni menciones que eres IA."""

GREETING_NUDGE = (
    "[El usuario se acaba de conectar y aún no ha dicho nada. Inicia tú la "
    "conversación: saluda brevemente como Sofia y haz tu primera pregunta.]"
)


def _to_conversation(contents: list[types.Content]) -> list[dict]:
    """contents de Gemini -> [{role, content}] para análisis/candidato.

    Salta el primer turno (el nudge de saludo) y mapea model->assistant.
    """
    conv = []
    for c in contents[1:]:
        role = "assistant" if c.role == "model" else "user"
        conv.append({"role": role, "content": c.parts[0].text})
    return conv


def _candidate_reply(conversation: list[dict]) -> str:
    """Respuesta del candidato (Groq) a lo último que dijo Sofia."""
    msgs = [{"role": "system", "content": CANDIDATE_PERSONA}]
    for m in conversation:  # roles invertidos desde la POV del candidato
        role = "user" if m["role"] == "assistant" else "assistant"
        msgs.append({"role": role, "content": m["content"]})
    resp = get_groq_client().chat.completions.create(
        model=settings.groq_model_llm, messages=msgs, temperature=0.85, max_tokens=220
    )
    return (resp.choices[0].message.content or "").strip()


async def main(max_turns: int) -> int:
    if not settings.gemini_api_key:
        print("ERROR: falta GEMINI_API_KEY en .env")
        return 1

    system_prompt = build_gemini_entrevistador_prompt(
        user_profile=None, session_vars=SESSION_VARS
    )
    # El prompt conciso usa {nombre}; sin user_profile pone "la persona". Inyectamos
    # el nombre real para que el saludo sea natural.
    system_prompt = system_prompt.replace("la persona", REGISTRO.nombre, 1)

    print(f"Modelo Sofia: {GEMINI_TEXT_MODEL} | prompt: {len(system_prompt)} chars")
    print(f"Candidato: {REGISTRO.nombre} ({REGISTRO.rol_objetivo}, {REGISTRO.industria})")
    print("Brechas sembradas:")
    for g in GAPS_SEMBRADAS:
        print(f"  - {g}")
    print("=" * 72)

    client = genai.Client(api_key=settings.gemini_api_key)
    gen_config = types.GenerateContentConfig(system_instruction=system_prompt, temperature=0.7)

    async def sofia(contents: list[types.Content]) -> str:
        # Reintento con backoff: gemini-2.5-flash a veces devuelve 503 (alta
        # demanda) o 429 (cuota) transitorios.
        for attempt in range(1, 6):
            try:
                resp = await client.aio.models.generate_content(
                    model=GEMINI_TEXT_MODEL, contents=contents, config=gen_config
                )
                return (resp.text or "").strip()
            except genai_errors.APIError as e:
                if getattr(e, "code", None) not in (429, 500, 502, 503, 504) or attempt == 5:
                    raise
                wait = 3 * attempt
                print(f"  [retry] Gemini {e.code}, intento {attempt}, esperando {wait}s...")
                await asyncio.sleep(wait)
        return ""

    # Arranca con el nudge para que Sofia salude (como en el flujo real).
    contents: list[types.Content] = [
        types.Content(role="user", parts=[types.Part(text=GREETING_NUDGE)])
    ]
    greeting = await sofia(contents)
    contents.append(types.Content(role="model", parts=[types.Part(text=greeting)]))
    print(f"\n[SOFIA] {greeting}")

    for turn in range(1, max_turns + 1):
        try:
            cand = _candidate_reply(_to_conversation(contents))
        except groq.APIError as e:
            print(f"\n[!] Groq en candidato (turno {turn}): {str(e)[:100]}")
            break
        contents.append(types.Content(role="user", parts=[types.Part(text=cand)]))
        print(f"\n[DANIEL] {cand}")

        try:
            s = await sofia(contents)
        except Exception as e:
            print(f"\n[!] Gemini en Sofia (turno {turn}): {type(e).__name__}: {str(e)[:120]}")
            break
        contents.append(types.Content(role="model", parts=[types.Part(text=s)]))
        print(f"\n[SOFIA] {s}")

    conversation = _to_conversation(contents)
    print("\n" + "=" * 72)
    print(f"Transcript: {len(conversation)} mensajes, {len(conversation)//2} intercambios")
    print("Generando diagnóstico (generate_user_profile, Groq)...")
    try:
        diag = await generate_user_profile(
            conversation=conversation, registro=REGISTRO, session_vars=SESSION_VARS
        )
    except Exception as e:
        print(f"[!] generate_user_profile falló: {type(e).__name__}: {e}")
        return 1

    import json
    print("\n" + "=" * 72)
    print("DIAGNÓSTICO GENERADO")
    print("=" * 72)
    print(json.dumps(diag, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    turns = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    raise SystemExit(asyncio.run(main(turns)))
