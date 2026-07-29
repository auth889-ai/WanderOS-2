"""Single Claude access layer — the Experience Director's brain.

Route order is deliberate: **Bedrock first** so reasoning runs on AWS credits,
then the direct Anthropic API if a key is present, then nothing (callers fall
back to deterministic rules and say so honestly).

Bedrock and the first-party API take slightly different request shapes — Bedrock
wants ``anthropic_version`` in the body and no ``model`` field, and it prefers
the ``us.`` inference-profile prefix for current models — so this module owns
that difference and hands callers one ``complete()`` signature.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from app.config.settings import settings

# Preference order. Opus 5 for judgement quality; Haiku is the cheap fast path.
BEDROCK_MODELS = [
    "us.anthropic.claude-opus-5",
    "us.anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
]


class ClaudeUnavailable(RuntimeError):
    """No Claude route is usable — caller must degrade and disclose it."""


@lru_cache(maxsize=1)
def _bedrock():
    import boto3

    return boto3.Session(
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=settings.aws_region,
    ).client("bedrock-runtime")


_RESOLVED_MODEL: str | None = None


@lru_cache(maxsize=1)
def route() -> str:
    """Which Claude route works: 'bedrock' | 'anthropic' | 'none'.

    Probed once with a 1-token call per candidate — an account may be entitled to
    Sonnet but not Opus, so the first model that actually *answers* is the one we
    keep. Probing beats assuming: a model listed as ACTIVE can still be denied.
    """
    global _RESOLVED_MODEL
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        for model in BEDROCK_MODELS:
            try:
                _bedrock().invoke_model(
                    modelId=model,
                    body=json.dumps({
                        "anthropic_version": "bedrock-2023-05-31",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    }),
                )
                _RESOLVED_MODEL = model
                return "bedrock"
            except Exception:
                continue
    if settings.anthropic_api_key:
        return "anthropic"
    return "none"


def _bedrock_model() -> str:
    if _RESOLVED_MODEL is None:
        route()  # resolve on first use
    return _RESOLVED_MODEL or BEDROCK_MODELS[-1]


def describe() -> str:
    """Human-readable provenance string — recorded on every verdict."""
    r = route()
    if r == "bedrock":
        return f"{_bedrock_model()} (AWS Bedrock)"
    if r == "anthropic":
        return f"{settings.critic_model} (Anthropic API)"
    return "unavailable"


def complete(
    prompt: str,
    *,
    image_jpeg: bytes | None = None,
    schema: dict[str, Any] | None = None,
    max_tokens: int = 2048,
) -> dict[str, Any]:
    """One reasoning call. Returns parsed JSON when ``schema`` is given.

    Raises ClaudeUnavailable when no route works, so callers can degrade with a
    label rather than silently pretending an AI judged something.
    """
    content: list[dict[str, Any]] = []
    if image_jpeg is not None:
        import base64

        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg",
                       "data": base64.standard_b64encode(image_jpeg).decode()},
        })
    instruction = prompt
    if schema is not None:
        instruction += ("\n\nReply with ONLY a JSON object matching this schema, "
                        "no prose, no code fences:\n" + json.dumps(schema))
    content.append({"type": "text", "text": instruction})

    r = route()
    if r == "bedrock":
        response = _bedrock().invoke_model(
            modelId=_bedrock_model(),
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": content}],
            }),
        )
        text = json.loads(response["body"].read())["content"][0]["text"]
    elif r == "anthropic":
        import anthropic

        message = anthropic.Anthropic(api_key=settings.anthropic_api_key).messages.create(
            model=settings.critic_model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": content}],
        )
        if message.stop_reason == "refusal":
            raise ClaudeUnavailable("Claude declined this request")
        text = message.content[0].text
    else:
        raise ClaudeUnavailable(
            "no Claude route: enable Anthropic models in the Bedrock console "
            "(Model access) or set ANTHROPIC_API_KEY"
        )

    if schema is None:
        return {"text": text}
    return _parse_json(text)


def _parse_json(text: str) -> dict[str, Any]:
    cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(cleaned[start:end + 1])
