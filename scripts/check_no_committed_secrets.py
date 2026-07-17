"""Chequeo conservador de secretos que nunca deben estar versionados."""

from __future__ import annotations

import subprocess
from pathlib import Path


ALLOWED_ENV_FILES = {
    Path("menteviva-frontend/.env.production"),  # solo variables publicas VITE_*
}
SENSITIVE_NAMES = {
    "service-account.json",
    "firebase-service-account.json",
    "credentials.json",
}
PRIVATE_KEY_MARKER = "-----BEGIN PRIVATE KEY-----"


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "-c", "safe.directory=*", "ls-files", "-z"],
        check=True,
        capture_output=True,
    )
    return [Path(item.decode()) for item in result.stdout.split(b"\0") if item]


def main() -> int:
    violations: list[str] = []
    for path in tracked_files():
        if path.name.startswith(".env") and path.name != ".env.example" and path not in ALLOWED_ENV_FILES:
            violations.append(f"archivo de entorno versionado: {path}")
        if path.name.lower() in SENSITIVE_NAMES:
            violations.append(f"archivo de credenciales versionado: {path}")
        try:
            if PRIVATE_KEY_MARKER in path.read_text(encoding="utf-8", errors="ignore"):
                violations.append(f"clave privada encontrada: {path}")
        except OSError:
            continue

    if violations:
        print("Se encontraron posibles secretos:")
        for violation in violations:
            print(f"- {violation}")
        return 1
    print("Chequeo de secretos versionados: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
