"""
Pool de clientes Groq con rotación de API keys.

Distribuye las llamadas entre múltiples API keys para evitar rate limits.
"""

import logging
from threading import Lock
from groq import Groq
from app.config import settings

logger = logging.getLogger("menteviva")


class GroqPool:
    """Pool de clientes Groq con rotación round-robin."""

    def __init__(self):
        self._clients: list[Groq] = []
        self._index = 0
        self._lock = Lock()
        self._initialize()

    def _initialize(self):
        """Inicializa los clientes con las API keys disponibles."""
        keys = settings.groq_api_keys

        if not keys:
            logger.error("[GroqPool] No hay API keys de Groq configuradas!")
            return

        for i, key in enumerate(keys):
            client = Groq(api_key=key)
            self._clients.append(client)
            logger.info(f"[GroqPool] Cliente {i+1} inicializado (key: ...{key[-6:]})")

        logger.info(f"[GroqPool] Pool inicializado con {len(self._clients)} clientes")

    def get_client(self) -> Groq:
        """
        Obtiene el siguiente cliente en rotación round-robin.
        Thread-safe para uso concurrente.
        """
        if not self._clients:
            # Fallback: crear cliente con la key principal
            logger.warning("[GroqPool] No hay clientes en el pool, usando key principal")
            return Groq(api_key=settings.groq_api_key)

        with self._lock:
            client = self._clients[self._index]
            self._index = (self._index + 1) % len(self._clients)
            return client

    @property
    def client_count(self) -> int:
        """Número de clientes en el pool."""
        return len(self._clients)


# Instancia global del pool
groq_pool = GroqPool()


def get_groq_client() -> Groq:
    """Obtiene un cliente Groq del pool."""
    return groq_pool.get_client()
