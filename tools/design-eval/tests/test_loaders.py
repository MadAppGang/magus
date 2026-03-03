"""Tests for dataset loader infrastructure."""

from pathlib import Path

from design_eval.datasets.base import DatasetLoader
from design_eval.datasets.design2code import Design2CodeLoader
from design_eval.datasets.designbench_edit import DesignBenchEditLoader
from design_eval.datasets.designbench_repair import DesignBenchRepairLoader
from design_eval.datasets.gde import GraphicDesignEvaluationLoader


def test_loader_names():
    """Each loader has the correct dataset name."""
    cache = Path("/tmp/test-design-eval")
    assert GraphicDesignEvaluationLoader(cache_dir=cache).name == "gde"
    assert DesignBenchEditLoader(cache_dir=cache).name == "designbench_edit"
    assert DesignBenchRepairLoader(cache_dir=cache).name == "designbench_repair"
    assert Design2CodeLoader(cache_dir=cache).name == "design2code"


def test_loader_is_subclass():
    """All loaders extend DatasetLoader."""
    assert issubclass(GraphicDesignEvaluationLoader, DatasetLoader)
    assert issubclass(DesignBenchEditLoader, DatasetLoader)
    assert issubclass(DesignBenchRepairLoader, DatasetLoader)
    assert issubclass(Design2CodeLoader, DatasetLoader)


def test_manifest_path(tmp_path: Path):
    """Manifest path is inside the loader's cache dir."""
    loader = GraphicDesignEvaluationLoader(cache_dir=tmp_path)
    assert loader.manifest_path == tmp_path / "gde" / "manifest.json"


def test_is_downloaded_false(tmp_path: Path):
    """Loader reports not downloaded when cache is empty."""
    loader = GraphicDesignEvaluationLoader(cache_dir=tmp_path)
    assert not loader.is_downloaded()


def test_content_hash():
    """Content hash produces consistent SHA-256."""
    h1 = DatasetLoader._content_hash(b"hello")
    h2 = DatasetLoader._content_hash(b"hello")
    h3 = DatasetLoader._content_hash(b"world")
    assert h1 == h2
    assert h1 != h3
    assert len(h1) == 64  # SHA-256 hex digest
