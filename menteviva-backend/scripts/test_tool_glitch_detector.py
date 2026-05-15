"""Verifica que _is_tool_use_glitch reconoce el error real y descarta otros."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import groq  # noqa: E402

from app.services.groq_llm import (  # noqa: E402
    FALLBACK_MODEL,
    _is_tool_use_glitch,
)


class FakeAPIError(groq.APIError):
    """Mimic la APIError de groq sin tener que hacer un request real."""

    def __init__(self, msg: str):
        self.message = msg

    def __str__(self):
        return self.message


def main():
    print(f"FALLBACK_MODEL = {FALLBACK_MODEL}")

    cases = [
        # (descripcion, error, esperado)
        ("Tool choice is none, but model called a tool", FakeAPIError("Tool choice is none, but model called a tool"), True),
        ("variant 'tool' lowercase", FakeAPIError("tool choice is none"), True),
        ("variant 'called a tool'", FakeAPIError("Model called a tool unexpectedly"), True),
        ("Rate limit (no tool)", FakeAPIError("Rate limit exceeded"), False),
        ("ValueError generico", ValueError("something else"), False),
        ("APIError sin keyword 'tool'", FakeAPIError("invalid request"), False),
    ]

    fails = 0
    for desc, err, expected in cases:
        got = _is_tool_use_glitch(err)
        ok = got == expected
        mark = "OK" if ok else "FAIL"
        print(f"  [{mark}] {desc!r:55s} -> got={got}, expected={expected}")
        if not ok:
            fails += 1

    if fails:
        print(f"\n{fails}/{len(cases)} fallaron")
        sys.exit(1)
    print(f"\n{len(cases)}/{len(cases)} OK")


if __name__ == "__main__":
    main()
