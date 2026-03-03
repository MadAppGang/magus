"""Loader for the Design2Code dataset (NoviScl/Design2Code on GitHub).

~484 web pages with reference screenshots and generated HTML.
The repository is cloned into cache_dir and screenshots + HTML files are
extracted from the on-disk layout.

Rendering candidate HTML into screenshots requires playwright, which is
included in the [full] optional extras:
    pip install design-eval[full]
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterator

from PIL import Image

from design_eval.datasets.base import DatasetLoader
from design_eval.models.dimensions import DESIGN2CODE_METRIC_MAP, DesignDimension
from design_eval.models.sample import EvalSample, GroundTruth

_GITHUB_REPO = "https://github.com/NoviScl/Design2Code.git"
_REPO_DIR_NAME = "Design2Code"

# Layout inside the cloned repo — these paths match the repository structure
# as of the initial public release.  The loader is resilient to missing
# subdirectories so it also works with partial clones or future restructuring.
_SCREENSHOT_DIRS = (
    "data/screenshots",
    "data/reference_screenshots",
    "screenshots",
    "testcases",
)
_HTML_DIRS = (
    "data/html_files",
    "data/reference_html",
    "html_files",
    "testcases",
)

# Pre-computed evaluation results that may live alongside the HTML/screenshots.
_EVAL_RESULT_FILENAMES = ("eval_results.json", "metrics.json", "scores.json")


class Design2CodeLoader(DatasetLoader):
    """Load the Design2Code benchmark from its GitHub repository."""

    name = "design2code"

    # ── public interface ──────────────────────────────────────────────────────

    def download(self) -> None:
        """Clone the Design2Code GitHub repository into cache_dir."""
        repo_path = self._repo_path
        if repo_path.exists():
            # Perform a fast-forward pull so the cache stays up to date.
            subprocess.run(
                ["git", "pull", "--ff-only"],
                cwd=repo_path,
                check=True,
            )
        else:
            subprocess.run(
                ["git", "clone", "--depth", "1", _GITHUB_REPO, str(repo_path)],
                check=True,
            )

        screenshot_pairs = list(self._discover_pairs())
        self._write_manifest(
            {
                "source": _GITHUB_REPO,
                "repo_dir": str(repo_path),
                "sample_count": len(screenshot_pairs),
            }
        )

    def load(self, limit: int | None = None) -> Iterator[EvalSample]:
        """Yield EvalSample objects from the cloned Design2Code repository."""
        metric_scores_lookup = _load_eval_results(self._repo_path)

        count = 0
        for pair in self._discover_pairs():
            if limit is not None and count >= limit:
                break

            sample = self._pair_to_sample(pair, metric_scores_lookup)
            yield sample
            count += 1

    # ── private helpers ───────────────────────────────────────────────────────

    @property
    def _repo_path(self) -> Path:
        return self.cache_dir / _REPO_DIR_NAME

    def _discover_pairs(self) -> Iterator[_FilePair]:
        """Yield (stem, screenshot_path, html_path) tuples from the repo."""
        repo = self._repo_path

        # Build a stem -> html_path index across all candidate HTML directories.
        html_index: dict[str, Path] = {}
        for rel_dir in _HTML_DIRS:
            html_dir = repo / rel_dir
            if not html_dir.is_dir():
                continue
            for html_file in sorted(html_dir.glob("*.html")):
                stem = html_file.stem
                if stem not in html_index:
                    html_index[stem] = html_file

        # Walk screenshot directories and match to HTML by stem.
        seen: set[str] = set()
        for rel_dir in _SCREENSHOT_DIRS:
            screenshot_dir = repo / rel_dir
            if not screenshot_dir.is_dir():
                continue
            for img_file in sorted(screenshot_dir.iterdir()):
                if img_file.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                    continue
                stem = img_file.stem
                if stem in seen:
                    continue
                seen.add(stem)
                yield _FilePair(
                    stem=stem,
                    screenshot=img_file,
                    html=html_index.get(stem),
                )

    def _pair_to_sample(
        self,
        pair: _FilePair,
        metric_scores_lookup: dict[str, dict[str, float]],
    ) -> EvalSample:
        reference_image = Image.open(pair.screenshot).convert("RGB")

        reference_code: str | None = None
        if pair.html is not None:
            reference_code = pair.html.read_text(encoding="utf-8", errors="replace")

        raw_scores = metric_scores_lookup.get(pair.stem, {})
        metric_scores = {k: float(v) for k, v in raw_scores.items() if _is_numeric(v)}
        dimensions = _metrics_to_dimensions(metric_scores)

        return EvalSample(
            id=f"design2code-{pair.stem}",
            dataset="design2code",
            reference_image=reference_image,
            candidate_image=None,  # rendered on demand via playwright
            reference_code=reference_code,
            candidate_code=None,
            ground_truth=GroundTruth(
                metric_scores=metric_scores,
                dimensions=dimensions,
            ),
            metadata={
                "screenshot_path": str(pair.screenshot),
                "html_path": str(pair.html) if pair.html else None,
                "note": (
                    "Rendering candidate HTML to an image requires playwright "
                    "(install design-eval[full])."
                ),
            },
        )


# ── data class ────────────────────────────────────────────────────────────────


class _FilePair:
    __slots__ = ("stem", "screenshot", "html")

    def __init__(self, stem: str, screenshot: Path, html: Path | None) -> None:
        self.stem = stem
        self.screenshot = screenshot
        self.html = html


# ── module-level helpers ──────────────────────────────────────────────────────


def _load_eval_results(repo_path: Path) -> dict[str, dict[str, float]]:
    """Return a stem -> metric_scores mapping from any pre-computed results file."""
    import json

    for filename in _EVAL_RESULT_FILENAMES:
        results_file = repo_path / filename
        if not results_file.exists():
            continue
        try:
            raw = json.loads(results_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        if isinstance(raw, dict):
            # Format A: {"stem": {"metric": score, ...}, ...}
            first_value = next(iter(raw.values()), None)
            if isinstance(first_value, dict):
                return raw

            # Format B: flat dict of metric -> score (single-page results)
            # Wrap under a sentinel key so the structure is uniform; the lookup
            # will not match any stem so this is effectively a no-op.
            return {}

    return {}


def _is_numeric(value: object) -> bool:
    try:
        float(value)  # type: ignore[arg-type]
        return True
    except (TypeError, ValueError):
        return False


def _metrics_to_dimensions(metric_scores: dict[str, float]) -> list[DesignDimension]:
    """Map metric names to deduplicated DesignDimension values."""
    seen: set[DesignDimension] = set()
    result: list[DesignDimension] = []
    for key in metric_scores:
        dim = DESIGN2CODE_METRIC_MAP.get(key)
        if dim is not None and dim not in seen:
            seen.add(dim)
            result.append(dim)
    return result
