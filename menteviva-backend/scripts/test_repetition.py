"""Mide repeticion de Sofia (entrevistador) turno-a-turno.

Uso:
    poetry run python -m scripts.test_repetition

Simula un candidato evasivo / de respuestas cortas (el caso que en los logs
disparaba que Sofia calcara la misma pregunta en turnos seguidos). Corre la
conversacion sintetica a traves del service REAL `chat_stream` (asi ejercita
temperature + frequency_penalty + presence_penalty configurados) y reporta:

- Similitud Jaccard de palabras entre respuestas CONSECUTIVAS de Sofia.
- Solapamiento del arranque (primeras 4 palabras de la pregunta).
- Flag de "casi duplicado" si Jaccard >= UMBRAL.

Objetivo: ver pocas o cero parejas marcadas como casi-duplicadas y arranques
de pregunta variados. No es un test pass/fail estricto (el LLM es estocastico),
es una herramienta de inspeccion rapida tras tocar el prompt o los parametros.
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.prompts.scenarios import get_system_prompt  # noqa: E402
from app.services.groq_llm import chat_stream  # noqa: E402

# Umbral de similitud Jaccard sobre conjuntos de palabras: por encima de esto
# dos respuestas consecutivas son sospechosamente parecidas.
UMBRAL_DUPLICADO = 0.45

# Candidato evasivo: respuestas cortas, de bajo contenido, repetitivas. Es el
# perfil que mas tienta al modelo a re-preguntar lo mismo.
USER_TURNS = [
    "Pues nada en especial, un dia normal.",
    "No se, lo de siempre.",
    "Mmm, no recuerdo bien.",
    "Es lo mismo que ya te dije.",
    "No tengo mas detalles.",
    "Pues hago mi trabajo y ya.",
    "No se que mas decirte.",
    "Igual que antes.",
]

_PALABRA = re.compile(r"[a-záéíóúñü]+", re.IGNORECASE)


def _palabras(texto: str) -> set[str]:
    return {w.lower() for w in _PALABRA.findall(texto) if len(w) > 2}


def jaccard(a: str, b: str) -> float:
    sa, sb = _palabras(a), _palabras(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def arranque(texto: str, n: int = 4) -> str:
    # Arranque de la PREGUNTA (lo que va tras el ultimo punto, si hay acuse).
    pregunta = texto.split(".")[-1].strip() or texto
    return " ".join(pregunta.split()[:n]).lower()


async def correr_turno(history: list[dict], system_prompt: str) -> str:
    full = ""
    async for token in chat_stream(history, system_prompt):
        full += token
    return full.strip()


async def main():
    system_prompt = get_system_prompt("entrevistador", user_profile=None, session_vars=None)
    print(f"system_prompt: {len(system_prompt)} chars\n")

    history: list[dict] = [
        {"role": "assistant", "content": "Hola, soy Sofia. Para arrancar, ¿cómo va tu día?"},
    ]

    respuestas: list[str] = []
    for i, user_msg in enumerate(USER_TURNS, 1):
        if i > 1:
            # Pacing para no reventar el limite TPM del free tier de Groq
            # (los reintentos suman llamadas). Simula pausas humanas reales.
            await asyncio.sleep(8)
        history.append({"role": "user", "content": user_msg})
        try:
            sofia = await correr_turno(history, system_prompt)
        except Exception as e:
            sofia = f"[ERROR: {type(e).__name__}: {str(e)[:120]}]"
        history.append({"role": "assistant", "content": sofia})
        respuestas.append(sofia)
        print(f"--- Turno {i} ---")
        print(f"  Usuario: {user_msg}")
        print(f"  Sofia:   {sofia}\n")

    print("=" * 70)
    print("ANALISIS DE REPETICION (respuestas consecutivas de Sofia)")
    print("=" * 70)
    flags = 0
    for i in range(1, len(respuestas)):
        j = jaccard(respuestas[i - 1], respuestas[i])
        a_prev, a_cur = arranque(respuestas[i - 1]), arranque(respuestas[i])
        mismo_arranque = a_prev == a_cur
        dup = j >= UMBRAL_DUPLICADO or mismo_arranque
        if dup:
            flags += 1
        marca = "  <-- CASI DUPLICADO" if dup else ""
        print(f"  {i}->{i+1}: jaccard={j:.2f}  arranque_igual={mismo_arranque}{marca}")
        if mismo_arranque:
            print(f"         arranque repetido: \"{a_cur}...\"")

    print(f"\nParejas marcadas: {flags}/{len(respuestas) - 1}")
    if flags == 0:
        print("OK: sin repeticiones consecutivas evidentes.")
    else:
        print("REVISAR: hay respuestas consecutivas muy parecidas.")


if __name__ == "__main__":
    asyncio.run(main())
