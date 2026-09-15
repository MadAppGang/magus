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
  /designer:review <reference> <implementation> [--width N] [--height N] [--threshold N]
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
  ```

  Errors: no positional → "ERROR: Missing required argument. Usage above."; a URL as
  either positional → "ERROR: <arg> is a URL. Export or capture it to a PNG and pass the
  file."; out-of-range option → "ERROR: Invalid <option>: must be <range>".

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

  **Step 4 — Present**

  Relay from the agent's completion message: the Severity and Diff Percentage rows, the
  `Judged by` line (which model looked, or that it was judged locally and why), the top
  issues, the review-services table, and the paths to `diff.json` and `summary.md`. Do
  not soften a FAIL and do not restate a locally judged report as an external verdict.
</instructions>
