"""Anthropic Claude adapter for design critique evaluation."""

from __future__ import annotations

import base64
import io
import json

from design_eval.models.output import Issue, ModelOutput
from design_eval.models.sample import EvalSample

SYSTEM_PROMPT = """You are a design critique expert. Analyze the provided design screenshot(s) and identify any visual design issues.

For each issue found, provide:
- category: one of "padding", "color", "typography", "alignment", "layout"
- severity: one of "critical", "major", "minor"
- description: brief explanation of the issue
- confidence: 0.0 to 1.0

Also provide overall dimension scores (0.0 to 1.0) for each category: padding, color, typography, alignment, layout.

Respond in JSON format:
{
  "issues": [{"category": "...", "severity": "...", "description": "...", "confidence": 0.0}],
  "dimension_scores": {"padding": 0.0, "color": 0.0, "typography": 0.0, "alignment": 0.0, "layout": 0.0}
}"""


def _image_to_base64(image) -> tuple[str, str]:
    """Convert a PIL image to base64 data and media type."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode()
    return b64, "image/png"


class AnthropicModel:
    """Claude adapter for design critique.

    Requires the `anthropic` package (install with `pip install design-eval[adapters]`).

    Args:
        model: Anthropic model name (default: "claude-sonnet-4-6").
        api_key: Anthropic API key. If None, reads from ANTHROPIC_API_KEY env var.
    """

    def __init__(self, model: str = "claude-sonnet-4-6", api_key: str | None = None) -> None:
        try:
            from anthropic import Anthropic
        except ImportError:
            raise ImportError(
                "anthropic package required. Install with: pip install design-eval[adapters]"
            )

        self.client = Anthropic(api_key=api_key)
        self.model = model

    def critique(self, sample: EvalSample) -> ModelOutput:
        """Send design screenshots to Claude and parse the critique response."""
        content: list[dict] = []

        # Add reference image
        b64, media_type = _image_to_base64(sample.reference_image)
        content.append({"type": "text", "text": "Reference design (correct/target):"})
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        })

        # Add candidate image if available
        if sample.candidate_image is not None:
            b64, media_type = _image_to_base64(sample.candidate_image)
            content.append({"type": "text", "text": "Candidate design (to evaluate):"})
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            })

        # Add prompt context if available
        if sample.prompt:
            content.append({"type": "text", "text": f"Edit instruction: {sample.prompt}"})

        content.append({
            "type": "text",
            "text": "Analyze the design and identify any visual issues. Respond in JSON only.",
        })

        response = self.client.messages.create(
            model=self.model,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
            max_tokens=2000,
        )

        raw = response.content[0].text
        return _parse_response(raw)


def _parse_response(raw: str) -> ModelOutput:
    """Parse JSON response into ModelOutput."""
    # Handle markdown code blocks
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if len(lines) > 2 else text

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
            confidence=float(item.get("confidence", 0.5)),
        ))

    dimension_scores = {}
    for k, v in data.get("dimension_scores", {}).items():
        dimension_scores[k] = float(v) if v is not None else 0.0

    return ModelOutput(
        issues=issues,
        dimension_scores=dimension_scores,
        raw_response=raw,
    )
