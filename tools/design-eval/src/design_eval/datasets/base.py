"""Abstract base class for dataset loaders with caching."""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Iterator

from design_eval.models.sample import EvalSample


class DatasetLoader(ABC):
    """Base class for all dataset loaders.

    Subclasses implement `_download` and `_load_samples`. This base handles
    caching of downloaded data and provides a uniform iteration interface.
    """

    name: str  # e.g. "design2code", "designbench_edit"

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir / self.name
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    @abstractmethod
    def download(self) -> None:
        """Download and cache the dataset."""

    @abstractmethod
    def load(self, limit: int | None = None) -> Iterator[EvalSample]:
        """Yield evaluation samples from the cached dataset."""

    @property
    def manifest_path(self) -> Path:
        return self.cache_dir / "manifest.json"

    def is_downloaded(self) -> bool:
        """Check if dataset has been downloaded."""
        return self.manifest_path.exists()

    def _write_manifest(self, info: dict) -> None:
        """Write a manifest file after successful download."""
        with open(self.manifest_path, "w") as f:
            json.dump(info, f, indent=2)

    def _read_manifest(self) -> dict:
        """Read the download manifest."""
        if not self.manifest_path.exists():
            return {}
        with open(self.manifest_path) as f:
            return json.load(f)

    @staticmethod
    def _content_hash(data: bytes) -> str:
        """SHA-256 hash for content verification."""
        return hashlib.sha256(data).hexdigest()
