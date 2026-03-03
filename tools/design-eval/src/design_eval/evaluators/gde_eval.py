"""GDE evaluator — correlates model scores with 60-rater consensus.

The GraphicDesignEvaluation dataset has human ratings across quality
categories (alignment, whitespace, overlap, etc.). This evaluator
computes Pearson and Spearman correlation between model-predicted
dimension scores and the human consensus scores.
"""

from __future__ import annotations

from design_eval.evaluators.base import BaseEvaluator, EvalResult
from design_eval.metrics.correlation import CorrelationMetric
from design_eval.models.dimensions import GDE_SCORE_MAP, DesignDimension
from design_eval.models.output import ModelOutput
from design_eval.models.sample import EvalSample


class GDEEvaluator(BaseEvaluator):
    """Evaluator for GraphicDesignEvaluation dataset."""

    dataset_name = "gde"

    def __init__(self) -> None:
        self.correlation = CorrelationMetric()

    def evaluate_sample(
        self, sample: EvalSample, output: ModelOutput
    ) -> EvalResult:
        """Compare model dimension scores against human ratings.

        For each GDE score category, maps to a unified dimension and
        compares the model's score for that dimension against the
        human rating.
        """
        gt_scores = sample.ground_truth.dimension_scores
        pred_scores = output.dimension_scores

        # Build matched score pairs via dimension mapping
        matched_pred: list[float] = []
        matched_ref: list[float] = []
        dim_scores: dict[str, float] = {}

        for gde_key, human_score in gt_scores.items():
            dimension = GDE_SCORE_MAP.get(gde_key)
            if dimension is None:
                continue
            dim_name = dimension.value
            model_score = pred_scores.get(dim_name, 0.0)
            matched_pred.append(model_score)
            matched_ref.append(human_score)
            dim_scores[dim_name] = abs(model_score - human_score)

        scores: dict[str, float] = {}
        if len(matched_pred) >= 2:
            corr = self.correlation.compute(matched_pred, matched_ref)
            scores.update(corr)
        else:
            scores = {
                "pearson_r": 0.0,
                "pearson_p": 1.0,
                "spearman_r": 0.0,
                "spearman_p": 1.0,
            }

        return EvalResult(
            sample_id=sample.id,
            dataset=self.dataset_name,
            scores=scores,
            dimension_scores=dim_scores,
            details={
                "num_matched_dimensions": len(matched_pred),
                "gt_categories": list(gt_scores.keys()),
            },
        )
