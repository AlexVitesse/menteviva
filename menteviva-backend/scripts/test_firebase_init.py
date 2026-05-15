"""Smoke test: Firebase Admin SDK arranca con la configuracion del .env."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.firebase_auth import _init_error, is_configured  # noqa: E402


def main():
    ok = is_configured()
    print(f"is_configured: {ok}")
    if not ok:
        print(f"init error: {_init_error}")
        sys.exit(1)
    print("Firebase Admin SDK OK")


if __name__ == "__main__":
    main()
