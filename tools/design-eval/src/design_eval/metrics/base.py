"""Base Metric protocol that all metrics must satisfy."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Metric(Protocol):
    """Protocol for all evaluation metrics.

    A metric takes lists of predictions and references,
    computes a score, and returns a dict mapping score names to float values.
    """

    name: str

    def compute(self, predictions: list[Any], references: list[Any]) -> dict[str, float]:
        """Compute metric scores from predictions and references.

        Args:
            predictions: Model outputs to evaluate.
            references: Ground-truth values to compare against.

        Returns:
            Dict mapping score names to float values, e.g.
            {"precision": 0.85, "recall": 0.90, "f1": 0.87}.
        """
        ...
