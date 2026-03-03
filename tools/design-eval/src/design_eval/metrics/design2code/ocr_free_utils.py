"""OCR-free text block extraction from rendered HTML screenshots.

Vendored and adapted from NoviScl/Design2Code (MIT License).
Original: Design2Code/metrics/ocr_free_utils.py

The original approach detects text by rendering HTML twice with different
color offsets and diffing the screenshots. Since our evaluation toolkit
receives pre-rendered images (not raw HTML), this module provides:

1. A simplified block extraction from pre-computed block data
2. A pixel-diff based approach for when two rendered variants are available
3. Utility functions for block normalization and filtering

For full OCR-free extraction from HTML, the original Design2Code pipeline
with playwright rendering is needed (available with [full] extras).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from PIL.Image import Image


def extract_blocks_from_annotations(
    annotations: list[dict],
    image_width: int,
    image_height: int,
) -> list[dict]:
    """Convert annotation dicts to normalized block format.

    Args:
        annotations: List of dicts with keys like 'text', 'bbox' (pixel coords),
                     'color' (RGB tuple). Bbox format: [x, y, w, h] in pixels.
        image_width: Image width for normalization.
        image_height: Image height for normalization.

    Returns:
        List of block dicts with normalized bbox (0-1 range) and text/color.
    """
    blocks = []
    for ann in annotations:
        bbox = ann.get("bbox", [0, 0, 0, 0])
        blocks.append({
            "text": ann.get("text", ""),
            "bbox": (
                bbox[0] / image_width,
                bbox[1] / image_height,
                bbox[2] / image_width,
                bbox[3] / image_height,
            ),
            "color": tuple(ann.get("color", (0, 0, 0))),
        })
    return blocks


def extract_blocks_from_pixel_diff(
    image_v1: Image,
    image_v2: Image,
    color_offset: int = 50,
    tolerance: int = 8,
    min_block_area: int = 25,
) -> list[dict]:
    """Extract text blocks by comparing two color-offset renderings.

    This replicates the original Design2Code OCR-free approach:
    render the same HTML with two different color palettes (offset by
    `color_offset` in RGB), then find pixels that differ.

    Args:
        image_v1: First rendering (original colors).
        image_v2: Second rendering (colors shifted by offset).
        color_offset: RGB offset used between renderings.
        tolerance: Pixel comparison tolerance.
        min_block_area: Minimum pixel area for a block to be included.

    Returns:
        List of block dicts with text="", normalized bbox, and detected color.
    """
    arr1 = np.array(image_v1.convert("RGB"))
    arr2 = np.array(image_v2.convert("RGB"))

    if arr1.shape != arr2.shape:
        raise ValueError("Both images must have the same dimensions")

    h, w, _ = arr1.shape

    # Find pixels where the color shift matches the expected offset
    expected = (arr1.astype(np.int16) + color_offset) % 256
    diff = np.abs(arr2.astype(np.int16) - expected)
    mask = np.all(diff <= tolerance, axis=2)

    # Find connected components via simple row-column scanning
    blocks = _extract_regions_from_mask(mask, arr1, w, h, min_block_area)
    return blocks


def _extract_regions_from_mask(
    mask: np.ndarray,
    original_pixels: np.ndarray,
    width: int,
    height: int,
    min_area: int,
) -> list[dict]:
    """Extract bounding-box regions from a boolean mask.

    Uses a simple connected-component approach: label regions with
    scipy if available, otherwise fall back to contiguous row spans.
    """
    try:
        from scipy import ndimage

        labeled, num_features = ndimage.label(mask)
        blocks = []
        for label_id in range(1, num_features + 1):
            ys, xs = np.where(labeled == label_id)
            if len(ys) < min_area:
                continue

            x_min, x_max = int(xs.min()), int(xs.max())
            y_min, y_max = int(ys.min()), int(ys.max())
            bw = x_max - x_min + 1
            bh = y_max - y_min + 1

            # Average color of the region in the original image
            region_pixels = original_pixels[ys, xs]
            avg_color = tuple(int(c) for c in region_pixels.mean(axis=0))

            blocks.append({
                "text": "",
                "bbox": (x_min / width, y_min / height, bw / width, bh / height),
                "color": avg_color,
            })
        return blocks

    except ImportError:
        # Fallback: row-based span extraction (less accurate)
        return _extract_regions_rowspan(mask, original_pixels, width, height, min_area)


def _extract_regions_rowspan(
    mask: np.ndarray,
    original_pixels: np.ndarray,
    width: int,
    height: int,
    min_area: int,
) -> list[dict]:
    """Fallback region extraction using row spans."""
    blocks = []
    visited = np.zeros_like(mask, dtype=bool)

    for y in range(height):
        x = 0
        while x < width:
            if mask[y, x] and not visited[y, x]:
                # Find span end
                x_end = x
                while x_end < width and mask[y, x_end]:
                    x_end += 1

                # Extend downward
                y_end = y
                while y_end < height and np.all(mask[y_end, x:x_end]):
                    visited[y_end, x:x_end] = True
                    y_end += 1

                bw = x_end - x
                bh = y_end - y
                if bw * bh >= min_area:
                    region = original_pixels[y:y_end, x:x_end]
                    avg_color = tuple(int(c) for c in region.reshape(-1, 3).mean(axis=0))
                    blocks.append({
                        "text": "",
                        "bbox": (x / width, y / height, bw / width, bh / height),
                        "color": avg_color,
                    })
                x = x_end
            else:
                x += 1

    return blocks


def filter_blocks(
    blocks: list[dict],
    min_text_length: int = 1,
    min_bbox_area: float = 0.0001,
) -> list[dict]:
    """Filter blocks by minimum text length and bbox area."""
    return [
        b
        for b in blocks
        if len(b.get("text", "")) >= min_text_length
        or (b["bbox"][2] * b["bbox"][3]) >= min_bbox_area
    ]
