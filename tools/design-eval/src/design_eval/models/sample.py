"""Evaluation sample and ground truth data models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from PIL.Image import Image

from design_eval.models.dimensions import DesignDimension


@dataclass
class GroundTruth:
    """Ground truth for an evaluation sample.

    Different datasets populate different fields:
    - design2code: metric_scores (block_match, text, position, color, clip)
    - designbench_edit: issue_labels (change type as category)
    - designbench_repair: issue_labels + issue_codes + reasoning
    - gde: dimension_scores (60-rater consensus per quality category)
    """

    issue_labels: list[str] = field(default_factory=list)
    issue_codes: list[str] = field(default_factory=list)
    dimension_scores: dict[str, float] = field(default_factory=dict)
    metric_scores: dict[str, float] = field(default_factory=dict)
    reasoning: str | None = None
    dimensions: list[DesignDimension] = field(default_factory=list)


@dataclass
class EvalSample:
    """A single evaluation sample from any dataset.

    Fields are populated based on dataset type:
    - reference_image: always present (correct/target design)
    - candidate_image: generated/buggy/before-edit (None for some GDE examples)
    - mark_image: visual issue highlight (repair dataset only)
    - reference_code / candidate_code: HTML source (design2code only)
    - prompt: edit instruction (designbench_edit only)
    """

    id: str
    dataset: str  # "design2code" | "designbench_edit" | "designbench_repair" | "gde"
    reference_image: Image
    candidate_image: Image | None = None
    mark_image: Image | None = None
    reference_code: str | None = None
    candidate_code: str | None = None
    prompt: str | None = None
    ground_truth: GroundTruth = field(default_factory=GroundTruth)
    metadata: dict = field(default_factory=dict)
