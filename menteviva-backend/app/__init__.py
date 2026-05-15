"""
Mente Viva Backend - API para entrenamiento de soft skills con IA.
"""

__version__ = "0.1.0"

# Windows: psycopg async requiere SelectorEventLoop. El default de Python 3.8+
# en Windows es ProactorEventLoop, que rompe la integracion con libpq. Esto se
# fija a nivel de policy ANTES de que uvicorn (o cualquier asyncio.run) cree
# su loop, asi que vive en el __init__ del paquete que uvicorn importa primero.
# En Linux (epoll) no aplica — el if lo deja como no-op.
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
