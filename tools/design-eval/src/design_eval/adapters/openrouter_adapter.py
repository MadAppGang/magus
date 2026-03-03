"""OpenRouter adapter — access any model via OpenAI-compatible API."""

from __future__ import annotations

import base64
import io
import json
import os

from design_eval.models.output import Issue, ModelOutput
from design_eval.models.sample import EvalSample

SYSTEM_PROMPT = """You are a design critique expert. Analyze the provided design screenshot(s) and identify any visual design issues.

For each issue found, provide:
- category: one of "padding", "color", "typography", "alignment", "layout"
- severity: one of "critical", "major", "minor"
- description: brief explanation of the issue
- confidence: 0.0 to 1.0

Also provide overall dimension scores (0.0 to 1.0) for each category: padding, color, typography, alignment, layout.

Respond in JSON format only, no markdown:
{"issues": [{"category": "...", "severity": "...", "description": "...", "confidence": 0.0}], "dimension_scores": {"padding": 0.0, "color": 0.0, "typography": 0.0, "alignment": 0.0, "layout": 0.0}}"""


def _image_to_base64(image) -> str:
    """Convert a PIL image to base64 data URI."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


class OpenRouterModel:
    """OpenRouter adapter — works with any model that supports vision.

    Uses the OpenAI-compatible API at openrouter.ai.

    Args:
        model: OpenRouter model ID (e.g. "minimax/minimax-m2.5").
        api_key: OpenRouter API key. If None, reads from OPENROUTER_API_KEY.
    """

    def __init__(self, model: str, api_key: str | None = None) -> None:
        try:
            from openai import OpenAI
        except ImportError:
            raise ImportError(
                "openai package required. Install with: pip install design-eval[adapters]"
            )

        self.model = model
        self.client = OpenAI(
            api_key=api_key or os.environ.get("OPENROUTER_API_KEY", ""),
            base_url="https://openrouter.ai/api/v1",
        )

    def critique(self, sample: EvalSample) -> ModelOutput:
        """Send design screenshots and parse the critique response."""
        content: list[dict] = []

        content.append({"type": "text", "text": "Reference design (correct/target):"})
        content.append({
            "type": "image_url",
            "image_url": {"url": _image_to_base64(sample.reference_image)},
        })

        if sample.candidate_image is not None:
            content.append({"type": "text", "text": "Candidate design (to evaluate):"})
            content.append({
                "type": "image_url",
                "image_url": {"url": _image_to_base64(sample.candidate_image)},
            })

        if sample.prompt:
            content.append({"type": "text", "text": f"Edit instruction: {sample.prompt}"})

        content.append({
            "type": "text",
            "text": "Analyze the design and identify any visual issues. Respond in JSON only, no markdown.",
        })

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            max_tokens=2000,
        )

        raw = response.choices[0].message.content or "{}"
        return _parse_response(raw)


def _parse_response(raw: str) -> ModelOutput:
    """Parse JSON response into ModelOutput."""
    text = raw.strip()
    # Strip markdown code blocks
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if len(lines) > 2 else text
    # Find JSON object in response
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        text = text[start:end]

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return ModelOutput(raw_response=raw)

    issues = []
    for item in data.get("issues", []):
        issues.append(Issue(
            category=item.get("category", "layout"),
            severity=item.get("severity", "minor"),
            description=item.get("description", ""),
            confidence=float(item.get("confidence") or 0.5),
        ))

    dimension_scores = {}
    for k, v in data.get("dimension_scores", {}).items():
        dimension_scores[k] = float(v) if v is not None else 0.0

    return ModelOutput(
        issues=issues,
        dimension_scores=dimension_scores,
        raw_response=raw,
    )
