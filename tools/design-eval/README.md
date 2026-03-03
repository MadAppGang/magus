# design-eval

Unified design critique evaluation toolkit combining 4 complementary datasets (~1,570 examples) for evaluating automated design critique models.

## Quick Start

```bash
# Install
uv sync

# Download datasets
uv run design-eval download --dataset all

# Run evaluation with dummy baseline
uv run design-eval run --model design_eval.adapters.dummy_adapter:DummyModel --limit 5

# Generate report
uv run design-eval report --results-dir ./results --format markdown
```

## Datasets

| Dataset | Examples | What It Provides |
|---------|----------|-----------------|
| Design2Code | 484 | Reference screenshot vs generated HTML, 5 element-level metrics |
| DesignBench edit | 359 | Before/after UI edit pairs, change type = issue type |
| DesignBench repair | 28 | Buggy + fixed screenshots + issue codes + reasoning |
| GraphicDesignEvaluation | 700 | Original + degraded designs, 60-rater scores |

## Custom Model

```python
from design_eval.models import EvalSample, ModelOutput, Issue

class MyModel:
    def critique(self, sample: EvalSample) -> ModelOutput:
        # Your model logic here
        return ModelOutput(issues=[...], dimension_scores={...})
```
