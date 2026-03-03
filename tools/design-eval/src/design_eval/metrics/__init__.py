"""Metrics for design-eval.

Core metrics (always available):
    - CorrelationMetric  — Pearson/Spearman correlation
    - ClassificationMetric — Precision/Recall/F1
    - SSIMMetric         — Structural Similarity Index
    - ColorDistanceMetric — CIEDE2000 perceptual color distance
    - TextSimilarity     — difflib SequenceMatcher text similarity
    - PositionMetric     — Chebyshev distance + IoU for bounding boxes

Optional metrics (require [full] extras):
    - CLIPSimilarity     — CLIP embedding cosine similarity

Import metrics directly from their modules to avoid eager loading of
heavy dependencies (sklearn, torch, etc.).
"""
