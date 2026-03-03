---
name: designer-integration
version: 1.0.0
description: |
  Optional integration patterns for the designer plugin (designer@magus).
  Provides detection pattern and delegation workflows for pixel-level design validation.
  Use when dev:frontend agent or dev:browser-debugging skill needs design validation.
---

# Designer Plugin Integration

## Overview

The `designer` plugin provides pixel-level design comparison and AI semantic analysis
for UI validation. When installed alongside `dev`, it enhances frontend workflows with
structured design fidelity checks.

This skill is **optional** — all dev plugin functionality works without designer installed.

## When to Use

Use this skill when:
- Implementing UI components from a design reference (Figma, screenshot)
- Validating that implementation matches design spec
- Running pre-commit design fidelity checks

## Detection Pattern

Check if the designer plugin is available before delegating:

```bash
# Check designer plugin availability
designer_available=$(claude /plugin list 2>/dev/null | grep -c "designer" || echo "0")
if [ "$designer_available" -gt "0" ]; then
  echo "designer plugin available — can delegate validation"
else
  echo "designer plugin not installed — use manual comparison"
fi
```

## Delegation Pattern

When designer is available, delegate pixel-level validation from `dev:frontend`:

```
Task(
  subagent_type: "designer:review",
  prompt: "Compare reference design at {REFERENCE_PATH} against implementation at {IMPL_URL}. Viewport: 1440x900."
)
```

Or use the designer:review command directly:
```bash
# Pixel-diff comparison
/designer:review REFERENCE_SOURCE={path} IMPL_SOURCE={url}
```

## Integration Points

| dev Component | Without designer | With designer |
|--------------|-----------------|---------------|
| `dev:frontend` agent | Manual Chrome MCP screenshots | Delegate to `designer:review` |
| `dev:browser-debugging` skill | Manual visual check | `designer:review` for diff report |
| Any UI implementation | Describe visual issues | Structured pixel-diff + semantic report |

## Output Format

When designer:review succeeds, it produces:
- `diff.json` — Structured report with pixel diff + semantic analysis
- `summary.md` — Human-readable summary with severity (PASS/WARN/FAIL/CRITICAL)
- `diff.png` — 3-panel composite: reference | implementation | diff overlay

Severity thresholds:
- PASS: 0–0.5% pixel diff
- WARN: 0.5–2.0%
- FAIL: 2.0–10.0%
- CRITICAL: >10.0%

## User Notification Template

If designer plugin is NOT installed and user needs design validation:

```
Design validation features are available with the designer plugin.
Install: /plugin marketplace add designer@magus

Without the designer plugin, you can still:
- Use Chrome MCP screenshot capture for manual visual comparison
- Use Gemini via claudish for AI-based visual analysis
- Compare screenshots manually side-by-side
```
