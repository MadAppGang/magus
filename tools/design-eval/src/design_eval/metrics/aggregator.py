"""Cross-dataset dimension score aggregation.

Combines dimension scores from multiple dataset evaluations into
a single unified view across the 5 design dimensions.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from design_eval.evaluators.base import DatasetEvalResult
from design_eval.models.dimensions import DesignDimension


@dataclass
class DimensionAggregation:
    """Aggregated score for one design dimension across datasets."""

    dimension: str
    overall_score: float
    dataset_scores: dict[str, float] = field(default_factory=dict)
    num_datasets: int = 0


@dataclass
class AggregatedReport:
    """Cross-dataset aggregated results."""

    dimensions: dict[str, DimensionAggregation] = field(default_factory=dict)
    dataset_results: dict[str, DatasetEvalResult] = field(default_factory=dict)


def aggregate_results(
    results: list[DatasetEvalResult],
) -> AggregatedReport:
    """Aggregate evaluation results across datasets by dimension.

    For each unified dimension, averages scores from all datasets
    that contribute to that dimension.
    """
    report = AggregatedReport()

    # Store individual dataset results
    for r in results:
        report.dataset_results[r.dataset] = r

    # Collect scores per dimension across datasets
    dim_scores: dict[str, list[tuple[str, float]]] = {
        d.value: [] for d in DesignDimension
    }

    for r in results:
        for dim_name, score in r.dimension_scores.items():
            if dim_name in dim_scores:
                dim_scores[dim_name].append((r.dataset, score))

    # Build aggregation
    for dim_name, entries in dim_scores.items():
        ds_scores = {dataset: score for dataset, score in entries}
        overall = sum(ds_scores.values()) / len(ds_scores) if ds_scores else 0.0

        report.dimensions[dim_name] = DimensionAggregation(
            dimension=dim_name,
            overall_score=round(overall, 4),
            dataset_scores=ds_scores,
            num_datasets=len(ds_scores),
        )

    return report
