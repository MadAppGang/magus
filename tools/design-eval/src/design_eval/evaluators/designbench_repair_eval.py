"""DesignBench Repair evaluator — issue detection accuracy.

The repair dataset has buggy + fixed screenshots with known issue codes.
The model must detect what issues exist. We evaluate detection accuracy
and provide qualitative comparison with ground truth reasoning.
"""

from __future__ import annotations

from design_eval.evaluators.base import BaseEvaluator, EvalResult
from design_eval.models.dimensions import DESIGNBENCH_REPAIR_MAP, DesignDimension
from design_eval.models.output import ModelOutput
from design_eval.models.sample import EvalSample


class DesignBenchRepairEvaluator(BaseEvaluator):
    """Evaluator for DesignBench repair triples.

    Note: Only 28 examples — results should include confidence intervals.
    """

    dataset_name = "designbench_repair"

    def evaluate_sample(
        self, sample: EvalSample, output: ModelOutput
    ) -> EvalResult:
        """Compare model-detected issues against ground truth issue codes.

        Maps issue codes and model output to unified dimensions,
        then computes detection precision, recall, and F1.
        """
        # Ground truth: map issue codes to dimensions
        gt_dimensions = set()
        for code in sample.ground_truth.issue_codes:
            dim = DESIGNBENCH_REPAIR_MAP.get(code.lower())
            if dim:
                gt_dimensions.add(dim.value)
        # Also use pre-mapped dimensions from ground truth
        for dim in sample.ground_truth.dimensions:
            gt_dimensions.add(dim.value)

        # Predicted: map issue categories to dimensions
        pred_dimensions = set()
        for issue in output.issues:
            cat = issue.category.lower()
            if cat in {d.value for d in DesignDimension}:
                pred_dimensions.add(cat)
            else:
                dim = DESIGNBENCH_REPAIR_MAP.get(cat)
                if dim:
                    pred_dimensions.add(dim.value)

        # Detection metrics
        true_positives = len(gt_dimensions & pred_dimensions)
        false_positives = len(pred_dimensions - gt_dimensions)
        false_negatives = len(gt_dimensions - pred_dimensions)

        precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0.0
        recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

        # Issue count accuracy
        gt_count = len(sample.ground_truth.issue_codes) or len(gt_dimensions)
        pred_count = len(output.issues)
        count_ratio = min(gt_count, pred_count) / max(gt_count, pred_count) if max(gt_count, pred_count) > 0 else 1.0

        # Per-dimension hit/miss
        all_dims = [d.value for d in DesignDimension]
        dim_scores = {}
        for d in all_dims:
            if d in gt_dimensions:
                dim_scores[d] = 1.0 if d in pred_dimensions else 0.0

        return EvalResult(
            sample_id=sample.id,
            dataset=self.dataset_name,
            scores={
                "precision": precision,
                "recall": recall,
                "f1": f1,
                "count_accuracy": count_ratio,
                "true_positives": float(true_positives),
                "false_positives": float(false_positives),
                "false_negatives": float(false_negatives),
            },
            dimension_scores=dim_scores,
            details={
                "gt_issue_codes": sample.ground_truth.issue_codes,
                "gt_dimensions": sorted(gt_dimensions),
                "pred_dimensions": sorted(pred_dimensions),
                "gt_reasoning": sample.ground_truth.reasoning,
            },
        )
