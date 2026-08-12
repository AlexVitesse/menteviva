"""Fachada de routing para conversación.

La implementación del ciclo de vida vive en ``services.conversation_session``;
proveedores, protocolo, turnos y finalización están separados en sus módulos.
El alias de módulo mantiene compatibles los imports y monkeypatches históricos
mientras los consumidores migran a los servicios explícitos.
"""

import sys

from app.services import conversation_session as _session

sys.modules[__name__] = _session
