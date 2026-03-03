"""Tests for evaluators."""

import pytest
from PIL import Image

from design_eval.adapters.dummy_adapter import DummyModel
from design_eval.evaluators.base import EvalResult
from design_eval.evaluators.designbench_edit_eval import DesignBenchEditEvaluator
from design_eval.evaluators.designbench_repair_eval import DesignBenchRepairEvaluator
from design_eval.evaluators.gde_eval import GDEEvaluator
from design_eval.models.dimensions import DesignDimension
from design_eval.models.output import Issue, ModelOutput
from design_eval.models.sample import EvalSample, GroundTruth


class TestGDEEvaluator:
    def test_evaluate_sample(self, gde_sample: EvalSample):
        evaluator = GDEEvaluator()
        output = ModelOutput(
            dimension_scores={
                "alignment": 0.8,
                "padding": 0.6,
                "color": 0.7,
                "typography": 0.5,
                "layout": 0.9,
            },
        )
        result = evaluator.evaluate_sample(gde_sample, output)
        assert result.dataset == "gde"
        assert "pearson_r" in result.scores or "pearson_p" in result.scores

    def test_evaluate_with_dummy(self, gde_sample: EvalSample):
        evaluator = GDEEvaluator()
        model = DummyModel(seed=42)
        result = evaluator.evaluate(model, [gde_sample])
        assert result.num_samples == 1
        assert result.dataset == "gde"


class TestDesignBenchEditEvaluator:
    def test_exact_match(self, sample_image: Image.Image):
        sample = EvalSample(
            id="edit-001",
            dataset="designbench_edit",
            reference_image=sample_image,
            candidate_image=sample_image,
            ground_truth=GroundTruth(
                issue_labels=["color"],
                dimensions=[DesignDimension.COLOR],
            ),
        )
        output = ModelOutput(
            issues=[Issue(category="color", severity="major", description="Color mismatch")],
        )
        evaluator = DesignBenchEditEvaluator()
        result = evaluator.evaluate_sample(sample, output)
        assert result.scores["exact_match"] == 1.0
        assert result.scores["precision"] == 1.0
        assert result.scores["recall"] == 1.0

    def test_no_match(self, sample_image: Image.Image):
        sample = EvalSample(
            id="edit-002",
            dataset="designbench_edit",
            reference_image=sample_image,
            ground_truth=GroundTruth(issue_labels=["color"]),
        )
        output = ModelOutput(
            issues=[Issue(category="typography", severity="minor", description="Wrong font")],
        )
        evaluator = DesignBenchEditEvaluator()
        result = evaluator.evaluate_sample(sample, output)
        assert result.scores["exact_match"] == 0.0


class TestDesignBenchRepairEvaluator:
    def test_partial_detection(self, eval_sample: EvalSample):
        output = ModelOutput(
            issues=[
                Issue(category="color", severity="major", description="Color wrong"),
                Issue(category="layout", severity="minor", description="Extra issue"),
            ],
        )
        evaluator = DesignBenchRepairEvaluator()
        result = evaluator.evaluate_sample(eval_sample, output)
        assert result.dataset == "designbench_repair"
        assert "precision" in result.scores
        assert "recall" in result.scores
        assert "f1" in result.scores

    def test_full_pipeline(self, eval_sample: EvalSample):
        evaluator = DesignBenchRepairEvaluator()
        model = DummyModel(seed=42)
        result = evaluator.evaluate(model, [eval_sample])
        assert result.num_samples == 1


class TestBaseEvaluator:
    def test_empty_results(self):
        evaluator = GDEEvaluator()
        result = evaluator._aggregate([])
        assert result.num_samples == 0
        assert result.aggregate_scores == {}

    def test_aggregation(self):
        evaluator = GDEEvaluator()
        results = [
            EvalResult("a", "gde", scores={"f1": 0.8}, dimension_scores={"color": 0.9}),
            EvalResult("b", "gde", scores={"f1": 0.6}, dimension_scores={"color": 0.7}),
        ]
        agg = evaluator._aggregate(results)
        assert agg.num_samples == 2
        assert agg.aggregate_scores["f1"] == pytest.approx(0.7)
        assert agg.dimension_scores["color"] == pytest.approx(0.8)
