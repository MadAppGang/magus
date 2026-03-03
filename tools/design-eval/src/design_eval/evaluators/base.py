"""Base evaluator that all dataset-specific evaluators extend."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from design_eval.adapters.protocol import DesignCritiqueModel
from design_eval.models.output import ModelOutput
from design_eval.models.sample import EvalSample


@dataclass
class EvalResult:
    """Result of evaluating a single sample."""

    sample_id: str
    dataset: str
    scores: dict[str, float] = field(default_factory=dict)
    dimension_scores: dict[str, float] = field(default_factory=dict)
    details: dict = field(default_factory=dict)


@dataclass
class DatasetEvalResult:
    """Aggregate result for an entire dataset."""

    dataset: str
    num_samples: int
    aggregate_scores: dict[str, float] = field(default_factory=dict)
    dimension_scores: dict[str, float] = field(default_factory=dict)
    per_sample: list[EvalResult] = field(default_factory=list)


class BaseEvaluator(ABC):
    """Base class for dataset-specific evaluators.

    Subclasses implement `evaluate_sample` to score a single sample.
    This base handles iteration, model invocation, and aggregation.
    """

    dataset_name: str

    @abstractmethod
    def evaluate_sample(
        self, sample: EvalSample, output: ModelOutput
    ) -> EvalResult:
        """Evaluate a single sample against model output."""

    def evaluate(
        self,
        model: DesignCritiqueModel,
        samples: list[EvalSample],
    ) -> DatasetEvalResult:
        """Run the model on all samples and aggregate results."""
        per_sample: list[EvalResult] = []

        for sample in samples:
            output = model.critique(sample)
            result = self.evaluate_sample(sample, output)
            per_sample.append(result)

        return self._aggregate(per_sample)

    def _aggregate(self, results: list[EvalResult]) -> DatasetEvalResult:
        """Aggregate per-sample results into dataset-level scores."""
        if not results:
            return DatasetEvalResult(
                dataset=self.dataset_name,
                num_samples=0,
            )

        # Average all score keys across samples
        all_keys = set()
        for r in results:
            all_keys.update(r.scores.keys())

        agg_scores: dict[str, float] = {}
        for key in sorted(all_keys):
            values = [r.scores[key] for r in results if key in r.scores]
            agg_scores[key] = sum(values) / len(values) if values else 0.0

        # Average dimension scores
        dim_keys = set()
        for r in results:
            dim_keys.update(r.dimension_scores.keys())

        agg_dims: dict[str, float] = {}
        for key in sorted(dim_keys):
            values = [r.dimension_scores[key] for r in results if key in r.dimension_scores]
            agg_dims[key] = sum(values) / len(values) if values else 0.0

        return DatasetEvalResult(
            dataset=self.dataset_name,
            num_samples=len(results),
            aggregate_scores=agg_scores,
            dimension_scores=agg_dims,
            per_sample=results,
        )
