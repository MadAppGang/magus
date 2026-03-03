"""Design critique model protocol — the interface models must implement."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from design_eval.models.output import ModelOutput
from design_eval.models.sample import EvalSample


@runtime_checkable
class DesignCritiqueModel(Protocol):
    """Protocol for design critique models.

    Any class with a `critique` method matching this signature can be used
    as an evaluation target — no inheritance required (structural subtyping).
    """

    def critique(self, sample: EvalSample) -> ModelOutput:
        """Analyze a design sample and return detected issues + scores."""
        ...
