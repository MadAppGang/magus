"""Unified design dimensions with cross-dataset mappings."""

from __future__ import annotations

from enum import Enum


class DesignDimension(str, Enum):
    """The 5 unified design critique dimensions."""

    PADDING = "padding"
    COLOR = "color"
    TYPOGRAPHY = "typography"
    ALIGNMENT = "alignment"
    LAYOUT = "layout"


# ── Cross-dataset label → dimension mappings ────────────────────────────

# DesignBench edit change types → unified dimension
DESIGNBENCH_EDIT_MAP: dict[str, DesignDimension] = {
    "text": DesignDimension.TYPOGRAPHY,
    "color": DesignDimension.COLOR,
    "position": DesignDimension.ALIGNMENT,
    "size": DesignDimension.LAYOUT,
    "font": DesignDimension.TYPOGRAPHY,
    "background": DesignDimension.COLOR,
    "border": DesignDimension.PADDING,
    "margin": DesignDimension.PADDING,
    "padding": DesignDimension.PADDING,
    "spacing": DesignDimension.PADDING,
    "alignment": DesignDimension.ALIGNMENT,
    "layout": DesignDimension.LAYOUT,
}

# DesignBench repair issue codes → unified dimension
DESIGNBENCH_REPAIR_MAP: dict[str, DesignDimension] = {
    "text_content": DesignDimension.TYPOGRAPHY,
    "text_style": DesignDimension.TYPOGRAPHY,
    "color_mismatch": DesignDimension.COLOR,
    "position_shift": DesignDimension.ALIGNMENT,
    "size_change": DesignDimension.LAYOUT,
    "missing_element": DesignDimension.LAYOUT,
    "extra_element": DesignDimension.LAYOUT,
    "overlap": DesignDimension.ALIGNMENT,
    "spacing": DesignDimension.PADDING,
    "alignment": DesignDimension.ALIGNMENT,
    "font": DesignDimension.TYPOGRAPHY,
    "background": DesignDimension.COLOR,
    "border": DesignDimension.PADDING,
}

# GraphicDesignEvaluation score categories → unified dimension
GDE_SCORE_MAP: dict[str, DesignDimension] = {
    "alignment": DesignDimension.ALIGNMENT,
    "whitespace": DesignDimension.PADDING,
    "overlap": DesignDimension.ALIGNMENT,
    "balance": DesignDimension.LAYOUT,
    "consistency": DesignDimension.TYPOGRAPHY,
    "color_harmony": DesignDimension.COLOR,
    "readability": DesignDimension.TYPOGRAPHY,
}

# Design2Code metric names → unified dimension
DESIGN2CODE_METRIC_MAP: dict[str, DesignDimension] = {
    "block_match": DesignDimension.LAYOUT,
    "text": DesignDimension.TYPOGRAPHY,
    "position": DesignDimension.ALIGNMENT,
    "color": DesignDimension.COLOR,
    "clip": DesignDimension.LAYOUT,  # overall visual similarity
}


def map_label_to_dimension(
    label: str, dataset: str
) -> DesignDimension | None:
    """Map a dataset-specific label to a unified design dimension.

    Returns None if the label has no known mapping.
    """
    label_lower = label.lower().strip()
    mapping: dict[str, DesignDimension]

    if dataset == "designbench_edit":
        mapping = DESIGNBENCH_EDIT_MAP
    elif dataset == "designbench_repair":
        mapping = DESIGNBENCH_REPAIR_MAP
    elif dataset == "gde":
        mapping = GDE_SCORE_MAP
    elif dataset == "design2code":
        mapping = DESIGN2CODE_METRIC_MAP
    else:
        return None

    return mapping.get(label_lower)
