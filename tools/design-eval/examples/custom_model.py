"""Example: Implement and evaluate a custom design critique model."""

from pathlib import Path

from design_eval.config import Config
from design_eval.datasets.gde import GraphicDesignEvaluationLoader
from design_eval.evaluators.gde_eval import GDEEvaluator
from design_eval.metrics.aggregator import aggregate_results
from design_eval.models.dimensions import DesignDimension
from design_eval.models.output import Issue, ModelOutput
from design_eval.models.sample import EvalSample
from design_eval.reporting.dimension_summary import print_dimension_summary


class MyDesignCritic:
    """Custom model that always reports perfect scores.

    Replace this with your actual design critique logic.
    Any class with a `critique(sample: EvalSample) -> ModelOutput` method works.
    """

    def critique(self, sample: EvalSample) -> ModelOutput:
        # Your analysis logic here
        # Access sample.reference_image, sample.candidate_image, etc.

        issues = [
            Issue(
                category=DesignDimension.ALIGNMENT.value,
                severity="minor",
                description="Slight misalignment in header",
                confidence=0.75,
            ),
        ]

        dimension_scores = {
            DesignDimension.PADDING.value: 0.9,
            DesignDimension.COLOR.value: 0.95,
            DesignDimension.TYPOGRAPHY.value: 0.85,
            DesignDimension.ALIGNMENT.value: 0.7,
            DesignDimension.LAYOUT.value: 0.88,
        }

        return ModelOutput(
            issues=issues,
            dimension_scores=dimension_scores,
        )


if __name__ == "__main__":
    config = Config.default()
    model = MyDesignCritic()

    loader = GraphicDesignEvaluationLoader(cache_dir=config.cache_dir)
    if not loader.is_downloaded():
        loader.download()

    samples = list(loader.load(limit=5))
    print(f"Loaded {len(samples)} samples")

    result = GDEEvaluator().evaluate(model, samples)
    print(f"Scores: {result.aggregate_scores}")

    report = aggregate_results([result])
    print_dimension_summary(report)
