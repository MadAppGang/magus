"""Element position distance metric using Chebyshev distance and IoU.

Used to compare predicted element bounding boxes against ground-truth
positions (e.g. Design2Code block-match evaluation).

Each bounding box is a dict with keys ``x``, ``y``, ``w``, ``h`` where all
values are in the same unit (pixels or normalised [0, 1] — be consistent
within a dataset).
"""

from __future__ import annotations

from typing import TypedDict

import numpy as np


class BBox(TypedDict):
    """Bounding box with top-left corner, width, and height."""

    x: float
    y: float
    w: float
    h: float


def _chebyshev(box_a: BBox, box_b: BBox, image_dim: float = 1.0) -> float:
    """Chebyshev (L-infinity) distance between two bbox top-left corners.

    The distance is normalised by ``image_dim`` so the result is in [0, 1]
    when image_dim equals the image side length.

    Args:
        box_a: First bounding box.
        box_b: Second bounding box.
        image_dim: Normalisation factor (typically image width or height).

    Returns:
        Normalised Chebyshev distance: max(|x1-x2|, |y1-y2|) / image_dim.
    """
    dx = abs(box_a["x"] - box_b["x"])
    dy = abs(box_a["y"] - box_b["y"])
    return max(dx, dy) / max(image_dim, 1e-6)


def _iou(box_a: BBox, box_b: BBox) -> float:
    """Compute Intersection over Union between two bounding boxes.

    Args:
        box_a: First bounding box with keys ``x``, ``y``, ``w``, ``h``.
        box_b: Second bounding box with keys ``x``, ``y``, ``w``, ``h``.

    Returns:
        IoU in [0.0, 1.0].  Returns 0.0 for degenerate (zero-area) boxes.
    """
    ax1, ay1 = box_a["x"], box_a["y"]
    ax2, ay2 = ax1 + box_a["w"], ay1 + box_a["h"]

    bx1, by1 = box_b["x"], box_b["y"]
    bx2, by2 = bx1 + box_b["w"], by1 + box_b["h"]

    inter_x = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    inter_y = max(0.0, min(ay2, by2) - max(ay1, by1))
    intersection = inter_x * inter_y

    area_a = box_a["w"] * box_a["h"]
    area_b = box_b["w"] * box_b["h"]
    union = area_a + area_b - intersection

    if union <= 0.0:
        return 0.0
    return float(intersection / union)


class PositionMetric:
    """Chebyshev distance and IoU between predicted and reference bounding boxes.

    Chebyshev distance measures how far the top-left corner of a predicted
    element is from the reference position.  IoU measures spatial overlap.

    Example::

        metric = PositionMetric(image_dim=1024.0)
        result = metric.compute(
            predictions=[{"x": 10, "y": 20, "w": 100, "h": 50}],
            references=[{"x": 12, "y": 22, "w": 100, "h": 50}],
        )
        # {"chebyshev_mean": 0.002, "iou_mean": 0.962}
    """

    name: str = "position_distance"

    def __init__(self, image_dim: float = 1.0) -> None:
        """Initialise position metric.

        Args:
            image_dim: Image dimension used to normalise Chebyshev distance.
                       Set to 1.0 when bounding boxes are already normalised
                       to [0, 1].  Set to image width/height (in pixels) for
                       pixel-space bounding boxes.
        """
        self._image_dim = image_dim

    def compute(
        self,
        predictions: list[dict],
        references: list[dict],
    ) -> dict[str, float]:
        """Compute mean Chebyshev distance and mean IoU across bbox pairs.

        Args:
            predictions: Predicted bounding boxes, each a dict with keys
                         ``x``, ``y``, ``w``, ``h``.
            references: Ground-truth bounding boxes with the same schema.

        Returns:
            Dict with keys:
            - ``chebyshev_mean`` — mean normalised Chebyshev distance in [0, 1]
            - ``iou_mean``       — mean IoU in [0, 1]
        """
        if len(predictions) != len(references):
            raise ValueError(
                f"predictions and references must have the same length, "
                f"got {len(predictions)} vs {len(references)}"
            )

        if not predictions:
            return {"chebyshev_mean": 0.0, "iou_mean": 0.0}

        chebyshev_scores: list[float] = []
        iou_scores: list[float] = []

        for pred, ref in zip(predictions, references):
            box_pred: BBox = {
                "x": float(pred["x"]),
                "y": float(pred["y"]),
                "w": float(pred["w"]),
                "h": float(pred["h"]),
            }
            box_ref: BBox = {
                "x": float(ref["x"]),
                "y": float(ref["y"]),
                "w": float(ref["w"]),
                "h": float(ref["h"]),
            }
            chebyshev_scores.append(_chebyshev(box_pred, box_ref, self._image_dim))
            iou_scores.append(_iou(box_pred, box_ref))

        return {
            "chebyshev_mean": float(np.mean(chebyshev_scores)),
            "iou_mean": float(np.mean(iou_scores)),
        }
