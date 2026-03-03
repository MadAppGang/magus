"""JSON report generation."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from design_eval.metrics.aggregator import AggregatedReport


def generate_json_report(
    report: AggregatedReport,
    output_path: Path,
) -> Path:
    """Write aggregated results as JSON.

    Returns the path to the written file.
    """
    data = {
        "dimensions": {},
        "datasets": {},
    }

    for dim_name, agg in report.dimensions.items():
        data["dimensions"][dim_name] = {
            "overall_score": agg.overall_score,
            "dataset_scores": agg.dataset_scores,
            "num_datasets": agg.num_datasets,
        }

    for ds_name, result in report.dataset_results.items():
        data["datasets"][ds_name] = {
            "num_samples": result.num_samples,
            "aggregate_scores": result.aggregate_scores,
            "dimension_scores": result.dimension_scores,
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    return output_path
