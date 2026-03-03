"""Text similarity metric using difflib SequenceMatcher.

No external dependencies — stdlib only.  Suitable for comparing extracted
text content between predicted and reference designs (e.g. Design2Code).
"""

from __future__ import annotations

import difflib


class TextSimilarity:
    """Character-level text similarity via difflib SequenceMatcher.

    ``SequenceMatcher.ratio()`` returns 2.0 * M / T where M is the number of
    matching characters and T is the total number of characters in both strings.
    The result is in [0.0, 1.0], with 1.0 meaning identical strings.

    Example::

        metric = TextSimilarity()
        result = metric.compute(
            predictions=["Hello World", "Submit"],
            references=["Hello world", "Cancel"],
        )
        # {"text_similarity": 0.727}
    """

    name: str = "text_similarity"

    def compute(
        self,
        predictions: list[str],
        references: list[str],
    ) -> dict[str, float]:
        """Compute mean SequenceMatcher similarity across string pairs.

        Args:
            predictions: Predicted text strings (one per sample).
            references: Ground-truth text strings (one per sample).

        Returns:
            Dict with key ``text_similarity`` — mean ratio in [0.0, 1.0].
        """
        if len(predictions) != len(references):
            raise ValueError(
                f"predictions and references must have the same length, "
                f"got {len(predictions)} vs {len(references)}"
            )

        if not predictions:
            return {"text_similarity": 0.0}

        ratios = [
            difflib.SequenceMatcher(None, pred, ref).ratio()
            for pred, ref in zip(predictions, references)
        ]

        mean_ratio = sum(ratios) / len(ratios)
        return {"text_similarity": mean_ratio}
