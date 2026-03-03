"""Dataset loaders for design-eval."""

from design_eval.datasets.base import DatasetLoader
from design_eval.datasets.design2code import Design2CodeLoader
from design_eval.datasets.designbench_edit import DesignBenchEditLoader
from design_eval.datasets.designbench_repair import DesignBenchRepairLoader
from design_eval.datasets.gde import GraphicDesignEvaluationLoader

__all__ = [
    "DatasetLoader",
    "Design2CodeLoader",
    "DesignBenchEditLoader",
    "DesignBenchRepairLoader",
    "GraphicDesignEvaluationLoader",
]
