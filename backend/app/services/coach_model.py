import os

import anthropic

ModelError = anthropic.AnthropicError

MAX_TOKENS = 8000


def model_name() -> str:
    return os.getenv("COACH_MODEL", "claude-sonnet-5-5")


def effort() -> str:
    return os.getenv("COACH_EFFORT", "medium")


def call_model(system, messages, tools):
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return client.messages.create(
        model=model_name(),
        max_tokens=MAX_TOKENS,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=messages,
        tools=tools,
        tool_choice={"type": "auto"},
        output_config={"effort": effort()},
    )
