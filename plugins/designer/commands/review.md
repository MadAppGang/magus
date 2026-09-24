---
name: review
description: Judge an implementation against its reference design — pixel diff, external vision model, and the project's review services. Give one image for a single-screen usability and accessibility audit.
agent: review
---

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  You are an orchestrator for the `designer:review` agent. Parse the arguments and
  delegate the whole pipeline to it. You capture nothing and judge nothing yourself.

  **Argument format**
  ```
  /designer:review <reference> <implementation> [--width N] [--height N] [--threshold N] [--panel <models>]
  /designer:review <implementation> [--scope usability|accessibility|comprehensive]
  ```

  - Two positional arguments: reference image, implementation image → compare mode
  - One positional argument: implementation image → single-image audit
  - Both must be local image files (PNG, JPG, WEBP). A Figma URL or a page URL is not
    an input the agent can open: export the frame or capture the page first — with
    browser-use@magus when installed (`designer:browser-use-integration`) — and pass
    the file.

  **Options**
  - `--width N` viewport width (default 1440, 100–3840)
  - `--height N` viewport height (default 900, 100–2160)
  - `--threshold N` pixel diff tolerance 0.0–1.0 (default 0.1)
  - `--scope` single-image mode depth (default `comprehensive`)
  - `--panel "<model>[,<model>…]"` compare mode only: the same comparison judged by
    several external vision models as well, then merged (Step 3b)

  **Examples**
  ```
  /designer:review ./designs/hero.png ./screenshots/hero-impl.png
  /designer:review ./design/screens/checkout--default.png ./shots/checkout.png --width 375 --height 812
  /designer:review ./screenshots/dashboard.png --scope accessibility
  ```

  **Step 1 — Parse**

  ```
  REFERENCE_SOURCE = first token when two positionals are present, else empty
  IMPL_SOURCE      = the last positional token (required)
  VIEWPORT_WIDTH, VIEWPORT_HEIGHT, THRESHOLD, REVIEW_SCOPE from the options
  PANEL_MODELS     = the comma-separated list after --panel, else empty
  ```

  Errors: no positional → "ERROR: Missing required argument. Usage above."; a URL as
  either positional → "ERROR: <arg> is a URL. Export or capture it to a PNG and pass the
  file."; out-of-range option → "ERROR: Invalid <option>: must be <range>"; `--panel`
  with one positional → "ERROR: --panel needs a reference and an implementation image."

  **Step 2 — Output directory**

  ```bash
  RUN_ID="ui-val-$(date -u +%Y%m%d-%H%M%S)-$(head -c 2 /dev/urandom | xxd -p)"
  if [ -n "${SESSION_PATH}" ]; then OUTPUT_DIR="${SESSION_PATH}/ui-validation/${RUN_ID}";
  else OUTPUT_DIR=".ui-validation/${RUN_ID}"; fi
  mkdir -p "${OUTPUT_DIR}"
  ```

  **Step 3 — Delegate**

  ```
  Agent: designer:review
  REFERENCE_SOURCE: {REFERENCE_SOURCE or omit}
  IMPL_SOURCE: {IMPL_SOURCE}
  VIEWPORT_WIDTH: {VIEWPORT_WIDTH}
  VIEWPORT_HEIGHT: {VIEWPORT_HEIGHT}
  THRESHOLD: {THRESHOLD}
  MASKS_JSON: []
  REVIEW_SCOPE: {REVIEW_SCOPE}
  OUTPUT_DIR: {OUTPUT_DIR}
  RUN_ID: {RUN_ID}
  ```

  **Step 3b — Panel (only with `--panel`)**

  Resolve each model the user named against the live catalog with claudish
  `list_models` / `search_models`. A version the user names is a hard constraint: if it
  is not listed, say so, show the listed alternatives, and run without the panel. Without
  the claudish MCP tools, say the panel is unavailable and continue with the single review.

  PANEL_DIR is `{OUTPUT_DIR}/panel` when OUTPUT_DIR is inside the working directory, and
  `.ui-validation/{RUN_ID}/panel` otherwise: `team` only accepts a path inside it.

  Write `{PANEL_DIR}/prompt.md` with the REFERENCE_SOURCE, IMPL_SOURCE, viewport,
  threshold and MASKS_JSON lines from Step 3, plus `JUDGE: self`. Leave out OUTPUT_DIR and
  RUN_ID: every slot then creates its own output directory, so no slot overwrites another
  or the Step 3 review, and claudish captures each slot's returned report itself.
  `JUDGE: self` makes each slot's model judge the images with its own read instead of
  handing the verdict to designer:review's usual judge, which would give every slot the
  same judge. Start the panel in the same message as the Step 3 dispatch:

  ```
  team(mode="run", path="{PANEL_DIR}",
    models=[<the resolved model IDs>],
    agent="designer:review",
    input_file="{PANEL_DIR}/prompt.md",
    require_pattern="Diff [Pp]ercentage.*[0-9.]+%",
    min_output_bytes=400)
  ```

  `require_pattern` pins the Diff Percentage row, which every design review carries with
  or without a vision model. Never pin "Overall Score": a review writes it only when
  semantic analysis ran, so a pixel-only review would be rejected. Poll
  `team(mode="status", path="{PANEL_DIR}")` until no slot is RUNNING; each completed
  review is `{PANEL_DIR}/response-<slot>.md`.

  Merge with `dev:aggregator`, which merges reviews and never reviews:

  ```
  Agent: dev:aggregator
  REVIEWS: {OUTPUT_DIR}/summary.md                 (the Step 3 review; only it writes here)
           {PANEL_DIR}/response-<slot>.md          (one line per completed slot)
  THRESHOLDS: designer:review's PASS / WARN / FAIL / CRITICAL rows under
              severity_thresholds in that agent's file, quoted at dispatch time
  OUTPUT: {PANEL_DIR}/consolidated.md
  ```

  If `dev` is not installed, present the reviews side by side instead.

  **Step 4 — Present**

  Relay from the agent's completion message: the Severity and Diff Percentage rows, the
  `Judged by` line (which model looked, or that it was judged locally and why), the top
  issues, the review-services table, and the paths to `diff.json` and `summary.md`. With
  a panel, also relay `consolidated.md`'s verdict and consensus levels, and name any slot
  that failed. Do not soften a FAIL and do not restate a locally judged report as an
  external verdict.
</instructions>
