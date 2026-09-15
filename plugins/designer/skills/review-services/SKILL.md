---
name: review-services
description: Judges a screen with an external vision model resolved live via claudish, and detects the project's review services (axe, Lighthouse, Percy, Chromatic, Applitools). Use when judging a design or a screenshot.
user-invocable: false
---

# Review services

Two procedures the designer agents share. Procedure A is how a screen gets judged by a
model other than the one running the agent. Procedure B is how the agent finds out which
review services this project already pays for, and uses them when they are there.

Both procedures write what they did into the report header, so a reader always knows
which eyes looked at the screen and which scanners ran.

## Procedure A — external vision judge

### Why an external model

The agent running this skill can `Read` a PNG and see it. That is a second opinion from
the same vendor. The owner's rule for design judging is a different vendor's eyes: the
newest Gemini Pro the catalog lists, and the top GPT tier when no Gemini Pro is live.
Model IDs are never written down here; they are resolved at run time.

### Step 1 — resolve the judge

```
search_models(query="gemini")
```

Pick the entry whose `id` names a Gemini **Pro** model with the highest version. Ignore
Flash, Lite, image-generation and preview-only variants unless no Pro entry exists.

If no Gemini Pro entry is live:

```
list_models()
```

Pick the highest-version `gpt-*` entry in the top tier. A user-named version is a hard
constraint: use it if listed, otherwise stop and name the live alternatives. Never
downgrade to a lower version because its name is closer as a string.

Send the catalog's `id`, never an `openrouterId` or a `provider@model` address.

Record `JUDGE_MODEL = <id>` for the report header.

### Step 2 — write the brief

The child session reads the images itself; claudish carries the image blocks to the
provider. So the brief names **paths**, and the paths must be readable from the working
directory the child runs in (the current one).

Write `${JUDGE_DIR}/input.md`, where `JUDGE_DIR` is a directory **inside the current
working directory** (`${OUTPUT_DIR}/judge` when `OUTPUT_DIR` is inside it; otherwise
`.ui-validation/judge-<RUN_ID>`). The `team` tool refuses a path outside the working
directory.

```markdown
Read these image files with the Read tool, in this order, before answering:
1. <absolute or cwd-relative path to image 1>   ← REFERENCE (or the only image)
2. <path to image 2>                            ← IMPLEMENTATION (omit in single-image mode)

Then answer the prompt below. Your answer MUST contain the JSON object described in it,
inside a ```json fence, with the key "overallScore". No other fenced JSON.

<the analysis prompt: the comparison prompt from designer:ui-analyse Pattern 5 for two
images, or Pattern 1 + Pattern 2 for one image>
```

### Step 3 — start the judge

```
team(mode="run",
     path="${JUDGE_DIR}",
     models=["${JUDGE_MODEL}"],
     input_file="${JUDGE_DIR}/input.md",
     require_pattern="\"overallScore\"")
```

Pass `input_file` only. Passing `input` as well is a hard error. `run` returns a slot map
and nothing else; the answer is not in its response.

### Step 4 — poll until settled

```
team(mode="status", path="${JUDGE_DIR}")
```

Settled means no slot has `state == "RUNNING"`. Poll at most 30 times, 20 seconds apart
(10 minutes). A single image review takes one to three minutes; a slot in
`tool_executing` for a minute is reading the images, not stuck.

On the ceiling: cancel with `team(mode="cancel", path="${JUDGE_DIR}")`, record
`judge: timed out after 10 minutes` under Obstacles, and go to Step 6.

### Step 5 — read the verdict

Read `${JUDGE_DIR}/response-<slot>.md` for the one slot in the run's `slots` map. Extract
the ```json block. That block is `SEMANTIC_DIFF` (two images) or the review findings (one
image).

A slot in state `FAILED` or `EMPTY` (`shape_mismatch`, `nonzero_exit`) produced no
verdict. Read `${JUDGE_DIR}/errors/<slot>.log` for the reason, record it under
Obstacles, and go to Step 6. Never fill the categories from the pixel diff, and never
report a score the judge did not write.

### Step 6 — local fallback, labelled

When claudish is unreachable (the `team` tool is absent or errors at call time), the
catalog lists no usable judge, or Steps 3–5 failed:

1. `Read` each image yourself, reference first.
2. Answer the same prompt.
3. Set `JUDGED_BY = "local (Claude, Read tool)"` and write the reason for the fallback
   under Obstacles Encountered.

A locally judged report is a valid report. It is not the owner's preferred route, and the
header must say so.

### Report header line

Every report that used this procedure carries, directly under its title:

```
**Judged by**: ${JUDGE_MODEL} via claudish team | local (Claude, Read tool) — <reason>
```

## Procedure B — configured review services

The agent never installs a service, never adds a credential, and never fails because one
is absent. It probes, uses what answers, and lists what it skipped.

### Detection

| Service | Present when | What it adds | Run |
|---|---|---|---|
| axe-core | `node_modules/@axe-core/cli` or `node_modules/@axe-core/playwright` in the project | Automated WCAG rules (about half of WCAG issues; keyboard order, reading order and cognitive checks stay manual) | `bunx axe <url or file://path> --save ${OUTPUT_DIR}/axe.json` |
| Lighthouse | `node_modules/lighthouse` or `lighthouse` on `PATH` | Accessibility, best-practice and performance scores for a served page | `lighthouse <url> --only-categories=accessibility --output=json --output-path=${OUTPUT_DIR}/lighthouse.json --chrome-flags="--headless"` |
| Playwright snapshots | `playwright.config.*` in the project | Baseline screenshots per test via `toHaveScreenshot()`; a failing snapshot names the drifted screen | `bunx playwright test --grep @visual --reporter=json` (only when such tests exist) |
| Percy | `PERCY_TOKEN` set and `node_modules/@percy/cli` | Cross-browser diff against approved baselines with anti-aliasing noise suppressed | `bunx percy snapshot <urls-or-static-dir>` |
| Chromatic | `CHROMATIC_PROJECT_TOKEN` set and `node_modules/chromatic` | Per-story visual diff in Storybook, every state a story | `bunx chromatic --exit-zero-on-changes` |
| Applitools | `APPLITOOLS_API_KEY` set and an `@applitools/*` package | Perceptual (not pixel) comparison with layout-aware matching | Through the project's own Eyes test runner; do not author one |

Probe order: cheapest first (env vars and `node_modules` listings via `ls`, `test -f`),
then `which` for CLIs. A probe is a read; it changes nothing.

### Using a result

- A service result is **evidence**, listed under its own heading in the report with the
  artifact path. It never replaces the judge's verdict and never sets the pixel severity.
- axe and Lighthouse need a served or file-addressable page. For an HTML artboard use
  `file://<absolute path>`; for a screenshot alone they cannot run — say so.
- Percy, Chromatic and Applitools upload to a third party. Run them only when the caller
  asked for the service by name or the project already runs them in CI (a script in
  `package.json` names them). Otherwise list the service as **available, not run**.

### Reporting

Under `## Review services` in the report:

```
| Service | Status | Artifact |
|---|---|---|
| axe-core | ran — 3 violations | ${OUTPUT_DIR}/axe.json |
| Lighthouse | not installed | — |
| Percy | available, not run (uploads; not requested) | — |
```

An empty table reads as "nothing was probed", so a run that probed and found nothing
writes every row with `not installed`.

## What the field does beyond pixel diff (research, 2026-09)

Pixel diff (pixelmatch, what `compare.ts` runs) flags anti-aliasing and sub-pixel shifts as
differences. The tools above layer three things on top of it:

1. **Perceptual and structural metrics.** SSIM weighs layout shifts over flat colour noise;
   Butteraugli models what a human eye notices. Multi-engine tools run pixel, SSIM and
   perceptual side by side and report the one that fits the change.
2. **AI review filtering.** Hosted services run a model over the diff to drop the
   false positives (anti-aliasing, font hinting) before a human sees the queue.
3. **Property-level comparison.** Reading computed CSS off the page and comparing it
   with the design file's tokens catches a wrong shade the eye cannot, and is the form
   `/dev:design-system` takes on the source side.

Sources: [Percy — visual regression tools 2026](https://percy.io/blog/visual-regression-testing-tools),
[Lastest — visual regression for design systems](https://lastest.cloud/blog/visual-regression-testing-design-systems-2026),
[Uiprobe — Figma-to-live design QA tools](https://www.uiprobe.io/learn/best-design-qa-tools-compare-figma-live-websites),
[Bug0 — visual regression tools](https://bug0.com/knowledge-base/visual-regression-testing-tools),
[Chromatic — axe comparison](https://www.chromatic.com/compare/axe),
[inclly — axe vs Lighthouse](https://inclly.com/resources/axe-vs-lighthouse).
