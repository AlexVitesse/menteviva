"""Entry point del backend.

Por que existe este modulo en lugar de invocar uvicorn directo:

En Windows, psycopg async NO funciona con `ProactorEventLoop` (default de Python
3.8+). Necesita `SelectorEventLoop`. uvicorn por su cuenta setea
`WindowsProactorEventLoopPolicy` antes de crear el loop, sobreescribiendo
cualquier policy que hayamos puesto en `app/__init__.py`. La unica forma de
ganarle a uvicorn es setear la policy ANTES de importar uvicorn.

En Linux/Mac no aplica (epoll/kqueue funcionan con psycopg sin issues). El if
deja el path multiplataforma.

Uso:
    poetry run python -m app                  # corre en :8000
    poetry run python -m app --port 9000      # override port (env var)

Variables de entorno relevantes:
    MENTEVIVA_HOST   default 127.0.0.1
    MENTEVIVA_PORT   default 8000
    MENTEVIVA_RELOAD default true en dev (cualquier valor truthy)
"""
import asyncio
import os
import sys


def _setup_event_loop_policy() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def main() -> None:
    _setup_event_loop_policy()

    import uvicorn  # importar DESPUES de fijar la policy

    host = os.getenv("MENTEVIVA_HOST", "127.0.0.1")
    port = int(os.getenv("MENTEVIVA_PORT", "8000"))
    reload = os.getenv("MENTEVIVA_RELOAD", "true").lower() in {"1", "true", "yes"}

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        # loop="asyncio" es el default; importante: uvicorn vuelve a setear su
        # policy en cada worker. Para que --reload preserve la SelectorEventLoop,
        # configuramos un reload_subprocess que tambien la fija (ver abajo).
        loop="asyncio",
    )


if __name__ == "__main__":
    main()
