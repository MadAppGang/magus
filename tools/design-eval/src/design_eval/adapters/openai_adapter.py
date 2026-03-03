"""OpenAI GPT-4V/4o adapter for design critique evaluation."""

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


def _image_to_base64(image) -> str:
    """Convert a PIL image to base64 data URI."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


class OpenAIModel:
    """GPT-4V/4o adapter for design critique.

    Requires the `openai` package (install with `pip install design-eval[adapters]`).

    Args:
        model: OpenAI model name (default: "gpt-4o").
        api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env var.
    """

    def __init__(self, model: str = "gpt-4o", api_key: str | None = None) -> None:
        try:
            from openai import OpenAI
        except ImportError:
            raise ImportError(
                "openai package required. Install with: pip install design-eval[adapters]"
            )

        self.client = OpenAI(api_key=api_key)
        self.model = model

    def critique(self, sample: EvalSample) -> ModelOutput:
        """Send design screenshots to GPT-4V and parse the critique response."""
        content: list[dict] = []

        # Add reference image
        content.append({"type": "text", "text": "Reference design (correct/target):"})
        content.append({
            "type": "image_url",
            "image_url": {"url": _image_to_base64(sample.reference_image)},
        })

        # Add candidate image if available
        if sample.candidate_image is not None:
            content.append({"type": "text", "text": "Candidate design (to evaluate):"})
            content.append({
                "type": "image_url",
                "image_url": {"url": _image_to_base64(sample.candidate_image)},
            })

        # Add prompt context if available
        if sample.prompt:
            content.append({"type": "text", "text": f"Edit instruction: {sample.prompt}"})

        content.append({
            "type": "text",
            "text": "Analyze the design and identify any visual issues. Respond in JSON.",
        })

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            response_format={"type": "json_object"},
            max_tokens=2000,
        )

        return _parse_response(response.choices[0].message.content or "{}")


def _parse_response(raw: str) -> ModelOutput:
    """Parse JSON response into ModelOutput."""
    try:
        data = json.loads(raw)
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
