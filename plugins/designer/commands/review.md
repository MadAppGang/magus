---
name: review
description: Compare a reference design against an implementation. Accepts Figma URL, image file, or browser URL as reference.
agent: design-review
---

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  You are an orchestrator for the designer:design-review agent. Parse the arguments
  and delegate the full comparison pipeline to the agent.

  **Argument Format**:
  ```
  /designer:review <reference> <implementation> [options]
  ```

  **Arguments**:
  - First positional arg: reference source (Figma URL, image file path, or browser URL)
  - Second positional arg: implementation source (browser URL or image file path)

  **Options**:
  - `--width N`      Viewport width in pixels (default: 1440)
  - `--height N`     Viewport height in pixels (default: 900)
  - `--threshold N`  Pixel diff tolerance 0.0–1.0 (default: 0.1)

  **Examples**:
  ```
  /designer:review https://figma.com/design/ABC123/?node-id=136-5051 http://localhost:5173/dashboard
  /designer:review ./designs/hero.png ./screenshots/hero-impl.png
  /designer:review https://staging.example.com/checkout http://localhost:3000/checkout --width 375 --height 812
  ```

  **Step 1: Parse Arguments**

  Parse $ARGUMENTS:

  ```
  REFERENCE_SOURCE = first whitespace-separated token (required)
  IMPL_SOURCE      = second whitespace-separated token (required)
  VIEWPORT_WIDTH   = value after --width  (default: 1440, must be 100-3840)
  VIEWPORT_HEIGHT  = value after --height (default: 900, must be 100-2160)
  THRESHOLD        = value after --threshold (default: 0.1, must be 0.0-1.0)
  ```

  Validation errors:
  - Missing REFERENCE_SOURCE → "ERROR: Missing required argument.
    Usage: /designer:review <reference> <implementation>"
  - Missing IMPL_SOURCE → same error
  - Invalid --width → "ERROR: Invalid width: must be 100-3840"
  - Invalid --height → "ERROR: Invalid height: must be 100-2160"
  - Invalid --threshold → "ERROR: Invalid threshold: must be 0.0-1.0"

  **Step 2: Create Output Directory**

  ```bash
  RUN_ID="ui-val-$(date -u +%Y%m%d-%H%M%S)-$(head -c 2 /dev/urandom | xxd -p)"
  if [ -n "${SESSION_PATH}" ]; then
    OUTPUT_DIR="${SESSION_PATH}/ui-validation/${RUN_ID}"
  else
    OUTPUT_DIR=".ui-validation/${RUN_ID}"
  fi
  mkdir -p "${OUTPUT_DIR}"
  echo "Output directory: ${OUTPUT_DIR}"
  echo "Run ID: ${RUN_ID}"
  ```

  **Step 3: Delegate to design-review Agent**

  Delegate to the designer:design-review agent with all parsed parameters:

  ```
  Task: designer:design-review

  Run a UI design comparison with the following parameters:

  REFERENCE_SOURCE: {REFERENCE_SOURCE}
  IMPL_SOURCE: {IMPL_SOURCE}
  VIEWPORT_WIDTH: {VIEWPORT_WIDTH}
  VIEWPORT_HEIGHT: {VIEWPORT_HEIGHT}
  THRESHOLD: {THRESHOLD}
  MASKS_JSON: []
  OUTPUT_DIR: {OUTPUT_DIR}
  RUN_ID: {RUN_ID}

  Execute the complete validation pipeline (Capture → Pixel Compare → Semantic Analysis → Report).
  When complete, return the severity, diffPercentage, and artifact paths.
  ```

  **Step 4: Present Results**

  After the agent completes, present the result summary to the user including:
  - Severity badge
  - Diff percentage
  - Top issues (if semantic analysis ran)
  - Path to diff.json and summary.md
</instructions>
