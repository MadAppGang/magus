"""CLI interface for design-eval: download, run, report."""

from __future__ import annotations

import importlib
import json
from pathlib import Path

import click

from design_eval.config import Config


DATASET_NAMES = ["design2code", "designbench_edit", "designbench_repair", "gde"]


def _get_loaders(config: Config, dataset: str) -> list:
    """Create dataset loader instances for the requested datasets."""
    from design_eval.datasets.design2code import Design2CodeLoader
    from design_eval.datasets.designbench_edit import DesignBenchEditLoader
    from design_eval.datasets.designbench_repair import DesignBenchRepairLoader
    from design_eval.datasets.gde import GraphicDesignEvaluationLoader

    loader_map = {
        "design2code": Design2CodeLoader,
        "designbench_edit": DesignBenchEditLoader,
        "designbench_repair": DesignBenchRepairLoader,
        "gde": GraphicDesignEvaluationLoader,
    }

    names = DATASET_NAMES if dataset == "all" else [dataset]
    return [loader_map[n](cache_dir=config.cache_dir) for n in names if n in loader_map]


def _get_evaluators(dataset: str) -> list:
    """Create evaluator instances for the requested datasets."""
    from design_eval.evaluators.design2code_eval import Design2CodeEvaluator
    from design_eval.evaluators.designbench_edit_eval import DesignBenchEditEvaluator
    from design_eval.evaluators.designbench_repair_eval import DesignBenchRepairEvaluator
    from design_eval.evaluators.gde_eval import GDEEvaluator

    evaluator_map = {
        "design2code": Design2CodeEvaluator,
        "designbench_edit": DesignBenchEditEvaluator,
        "designbench_repair": DesignBenchRepairEvaluator,
        "gde": GDEEvaluator,
    }

    names = DATASET_NAMES if dataset == "all" else [dataset]
    return [evaluator_map[n]() for n in names if n in evaluator_map]


def _load_model(module_path: str):
    """Dynamically import a model class from 'module:ClassName' format."""
    if ":" not in module_path:
        raise click.BadParameter(
            f"Model must be in 'module:ClassName' format, got '{module_path}'"
        )
    module_name, class_name = module_path.rsplit(":", 1)
    module = importlib.import_module(module_name)
    cls = getattr(module, class_name)
    return cls()


@click.group()
def main() -> None:
    """Design-eval: unified design critique evaluation toolkit."""


@main.command()
@click.option(
    "--dataset",
    type=click.Choice(DATASET_NAMES + ["all"], case_sensitive=False),
    default="all",
    help="Which dataset(s) to download.",
)
@click.option(
    "--cache-dir",
    type=click.Path(),
    default=None,
    help="Cache directory (default: ~/.cache/design-eval).",
)
def download(dataset: str, cache_dir: str | None) -> None:
    """Download and cache evaluation datasets."""
    config = Config.default()
    if cache_dir:
        config.cache_dir = Path(cache_dir)

    loaders = _get_loaders(config, dataset)
    for loader in loaders:
        click.echo(f"Downloading {loader.name}...")
        loader.download()
        click.echo(f"  Cached to {loader.cache_dir}")

    click.echo("Done.")


@main.command()
@click.option(
    "--model",
    required=True,
    help="Model in 'module:ClassName' format (e.g. design_eval.adapters.dummy_adapter:DummyModel).",
)
@click.option(
    "--dataset",
    type=click.Choice(DATASET_NAMES + ["all"], case_sensitive=False),
    default="all",
    help="Which dataset(s) to evaluate on.",
)
@click.option("--limit", type=int, default=None, help="Max samples per dataset.")
@click.option(
    "--output-dir",
    type=click.Path(),
    default="./results",
    help="Directory for result files.",
)
@click.option(
    "--cache-dir",
    type=click.Path(),
    default=None,
    help="Cache directory for datasets.",
)
def run(model: str, dataset: str, limit: int | None, output_dir: str, cache_dir: str | None) -> None:
    """Run a design critique model on evaluation datasets."""
    from design_eval.evaluators.base import DatasetEvalResult

    config = Config.default()
    config.output_dir = Path(output_dir)
    if cache_dir:
        config.cache_dir = Path(cache_dir)

    click.echo(f"Loading model: {model}")
    model_instance = _load_model(model)

    loaders = _get_loaders(config, dataset)
    evaluators = _get_evaluators(dataset)
    all_results: list[DatasetEvalResult] = []

    for loader, evaluator in zip(loaders, evaluators):
        if not loader.is_downloaded():
            click.echo(f"  Downloading {loader.name}...")
            loader.download()

        click.echo(f"  Evaluating on {loader.name}...")
        samples = list(loader.load(limit=limit))
        click.echo(f"    Loaded {len(samples)} samples")

        result = evaluator.evaluate(model_instance, samples)
        all_results.append(result)

        click.echo(f"    Scores: {result.aggregate_scores}")

    # Save raw results
    config.output_dir.mkdir(parents=True, exist_ok=True)
    results_path = config.output_dir / "results.json"
    results_data = []
    for r in all_results:
        results_data.append({
            "dataset": r.dataset,
            "num_samples": r.num_samples,
            "aggregate_scores": r.aggregate_scores,
            "dimension_scores": r.dimension_scores,
        })
    with open(results_path, "w") as f:
        json.dump(results_data, f, indent=2)

    click.echo(f"\nResults saved to {results_path}")


@main.command()
@click.option(
    "--results-dir",
    type=click.Path(exists=True),
    required=True,
    help="Directory containing results.json.",
)
@click.option(
    "--format",
    "fmt",
    type=click.Choice(["json", "markdown", "both"], case_sensitive=False),
    default="markdown",
    help="Report format.",
)
def report(results_dir: str, fmt: str) -> None:
    """Generate reports from evaluation results."""
    from design_eval.evaluators.base import DatasetEvalResult
    from design_eval.metrics.aggregator import aggregate_results
    from design_eval.reporting.dimension_summary import print_dimension_summary
    from design_eval.reporting.json_report import generate_json_report
    from design_eval.reporting.markdown_report import generate_markdown_report

    results_path = Path(results_dir) / "results.json"
    if not results_path.exists():
        raise click.ClickException(f"No results.json found in {results_dir}")

    with open(results_path) as f:
        raw = json.load(f)

    # Reconstruct DatasetEvalResult objects
    dataset_results = []
    for entry in raw:
        dataset_results.append(
            DatasetEvalResult(
                dataset=entry["dataset"],
                num_samples=entry["num_samples"],
                aggregate_scores=entry.get("aggregate_scores", {}),
                dimension_scores=entry.get("dimension_scores", {}),
            )
        )

    aggregated = aggregate_results(dataset_results)

    # Print summary to stdout
    print_dimension_summary(aggregated)

    # Generate report files
    output_dir = Path(results_dir)
    if fmt in ("json", "both"):
        path = generate_json_report(aggregated, output_dir / "report.json")
        click.echo(f"JSON report: {path}")

    if fmt in ("markdown", "both"):
        path = generate_markdown_report(aggregated, output_dir / "report.md")
        click.echo(f"Markdown report: {path}")


if __name__ == "__main__":
    main()
