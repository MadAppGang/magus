"""Visual similarity metrics: CLIP embedding cosine similarity and SSIM.

Both metrics accept lists of PIL Images and return float scores in [0, 1].

CLIP requires the ``[full]`` extras (``open-clip-torch``, ``torch``).
SSIM works with just ``numpy`` and ``scipy`` (always available).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
from scipy.signal import fftconvolve

if TYPE_CHECKING:
    from PIL.Image import Image


# ── CLIP Similarity ────────────────────────────────────────────────────────


class CLIPSimilarity:
    """Cosine similarity between CLIP image embeddings.

    Requires ``open-clip-torch`` and ``torch`` (install with ``pip install design-eval[full]``).

    Example::

        metric = CLIPSimilarity()
        result = metric.compute(predictions=[img_a, img_b], references=[img_ref_a, img_ref_b])
        # {"clip_similarity": 0.91}
    """

    name: str = "clip_similarity"

    def __init__(self, model_name: str = "ViT-B-32", pretrained: str = "openai") -> None:
        """Initialise CLIP model.

        Args:
            model_name: open_clip model architecture name.
            pretrained: Pretrained weights tag recognised by open_clip.

        Raises:
            ImportError: If ``open_clip`` or ``torch`` are not installed.
        """
        try:
            import open_clip  # type: ignore[import-untyped]
            import torch  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "CLIPSimilarity requires 'open-clip-torch' and 'torch'. "
                "Install them with: pip install design-eval[full]"
            ) from exc

        self._torch = torch
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model, _, self._preprocess = open_clip.create_model_and_transforms(
            model_name, pretrained=pretrained, device=self._device
        )
        self._model.eval()

    def compute(
        self,
        predictions: list[Image],
        references: list[Image],
    ) -> dict[str, float]:
        """Compute mean cosine similarity between prediction and reference embeddings.

        Args:
            predictions: Predicted/generated PIL images.
            references: Ground-truth/reference PIL images.

        Returns:
            Dict with key ``clip_similarity`` — mean cosine similarity in [-1, 1],
            typically in [0.5, 1.0] for similar design images.
        """
        if len(predictions) != len(references):
            raise ValueError(
                f"predictions and references must have the same length, "
                f"got {len(predictions)} vs {len(references)}"
            )

        torch = self._torch

        def _embed(images: list[Image]) -> "torch.Tensor":
            tensors = torch.stack([self._preprocess(img) for img in images]).to(self._device)
            with torch.no_grad():
                features = self._model.encode_image(tensors)
            features = features / features.norm(dim=-1, keepdim=True)
            return features

        pred_feats = _embed(predictions)
        ref_feats = _embed(references)

        cosine_sims = (pred_feats * ref_feats).sum(dim=-1)  # element-wise dot after normalising
        mean_sim = float(cosine_sims.mean().cpu().item())

        return {"clip_similarity": mean_sim}


# ── SSIM ──────────────────────────────────────────────────────────────────


def _ssim_pair(img_a: np.ndarray, img_b: np.ndarray) -> float:
    """Compute SSIM between two uint8 HxWxC numpy arrays.

    Uses the standard Gaussian-weighted SSIM formula (Wang et al. 2004).
    Constants follow the original paper: K1=0.01, K2=0.03, L=255.
    """
    # Convert to float
    a = img_a.astype(np.float64)
    b = img_b.astype(np.float64)

    L = 255.0
    k1, k2 = 0.01, 0.03
    c1 = (k1 * L) ** 2
    c2 = (k2 * L) ** 2

    # Build 11x11 Gaussian kernel (sigma=1.5), as per the original SSIM paper
    kernel_size = 11
    sigma = 1.5
    coords = np.arange(kernel_size) - kernel_size // 2
    g = np.exp(-(coords**2) / (2 * sigma**2))
    g /= g.sum()
    kernel_2d = np.outer(g, g)  # (11, 11)

    def _filter(channel: np.ndarray) -> np.ndarray:
        """Apply 2D Gaussian filter via FFT convolution."""
        return fftconvolve(channel, kernel_2d, mode="valid")

    def _ssim_channel(ch_a: np.ndarray, ch_b: np.ndarray) -> float:
        mu_a = _filter(ch_a)
        mu_b = _filter(ch_b)
        mu_a2 = mu_a * mu_a
        mu_b2 = mu_b * mu_b
        mu_ab = mu_a * mu_b

        sigma_a2 = _filter(ch_a * ch_a) - mu_a2
        sigma_b2 = _filter(ch_b * ch_b) - mu_b2
        sigma_ab = _filter(ch_a * ch_b) - mu_ab

        numerator = (2 * mu_ab + c1) * (2 * sigma_ab + c2)
        denominator = (mu_a2 + mu_b2 + c1) * (sigma_a2 + sigma_b2 + c2)
        ssim_map = numerator / (denominator + 1e-10)
        return float(ssim_map.mean())

    # Ensure same spatial size (resize b to match a if needed)
    if a.shape[:2] != b.shape[:2]:
        from PIL import Image as PILImage  # local import to avoid top-level dep issues

        pil_b = PILImage.fromarray(img_b)
        pil_b = pil_b.resize((img_a.shape[1], img_a.shape[0]), PILImage.LANCZOS)
        b = np.asarray(pil_b, dtype=np.float64)

    # Compute per-channel and average
    if a.ndim == 2:
        return _ssim_channel(a, b)

    scores = [_ssim_channel(a[:, :, c], b[:, :, c]) for c in range(a.shape[2])]
    return float(np.mean(scores))


class SSIMMetric:
    """Structural Similarity Index (SSIM) between image pairs.

    Works with core dependencies only (numpy + scipy — no torch needed).

    Example::

        metric = SSIMMetric()
        result = metric.compute(predictions=[img_a], references=[img_ref_a])
        # {"ssim": 0.87}
    """

    name: str = "ssim"

    def compute(
        self,
        predictions: list[Image],
        references: list[Image],
    ) -> dict[str, float]:
        """Compute mean SSIM across image pairs.

        Args:
            predictions: Predicted/generated PIL images.
            references: Ground-truth/reference PIL images.

        Returns:
            Dict with key ``ssim`` — mean SSIM score in [0, 1].
        """
        if len(predictions) != len(references):
            raise ValueError(
                f"predictions and references must have the same length, "
                f"got {len(predictions)} vs {len(references)}"
            )

        scores: list[float] = []
        for pred, ref in zip(predictions, references):
            # Ensure RGB so we always have 3 channels
            arr_pred = np.asarray(pred.convert("RGB"), dtype=np.uint8)
            arr_ref = np.asarray(ref.convert("RGB"), dtype=np.uint8)
            scores.append(_ssim_pair(arr_pred, arr_ref))

        return {"ssim": float(np.mean(scores)) if scores else 0.0}
