"""Configuration management for design-eval."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class DatasetConfig:
    """Per-dataset configuration."""

    enabled: bool = True
    limit: int | None = None
    cache_dir: Path | None = None


@dataclass
class Config:
    """Top-level evaluation configuration."""

    output_dir: Path = field(default_factory=lambda: Path("./results"))
    cache_dir: Path = field(default_factory=lambda: Path("~/.cache/design-eval").expanduser())
    datasets: dict[str, DatasetConfig] = field(default_factory=dict)
    model_module: str | None = None
    report_format: str = "markdown"

    @classmethod
    def from_yaml(cls, path: Path) -> Config:
        """Load configuration from a YAML file."""
        with open(path) as f:
            raw = yaml.safe_load(f) or {}

        datasets = {}
        for name, cfg in raw.get("datasets", {}).items():
            datasets[name] = DatasetConfig(
                enabled=cfg.get("enabled", True),
                limit=cfg.get("limit"),
                cache_dir=Path(cfg["cache_dir"]) if cfg.get("cache_dir") else None,
            )

        return cls(
            output_dir=Path(raw.get("output_dir", "./results")),
            cache_dir=Path(raw.get("cache_dir", "~/.cache/design-eval")).expanduser(),
            datasets=datasets,
            model_module=raw.get("model_module"),
            report_format=raw.get("report_format", "markdown"),
        )

    @classmethod
    def default(cls) -> Config:
        """Return default configuration."""
        return cls()
