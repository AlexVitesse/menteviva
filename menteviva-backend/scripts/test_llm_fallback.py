"""
Test ligero de la logica de reintento/fallback de groq_llm.

A diferencia del resto de scripts/test_*.py, este NO pega a la API real de Groq:
mockea `get_groq_client` con un cliente falso que devuelve respuestas/errores
guionados. Asi ejercita de forma determinista las ramas dificiles de disparar
en vivo (glitch de tool-use, respuesta vacia, error real) SIN gastar la cuota
free-tier (TPM). Corre en milisegundos y sin red.

Cubre:
- chat_stream: glitch->ok, glitch->glitch (re-enganche), vacio->vacio
  (re-enganche), vacio->ok, error real (propaga), glitch->error real (propaga).
- chat_complete: None->ok, None->None (re-enganche), glitch->ok,
  error real (propaga).

Uso:
    cd menteviva-backend
    poetry run python -m scripts.test_llm_fallback
"""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import groq

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import groq_llm  # noqa: E402


# --- Builders de respuestas/errores estilo SDK de Groq -----------------------

def _glitch() -> groq.APIError:
    """El bug intermitente de tool-calling de gpt-oss-20b."""
    return groq.APIError(
        "Tool choice is none, but model called a tool",
        httpx.Request("POST", "https://api.groq.com"),
        body=None,
    )


def _real_error() -> groq.APIError:
    """Un error de verdad (p.ej. 429) que NO es el glitch -> debe propagarse."""
    return groq.APIError(
        "rate limit reached for model gpt-oss-20b",
        httpx.Request("POST", "https://api.groq.com"),
        body=None,
    )


def _stream(*contents):
    """Iterable de chunks estilo streaming. None/'' simulan deltas sin texto."""
    return [
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=c))])
        for c in contents
    ]


def _completion(content):
    """Respuesta no-streaming; content puede ser None (modelo 'razono' vacio)."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


class FakeClient:
    """create() consume una lista de acciones: si es excepcion la lanza, si no la devuelve."""

    def __init__(self, actions):
        self._actions = list(actions)
        self.calls = 0
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=self._create)
        )

    def _create(self, **kwargs):
        self.calls += 1
        if not self._actions:
            raise AssertionError("create() llamado mas veces de las guionadas")
        action = self._actions.pop(0)
        if isinstance(action, BaseException):
            raise action
        return action


def _install(actions) -> FakeClient:
    fake = FakeClient(actions)
    groq_llm.get_groq_client = lambda: fake  # monkeypatch del binding del modulo
    return fake


# --- Drivers -----------------------------------------------------------------

async def _drive_stream() -> str:
    out = ""
    async for tok in groq_llm.chat_stream([{"role": "user", "content": "no se"}], "sys"):
        out += tok
    return out


# --- Aserciones --------------------------------------------------------------

_passed = 0
_failed = 0


def _check(name: str, cond: bool, detail: str = ""):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  PASS  {name}")
    else:
        _failed += 1
        print(f"  FAIL  {name}{(' -> ' + detail) if detail else ''}")


def _is_reengage(text: str) -> bool:
    return text in groq_llm._REENGAGE_FALLBACKS


async def main():
    print("chat_stream:")

    _install([_glitch(), _stream("Hola ", "qué tal")])
    out = await _drive_stream()
    _check("glitch -> reintento ok", out == "Hola qué tal", repr(out))

    _install([_glitch(), _glitch()])
    out = await _drive_stream()
    _check("glitch -> glitch -> re-enganche (NO propaga)", _is_reengage(out), repr(out))

    _install([_stream(), _stream()])
    out = await _drive_stream()
    _check("vacio -> vacio -> re-enganche", _is_reengage(out), repr(out))

    _install([_stream(None, ""), _stream("Cuéntame", " más")])
    out = await _drive_stream()
    _check("vacio -> reintento ok", out == "Cuéntame más", repr(out))

    _install([_real_error()])
    try:
        await _drive_stream()
        _check("error real propaga", False, "no lanzo")
    except groq.APIError:
        _check("error real propaga", True)

    _install([_glitch(), _real_error()])
    try:
        await _drive_stream()
        _check("glitch -> error real propaga", False, "no lanzo")
    except groq.APIError:
        _check("glitch -> error real propaga", True)

    print("chat_complete:")

    _install([_completion(None), _completion("Respuesta")])
    out = await groq_llm.chat_complete([{"role": "user", "content": "x"}], "sys")
    _check("None -> reintento ok", out == "Respuesta", repr(out))

    _install([_completion(None), _completion("")])
    out = await groq_llm.chat_complete([{"role": "user", "content": "x"}], "sys")
    _check("None -> None -> re-enganche (no crashea con .strip)", _is_reengage(out), repr(out))

    _install([_glitch(), _completion("Ok")])
    out = await groq_llm.chat_complete([{"role": "user", "content": "x"}], "sys")
    _check("glitch -> reintento ok", out == "Ok", repr(out))

    _install([_real_error()])
    try:
        await groq_llm.chat_complete([{"role": "user", "content": "x"}], "sys")
        _check("error real propaga", False, "no lanzo")
    except groq.APIError:
        _check("error real propaga", True)

    print(f"\n{_passed} passed, {_failed} failed")
    return 1 if _failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
