"""CIEDE2000 perceptual color distance metric.

Extracts dominant colors from each image using a simple numpy k-means
implementation, then computes CIEDE2000 between matched dominant colors.

CIEDE2000 is implemented directly with numpy (no colormath dependency at
runtime) because colormath 3.0.x calls ``numpy.asscalar`` which was removed
in NumPy 1.24.  The colormath sRGBColor/LabColor objects are used only for
the sRGB→Lab conversion, then we call our own CIEDE2000 kernel.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from PIL.Image import Image

_K_COLORS = 5  # number of dominant colors to extract per image
_KMEANS_ITERS = 20  # max k-means iterations


# ── sRGB → CIE L*a*b* conversion (pure numpy) ─────────────────────────────


def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    """Apply sRGB gamma expansion (IEC 61966-2-1)."""
    mask = c > 0.04045
    result = np.where(mask, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    return result


def _linear_to_xyz(rgb: np.ndarray) -> np.ndarray:
    """Convert linear-light RGB to CIE XYZ (D65 illuminant, sRGB primaries)."""
    M = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ]
    )
    return rgb @ M.T


def _xyz_to_lab(xyz: np.ndarray) -> np.ndarray:
    """Convert CIE XYZ to L*a*b* (D65 reference white)."""
    # D65 reference white
    white = np.array([0.95047, 1.00000, 1.08883])
    f = xyz / white

    delta = 6.0 / 29.0
    mask = f > delta**3
    f = np.where(mask, np.cbrt(f), f / (3 * delta**2) + 4.0 / 29.0)

    L = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def _rgb255_to_lab(rgb255: np.ndarray) -> np.ndarray:
    """Convert uint8-range RGB array (..., 3) to CIE L*a*b*.

    Args:
        rgb255: Array of shape (..., 3) with values in [0, 255].

    Returns:
        Array of shape (..., 3) with [L, a, b] values.
    """
    srgb = rgb255.astype(np.float64) / 255.0
    linear = _srgb_to_linear(srgb)
    xyz = _linear_to_xyz(linear)
    return _xyz_to_lab(xyz)


# ── CIEDE2000 (pure numpy, vectorised) ────────────────────────────────────


def _ciede2000_vectorised(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """Compute CIEDE2000 between two arrays of Lab colors.

    Implements the full CIEDE2000 formula (Sharma et al. 2005).

    Args:
        lab1: Array of shape (N, 3) with [L, a, b] rows.
        lab2: Array of shape (N, 3) with [L, a, b] rows.

    Returns:
        Array of shape (N,) with delta-E values in [0, 100].
    """
    L1, a1, b1 = lab1[:, 0], lab1[:, 1], lab1[:, 2]
    L2, a2, b2 = lab2[:, 0], lab2[:, 1], lab2[:, 2]

    # Step 1: compute C'ab and h'ab
    C1 = np.sqrt(a1**2 + b1**2)
    C2 = np.sqrt(a2**2 + b2**2)
    C_bar = (C1 + C2) / 2.0
    C_bar7 = C_bar**7

    G = 0.5 * (1.0 - np.sqrt(C_bar7 / (C_bar7 + 25.0**7)))
    a1p = a1 * (1.0 + G)
    a2p = a2 * (1.0 + G)

    C1p = np.sqrt(a1p**2 + b1**2)
    C2p = np.sqrt(a2p**2 + b2**2)

    h1p = np.degrees(np.arctan2(b1, a1p)) % 360.0
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360.0

    # Step 2: delta L', delta C', delta H'
    dLp = L2 - L1
    dCp = C2p - C1p

    # delta h' — handle the circular distance
    dhp = np.where(
        C1p * C2p == 0,
        0.0,
        np.where(
            np.abs(h2p - h1p) <= 180,
            h2p - h1p,
            np.where(h2p - h1p > 180, h2p - h1p - 360, h2p - h1p + 360),
        ),
    )
    dHp = 2.0 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp / 2.0))

    # Step 3: CIEDE2000 weighting functions
    Lp_bar = (L1 + L2) / 2.0
    Cp_bar = (C1p + C2p) / 2.0
    Cp_bar7 = Cp_bar**7

    hp_bar = np.where(
        C1p * C2p == 0,
        h1p + h2p,
        np.where(
            np.abs(h1p - h2p) <= 180,
            (h1p + h2p) / 2.0,
            np.where(h1p + h2p < 360, (h1p + h2p + 360) / 2.0, (h1p + h2p - 360) / 2.0),
        ),
    )

    T = (
        1.0
        - 0.17 * np.cos(np.radians(hp_bar - 30))
        + 0.24 * np.cos(np.radians(2 * hp_bar))
        + 0.32 * np.cos(np.radians(3 * hp_bar + 6))
        - 0.20 * np.cos(np.radians(4 * hp_bar - 63))
    )

    SL = 1.0 + 0.015 * (Lp_bar - 50) ** 2 / np.sqrt(20 + (Lp_bar - 50) ** 2)
    SC = 1.0 + 0.045 * Cp_bar
    SH = 1.0 + 0.015 * Cp_bar * T

    d_theta = 30.0 * np.exp(-((hp_bar - 275) / 25.0) ** 2)
    RC = 2.0 * np.sqrt(Cp_bar7 / (Cp_bar7 + 25.0**7))
    RT = -np.sin(np.radians(2 * d_theta)) * RC

    delta_e = np.sqrt(
        (dLp / SL) ** 2
        + (dCp / SC) ** 2
        + (dHp / SH) ** 2
        + RT * (dCp / SC) * (dHp / SH)
    )
    return delta_e


# ── k-means dominant color extraction ─────────────────────────────────────


def _dominant_colors(image: Image, k: int = _K_COLORS) -> np.ndarray:
    """Extract k dominant colors from a PIL image using numpy k-means.

    Args:
        image: Input PIL image (converted to RGB internally).
        k: Number of dominant colors to extract.

    Returns:
        Array of shape (k, 3) containing RGB centroids in [0, 255].
    """
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    pixels = arr.reshape(-1, 3)

    # Subsample for speed (at most 4096 pixels)
    if len(pixels) > 4096:
        idx = np.random.default_rng(seed=42).choice(len(pixels), size=4096, replace=False)
        pixels = pixels[idx]

    # Initialise centroids by spreading evenly over pixel indices
    indices = np.linspace(0, len(pixels) - 1, k, dtype=int)
    centroids = pixels[indices].copy()

    for _ in range(_KMEANS_ITERS):
        # Assign each pixel to nearest centroid
        diffs = pixels[:, np.newaxis, :] - centroids[np.newaxis, :, :]  # (N, k, 3)
        distances = np.linalg.norm(diffs, axis=2)  # (N, k)
        assignments = np.argmin(distances, axis=1)  # (N,)

        # Recompute centroids
        new_centroids = np.zeros_like(centroids)
        for j in range(k):
            members = pixels[assignments == j]
            if len(members) > 0:
                new_centroids[j] = members.mean(axis=0)
            else:
                new_centroids[j] = centroids[j]  # keep old centroid if cluster is empty

        if np.allclose(centroids, new_centroids, atol=0.5):
            break
        centroids = new_centroids

    return centroids  # (k, 3)


def _ciede2000_between_palettes(
    palette_a: np.ndarray,
    palette_b: np.ndarray,
) -> tuple[float, float]:
    """Compute mean and max CIEDE2000 between two matched color palettes.

    Palettes are matched by index (centroid 0 vs centroid 0, etc.).  Both
    palettes must have the same number of colors.

    Args:
        palette_a: Array of shape (k, 3) with RGB values in [0, 255].
        palette_b: Array of shape (k, 3) with RGB values in [0, 255].

    Returns:
        Tuple of (mean_delta_e, max_delta_e).
    """
    lab_a = _rgb255_to_lab(palette_a.astype(np.float64))
    lab_b = _rgb255_to_lab(palette_b.astype(np.float64))
    deltas = _ciede2000_vectorised(lab_a, lab_b)
    return float(np.mean(deltas)), float(np.max(deltas))


# ── Public metric class ────────────────────────────────────────────────────


class ColorDistanceMetric:
    """CIEDE2000 perceptual color distance between image pairs.

    For each pair of images the metric:
    1. Extracts k=5 dominant colors from each image via k-means.
    2. Matches dominant colors by palette index.
    3. Computes CIEDE2000 for each matched pair.
    4. Aggregates mean and max across all image pairs.

    CIEDE2000 values are in [0, 100]; values below ~2 are barely perceptible
    to human observers.  Uses a pure numpy implementation so it is compatible
    with NumPy 1.24+ (avoiding the removed ``numpy.asscalar`` call in
    colormath 3.0.x).

    Example::

        metric = ColorDistanceMetric()
        result = metric.compute(predictions=[img_a], references=[img_ref_a])
        # {"ciede2000_mean": 12.4, "ciede2000_max": 31.7}
    """

    name: str = "color_distance"

    def __init__(self, k: int = _K_COLORS) -> None:
        """Initialise color distance metric.

        Args:
            k: Number of dominant colors to extract from each image.
        """
        self._k = k

    def compute(
        self,
        predictions: list[Image],
        references: list[Image],
    ) -> dict[str, float]:
        """Compute CIEDE2000 color distance between prediction and reference images.

        Args:
            predictions: Predicted/generated PIL images.
            references: Ground-truth/reference PIL images.

        Returns:
            Dict with keys:
            - ``ciede2000_mean`` — mean CIEDE2000 across all matched dominant-color pairs
            - ``ciede2000_max``  — mean of per-image max CIEDE2000 values
        """
        if len(predictions) != len(references):
            raise ValueError(
                f"predictions and references must have the same length, "
                f"got {len(predictions)} vs {len(references)}"
            )

        all_means: list[float] = []
        all_maxes: list[float] = []

        for pred, ref in zip(predictions, references):
            palette_pred = _dominant_colors(pred, k=self._k)
            palette_ref = _dominant_colors(ref, k=self._k)
            mean_de, max_de = _ciede2000_between_palettes(palette_pred, palette_ref)
            all_means.append(mean_de)
            all_maxes.append(max_de)

        return {
            "ciede2000_mean": float(np.mean(all_means)) if all_means else 0.0,
            "ciede2000_max": float(np.mean(all_maxes)) if all_maxes else 0.0,
        }
