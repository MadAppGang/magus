"""Design2Code evaluator — full block-level visual scoring.

Uses the vendored Design2Code metrics to compute 5-component scores:
size, text, position, color, CLIP. Each maps to a unified dimension.

This evaluator requires blocks extracted from screenshots. When pre-computed
blocks are unavailable, it falls back to comparing model dimension scores
against ground truth metric scores.
"""

from __future__ import annotations

from design_eval.evaluators.base import BaseEvaluator, EvalResult
from design_eval.metrics.design2code.visual_score import compute_block_scores
from design_eval.models.dimensions import DESIGN2CODE_METRIC_MAP
from design_eval.models.output import ModelOutput
from design_eval.models.sample import EvalSample


class Design2CodeEvaluator(BaseEvaluator):
    """Evaluator for Design2Code web page reproductions."""

    dataset_name = "design2code"

    def evaluate_sample(
        self, sample: EvalSample, output: ModelOutput
    ) -> EvalResult:
        """Evaluate using block-level scoring or dimension score comparison.

        If the sample has pre-computed metric scores in ground_truth,
        compare model dimension scores against those. If block data
        is available in metadata, run full block-level evaluation.
        """
        scores: dict[str, float] = {}
        dim_scores: dict[str, float] = {}
        details: dict = {}

        # Check for pre-computed blocks in metadata
        pred_blocks = sample.metadata.get("pred_blocks")
        ref_blocks = sample.metadata.get("ref_blocks")

        if pred_blocks is not None and ref_blocks is not None:
            # Full block-level evaluation
            block_scores = compute_block_scores(
                pred_blocks=pred_blocks,
                ref_blocks=ref_blocks,
                pred_image=sample.candidate_image,
                ref_image=sample.reference_image,
            )
            scores = {f"d2c_{k}": v for k, v in block_scores.items()}

            # Map to dimensions
            for metric_name, dimension in DESIGN2CODE_METRIC_MAP.items():
                if metric_name in block_scores:
                    dim_scores[dimension.value] = block_scores[metric_name]

            details["evaluation_mode"] = "block_level"

        elif sample.ground_truth.metric_scores:
            # Compare model scores against pre-computed ground truth
            gt_metrics = sample.ground_truth.metric_scores
            pred_dim_scores = output.dimension_scores

            for metric_name, gt_value in gt_metrics.items():
                dimension = DESIGN2CODE_METRIC_MAP.get(metric_name)
                if dimension is None:
                    continue

                dim_name = dimension.value
                pred_value = pred_dim_scores.get(dim_name, 0.0)

                # Score as 1 - absolute error (clamped to [0, 1])
                error = abs(gt_value - pred_value)
                score = max(0.0, 1.0 - error)
                scores[f"d2c_{metric_name}_accuracy"] = score
                dim_scores[dim_name] = score

            details["evaluation_mode"] = "metric_comparison"
            details["gt_metrics"] = gt_metrics

        else:
            # No ground truth available — record model output only
            for dim_name, score in output.dimension_scores.items():
                dim_scores[dim_name] = score
            details["evaluation_mode"] = "output_only"

        return EvalResult(
            sample_id=sample.id,
            dataset=self.dataset_name,
            scores=scores,
            dimension_scores=dim_scores,
            details=details,
        )
