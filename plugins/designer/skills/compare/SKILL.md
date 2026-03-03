---
name: compare
namespace: designer
description: >
  SKILL (use Skill tool, NOT Task tool). Provides the compare.ts CLI invocation
  pattern, semantic comparison prompt template, severity thresholds, and model
  selection guide for UI design comparison. Use when any agent needs to invoke
  the designer pixel-diff pipeline or AI semantic analysis outside the full
  design-review agent workflow.
---

# UI Comparison Skill

This skill documents how to use the designer plugin's comparison engine from
any agent context. It covers:

1. The `compare.ts` CLI invocation pattern
2. The semantic comparison prompt template (via claudish)
3. Severity thresholds reference
4. Model selection guide
5. Tips for reducing false positives

---

## 1. compare.ts CLI Invocation

The comparison script is located at `${CLAUDE_PLUGIN_ROOT}/scripts/compare.ts`.
It performs deterministic pixel-level comparison: normalization, optional masking,
pixelmatch, and 3-panel diff image composition.

### Basic Invocation

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/compare.ts" \
  --ref "${OUTPUT_DIR}/reference-raw.png" \
  --impl "${OUTPUT_DIR}/implementation-raw.png" \
  --output "${OUTPUT_DIR}" \
  --width 1440 \
  --height 900
```

### Full Invocation with All Options

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/compare.ts" \
  --ref "${REFERENCE_IMAGE_PATH}" \
  --impl "${IMPLEMENTATION_IMAGE_PATH}" \
  --output "${OUTPUT_DIR}" \
  --width "${VIEWPORT_WIDTH:-1440}" \
  --height "${VIEWPORT_HEIGHT:-900}" \
  --threshold "${THRESHOLD:-0.1}" \
  --masks "${MASKS_JSON:-[]}"
```

### CLI Arguments Reference

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `--ref` | path | YES | — | Absolute path to reference image |
| `--impl` | path | YES | — | Absolute path to implementation image |
| `--output` | path | YES | — | Output directory (created if not exists) |
| `--width` | integer | no | 1440 | Target viewport width in pixels |
| `--height` | integer | no | 900 | Target viewport height in pixels |
| `--threshold` | float | no | 0.1 | Per-pixel tolerance (0.0–1.0) |
| `--masks` | JSON | no | `[]` | Array of MaskRegion objects to exclude |

### Mask Region Format

Masks allow excluding dynamic regions (timestamps, ads, user avatars) from the diff.

```json
[
  { "x": 0, "y": 0, "width": 200, "height": 40, "reason": "dynamic timestamp" },
  { "x": 1200, "y": 800, "width": 240, "height": 100, "reason": "user avatar" }
]
```

Pass as a JSON string with shell quoting:
```bash
MASKS='[{"x":0,"y":0,"width":200,"height":40,"reason":"timestamp"}]'
bun "${CLAUDE_PLUGIN_ROOT}/scripts/compare.ts" ... --masks "${MASKS}"
```

### Output Files

The script writes to `${OUTPUT_DIR}`:

| File | Description |
|------|-------------|
| `reference-normalized.png` | Reference resized to viewport dimensions |
| `implementation-normalized.png` | Implementation resized to viewport dimensions |
| `diff-raw.png` | Raw pixelmatch diff output (diff pixels highlighted) |
| `diff.png` | 3-panel composite: reference \| implementation \| diff overlay |
| `pixel-diff.json` | Structured result (success or error schema) |

### pixel-diff.json — Success Schema

```json
{
  "success": true,
  "runId": "ui-val-20260303-143022-a1b2c3d4",
  "diffPixelCount": 12450,
  "totalPixels": 1296000,
  "diffPercentage": 0.96,
  "severity": "WARN",
  "artifacts": {
    "referenceNormalized": "reference-normalized.png",
    "implementationNormalized": "implementation-normalized.png",
    "diffImage": "diff.png"
  },
  "masksApplied": 0,
  "duration": 2340
}
```

### pixel-diff.json — Error Schema

```json
{
  "success": false,
  "runId": "ui-val-1709500000000-a1b2c3d4",
  "error": "Reference file not found: /path/to/ref.png",
  "diffPixelCount": 0,
  "totalPixels": 1296000,
  "diffPercentage": 0,
  "severity": "FAIL",
  "threshold": 0.1,
  "viewport": { "width": 1440, "height": 900 },
  "artifacts": {
    "referenceNormalized": "reference-normalized.png",
    "implementationNormalized": "implementation-normalized.png",
    "diffRaw": "diff-raw.png",
    "diffImage": "diff.png"
  },
  "masksApplied": 0,
  "duration": 12
}
```

### Exit Codes

| Code | Phase | Condition |
|------|-------|-----------|
| 0 | — | Success |
| 1 | validation | File not found, unsupported format, non-writable output dir |
| 2 | normalization | sharp decode/resize/write failure |
| 3 | comparison | pixelmatch failure |
| 4 | output | diff image composition failure |

Always read `pixel-diff.json` after the Bash call. Use the `success` field to branch:
- `success: true` → proceed with semantic analysis
- `success: false` → surface `error` message to user

---

## 2. Semantic Comparison Prompt Template

Use this prompt when invoking claudish for AI semantic analysis. It asks the
vision model to categorize differences across 7 UI categories and output
structured JSON.

### Prompt Template

```
Compare these two UI screenshots:
- Image 1: REFERENCE (design target)
- Image 2: IMPLEMENTATION (built result)

For each difference category below, report: severity (CRITICAL/HIGH/MEDIUM/LOW),
description, and specific location.

Categories:
1. Colors - backgrounds, text, borders, buttons
2. Typography - font family, size, weight, line height
3. Spacing - padding, margin, gap between elements
4. Layout - element position, alignment, order, missing/extra elements
5. Imagery - icons, images, illustrations (wrong/missing/extra)
6. Content - text content differences (if not due to dynamic data)
7. States - hover, disabled, active states incorrectly shown

Output as JSON:
{
  "overallScore": 0-10,
  "categories": {
    "colors": { "severity": "...", "issues": [...] },
    "typography": { "severity": "...", "issues": [...] },
    "spacing": { "severity": "...", "issues": [...] },
    "layout": { "severity": "...", "issues": [...] },
    "imagery": { "severity": "...", "issues": [...] },
    "content": { "severity": "...", "issues": [...] },
    "states": { "severity": "...", "issues": [...] }
  },
  "topIssues": [...top 3 critical issues...]
}
```

### claudish Invocation

```bash
# Write prompt to file for auditability
cat > "${OUTPUT_DIR}/semantic-prompt.txt" << 'PROMPT'
Compare these two UI screenshots:
... (full prompt text above)
PROMPT

# Run vision comparison
npx claudish --model "${VISION_MODEL}" \
  --image "${OUTPUT_DIR}/reference-normalized.png" \
  --image "${OUTPUT_DIR}/implementation-normalized.png" \
  --quiet --auto-approve < "${OUTPUT_DIR}/semantic-prompt.txt" \
> "${OUTPUT_DIR}/semantic-raw.txt" 2>/dev/null
CLAUDISH_EXIT=$?
```

### Parsing the Output

```bash
# Extract JSON block from raw output
# Agent should find first '{' through last '}' and attempt JSON.parse()
# If parse fails or CLAUDISH_EXIT != 0:
#   SEMANTIC_DIFF = { "skipped": true, "error": "claudish output was not valid JSON" }
```

---

## 3. Severity Thresholds Reference

### Pixel Diff Severity

| Diff % Range | Severity | Interpretation |
|---|---|---|
| 0.0 – 0.5% | PASS | Visual match — differences within anti-aliasing noise |
| 0.5 – 2.0% | WARN | Minor differences — review before shipping |
| 2.0 – 10.0% | FAIL | Significant differences — requires fix |
| >10.0% | CRITICAL | Major deviation — implementation diverged from design |

### Semantic Issue Severity

| Severity | Definition |
|----------|------------|
| CRITICAL | Prevents user task completion or fundamentally misrepresents the design |
| HIGH | Significant visual deviation that users will notice immediately |
| MEDIUM | Visible difference that degrades fidelity but not functionality |
| LOW | Polish-level issue: minor spacing, subtle color, tiny alignment |

---

## 4. Model Selection Guide

Priority order for vision model selection:

| Priority | Model | Key | Notes |
|----------|-------|-----|-------|
| 1 | `g/gemini-3-pro-preview` | `GEMINI_API_KEY` | Best accuracy, lowest latency, direct API |
| 2 | `or/google/gemini-3-pro-preview` | `OPENROUTER_API_KEY` | Same model via OpenRouter |
| 3 | `or/qwen/qwen3-vl-32b-instruct` | `OPENROUTER_API_KEY` | Best OCR and spatial reasoning fallback |
| 4 | _(skip)_ | none | Produce pixel-only report |

### Detection Pattern

```bash
if [[ -n "${GEMINI_API_KEY}" ]]; then
  VISION_MODEL="g/gemini-3-pro-preview"
elif [[ -n "${OPENROUTER_API_KEY}" ]]; then
  VISION_MODEL="or/google/gemini-3-pro-preview"
  # If Gemini not available via OpenRouter, fall back:
  # VISION_MODEL="or/qwen/qwen3-vl-32b-instruct"
else
  echo "WARN: No vision API key. Semantic analysis skipped."
  SEMANTIC_SKIP=true
fi
```

---

## 5. Tips for Reducing False Positives

### Use Masks for Dynamic Content

Dynamic content (timestamps, user data, ads, carousels) will always differ.
Mask these regions to prevent them from inflating the diff percentage:

```bash
MASKS='[
  {"x": 0, "y": 0, "width": 300, "height": 50, "reason": "dynamic user name"},
  {"x": 900, "y": 750, "width": 540, "height": 150, "reason": "ad banner"}
]'
```

### Adjust Threshold for Anti-Aliasing

The default threshold of 0.1 filters most anti-aliasing differences.
For fonts with heavy sub-pixel rendering, increase to 0.15–0.2:

```bash
--threshold 0.15
```

Use `--includeAA false` (the default) to exclude anti-aliased edge pixels
from the diff count.

### Match Viewport to Design Spec

Always run at the viewport size the design was created for:
- Desktop designs: `--width 1440 --height 900` (default)
- Mobile designs: `--width 375 --height 812` (iPhone 14)
- Tablet designs: `--width 768 --height 1024` (iPad)

Mismatched viewports cause normalization cropping that creates false positives.

### Disable Animations Before Capture

When capturing browser screenshots, disable CSS animations and transitions
before taking the screenshot to avoid motion blur artifacts:

```javascript
const style = document.createElement('style');
style.textContent = '* { animation-duration: 0s !important; transition-duration: 0s !important; }';
document.head.appendChild(style);
```

### Wait for Network Idle

Always wait for the page to reach network idle before capturing:
- Check `document.readyState === 'complete'`
- Add a 800ms stabilization delay after load
- For SPA routes, watch for the loading spinner to disappear before capturing

### Interpret Semantic Analysis Contextually

The AI semantic analysis may flag dynamic content differences (user names,
dates, random images) as "content" or "imagery" issues. Cross-reference with
pixel diff location to determine if the issue is structural or data-driven.
