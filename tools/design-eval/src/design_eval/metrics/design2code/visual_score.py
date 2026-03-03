"""Visual similarity scoring with 5-component block-level evaluation.

Vendored and adapted from NoviScl/Design2Code (MIT License).
Original: Design2Code/metrics/visual_score.py — scoring functions.

Computes 5 equally-weighted metrics (20% each):
1. Size score — ratio of matched block area to total area
2. Text score — SequenceMatcher ratio on matched block text
3. Position score — 1 - Chebyshev distance between block centers
4. Color score — CIEDE2000 similarity between matched block colors
5. CLIP score — cosine similarity of masked images (requires [full] extras)

Key adaptations:
- Accepts PIL images and block lists directly (no file I/O)
- CLIP scoring is optional — returns 0.0 if torch/clip unavailable
- Removed HTML pre-processing, screenshot generation, debug visualization
"""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import TYPE_CHECKING

import numpy as np

from design_eval.metrics.design2code.block_extraction import (
    find_optimal_matching,
    merge_blocks_by_bbox,
)

if TYPE_CHECKING:
    from PIL.Image import Image


def _chebyshev_center_distance(bbox1: tuple, bbox2: tuple) -> float:
    """Chebyshev distance between centers of two bboxes (normalized coords)."""
    cx1 = bbox1[0] + bbox1[2] / 2
    cy1 = bbox1[1] + bbox1[3] / 2
    cx2 = bbox2[0] + bbox2[2] / 2
    cy2 = bbox2[1] + bbox2[3] / 2
    return max(abs(cx2 - cx1), abs(cy2 - cy1))


def _color_similarity_ciede2000(rgb1: tuple, rgb2: tuple) -> float:
    """CIEDE2000 color similarity normalized to [0, 1]."""
    from colormath.color_conversions import convert_color
    from colormath.color_diff import delta_e_cie2000
    from colormath.color_objects import LabColor, sRGBColor

    lab1 = convert_color(sRGBColor(rgb1[0], rgb1[1], rgb1[2], is_upscaled=True), LabColor)
    lab2 = convert_color(sRGBColor(rgb2[0], rgb2[1], rgb2[2], is_upscaled=True), LabColor)
    delta_e = delta_e_cie2000(lab1, lab2)
    return max(0.0, 1.0 - (delta_e / 100.0))


def _mask_and_encode_clip(image: Image, block_bboxes: list[tuple]) -> np.ndarray | None:
    """Mask text regions, resize to square, encode with CLIP.

    Returns normalized feature vector, or None if CLIP is unavailable.
    """
    try:
        import torch
        import clip as clip_module
    except ImportError:
        return None

    try:
        import cv2
    except ImportError:
        return None

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, preprocess = clip_module.load("ViT-B/32", device=device)

    # Mask text bounding boxes via inpainting
    img_array = np.array(image)
    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
    h, w = img_bgr.shape[:2]

    mask = np.zeros((h, w), dtype=np.uint8)
    for bbox in block_bboxes:
        x = int(bbox[0] * w)
        y = int(bbox[1] * h)
        bw = int(bbox[2] * w)
        bh = int(bbox[3] * h)
        mask[y : y + bh, x : x + bw] = 255

    if mask.any():
        img_bgr = cv2.inpaint(img_bgr, mask, 3, cv2.INPAINT_TELEA)

    from PIL import Image as PILImage

    img_pil = PILImage.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))

    # Resize to square (crop shorter dimension)
    size = min(img_pil.size)
    img_pil = img_pil.resize((size, size), PILImage.LANCZOS)

    tensor = preprocess(img_pil).unsqueeze(0).to(device)
    with torch.no_grad():
        features = model.encode_image(tensor)
    features = features / features.norm(dim=-1, keepdim=True)
    return features.cpu().numpy()


def compute_block_scores(
    pred_blocks: list[dict],
    ref_blocks: list[dict],
    pred_image: Image | None = None,
    ref_image: Image | None = None,
    text_threshold: float = 0.5,
) -> dict[str, float]:
    """Compute the 5-component block-level visual similarity score.

    Args:
        pred_blocks: Predicted/candidate blocks with text, bbox, color keys.
        ref_blocks: Reference/ground-truth blocks.
        pred_image: Candidate PIL image (needed for CLIP score).
        ref_image: Reference PIL image (needed for CLIP score).
        text_threshold: Minimum text similarity to count as a match.

    Returns:
        Dict with keys: size, text, position, color, clip, total.
        Total = 0.2 * sum of the 5 component scores.
    """
    zero_result = {
        "size": 0.0,
        "text": 0.0,
        "position": 0.0,
        "color": 0.0,
        "clip": 0.0,
        "total": 0.0,
    }

    if not pred_blocks or not ref_blocks:
        # Still compute CLIP if images available
        clip_score = _compute_clip_score(pred_blocks, ref_blocks, pred_image, ref_image)
        zero_result["clip"] = clip_score
        zero_result["total"] = 0.2 * clip_score
        return zero_result

    # Merge blocks sharing bboxes
    pred_blocks = merge_blocks_by_bbox(pred_blocks)
    ref_blocks = merge_blocks_by_bbox(ref_blocks)

    # Optimal matching with iterative merging
    pred_m, ref_m, matching = find_optimal_matching(pred_blocks, ref_blocks)

    # Filter low-similarity matches
    filtered = []
    for i, j in matching:
        sim = SequenceMatcher(None, pred_m[i]["text"], ref_m[j]["text"]).ratio()
        if sim >= text_threshold:
            filtered.append((i, j, sim))

    matched_i = {m[0] for m in filtered}
    matched_j = {m[1] for m in filtered}

    # Unmatched area
    unmatched_pred = sum(
        b["bbox"][2] * b["bbox"][3] for idx, b in enumerate(pred_m) if idx not in matched_i
    )
    unmatched_ref = sum(
        b["bbox"][2] * b["bbox"][3] for idx, b in enumerate(ref_m) if idx not in matched_j
    )

    matched_areas = []
    text_scores = []
    position_scores = []
    color_scores = []

    for i, j, text_sim in filtered:
        area_sum = (
            pred_m[i]["bbox"][2] * pred_m[i]["bbox"][3]
            + ref_m[j]["bbox"][2] * ref_m[j]["bbox"][3]
        )
        pos_sim = 1.0 - _chebyshev_center_distance(pred_m[i]["bbox"], ref_m[j]["bbox"])
        col_sim = _color_similarity_ciede2000(pred_m[i]["color"], ref_m[j]["color"])

        matched_areas.append(area_sum)
        text_scores.append(text_sim)
        position_scores.append(pos_sim)
        color_scores.append(col_sim)

    if not matched_areas:
        clip_score = _compute_clip_score(pred_blocks, ref_blocks, pred_image, ref_image)
        zero_result["clip"] = clip_score
        zero_result["total"] = 0.2 * clip_score
        return zero_result

    total_area = sum(matched_areas) + unmatched_pred + unmatched_ref
    size_score = sum(matched_areas) / total_area if total_area > 0 else 0.0
    text_score = float(np.mean(text_scores))
    position_score = float(np.mean(position_scores))
    color_score = float(np.mean(color_scores))
    clip_score = _compute_clip_score(pred_blocks, ref_blocks, pred_image, ref_image)

    total = 0.2 * (size_score + text_score + position_score + color_score + clip_score)

    return {
        "size": round(size_score, 4),
        "text": round(text_score, 4),
        "position": round(position_score, 4),
        "color": round(color_score, 4),
        "clip": round(clip_score, 4),
        "total": round(total, 4),
    }


def _compute_clip_score(
    pred_blocks: list[dict],
    ref_blocks: list[dict],
    pred_image: Image | None,
    ref_image: Image | None,
) -> float:
    """Compute CLIP cosine similarity between masked images."""
    if pred_image is None or ref_image is None:
        return 0.0

    pred_bboxes = [b["bbox"] for b in pred_blocks]
    ref_bboxes = [b["bbox"] for b in ref_blocks]

    feat_pred = _mask_and_encode_clip(pred_image, pred_bboxes)
    feat_ref = _mask_and_encode_clip(ref_image, ref_bboxes)

    if feat_pred is None or feat_ref is None:
        return 0.0

    similarity = float(feat_pred @ feat_ref.T)
    return max(0.0, similarity)
