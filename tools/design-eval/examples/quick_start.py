"""Quick start: evaluate a design critique model on synthetic data."""

from pathlib import Path

from PIL import Image

from design_eval.adapters.dummy_adapter import DummyModel
from design_eval.evaluators.designbench_edit_eval import DesignBenchEditEvaluator
from design_eval.evaluators.gde_eval import GDEEvaluator
from design_eval.metrics.aggregator import aggregate_results
from design_eval.models.dimensions import DesignDimension
from design_eval.models.sample import EvalSample, GroundTruth
from design_eval.reporting.dimension_summary import print_dimension_summary
from design_eval.reporting.json_report import generate_json_report
from design_eval.reporting.markdown_report import generate_markdown_report

# ── 1. Create your model (or use the dummy baseline) ────────────────────

model = DummyModel(seed=42)

# To use your own model, just implement critique():
#
#   class MyModel:
#       def critique(self, sample: EvalSample) -> ModelOutput:
#           # analyze sample.reference_image, sample.candidate_image
#           return ModelOutput(issues=[...], dimension_scores={...})

# ── 2. Create some test samples ─────────────────────────────────────────

reference = Image.new("RGB", (200, 200), (255, 255, 255))
candidate = Image.new("RGB", (200, 200), (240, 240, 250))

gde_samples = [
    EvalSample(
        id="gde-1",
        dataset="gde",
        reference_image=reference,
        candidate_image=candidate,
        ground_truth=GroundTruth(
            dimension_scores={
                "alignment": 4.2,
                "whitespace": 3.8,
                "color_harmony": 4.0,
            },
        ),
    ),
]

edit_samples = [
    EvalSample(
        id="edit-1",
        dataset="designbench_edit",
        reference_image=reference,
        candidate_image=candidate,
        ground_truth=GroundTruth(issue_labels=["color"]),
    ),
    EvalSample(
        id="edit-2",
        dataset="designbench_edit",
        reference_image=reference,
        candidate_image=candidate,
        ground_truth=GroundTruth(issue_labels=["text", "position"]),
    ),
]

# ── 3. Run evaluation ───────────────────────────────────────────────────

gde_result = GDEEvaluator().evaluate(model, gde_samples)
edit_result = DesignBenchEditEvaluator().evaluate(model, edit_samples)

print("GDE scores:", gde_result.aggregate_scores)
print("Edit scores:", edit_result.aggregate_scores)

# ── 4. Aggregate across datasets and print summary ──────────────────────

report = aggregate_results([gde_result, edit_result])
print_dimension_summary(report)

# ── 5. Save reports ─────────────────────────────────────────────────────

out = Path("./results")
generate_json_report(report, out / "report.json")
generate_markdown_report(report, out / "report.md")
print(f"Reports saved to {out}/")
