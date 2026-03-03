"""Loader for the GraphicDesignEvaluation (GDE) HuggingFace dataset.

Dataset: creative-graphic-design/GraphicDesignEvaluation
~700 examples: original image + degraded image + 60-rater consensus scores.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

import datasets as hf_datasets

from design_eval.datasets.base import DatasetLoader
from design_eval.models.dimensions import DESIGNBENCH_EDIT_MAP, GDE_SCORE_MAP, DesignDimension
from design_eval.models.sample import EvalSample, GroundTruth

_HF_REPO = "creative-graphic-design/GraphicDesignEvaluation"

# Score fields present in the HF dataset rows that map to our GDE_SCORE_MAP keys.
# The dataset stores per-perturbation quality ratings; we use the aggregate columns
# when available and fall back to per-field scores.
_SCORE_FIELDS: tuple[str, ...] = (
    "alignment",
    "whitespace",
    "overlap",
    "balance",
    "consistency",
    "color_harmony",
    "readability",
)


class GraphicDesignEvaluationLoader(DatasetLoader):
    """Load the GraphicDesignEvaluation dataset from HuggingFace."""

    name = "gde"

    def download(self) -> None:
        """Download GDE from HuggingFace and persist to cache_dir."""
        ds = hf_datasets.load_dataset(_HF_REPO, trust_remote_code=True)
        ds.save_to_disk(str(self.cache_dir / "dataset"))
        self._write_manifest(
            {
                "source": _HF_REPO,
                "splits": list(ds.keys()),
            }
        )

    def load(self, limit: int | None = None) -> Iterator[EvalSample]:
        """Yield EvalSample objects from the cached GDE dataset."""
        ds = hf_datasets.load_from_disk(str(self.cache_dir / "dataset"))

        # Use the train split if the dataset is split, otherwise use all rows.
        if isinstance(ds, hf_datasets.DatasetDict):
            split = ds["train"] if "train" in ds else next(iter(ds.values()))
        else:
            split = ds

        count = 0
        for idx, row in enumerate(split):
            if limit is not None and count >= limit:
                break

            sample = self._row_to_sample(idx, row)
            yield sample
            count += 1

    # ── helpers ──────────────────────────────────────────────────────────────

    def _row_to_sample(self, idx: int, row: dict) -> EvalSample:
        dimension_scores: dict[str, float] = {}
        for field in _SCORE_FIELDS:
            value = row.get(field)
            if value is not None:
                try:
                    dimension_scores[field] = float(value)
                except (TypeError, ValueError):
                    pass

        metadata: dict = {}
        perturbation = row.get("perturbation_type") or row.get("perturbation")
        if perturbation is not None:
            metadata["perturbation_type"] = perturbation

        quality = row.get("quality") or row.get("quality_rating")
        if quality is not None:
            metadata["quality_rating"] = quality

        sample_id = row.get("id") or row.get("image_id") or str(idx)

        return EvalSample(
            id=f"gde-{sample_id}",
            dataset="gde",
            reference_image=row["original_image"],
            candidate_image=row.get("degraded_image"),
            ground_truth=GroundTruth(
                dimension_scores=dimension_scores,
                dimensions=_scores_to_dimensions(dimension_scores),
            ),
            metadata=metadata,
        )


def _scores_to_dimensions(scores: dict[str, float]) -> list[DesignDimension]:
    """Convert score category names to DesignDimension values (deduplicated)."""
    seen: set[DesignDimension] = set()
    result: list[DesignDimension] = []
    for key in scores:
        dim = GDE_SCORE_MAP.get(key)
        if dim is not None and dim not in seen:
            seen.add(dim)
            result.append(dim)
    return result
