"""
Estimacion de costo por turno de LLM para los logs del banco de pruebas.

Centraliza las tarifas (USD por 1M de tokens, input/output) de los tres motores
del ChatLab (Groq, Gemini, OpenAI) y expone `log_llm_cost()` para que cada
servicio loguee de forma uniforme cuanto costo cada llamada. Es SOLO para
observabilidad/comparacion: si un modelo no esta en la tabla, se loguean los
tokens sin costo estimado (y se avisa que falta la tarifa).

Tarifas verificadas 2026-07 en las paginas oficiales de precios. Notas:
- Gemini Pro tiene precio por tramos segun contexto; usamos el tramo <=200k
  tokens (el banco de pruebas no se acerca a ese limite).
- Los precios gpt-4.x de OpenAI son legacy (el modelo sigue en la API aunque se
  retiro de la UI de ChatGPT).
- No incluye descuentos por batch/cache: es el costo on-demand, el peor caso.
"""

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger("menteviva")


def _record_cost(provider: str, cost: float) -> None:
    """Agenda telemetria sin bloquear ni convertir el log en dependencia fatal."""
    try:
        from app.services.telemetry import increment

        loop = asyncio.get_running_loop()
        day = datetime.now(timezone.utc).date().isoformat()
        loop.create_task(
            increment(
                "llm_cost_micro_usd",
                max(0, round(cost * 1_000_000)),
                day=day,
                provider=provider,
            )
        )
    except RuntimeError:
        # Algunos scripts sincronos no tienen event loop; conservan el log.
        return

# provider -> {model_id: (input_usd_por_1M, output_usd_por_1M)}
PRICING: dict[str, dict[str, tuple[float, float]]] = {
    "groq": {
        "openai/gpt-oss-20b": (0.075, 0.30),
        "openai/gpt-oss-120b": (0.15, 0.60),
        "llama-3.3-70b-versatile": (0.59, 0.79),
        "llama-3.1-8b-instant": (0.05, 0.08),
    },
    "gemini": {
        "gemini-3.5-flash": (1.50, 9.00),
        "gemini-3.1-pro-preview": (2.00, 12.00),
        "gemini-3.1-flash-lite": (0.25, 1.50),
        "gemini-2.5-flash": (0.30, 2.50),
        "gemini-2.5-pro": (1.25, 10.00),
        "gemini-2.5-flash-lite": (0.10, 0.40),
    },
    "openai": {
        "gpt-5.5": (5.00, 30.00),
        "gpt-5.4": (2.50, 15.00),
        "gpt-5.4-mini": (0.75, 4.50),
        "gpt-5.4-nano": (0.20, 1.25),
        "gpt-4o": (2.50, 10.00),
        "gpt-4o-mini": (0.15, 0.60),
        "gpt-4.1": (2.00, 8.00),
        "gpt-4.1-mini": (0.40, 1.60),
        "gpt-4.1-nano": (0.10, 0.40),
    },
}


def price_for(provider: str, model: str) -> tuple[float, float] | None:
    """Tarifa (input, output) por 1M tok para (provider, model). Match exacto y,
    si no, por prefijo mas largo (tolera sufijos de fecha tipo gpt-4o-2024-08-06
    o gemini-2.5-flash-preview-XX)."""
    table = PRICING.get(provider, {})
    if model in table:
        return table[model]
    candidatos = [k for k in table if model.startswith(k)]
    if candidatos:
        return table[max(candidatos, key=len)]
    return None


def estimate_cost(
    provider: str, model: str, in_tok: int | None, out_tok: int | None
) -> float | None:
    """Costo estimado (USD) del turno, o None si el modelo no esta tarifado.

    Nota: los tokens de razonamiento (gpt-5, gemini "thinking") se facturan como
    output; el caller debe sumarlos a `out_tok` antes de llamar aqui.
    """
    price = price_for(provider, model)
    if not price:
        return None
    return (in_tok or 0) / 1e6 * price[0] + (out_tok or 0) / 1e6 * price[1]


def log_llm_cost(provider: str, model: str, in_tok: int | None, out_tok: int | None) -> float | None:
    """Loguea tokens + costo estimado (USD) del turno y lo devuelve. No-fatal:
    cualquier fallo se traga (el logueo de costo nunca debe romper un turno).
    """
    try:
        in_tok = in_tok or 0
        out_tok = out_tok or 0
        price = price_for(provider, model)
        if price:
            cost = estimate_cost(provider, model, in_tok, out_tok)
            logger.info(
                f"[costo][{provider}] modelo={model} in={in_tok} out={out_tok} tok "
                f"-> ~${cost:.6f} USD (${price[0]}/${price[1]} por 1M)"
            )
            _record_cost(provider, cost)
            return cost
        logger.info(
            f"[costo][{provider}] modelo={model} in={in_tok} out={out_tok} tok "
            f"-> precio no listado (agrega la tarifa a llm_costs.PRICING)"
        )
        return None
    except Exception as e:  # pragma: no cover - logging best-effort
        logger.warning(
            "[costo][%s] no se pudo calcular type=%s", provider, type(e).__name__
        )
        return None
