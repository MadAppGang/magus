"""DesignBench Edit evaluator — issue classification vs change labels.

Each DesignBench edit sample has a before/after pair with a known change
type (text, color, position, size). The model must detect what kind of
design change occurred. We evaluate with macro P/R/F1.
"""

from __future__ import annotations

from design_eval.evaluators.base import BaseEvaluator, EvalResult
from design_eval.models.dimensions import DESIGNBENCH_EDIT_MAP, DesignDimension
from design_eval.models.output import ModelOutput
from design_eval.models.sample import EvalSample


class DesignBenchEditEvaluator(BaseEvaluator):
    """Evaluator for DesignBench edit pairs."""

    dataset_name = "designbench_edit"

    def evaluate_sample(
        self, sample: EvalSample, output: ModelOutput
    ) -> EvalResult:
        """Compare model-detected issues against ground truth change type.

        Maps the ground truth change label and the model's detected
        issue categories to unified dimensions, then computes accuracy.
        """
        # Ground truth: map edit labels to dimensions
        gt_dimensions = set()
        for label in sample.ground_truth.issue_labels:
            dim = DESIGNBENCH_EDIT_MAP.get(label.lower())
            if dim:
                gt_dimensions.add(dim.value)

        # Predicted: map issue categories to dimensions
        pred_dimensions = set()
        for issue in output.issues:
            cat = issue.category.lower()
            # Direct dimension match
            if cat in {d.value for d in DesignDimension}:
                pred_dimensions.add(cat)
            else:
                dim = DESIGNBENCH_EDIT_MAP.get(cat)
                if dim:
                    pred_dimensions.add(dim.value)

        # Convert to binary presence per dimension for scoring
        all_dims = [d.value for d in DesignDimension]
        gt_labels = [1.0 if d in gt_dimensions else 0.0 for d in all_dims]
        pred_labels = [1.0 if d in pred_dimensions else 0.0 for d in all_dims]

        # Compute per-dimension accuracy
        correct = sum(1 for g, p in zip(gt_labels, pred_labels) if g == p)
        accuracy = correct / len(all_dims)

        # Exact match on detected dimensions
        exact_match = 1.0 if gt_dimensions == pred_dimensions else 0.0

        # Precision/recall on dimension detection
        true_positives = len(gt_dimensions & pred_dimensions)
        precision = true_positives / len(pred_dimensions) if pred_dimensions else 0.0
        recall = true_positives / len(gt_dimensions) if gt_dimensions else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) > 0
            else 0.0
        )

        dim_scores = {d: (1.0 if d in gt_dimensions & pred_dimensions else 0.0) for d in all_dims}

        return EvalResult(
            sample_id=sample.id,
            dataset=self.dataset_name,
            scores={
                "accuracy": accuracy,
                "exact_match": exact_match,
                "precision": precision,
                "recall": recall,
                "f1": f1,
            },
            dimension_scores=dim_scores,
            details={
                "gt_labels": sorted(gt_dimensions),
                "pred_labels": sorted(pred_dimensions),
            },
        )
