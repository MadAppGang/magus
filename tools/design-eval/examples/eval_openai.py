"""Quick eval: OpenAI GPT-4o on synthetic samples."""
from PIL import Image
from design_eval.adapters.openai_adapter import OpenAIModel
from design_eval.evaluators.gde_eval import GDEEvaluator
from design_eval.evaluators.designbench_edit_eval import DesignBenchEditEvaluator
from design_eval.metrics.aggregator import aggregate_results
from design_eval.reporting.dimension_summary import print_dimension_summary
from design_eval.models.sample import EvalSample, GroundTruth

print("=== OPENAI (GPT-4o) Evaluation ===")
model = OpenAIModel(model="gpt-4o")
img_ref = Image.new("RGB", (200, 200), (255, 255, 255))
img_bad = Image.new("RGB", (200, 200), (240, 230, 250))

gde_samples = [
    EvalSample(
        id="gde-1", dataset="gde",
        reference_image=img_ref, candidate_image=img_bad,
        ground_truth=GroundTruth(
            dimension_scores={"alignment": 4.2, "whitespace": 3.8, "color_harmony": 4.0}
        ),
    ),
]
edit_samples = [
    EvalSample(
        id="edit-1", dataset="designbench_edit",
        reference_image=img_ref, candidate_image=img_bad,
        ground_truth=GroundTruth(issue_labels=["color"]),
    ),
    EvalSample(
        id="edit-2", dataset="designbench_edit",
        reference_image=img_ref, candidate_image=img_bad,
        ground_truth=GroundTruth(issue_labels=["text"]),
    ),
]

print("Running GDE eval...")
gde_r = GDEEvaluator().evaluate(model, gde_samples)
print(f"GDE: {gde_r.aggregate_scores}")

print("Running Edit eval...")
edit_r = DesignBenchEditEvaluator().evaluate(model, edit_samples)
print(f"Edit: {edit_r.aggregate_scores}")

report = aggregate_results([gde_r, edit_r])
print_dimension_summary(report)
print("DONE")
