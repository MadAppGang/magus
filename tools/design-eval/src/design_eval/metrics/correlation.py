"""Pearson and Spearman correlation metrics.

Used to compare model-predicted dimension scores against human rater scores
(e.g. GDE dataset with 60-rater consensus).
"""

from __future__ import annotations

import numpy as np
from scipy import stats


class CorrelationMetric:
    """Pearson and Spearman correlation between two score lists.

    Typical use: correlate ModelOutput.dimension_scores values against
    GroundTruth.dimension_scores from the GDE dataset.

    Example::

        metric = CorrelationMetric()
        result = metric.compute(
            predictions=[0.7, 0.5, 0.9],
            references=[0.65, 0.55, 0.88],
        )
        # {"pearson_r": 0.99, "pearson_p": 0.01,
        #  "spearman_r": 1.0,  "spearman_p": 0.0}
    """

    name: str = "correlation"

    def compute(
        self,
        predictions: list[float],
        references: list[float],
    ) -> dict[str, float]:
        """Compute Pearson and Spearman correlation.

        Args:
            predictions: Predicted float scores (one per sample).
            references: Ground-truth float scores (one per sample).

        Returns:
            Dict with keys:
            - ``pearson_r``  — Pearson correlation coefficient
            - ``pearson_p``  — two-tailed p-value for Pearson
            - ``spearman_r`` — Spearman rank correlation coefficient
            - ``spearman_p`` — two-tailed p-value for Spearman

        Notes:
            When either input is constant (zero variance) scipy raises a
            ``ConstantInputWarning`` and returns ``nan``.  We coerce ``nan``
            r-values to ``0.0`` and ``nan`` p-values to ``1.0`` so downstream
            code always receives finite floats.
        """
        if len(predictions) != len(references):
            raise ValueError(
                f"predictions and references must have the same length, "
                f"got {len(predictions)} vs {len(references)}"
            )
        if len(predictions) < 2:
            raise ValueError("At least 2 data points are required to compute correlation.")

        x = np.asarray(predictions, dtype=float)
        y = np.asarray(references, dtype=float)

        # Pearson
        pearson_result = stats.pearsonr(x, y)
        pearson_r = float(pearson_result.statistic)
        pearson_p = float(pearson_result.pvalue)

        # Spearman
        spearman_result = stats.spearmanr(x, y)
        spearman_r = float(spearman_result.statistic)
        spearman_p = float(spearman_result.pvalue)

        # Coerce NaN from constant-input edge case
        def _clean_r(v: float) -> float:
            return 0.0 if np.isnan(v) else v

        def _clean_p(v: float) -> float:
            return 1.0 if np.isnan(v) else v

        return {
            "pearson_r": _clean_r(pearson_r),
            "pearson_p": _clean_p(pearson_p),
            "spearman_r": _clean_r(spearman_r),
            "spearman_p": _clean_p(spearman_p),
        }
