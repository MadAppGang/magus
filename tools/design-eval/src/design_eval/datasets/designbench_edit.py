"""Loader for the DesignBench Edit subset of the DesignBench HuggingFace dataset.

Dataset: creative-graphic-design/DesignBench
Filtered to edit-type examples (~359 examples).
Each example has a before/after image pair, a change type, and an edit instruction.
"""

from __future__ import annotations

from typing import Iterator

import datasets as hf_datasets

from design_eval.datasets.base import DatasetLoader
from design_eval.models.dimensions import DESIGNBENCH_EDIT_MAP, DesignDimension
from design_eval.models.sample import EvalSample, GroundTruth

_HF_REPO = "creative-graphic-design/DesignBench"

# The dataset field that identifies the example type.  Edit examples carry
# values such as "edit", "edit_text", "edit_color", etc.  We match on the
# prefix so that all subtypes are included.
_EDIT_TYPE_FIELD = "type"
_EDIT_PREFIX = "edit"

# Field name for the natural-language edit instruction.
_INSTRUCTION_FIELDS = ("instruction", "edit_instruction", "prompt", "description")


class DesignBenchEditLoader(DatasetLoader):
    """Load the edit subset of DesignBench from HuggingFace."""

    name = "designbench_edit"

    def download(self) -> None:
        """Download DesignBench from HuggingFace and persist to cache_dir."""
        ds = hf_datasets.load_dataset(_HF_REPO, trust_remote_code=True)
        ds.save_to_disk(str(self.cache_dir / "dataset"))
        self._write_manifest(
            {
                "source": _HF_REPO,
                "splits": list(ds.keys()),
            }
        )

    def load(self, limit: int | None = None) -> Iterator[EvalSample]:
        """Yield EvalSample objects for edit-type examples."""
        ds = hf_datasets.load_from_disk(str(self.cache_dir / "dataset"))

        if isinstance(ds, hf_datasets.DatasetDict):
            split = ds["train"] if "train" in ds else next(iter(ds.values()))
        else:
            split = ds

        count = 0
        for idx, row in enumerate(split):
            if limit is not None and count >= limit:
                break

            row_type = str(row.get(_EDIT_TYPE_FIELD, "")).lower()
            if not row_type.startswith(_EDIT_PREFIX):
                continue

            yield self._row_to_sample(idx, row)
            count += 1

    # ── helpers ──────────────────────────────────────────────────────────────

    def _row_to_sample(self, idx: int, row: dict) -> EvalSample:
        change_type = _extract_change_type(row)
        dimensions = _change_type_to_dimensions(change_type)
        prompt = _extract_instruction(row)
        sample_id = row.get("id") or row.get("image_id") or str(idx)

        return EvalSample(
            id=f"designbench_edit-{sample_id}",
            dataset="designbench_edit",
            # after image is the target / reference; before is what needs editing
            reference_image=row["after_image"],
            candidate_image=row.get("before_image"),
            prompt=prompt,
            ground_truth=GroundTruth(
                issue_labels=[change_type] if change_type else [],
                dimensions=dimensions,
            ),
            metadata={
                "type": row.get(_EDIT_TYPE_FIELD, ""),
                "change_type": change_type,
            },
        )


# ── module-level helpers ──────────────────────────────────────────────────────

def _extract_change_type(row: dict) -> str:
    """Extract a normalised change-type label from a dataset row."""
    # Dedicated change_type field takes priority.
    for field in ("change_type", "edit_type", "category"):
        value = row.get(field)
        if value:
            return str(value).lower().strip()

    # Fall back to stripping the "edit_" prefix from the type field.
    type_value = str(row.get(_EDIT_TYPE_FIELD, "")).lower()
    if type_value.startswith("edit_"):
        return type_value[len("edit_"):]

    return type_value


def _extract_instruction(row: dict) -> str | None:
    """Return the edit instruction string, trying several candidate fields."""
    for field in _INSTRUCTION_FIELDS:
        value = row.get(field)
        if value:
            return str(value)
    return None


def _change_type_to_dimensions(change_type: str) -> list[DesignDimension]:
    """Map a change-type label to unified DesignDimension values."""
    dim = DESIGNBENCH_EDIT_MAP.get(change_type)
    return [dim] if dim is not None else []
