"""Loader for the DesignBench Repair subset of the DesignBench HuggingFace dataset.

Dataset: creative-graphic-design/DesignBench
Filtered to repair=vanilla examples (~28 examples).
Each example has a buggy screenshot, a fixed screenshot, a visual mark overlay,
issue codes, and reasoning text.
"""

from __future__ import annotations

from typing import Iterator

import datasets as hf_datasets

from design_eval.datasets.base import DatasetLoader
from design_eval.models.dimensions import DESIGNBENCH_REPAIR_MAP, DesignDimension
from design_eval.models.sample import EvalSample, GroundTruth

_HF_REPO = "creative-graphic-design/DesignBench"

# Field that identifies repair examples and their variant.
_TYPE_FIELD = "type"
_REPAIR_PREFIX = "repair"

# The vanilla variant is the unaugmented repair task.
_VANILLA_VARIANT_FIELD = "variant"
_VANILLA_VALUE = "vanilla"

# Candidate field names for issue codes / reasoning across dataset versions.
_ISSUE_CODE_FIELDS = ("issue_codes", "issue_code", "issues", "error_codes")
_REASONING_FIELDS = ("reasoning", "rationale", "explanation", "description")


class DesignBenchRepairLoader(DatasetLoader):
    """Load the vanilla repair subset of DesignBench from HuggingFace."""

    name = "designbench_repair"

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
        """Yield EvalSample objects for repair-vanilla examples."""
        ds = hf_datasets.load_from_disk(str(self.cache_dir / "dataset"))

        if isinstance(ds, hf_datasets.DatasetDict):
            split = ds["train"] if "train" in ds else next(iter(ds.values()))
        else:
            split = ds

        count = 0
        for idx, row in enumerate(split):
            if limit is not None and count >= limit:
                break

            if not _is_vanilla_repair(row):
                continue

            yield self._row_to_sample(idx, row)
            count += 1

    # ── helpers ──────────────────────────────────────────────────────────────

    def _row_to_sample(self, idx: int, row: dict) -> EvalSample:
        issue_codes = _extract_issue_codes(row)
        reasoning = _extract_reasoning(row)
        dimensions = _codes_to_dimensions(issue_codes)
        sample_id = row.get("id") or row.get("image_id") or str(idx)

        return EvalSample(
            id=f"designbench_repair-{sample_id}",
            dataset="designbench_repair",
            # fixed screenshot is the reference (correct design)
            reference_image=row["fixed_image"],
            # buggy screenshot is the candidate that needs repair
            candidate_image=row.get("buggy_image"),
            mark_image=row.get("mark_screenshot") or row.get("mark_image"),
            ground_truth=GroundTruth(
                issue_codes=issue_codes,
                dimensions=dimensions,
                reasoning=reasoning,
            ),
            metadata={
                "type": row.get(_TYPE_FIELD, ""),
                "variant": row.get(_VANILLA_VARIANT_FIELD, ""),
            },
        )


# ── module-level helpers ──────────────────────────────────────────────────────

def _is_vanilla_repair(row: dict) -> bool:
    """Return True if this row is a vanilla repair example."""
    row_type = str(row.get(_TYPE_FIELD, "")).lower()
    if not row_type.startswith(_REPAIR_PREFIX):
        return False

    # If no variant field is present, treat all repair examples as vanilla
    # (older dataset versions may not have the field).
    variant = row.get(_VANILLA_VARIANT_FIELD)
    if variant is None:
        return True

    return str(variant).lower() == _VANILLA_VALUE


def _extract_issue_codes(row: dict) -> list[str]:
    """Return the list of issue code strings from a row."""
    for field in _ISSUE_CODE_FIELDS:
        value = row.get(field)
        if value is None:
            continue
        if isinstance(value, list):
            return [str(v).lower().strip() for v in value if v]
        if isinstance(value, str) and value.strip():
            # Some versions store codes as comma-separated strings.
            return [c.strip().lower() for c in value.split(",") if c.strip()]
    return []


def _extract_reasoning(row: dict) -> str | None:
    """Return the reasoning/rationale string from a row, if present."""
    for field in _REASONING_FIELDS:
        value = row.get(field)
        if value:
            return str(value)
    return None


def _codes_to_dimensions(codes: list[str]) -> list[DesignDimension]:
    """Map issue codes to deduplicated DesignDimension values."""
    seen: set[DesignDimension] = set()
    result: list[DesignDimension] = []
    for code in codes:
        dim = DESIGNBENCH_REPAIR_MAP.get(code)
        if dim is not None and dim not in seen:
            seen.add(dim)
            result.append(dim)
    return result
