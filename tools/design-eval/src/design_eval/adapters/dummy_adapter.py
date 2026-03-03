"""Dummy/random baseline adapter for testing and benchmarking."""

from __future__ import annotations

import random

from design_eval.models.dimensions import DesignDimension
from design_eval.models.output import Issue, ModelOutput
from design_eval.models.sample import EvalSample


class DummyModel:
    """Random baseline model that generates arbitrary issues and scores.

    Useful for testing the evaluation pipeline end-to-end and establishing
    a random-chance baseline for metrics.
    """

    def __init__(self, seed: int = 42) -> None:
        self.rng = random.Random(seed)

    def critique(self, sample: EvalSample) -> ModelOutput:
        """Generate random issues and dimension scores."""
        num_issues = self.rng.randint(0, 5)
        dimensions = list(DesignDimension)
        severities = ["critical", "major", "minor"]

        issues = [
            Issue(
                category=self.rng.choice(dimensions).value,
                severity=self.rng.choice(severities),
                description=f"Random issue #{i + 1} detected",
                confidence=round(self.rng.random(), 2),
            )
            for i in range(num_issues)
        ]

        dimension_scores = {
            dim.value: round(self.rng.uniform(0.0, 1.0), 3)
            for dim in dimensions
        }

        return ModelOutput(
            issues=issues,
            dimension_scores=dimension_scores,
            raw_response=None,
        )
