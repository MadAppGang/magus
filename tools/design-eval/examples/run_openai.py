"""Example: Run design critique evaluation with GPT-4o."""

from pathlib import Path

from design_eval.adapters.openai_adapter import OpenAIModel
from design_eval.config import Config
from design_eval.datasets.gde import GraphicDesignEvaluationLoader
from design_eval.evaluators.gde_eval import GDEEvaluator
from design_eval.metrics.aggregator import aggregate_results
from design_eval.reporting.dimension_summary import print_dimension_summary
from design_eval.reporting.markdown_report import generate_markdown_report

# 1. Configure
config = Config.default()
model = OpenAIModel(model="gpt-4o")

# 2. Load dataset (start with GDE — simplest)
loader = GraphicDesignEvaluationLoader(cache_dir=config.cache_dir)
if not loader.is_downloaded():
    loader.download()

samples = list(loader.load(limit=10))  # limit for demo
print(f"Loaded {len(samples)} GDE samples")

# 3. Evaluate
evaluator = GDEEvaluator()
result = evaluator.evaluate(model, samples)
print(f"Aggregate scores: {result.aggregate_scores}")

# 4. Report
report = aggregate_results([result])
print_dimension_summary(report)
generate_markdown_report(report, Path("./results/report.md"))
print("Report saved to ./results/report.md")
