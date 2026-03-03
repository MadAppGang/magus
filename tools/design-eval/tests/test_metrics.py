"""Tests for metrics."""

import pytest

from design_eval.metrics.base import Metric
from design_eval.metrics.classification import ClassificationMetric
from design_eval.metrics.correlation import CorrelationMetric
from design_eval.metrics.text import TextSimilarity
from design_eval.metrics.position import PositionMetric


class TestCorrelationMetric:
    def test_perfect_correlation(self):
        m = CorrelationMetric()
        result = m.compute([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
        assert result["pearson_r"] == pytest.approx(1.0)
        assert result["spearman_r"] == pytest.approx(1.0)

    def test_negative_correlation(self):
        m = CorrelationMetric()
        result = m.compute([1.0, 2.0, 3.0], [3.0, 2.0, 1.0])
        assert result["pearson_r"] == pytest.approx(-1.0)

    def test_requires_two_points(self):
        m = CorrelationMetric()
        with pytest.raises(ValueError, match="At least 2"):
            m.compute([1.0], [1.0])

    def test_length_mismatch(self):
        m = CorrelationMetric()
        with pytest.raises(ValueError, match="same length"):
            m.compute([1.0, 2.0], [1.0])


class TestClassificationMetric:
    def test_perfect_classification(self):
        m = ClassificationMetric()
        result = m.compute(["a", "b", "c"], ["a", "b", "c"])
        assert result["precision"] == pytest.approx(1.0)
        assert result["recall"] == pytest.approx(1.0)
        assert result["f1"] == pytest.approx(1.0)

    def test_wrong_classification(self):
        m = ClassificationMetric()
        result = m.compute(["a", "a", "a"], ["b", "b", "b"])
        assert result["f1"] == pytest.approx(0.0)

    def test_per_class(self):
        m = ClassificationMetric()
        result = m.compute_per_class(["a", "b", "a"], ["a", "b", "b"])
        assert "a" in result
        assert "b" in result
        assert result["a"]["precision"] > 0

    def test_length_mismatch(self):
        m = ClassificationMetric()
        with pytest.raises(ValueError):
            m.compute(["a"], ["a", "b"])


class TestTextSimilarity:
    def test_identical(self):
        m = TextSimilarity()
        result = m.compute(["hello world"], ["hello world"])
        assert result["text_similarity"] == pytest.approx(1.0)

    def test_different(self):
        m = TextSimilarity()
        result = m.compute(["abc"], ["xyz"])
        assert result["text_similarity"] == pytest.approx(0.0)

    def test_partial(self):
        m = TextSimilarity()
        result = m.compute(["hello world"], ["hello earth"])
        assert 0.0 < result["text_similarity"] < 1.0


class TestPositionMetric:
    def test_identical_position(self):
        m = PositionMetric()
        bbox = {"x": 10, "y": 20, "w": 50, "h": 30}
        result = m.compute([bbox], [bbox])
        assert result["chebyshev_mean"] == pytest.approx(0.0)
        assert result["iou_mean"] == pytest.approx(1.0)

    def test_non_overlapping(self):
        m = PositionMetric()
        result = m.compute(
            [{"x": 0, "y": 0, "w": 10, "h": 10}],
            [{"x": 100, "y": 100, "w": 10, "h": 10}],
        )
        assert result["iou_mean"] == pytest.approx(0.0)
        assert result["chebyshev_mean"] > 0


class TestProtocolSatisfaction:
    def test_correlation_satisfies_protocol(self):
        assert isinstance(CorrelationMetric(), Metric)

    def test_classification_satisfies_protocol(self):
        assert isinstance(ClassificationMetric(), Metric)

    def test_text_satisfies_protocol(self):
        assert isinstance(TextSimilarity(), Metric)

    def test_position_satisfies_protocol(self):
        assert isinstance(PositionMetric(), Metric)
