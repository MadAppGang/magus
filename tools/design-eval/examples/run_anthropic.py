"""Example: Run design critique evaluation with Claude."""

from pathlib import Path

from design_eval.adapters.anthropic_adapter import AnthropicModel
from design_eval.config import Config
from design_eval.datasets.designbench_edit import DesignBenchEditLoader
from design_eval.datasets.gde import GraphicDesignEvaluationLoader
from design_eval.evaluators.designbench_edit_eval import DesignBenchEditEvaluator
from design_eval.evaluators.gde_eval import GDEEvaluator
from design_eval.metrics.aggregator import aggregate_results
from design_eval.reporting.dimension_summary import print_dimension_summary
from design_eval.reporting.markdown_report import generate_markdown_report

# 1. Configure
config = Config.default()
model = AnthropicModel(model="claude-sonnet-4-6-20250514")

# 2. Load datasets
gde_loader = GraphicDesignEvaluationLoader(cache_dir=config.cache_dir)
edit_loader = DesignBenchEditLoader(cache_dir=config.cache_dir)

for loader in [gde_loader, edit_loader]:
    if not loader.is_downloaded():
        loader.download()

gde_samples = list(gde_loader.load(limit=10))
edit_samples = list(edit_loader.load(limit=10))
print(f"Loaded {len(gde_samples)} GDE + {len(edit_samples)} DesignBench edit samples")

# 3. Evaluate on both datasets
gde_result = GDEEvaluator().evaluate(model, gde_samples)
edit_result = DesignBenchEditEvaluator().evaluate(model, edit_samples)

# 4. Aggregate and report
report = aggregate_results([gde_result, edit_result])
print_dimension_summary(report)
generate_markdown_report(report, Path("./results/report.md"))
print("Report saved to ./results/report.md")
