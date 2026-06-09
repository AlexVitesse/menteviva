"""Mide latencia del LLM (Groq) con varios modelos.

Uso:
    poetry run python -m scripts.test_llm_latency

Compara el modelo configurado vs alternativas, con el system_prompt real
del entrevistador (Sofia) y una conversacion sintetica. Reporta time-to-first
-token (TTFT) y tiempo total por turno, varias corridas.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import settings  # noqa: E402
from app.prompts.scenarios import get_system_prompt  # noqa: E402
from app.services.groq_pool import get_groq_client  # noqa: E402

MODELS = ["openai/gpt-oss-20b", "llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
RUNS = 3
GAP_SECONDS = 15  # pausa entre runs para simular pacing real (no ráfaga TPM)

# Conversacion sintetica representativa de un turno del diagnostico.
CONVERSATION = [
    {"role": "assistant", "content": "Hola, soy Sofia. Cuentame, que te gustaria lograr hoy."},
    {"role": "user", "content": "Me encantaria poder llegar a una conclusion acerca de mis problemas el dia de hoy."},
]


def measure(client, model: str, system_prompt: str) -> tuple[float, float, int]:
    """Devuelve (ttft, total, n_tokens) en segundos para un turno streaming."""
    messages = [{"role": "system", "content": system_prompt}, *CONVERSATION]
    t0 = time.perf_counter()
    ttft = None
    n = 0
    stream = client.chat.completions.create(
        model=model,
        temperature=0.4,
        max_tokens=500,
        stream=True,
        messages=messages,
    )
    for chunk in stream:
        if chunk.choices[0].delta.content:
            if ttft is None:
                ttft = time.perf_counter() - t0
            n += 1
    total = time.perf_counter() - t0
    return (ttft or total), total, n


def main():
    print(f"Keys Groq activas: {len(settings.groq_api_keys)}")
    print(f"Modelo configurado (settings.groq_model_llm): {settings.groq_model_llm}\n")

    system_prompt = get_system_prompt("entrevistador", user_profile=None, session_vars=None)
    print(f"system_prompt: {len(system_prompt)} chars\n")

    client = get_groq_client()

    for model in MODELS:
        print(f"=== {model} ===")
        ttfts, totals = [], []
        for i in range(RUNS):
            if i > 0:
                time.sleep(GAP_SECONDS)
            try:
                ttft, total, n = measure(client, model, system_prompt)
                ttfts.append(ttft)
                totals.append(total)
                print(f"  run {i+1}: TTFT={ttft:5.2f}s  total={total:6.2f}s  ({n} tokens)")
            except Exception as e:
                print(f"  run {i+1}: ERROR {type(e).__name__}: {str(e)[:120]}")
        if totals:
            print(f"  --> total: min={min(totals):.2f}s  max={max(totals):.2f}s  "
                  f"avg={sum(totals)/len(totals):.2f}s")
        print()


if __name__ == "__main__":
    main()
