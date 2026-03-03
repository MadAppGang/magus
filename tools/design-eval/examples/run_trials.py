"""Multi-model trial runner — 10 trials across 6 models.

Usage:
    source .env && uv run python examples/run_trials.py
    source .env && uv run python examples/run_trials.py --trials 5 --limit 3
"""

from __future__ import annotations

import argparse
import json
import time
import warnings
from dataclasses import asdict, dataclass, field
from pathlib import Path

warnings.filterwarnings("ignore", category=RuntimeWarning, module="scipy")
warnings.filterwarnings("ignore", message=".*ConstantInputWarning.*")

from PIL import Image

from design_eval.evaluators.designbench_edit_eval import DesignBenchEditEvaluator
from design_eval.evaluators.gde_eval import GDEEvaluator
from design_eval.metrics.aggregator import aggregate_results
from design_eval.models.dimensions import DesignDimension
from design_eval.models.sample import EvalSample, GroundTruth
from design_eval.reporting.dimension_summary import format_dimension_table

# ── Model registry ──────────────────────────────────────────────────────

MODELS = {
    "claude-sonnet-4.6": {
        "type": "anthropic",
        "model_id": "claude-sonnet-4-6",
    },
    "gpt-5.2": {
        "type": "openai",
        "model_id": "gpt-4o",  # adjust to gpt-5.2 when available
    },
    "minimax-m2.5": {
        "type": "litellm",
        "model_id": "minimax-m2.5",
    },
    "kimi-k2.5": {
        "type": "litellm",
        "model_id": "kimi-for-coding",
    },
    "gemini-3-pro": {
        "type": "litellm",
        "model_id": "gemini-3-pro-preview",
    },
    "gemini-3.1-pro": {
        "type": "litellm",
        "model_id": "gemini-sub/gemini-3.1-pro-preview",
    },
}


def create_model(name: str, config: dict):
    """Instantiate a model adapter from config."""
    if config["type"] == "anthropic":
        from design_eval.adapters.anthropic_adapter import AnthropicModel
        return AnthropicModel(model=config["model_id"])
    elif config["type"] == "openai":
        from design_eval.adapters.openai_adapter import OpenAIModel
        return OpenAIModel(model=config["model_id"])
    elif config["type"] == "openrouter":
        from design_eval.adapters.openrouter_adapter import OpenRouterModel
        return OpenRouterModel(model=config["model_id"])
    elif config["type"] == "litellm":
        from design_eval.adapters.litellm_adapter import LiteLLMModel
        return LiteLLMModel(model=config["model_id"])
    else:
        raise ValueError(f"Unknown model type: {config['type']}")


# ── Sample generation ───────────────────────────────────────────────────

def generate_samples(limit: int = 5) -> dict[str, list[EvalSample]]:
    """Generate synthetic test samples for evaluation.

    For real evaluations, replace this with dataset loading:
        loader = GraphicDesignEvaluationLoader(cache_dir=...)
        loader.download()
        samples = list(loader.load(limit=limit))
    """
    # Create varied synthetic images
    colors_ref = [
        (255, 255, 255),  # white
        (240, 248, 255),  # alice blue
        (245, 245, 220),  # beige
        (255, 250, 240),  # floral white
        (248, 248, 255),  # ghost white
    ]
    colors_bad = [
        (220, 220, 240),  # shifted blue
        (255, 230, 200),  # shifted warm
        (200, 245, 200),  # shifted green
        (255, 200, 200),  # shifted red
        (230, 230, 200),  # shifted yellow
    ]

    gde_samples = []
    edit_samples = []

    for i in range(min(limit, len(colors_ref))):
        ref = Image.new("RGB", (300, 200), colors_ref[i])
        bad = Image.new("RGB", (300, 200), colors_bad[i])

        gde_samples.append(EvalSample(
            id=f"gde-{i+1}",
            dataset="gde",
            reference_image=ref,
            candidate_image=bad,
            ground_truth=GroundTruth(
                dimension_scores={
                    "alignment": 3.5 + (i * 0.3),
                    "whitespace": 3.0 + (i * 0.2),
                    "color_harmony": 4.0 - (i * 0.1),
                },
            ),
        ))

        labels = ["color", "text", "position", "size", "alignment"]
        edit_samples.append(EvalSample(
            id=f"edit-{i+1}",
            dataset="designbench_edit",
            reference_image=ref,
            candidate_image=bad,
            ground_truth=GroundTruth(issue_labels=[labels[i % len(labels)]]),
        ))

    return {"gde": gde_samples, "edit": edit_samples}


# ── Trial result tracking ──────────────────────────────────────────────

@dataclass
class TrialResult:
    model: str
    trial: int
    gde_scores: dict[str, float] = field(default_factory=dict)
    edit_scores: dict[str, float] = field(default_factory=dict)
    dimension_scores: dict[str, float] = field(default_factory=dict)
    duration_s: float = 0.0
    error: str | None = None


def run_trial(
    model_name: str,
    model_config: dict,
    samples: dict[str, list[EvalSample]],
    trial_num: int,
) -> TrialResult:
    """Run one trial for one model."""
    result = TrialResult(model=model_name, trial=trial_num)
    start = time.time()

    try:
        model = create_model(model_name, model_config)

        # GDE evaluation
        gde_result = GDEEvaluator().evaluate(model, samples["gde"])
        result.gde_scores = gde_result.aggregate_scores

        # Edit evaluation
        edit_result = DesignBenchEditEvaluator().evaluate(model, samples["edit"])
        result.edit_scores = edit_result.aggregate_scores

        # Aggregate dimensions
        report = aggregate_results([gde_result, edit_result])
        result.dimension_scores = {
            dim: agg.overall_score
            for dim, agg in report.dimensions.items()
        }

    except Exception as e:
        result.error = f"{type(e).__name__}: {e}"

    result.duration_s = round(time.time() - start, 1)
    return result


# ── Main ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Multi-model design critique evaluation")
    parser.add_argument("--trials", type=int, default=10, help="Number of trials per model")
    parser.add_argument("--limit", type=int, default=5, help="Samples per dataset per trial")
    parser.add_argument("--output", type=str, default="./results/trials", help="Output directory")
    parser.add_argument("--models", type=str, nargs="*", default=None, help="Model names to run (default: all)")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Select models
    models_to_run = {k: v for k, v in MODELS.items() if args.models is None or k in args.models}
    print(f"Models: {list(models_to_run.keys())}")
    print(f"Trials: {args.trials} | Samples/dataset: {args.limit}")
    print("=" * 70)

    # Generate samples once (shared across all trials for consistency)
    samples = generate_samples(limit=args.limit)
    print(f"Generated {len(samples['gde'])} GDE + {len(samples['edit'])} edit samples\n")

    all_results: list[TrialResult] = []

    for model_name, model_config in models_to_run.items():
        print(f"\n{'─' * 50}")
        print(f"  {model_name} ({model_config['model_id']})")
        print(f"{'─' * 50}")

        for trial in range(1, args.trials + 1):
            result = run_trial(model_name, model_config, samples, trial)
            all_results.append(result)

            if result.error:
                print(f"  Trial {trial:2d}: ERROR — {result.error}")
            else:
                f1 = result.edit_scores.get("f1", 0)
                pr = result.gde_scores.get("pearson_r", 0)
                print(f"  Trial {trial:2d}: edit_f1={f1:.3f}  gde_pearson={pr:.3f}  ({result.duration_s}s)")

    # ── Summary ─────────────────────────────────────────────────────────

    print("\n" + "=" * 70)
    print("  SUMMARY — Average across all trials")
    print("=" * 70)

    summary: dict[str, dict] = {}
    for model_name in models_to_run:
        model_results = [r for r in all_results if r.model == model_name and r.error is None]
        if not model_results:
            summary[model_name] = {"status": "ALL FAILED"}
            continue

        n = len(model_results)
        avg_edit_f1 = sum(r.edit_scores.get("f1", 0) for r in model_results) / n
        avg_edit_acc = sum(r.edit_scores.get("accuracy", 0) for r in model_results) / n
        avg_gde_pr = sum(r.gde_scores.get("pearson_r", 0) for r in model_results) / n
        avg_gde_sr = sum(r.gde_scores.get("spearman_r", 0) for r in model_results) / n
        avg_duration = sum(r.duration_s for r in model_results) / n

        # Average dimension scores
        avg_dims: dict[str, float] = {}
        for dim in DesignDimension:
            vals = [r.dimension_scores.get(dim.value, 0) for r in model_results]
            avg_dims[dim.value] = sum(vals) / len(vals)

        errors = len([r for r in all_results if r.model == model_name and r.error is not None])

        summary[model_name] = {
            "trials_ok": n,
            "trials_err": errors,
            "edit_f1": round(avg_edit_f1, 4),
            "edit_accuracy": round(avg_edit_acc, 4),
            "gde_pearson_r": round(avg_gde_pr, 4),
            "gde_spearman_r": round(avg_gde_sr, 4),
            "avg_duration_s": round(avg_duration, 1),
            "dimensions": {k: round(v, 4) for k, v in avg_dims.items()},
        }

    # Print summary table
    header = f"{'Model':<22} {'Trials':>6} {'Edit F1':>8} {'Edit Acc':>9} {'GDE r':>7} {'Avg(s)':>7}"
    print(header)
    print("-" * len(header))
    for model_name, s in summary.items():
        if s.get("status") == "ALL FAILED":
            print(f"{model_name:<22} {'FAILED':>6}")
        else:
            print(
                f"{model_name:<22} {s['trials_ok']:>6} "
                f"{s['edit_f1']:>8.4f} {s['edit_accuracy']:>9.4f} "
                f"{s['gde_pearson_r']:>7.4f} {s['avg_duration_s']:>7.1f}"
            )

    # Dimension breakdown
    print(f"\n{'Model':<22} {'padding':>9} {'color':>9} {'typography':>12} {'alignment':>11} {'layout':>9}")
    print("-" * 74)
    for model_name, s in summary.items():
        if s.get("status") == "ALL FAILED":
            continue
        d = s["dimensions"]
        print(
            f"{model_name:<22} {d.get('padding', 0):>9.4f} {d.get('color', 0):>9.4f} "
            f"{d.get('typography', 0):>12.4f} {d.get('alignment', 0):>11.4f} {d.get('layout', 0):>9.4f}"
        )

    # Save results
    results_path = output_dir / "trial_results.json"
    with open(results_path, "w") as f:
        json.dump({
            "config": {
                "trials": args.trials,
                "limit": args.limit,
                "models": list(models_to_run.keys()),
            },
            "summary": summary,
            "raw_results": [
                {
                    "model": r.model,
                    "trial": r.trial,
                    "gde_scores": r.gde_scores,
                    "edit_scores": r.edit_scores,
                    "dimension_scores": r.dimension_scores,
                    "duration_s": r.duration_s,
                    "error": r.error,
                }
                for r in all_results
            ],
        }, f, indent=2)

    print(f"\nResults saved to {results_path}")


if __name__ == "__main__":
    main()
