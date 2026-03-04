# Tech-Writer Benchmark Results

**Topic**: How skill injection works in the dev plugin's /dev:implement command
**Date**: 2026-03-04
**Judges**: 6/7 successful
**A/B Mapping**: Sample A = default, Sample B = techwriter

## Winner: TECHWRITER

Weighted score: **7.2** (tech-writer) vs **6.7** (default) — delta +0.5

## Per-Criterion Comparison

| Criterion | Weight | Default | Tech-Writer | Winner | Delta |
|-----------|--------|---------|-------------|--------|-------|
| AI Slop Absence | 2x | 9.8 | 9.8 | tie | +0 |
| Readability | 1.5x | 8.5 | 8.2 | default | -0.3 |
| Document Structure | 1.5x | 4.7 | 5.8 | techwriter | +1.2 |
| Conciseness | 1x | 8.2 | 8 | default | -0.2 |
| Technical Accuracy | 2x | 7.5 | 8 | techwriter | +0.5 |
| Progressive Disclosure | 1x | 4.7 | 6.7 | techwriter | +2 |
| Diagram Quality | 1x | 1 | 1 | tie | +0 |
| Overall Quality | 2x | 6.2 | 7 | techwriter | +0.8 |
| **WEIGHTED OVERALL** | **12.0x** | **6.7** | **7.2** | **techwriter** | **+0.5** |

## Preference Votes

| Metric | Value |
|--------|-------|
| Default votes | 1/6 |
| Tech-Writer votes | 5/6 |
| Consensus | 83% |
| Winner | techwriter |

## Judge Details

| Judge | Model | Parse | Preference | Reasoning |
|-------|-------|-------|------------|-----------|
| internal | internal | json | techwriter | Both fragments are clean and slop-free, but Sample B provides more specific, actionable information:... |
| minimax | minimax-m2.5 | json | default | Sample A is slightly more direct and actionable—it explicitly states what the convention is (not fol... |
| kimi | kimi-k2.5 | json | techwriter | Sample B provides more actionable information by explicitly listing the five edge cases covered, giv... |
| glm | glm-5 | json | techwriter | Sample B demonstrates better structural awareness by cross-referencing §7 and explicitly mentioning ... |
| gemini | gemini-3.1-pro-preview | json | techwriter | Sample B provides a highly concise, scannable summary that excellently demonstrates progressive disc... |
| gpt | gpt-5.3-codex | json | techwriter | Sample B is more reader-oriented and gives clearer navigational context by referencing an edge-cases... |

## Failed Judges

- qwen

## Score Distribution

### AI Slop Absence (2x)
- Default:     9.8 ± 0.4 [9–10]
- Tech-Writer: 9.8 ± 0.4 [9–10]

### Readability (1.5x)
- Default:     8.5 ± 0.5 [8–9]
- Tech-Writer: 8.2 ± 1 [7–9]

### Document Structure (1.5x)
- Default:     4.7 ± 1.2 [3–6]
- Tech-Writer: 5.8 ± 1.2 [4–7]

### Conciseness (1x)
- Default:     8.2 ± 1.6 [5–9]
- Tech-Writer: 8 ± 1.7 [5–10]

### Technical Accuracy (2x)
- Default:     7.5 ± 0.8 [6–8]
- Tech-Writer: 8 ± 0.6 [7–9]

### Progressive Disclosure (1x)
- Default:     4.7 ± 0.8 [3–5]
- Tech-Writer: 6.7 ± 1 [5–8]

### Diagram Quality (1x)
- Default:     1 ± 0 [1–1]
- Tech-Writer: 1 ± 0 [1–1]

### Overall Quality (2x)
- Default:     6.2 ± 0.8 [5–7]
- Tech-Writer: 7 ± 0.6 [6–8]

