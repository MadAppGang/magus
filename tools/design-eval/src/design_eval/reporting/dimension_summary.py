"""Cross-dataset dimension summary table generation."""

from __future__ import annotations

from design_eval.metrics.aggregator import AggregatedReport


def format_dimension_table(report: AggregatedReport) -> str:
    """Format the cross-dataset dimension summary as a text table.

    Returns a formatted string showing each dimension's scores
    across all evaluated datasets plus the overall average.
    """
    datasets = sorted(report.dataset_results.keys())

    # Column widths
    dim_width = 14
    score_width = 10
    header = f"{'Dimension':<{dim_width}} {'Overall':>{score_width}}"
    for ds in datasets:
        header += f" {ds:>{score_width}}"

    separator = "-" * len(header)

    rows = [header, separator]
    for dim_name in sorted(report.dimensions.keys()):
        agg = report.dimensions[dim_name]
        row = f"{dim_name:<{dim_width}} {agg.overall_score:>{score_width}.4f}"
        for ds in datasets:
            score = agg.dataset_scores.get(ds)
            if score is not None:
                row += f" {score:>{score_width}.4f}"
            else:
                row += f" {'—':>{score_width}}"
        rows.append(row)

    return "\n".join(rows)


def print_dimension_summary(report: AggregatedReport) -> None:
    """Print the cross-dataset dimension summary to stdout."""
    print("\n" + format_dimension_table(report) + "\n")
