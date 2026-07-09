"""
Smoke test del banco de pruebas ChatLab (router chat_text).

Ejercita las rutas del router llamando a las funciones directo (sin levantar
uvicorn):

  A) POST /api/chat  -> saludo (greet=True) de Roberto via Groq.
     Verifica settings, override de modelo y latencia end-to-end.

  B) POST /api/chat  -> Gemini + entrevistador (default = prompt maestro).
     Verifica que Gemini corre con el PROMPT MAESTRO (prompt_chars ~26k) y no
     con el conciso de voz (~2.5k), y que la rotacion de keys funciona. OJO:
     pega al API de Gemini (free tier 20 req/dia POR KEY POR MODELO); si esta
     agotado, se registra el error pero no tumba el script.

  C) POST /api/chat/diagnostico -> corre el paso de analisis de produccion
     (Groq gpt-oss-120b) sobre la conversacion REAL que Eric tuvo con Gemini
     (Sofia). Verifica que el diagnostico sale con resumen/fortalezas/gaps.

OJO: pega a APIs reales (Groq + Gemini). Escribe el resultado a
logs/chatlab_smoke.txt porque stdout se traga en Windows.

Uso:
    poetry run python -m scripts.test_chatlab_smoke [modelo_groq_parte_A]
"""

import asyncio
import sys
import traceback
from pathlib import Path

from app.routers.chat_text import (
    ChatMessage,
    ChatRequest,
    DiagnosticoRequest,
    chat,
    chat_diagnostico,
)

OUT = Path(__file__).resolve().parent.parent / "logs" / "chatlab_smoke.txt"


# Conversacion real Eric <-> Sofia (Gemini, ChatLab, 2026-07-08). El candidato
# es "user", Sofia es "assistant". Sirve para ver que diagnostico produce el
# analizador de produccion sobre una charla conducida por Gemini.
ERIC_GEMINI_CONV = [
    ("user", "Hola"),
    ("assistant", "¡Hola! Soy Sofía, tu coach de Mente Viva. ¿Cómo va tu día hasta ahora? ¿En qué andas?"),
    ("user", "Anda de maravilla ando llegando de comprar lo de mi desayuno"),
    ("assistant", "¡Qué bueno! Me alegra escuchar eso. Cuéntame, ¿podrías compartirme alguna situación en tu trabajo donde hayas tenido que resolver un problema inesperado?"),
    ("user", "Claro una vez el sistema no respondia como debia, entonces explore hice test revise logs y el problema era el prompt, con eso tuvimos un mejor resultado"),
    ("assistant", "Ya veo. ¿Qué fue lo primero que hiciste cuando te diste cuenta de que el sistema no respondía correctamente?"),
    ("user", "Revisar logs, que tools llamaba, cual era su comportamiento y cual era el esperado"),
    ("assistant", "Entiendo. Y al final, cuando identificaste que el problema era el prompt, ¿qué acciones concretas tomaste para modificarlo y lograr un mejor resultado?"),
    ("user", "comparando respuestas y probando con cambios di a la solucion"),
    ("assistant", "Qué interesante. ¿Hubo alguna forma de medir qué tanto mejoró el resultado después de ajustar el prompt? ¿Hubo algún indicador o número que te mostrara el impacto?"),
    ("user", "No con numero pero si con experiencias de usuario podriamos decir que con lo que el usuario se sentia mas comodo ese fue nuestra metrica"),
    ("assistant", "Tiene sentido. Cambiando un poco de tema, ¿podrías compartirme alguna situación donde hayas tenido que trabajar en equipo para lograr un objetivo importante?"),
    ("user", "Si claro trabajando en una consultoria debo trabajar en equipo para lograr objetivos por ejemplo actualmente tenemos el objetivo que cada consultor alcance una carta de exito"),
    ("assistant", "Muy bien. Y en ese objetivo de que cada consultor alcance una carta de éxito, ¿qué hiciste tú específicamente para contribuir al equipo y alcanzar esa meta?"),
    ("user", "Yo soy desarrollador de momento soy ejecutor pero trato de cada vez que trabajo con un cliente entender el giro del negocio, buscar mas alla de lo que me piden y agregar un extra"),
    ("assistant", "Qué bueno que buscas agregar un extra. En alguna ocasión, ¿tuviste que comunicarte con alguien de un área diferente o con un cliente para explicarle algo técnico de una manera sencilla?"),
    ("user", "Si con el area de ventas o con el area de RRHH ahi tengo que dejar de usar lenguaje tecnico y usar analogias, resultados mas que como se hizo y que tecnologias se usan"),
    ("assistant", "Entiendo. ¿Y recuerdas alguna situación específica con el área de ventas o RRHH donde hayas aplicado esto? ¿Qué fue lo que les explicaste y cómo reaccionaron?"),
    ("user", "Si claro una vez tuve que explicar que era un LLM de frontera, ya que ese termino es muy tecnico me preguntaron que era ya que en ese momento yo asumi de manera erronea que lo conocian ese termino. Entonces les explique que era la IA mas capas del momento la mas lista y preparada, la que tienen las empresas top de IA actualmente. Esa explicacion basto para que entendieran el termino"),
    ("assistant", "Ya veo. Parece que supiste adaptar tu explicación muy bien. Muchas gracias por compartir tus experiencias conmigo. Ha sido muy útil. ¡Que tengas un excelente día!"),
]


async def part_a() -> list[str]:
    model_override = sys.argv[1] if len(sys.argv) > 1 else None
    req = ChatRequest(
        avatar_id="roberto",
        provider="groq",
        messages=[],
        greet=True,
        level="principiante",
        model=model_override,
    )
    res = await chat(req)
    # Plan 12/B: el turno debe traer usage + costo estimado (los modelos Groq
    # del selector estan todos tarifados en llm_costs.PRICING). Solo se exige
    # con el modelo default: un override puede no estar en la tabla.
    if not model_override:
        assert res.input_tokens and res.input_tokens > 0, "input_tokens vacio en /api/chat"
        assert res.cost_usd and res.cost_usd > 0, "cost_usd vacio en /api/chat (Groq default)"
    return [
        "=== A) Groq / Roberto (greet) ===",
        f"provider: {res.provider}",
        f"model: {res.model_name}",
        f"prompt_chars: {res.prompt_chars}",
        f"latency_ms: {res.latency_ms}",
        f"tokens: in={res.input_tokens} out={res.output_tokens}  cost_usd: {res.cost_usd}",
        f"reply: {res.reply[:200]}",
    ]


async def part_b() -> list[str]:
    """Gemini + entrevistador: ahora el banco usa el prompt MAESTRO por default."""
    try:
        req = ChatRequest(
            avatar_id="entrevistador",
            provider="gemini",
            messages=[],
            greet=True,
        )
        res = await chat(req)
        big = res.prompt_chars > 8000  # el maestro es ~26k; el de voz ~2.5k
        return [
            "=== B) Gemini / entrevistador (default = prompt maestro) ===",
            f"prompt_chars: {res.prompt_chars}  ({'OK maestro' if big else 'OJO: parece prompt de voz'})",
            f"model: {res.model_name}",
            f"latency_ms: {res.latency_ms}",
            f"tokens: in={res.input_tokens} out={res.output_tokens}  cost_usd: {res.cost_usd}",
            f"reply: {res.reply[:200]}",
        ]
    except Exception as e:
        return [
            "=== B) Gemini / entrevistador (default = prompt maestro) ===",
            f"ERROR (posible cuota Gemini agotada, 20/dia): {type(e).__name__}: {str(e)[:200]}",
        ]


async def part_chatgpt() -> list[str]:
    """ChatGPT / entrevistador: valida que la familia GPT-5 (razonamiento) corre
    sin romper por parametros. openai_llm ahora manda max_completion_tokens +
    reasoning_effort (no temperature/max_tokens) para gpt-5.x. Si no hay
    CHATGPT_API_KEY o el modelo no esta disponible, se registra sin tumbar.
    """
    try:
        req = ChatRequest(
            avatar_id="entrevistador",
            provider="chatgpt",
            messages=[],
            greet=True,
            model="gpt-5.4-mini",
        )
        res = await chat(req)
        return [
            "=== D) ChatGPT / entrevistador (gpt-5.4-mini, razonamiento) ===",
            f"model: {res.model_name}",
            f"prompt_chars: {res.prompt_chars}",
            f"latency_ms: {res.latency_ms}",
            f"tokens: in={res.input_tokens} out={res.output_tokens}  cost_usd: {res.cost_usd}",
            f"reply: {res.reply[:200]}",
        ]
    except Exception as e:
        return [
            "=== D) ChatGPT / entrevistador (gpt-5.4-mini, razonamiento) ===",
            f"ERROR (posible falta de CHATGPT_API_KEY o modelo no disponible): "
            f"{type(e).__name__}: {str(e)[:200]}",
        ]


async def part_c() -> list[str]:
    """Diagnostico de produccion sobre la charla real Eric<->Sofia (Gemini)."""
    req = DiagnosticoRequest(
        messages=[ChatMessage(role=r, content=c) for r, c in ERIC_GEMINI_CONV],
        user_profile={
            "registro": {
                "nombre": "Eric",
                "rol_objetivo": "Consultor de tecnología",
                "industria": "Tecnología",
                "experience_level": "mid",
            }
        },
    )
    res = await chat_diagnostico(req)
    d = res.diagnostico
    lines = [
        "=== C) Diagnóstico (Groq gpt-oss-120b) sobre charla Eric<->Sofia ===",
        f"latency_ms: {res.latency_ms}",
        f"saved: {res.saved}  diagnostic_id: {res.diagnostic_id}  save_error: {res.save_error}",
        f"is_demo: {d.get('is_demo')}",
        f"competencias_foco: {d.get('competencias_foco')}",
        f"strengths: {len(d.get('strengths') or [])}  gaps: {len(d.get('gaps') or [])}",
        "",
        "RESUMEN EJECUTIVO:",
        d.get("resumen_ejecutivo", "(vacío)"),
        "",
        "BLIND SPOT:",
        d.get("blind_spot", "(vacío)"),
        "",
        "PREGUNTA PARA LLEVARSE:",
        d.get("reflection_question", "(vacío)"),
        "",
        f"verbal_patterns: {d.get('verbal_patterns')}",
        f"recommended: {d.get('recommended_next_scenario')} / {d.get('recommended_next_level')}",
    ]
    for i, g in enumerate(d.get("gaps") or [], 1):
        lines.append(f"  gap {i} [{g.get('skill')}]: {g.get('evidence', '')[:120]}")
    return lines


async def main() -> str:
    blocks: list[list[str]] = []
    blocks.append(await part_a())
    blocks.append(await part_b())
    blocks.append(await part_chatgpt())
    blocks.append(await part_c())
    return "\n\n".join("\n".join(b) for b in blocks) + "\n"


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        out = asyncio.run(main())
        ok = True
    except Exception:
        out = traceback.format_exc()
        ok = False
    OUT.write_text(out, encoding="utf-8")
    sys.exit(0 if ok else 1)
