"""Markdown report generation."""

from __future__ import annotations

from pathlib import Path

from design_eval.metrics.aggregator import AggregatedReport


def generate_markdown_report(
    report: AggregatedReport,
    output_path: Path,
) -> Path:
    """Write aggregated results as a Markdown report.

    Returns the path to the written file.
    """
    lines: list[str] = []
    lines.append("# Design Critique Evaluation Report\n")

    # Cross-dataset dimension summary
    lines.append("## Dimension Summary\n")
    lines.append("| Dimension | Overall | " + " | ".join(
        sorted(report.dataset_results.keys())
    ) + " |")
    lines.append("|-----------|---------|" + "|".join(
        "---------" for _ in report.dataset_results
    ) + "|")

    datasets_sorted = sorted(report.dataset_results.keys())
    for dim_name, agg in sorted(report.dimensions.items()):
        row = f"| {dim_name} | {agg.overall_score:.3f} |"
        for ds in datasets_sorted:
            score = agg.dataset_scores.get(ds, "—")
            if isinstance(score, float):
                row += f" {score:.3f} |"
            else:
                row += f" {score} |"
        lines.append(row)

    lines.append("")

    # Per-dataset details
    lines.append("## Per-Dataset Results\n")
    for ds_name in datasets_sorted:
        result = report.dataset_results[ds_name]
        lines.append(f"### {ds_name}\n")
        lines.append(f"- **Samples:** {result.num_samples}")

        if result.aggregate_scores:
            lines.append(f"- **Scores:**")
            for k, v in sorted(result.aggregate_scores.items()):
                lines.append(f"  - {k}: {v:.4f}")

        if result.dimension_scores:
            lines.append(f"- **Dimension scores:**")
            for k, v in sorted(result.dimension_scores.items()):
                lines.append(f"  - {k}: {v:.4f}")

        lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines))
    return output_path
