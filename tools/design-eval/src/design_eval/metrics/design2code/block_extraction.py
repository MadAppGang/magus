"""Block matching via Hungarian algorithm.

Vendored and adapted from NoviScl/Design2Code (MIT License).
Original: Design2Code/metrics/visual_score.py — block matching functions.

Key adaptations:
- Accepts block dicts directly (no file I/O)
- Removed debug visualization and file path dependencies
- Simplified merge logic for clarity
"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from difflib import SequenceMatcher

import numpy as np
from scipy.optimize import linear_sum_assignment


def calculate_text_similarity(block1: dict, block2: dict) -> float:
    """Text similarity between two blocks via SequenceMatcher."""
    return SequenceMatcher(None, block1["text"], block2["text"]).ratio()


def create_cost_matrix(blocks_a: list[dict], blocks_b: list[dict]) -> np.ndarray:
    """Create cost matrix for Hungarian matching (negative similarity)."""
    n, m = len(blocks_a), len(blocks_b)
    cost = np.zeros((n, m))
    for i in range(n):
        for j in range(m):
            cost[i, j] = -calculate_text_similarity(blocks_a[i], blocks_b[j])
    return cost


def adjust_cost_for_context(
    cost_matrix: np.ndarray,
    consecutive_bonus: float = 1.0,
    window_size: int = 20,
) -> np.ndarray:
    """Add contextual bonus for nearby high-quality matches."""
    if window_size <= 0:
        return cost_matrix

    n, m = cost_matrix.shape
    adjusted = np.copy(cost_matrix)

    for i in range(n):
        for j in range(m):
            if adjusted[i][j] >= -0.5:
                continue
            nearby = cost_matrix[
                max(0, i - window_size) : min(n, i + window_size + 1),
                max(0, j - window_size) : min(m, j + window_size + 1),
            ]
            flat = np.sort(nearby.flatten())
            flat = np.delete(flat, np.where(flat == cost_matrix[i, j])[0][0])
            top_k = flat[: window_size * 2]
            adjusted[i][j] += consecutive_bonus * np.sum(top_k)

    return adjusted


def merge_blocks_wo_check(block1: dict, block2: dict) -> dict:
    """Merge two adjacent blocks into one."""
    merged_text = block1["text"] + " " + block2["text"]

    x_min = min(block1["bbox"][0], block2["bbox"][0])
    y_min = min(block1["bbox"][1], block2["bbox"][1])
    x_max = max(
        block1["bbox"][0] + block1["bbox"][2],
        block2["bbox"][0] + block2["bbox"][2],
    )
    y_max = max(
        block1["bbox"][1] + block1["bbox"][3],
        block2["bbox"][1] + block2["bbox"][3],
    )

    merged_color = tuple(
        (c1 + c2) // 2 for c1, c2 in zip(block1["color"], block2["color"])
    )

    return {
        "text": merged_text,
        "bbox": (x_min, y_min, x_max - x_min, y_max - y_min),
        "color": merged_color,
    }


def _find_matching(
    blocks_a: list[dict],
    blocks_b: list[dict],
    bonus: float,
    window: int,
) -> tuple[list[tuple[int, int]], list[float], np.ndarray]:
    """Run Hungarian matching and return (pairs, costs, cost_matrix)."""
    cost_matrix = create_cost_matrix(blocks_a, blocks_b)
    cost_matrix = adjust_cost_for_context(cost_matrix, bonus, window)
    row_ind, col_ind = linear_sum_assignment(cost_matrix)
    costs = cost_matrix[row_ind, col_ind].tolist()
    return list(zip(row_ind, col_ind)), costs, cost_matrix


def _difference_of_means(list1: list[float], list2: list[float]) -> float:
    """Compute mean difference of unique elements between two cost lists."""
    counter1 = Counter(list1)
    counter2 = Counter(list2)

    for element in set(list1) & set(list2):
        common = min(counter1[element], counter2[element])
        counter1[element] -= common
        counter2[element] -= common

    unique1 = list(counter1.elements())
    unique2 = list(counter2.elements())

    mean1 = sum(unique1) / len(unique1) if unique1 else 0
    mean2 = sum(unique2) / len(unique2) if unique2 else 0

    if mean1 - mean2 > 0:
        return (mean1 - mean2) if min(unique1) > min(unique2) else 0.0
    return mean1 - mean2


def _remove_indices(lst: list, indices: list[int]) -> list:
    """Remove elements at given indices (in-place, descending order)."""
    for idx in sorted(indices, reverse=True):
        if idx < len(lst):
            lst.pop(idx)
    return lst


def _merge_by_list(blocks: list[dict], merge_list: list[list]) -> list[dict]:
    """Merge block pairs from merge_list."""
    pop_list: list[int] = []
    while merge_list:
        i, j, _ = merge_list[0]
        blocks[i] = merge_blocks_wo_check(blocks[i], blocks[j])
        pop_list.append(j)
        merge_list.pop(0)
        merge_list = [
            m
            for m in merge_list
            if m[0] != i and m[1] != i and m[0] != j and m[1] != j
        ]
    _remove_indices(blocks, pop_list)
    return blocks


def find_optimal_matching(
    blocks_a: list[dict],
    blocks_b: list[dict],
    consecutive_bonus: float = 0.1,
    window_size: int = 1,
    merge_threshold: float = 0.05,
) -> tuple[list[dict], list[dict], list[tuple[int, int]]]:
    """Find optimal block matching with iterative merging.

    Repeatedly merges adjacent blocks in both lists when doing so
    improves the overall matching cost by more than `merge_threshold`.

    Returns:
        (merged_blocks_a, merged_blocks_b, matching_pairs)
    """
    merge_bonus = 0.0
    merge_window = 1

    while True:
        a_changed = False
        b_changed = False

        _, current_cost, _ = _find_matching(blocks_a, blocks_b, merge_bonus, merge_window)

        # Try merging adjacent pairs in A
        if len(blocks_a) >= 2:
            merges = []
            for i in range(len(blocks_a) - 1):
                new_a = deepcopy(blocks_a)
                new_a[i] = merge_blocks_wo_check(new_a[i], new_a[i + 1])
                new_a.pop(i + 1)
                _, updated_cost, _ = _find_matching(new_a, blocks_b, merge_bonus, merge_window)
                diff = _difference_of_means(current_cost, updated_cost)
                if diff > merge_threshold:
                    merges.append([i, i + 1, diff])

            merges.sort(key=lambda x: x[2], reverse=True)
            if merges:
                a_changed = True
                blocks_a = _merge_by_list(blocks_a, merges)

        # Try merging adjacent pairs in B
        if len(blocks_b) >= 2:
            merges = []
            for i in range(len(blocks_b) - 1):
                new_b = deepcopy(blocks_b)
                new_b[i] = merge_blocks_wo_check(new_b[i], new_b[i + 1])
                new_b.pop(i + 1)
                _, updated_cost, _ = _find_matching(blocks_a, new_b, merge_bonus, merge_window)
                diff = _difference_of_means(current_cost, updated_cost)
                if diff > merge_threshold:
                    merges.append([i, i + 1, diff])

            merges.sort(key=lambda x: x[2], reverse=True)
            if merges:
                b_changed = True
                blocks_b = _merge_by_list(blocks_b, merges)

        if not a_changed and not b_changed:
            break

    matching, _, _ = _find_matching(blocks_a, blocks_b, consecutive_bonus, window_size)
    return blocks_a, blocks_b, matching


def merge_blocks_by_bbox(blocks: list[dict]) -> list[dict]:
    """Merge blocks sharing the same bounding box."""
    merged: dict[tuple, dict] = {}
    for block in blocks:
        key = tuple(block["bbox"])
        if key in merged:
            merged[key]["text"] += " " + block["text"]
            merged[key]["color"] = [
                (c1 + c2) / 2
                for c1, c2 in zip(merged[key]["color"], block["color"])
            ]
        else:
            merged[key] = dict(block)
    return list(merged.values())
