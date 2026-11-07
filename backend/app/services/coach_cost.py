import logging

logger = logging.getLogger(__name__)

# USD per million tokens
PRICES = {
    "claude-sonnet-5-5": {"input": 2.00, "output": 10.00, "cache_read": 0.20, "cache_write": 2.50},
    "claude-opus-5-5": {"input": 4.00, "output": 20.00, "cache_read": 0.20, "cache_write": 5.00},
}


def cost_usd(model: str, usage) -> float:
    prices = PRICES.get(model)
    if prices is None:
        logger.warning("No price for model %s; recording cost as 0", model)
        return 0.0
    return (
        usage.input_tokens * prices["input"]
        + usage.output_tokens * prices["output"]
        + (usage.cache_read_input_tokens or 0) * prices["cache_read"]
        + (usage.cache_creation_input_tokens or 0) * prices["cache_write"]
    ) / 1_000_000
