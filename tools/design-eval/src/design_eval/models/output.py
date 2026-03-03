"""Model output data models."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Issue:
    """A single design issue detected by a model."""

    category: str  # maps to DesignDimension
    severity: str  # "critical" | "major" | "minor"
    description: str
    confidence: float = 1.0
    location: dict | None = None  # optional bbox {x, y, w, h}


@dataclass
class ModelOutput:
    """Output from a design critique model for one sample."""

    issues: list[Issue] = field(default_factory=list)
    dimension_scores: dict[str, float] = field(default_factory=dict)
    raw_response: str | None = None
