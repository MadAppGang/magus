"""Precision, Recall, and F1 classification metrics.

Used to evaluate issue detection accuracy on DesignBench datasets where the
task is to classify which design dimension(s) a change/bug belongs to.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import precision_recall_fscore_support
from sklearn.preprocessing import LabelEncoder


class ClassificationMetric:
    """Macro-averaged precision, recall, and F1 for label classification.

    Typical use: compare predicted issue categories (from ModelOutput.issues)
    against GroundTruth.issue_labels from DesignBench edit/repair datasets.

    Example::

        metric = ClassificationMetric()
        result = metric.compute(
            predictions=["color", "alignment", "typography"],
            references=["color", "layout",    "typography"],
        )
        # {"precision": 0.67, "recall": 0.67, "f1": 0.67, "support": 3}
    """

    name: str = "classification"

    def compute(
        self,
        predictions: list[str],
        references: list[str],
    ) -> dict[str, float]:
        """Compute macro-averaged P/R/F1 across all label classes.

        Args:
            predictions: Predicted label strings (one per sample).
            references: Ground-truth label strings (one per sample).

        Returns:
            Dict with keys:
            - ``precision`` — macro-averaged precision
            - ``recall``    — macro-averaged recall
            - ``f1``        — macro-averaged F1 score
            - ``support``   — total number of samples
        """
        if len(predictions) != len(references):
            raise ValueError(
                f"predictions and references must have the same length, "
                f"got {len(predictions)} vs {len(references)}"
            )

        # Encode string labels to integers so sklearn is happy
        le = LabelEncoder()
        all_labels = list(set(predictions) | set(references))
        le.fit(all_labels)
        y_pred = le.transform(predictions)
        y_true = le.transform(references)

        precision, recall, f1, support = precision_recall_fscore_support(
            y_true,
            y_pred,
            average="macro",
            zero_division=0,
        )

        return {
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "support": float(len(references)),
        }

    def compute_per_class(
        self,
        predictions: list[str],
        references: list[str],
    ) -> dict[str, dict[str, float]]:
        """Compute per-class P/R/F1.

        Args:
            predictions: Predicted label strings.
            references: Ground-truth label strings.

        Returns:
            Dict mapping each class label to its own
            ``{"precision": ..., "recall": ..., "f1": ..., "support": ...}`` dict.
        """
        if len(predictions) != len(references):
            raise ValueError(
                f"predictions and references must have the same length, "
                f"got {len(predictions)} vs {len(references)}"
            )

        le = LabelEncoder()
        all_labels = sorted(set(predictions) | set(references))
        le.fit(all_labels)
        y_pred = le.transform(predictions)
        y_true = le.transform(references)

        precision_arr, recall_arr, f1_arr, support_arr = precision_recall_fscore_support(
            y_true,
            y_pred,
            average=None,
            labels=list(range(len(all_labels))),
            zero_division=0,
        )

        result: dict[str, dict[str, float]] = {}
        for i, label in enumerate(all_labels):
            result[label] = {
                "precision": float(precision_arr[i]),
                "recall": float(recall_arr[i]),
                "f1": float(f1_arr[i]),
                "support": float(support_arr[i]),
            }
        return result
