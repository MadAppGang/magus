"""Shared test fixtures for design-eval."""

from __future__ import annotations

import pytest
from PIL import Image

from design_eval.models.dimensions import DesignDimension
from design_eval.models.output import Issue, ModelOutput
from design_eval.models.sample import EvalSample, GroundTruth


@pytest.fixture
def sample_image() -> Image.Image:
    """A 100x100 red test image."""
    return Image.new("RGB", (100, 100), color=(255, 0, 0))


@pytest.fixture
def alt_image() -> Image.Image:
    """A 100x100 blue test image."""
    return Image.new("RGB", (100, 100), color=(0, 0, 255))


@pytest.fixture
def sample_ground_truth() -> GroundTruth:
    """Ground truth with issue labels and dimension scores."""
    return GroundTruth(
        issue_labels=["color_mismatch", "spacing"],
        dimension_scores={"alignment": 0.8, "whitespace": 0.6},
        dimensions=[DesignDimension.COLOR, DesignDimension.PADDING],
    )


@pytest.fixture
def eval_sample(sample_image: Image.Image, alt_image: Image.Image, sample_ground_truth: GroundTruth) -> EvalSample:
    """A complete evaluation sample for testing."""
    return EvalSample(
        id="test-001",
        dataset="designbench_repair",
        reference_image=sample_image,
        candidate_image=alt_image,
        ground_truth=sample_ground_truth,
        metadata={"source": "test"},
    )


@pytest.fixture
def model_output() -> ModelOutput:
    """A sample model output with issues."""
    return ModelOutput(
        issues=[
            Issue(
                category="color",
                severity="major",
                description="Color mismatch in header",
                confidence=0.9,
            ),
            Issue(
                category="padding",
                severity="minor",
                description="Insufficient spacing",
                confidence=0.7,
            ),
        ],
        dimension_scores={
            "color": 0.4,
            "padding": 0.6,
            "typography": 0.8,
            "alignment": 0.9,
            "layout": 0.7,
        },
    )


@pytest.fixture
def gde_sample(sample_image: Image.Image, alt_image: Image.Image) -> EvalSample:
    """A GDE evaluation sample with 60-rater scores."""
    return EvalSample(
        id="gde-001",
        dataset="gde",
        reference_image=sample_image,
        candidate_image=alt_image,
        ground_truth=GroundTruth(
            dimension_scores={
                "alignment": 4.2,
                "whitespace": 3.8,
                "overlap": 4.5,
                "balance": 3.9,
                "consistency": 4.1,
                "color_harmony": 3.5,
                "readability": 4.0,
            },
        ),
    )


@pytest.fixture
def design2code_sample(sample_image: Image.Image, alt_image: Image.Image) -> EvalSample:
    """A Design2Code sample with HTML and metric scores."""
    return EvalSample(
        id="d2c-001",
        dataset="design2code",
        reference_image=sample_image,
        candidate_image=alt_image,
        reference_code="<html><body><h1>Hello</h1></body></html>",
        candidate_code="<html><body><h1>Hello</h1></body></html>",
        ground_truth=GroundTruth(
            metric_scores={
                "block_match": 0.85,
                "text": 0.92,
                "position": 0.78,
                "color": 0.88,
                "clip": 0.91,
            },
        ),
    )
