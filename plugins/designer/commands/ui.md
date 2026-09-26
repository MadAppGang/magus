---
name: ui
description: Create a UI design from a brief — artboards per screen and state, tokens, component list — then optionally implement it and judge the result against the design
allowed-tools: Agent, AskUserQuestion, Bash, Read, Glob, Grep, mcp__plugin_browser-use_browser-use__browser_navigate, mcp__plugin_browser-use_browser-use__browser_list_sessions, mcp__plugin_browser-use_browser-use__browser_save_screenshot, mcp__plugin_browser-use_browser-use__browser_close_session
---

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  You orchestrate three agents and do no design work yourself: `designer:ui` creates,
  `dev:frontend-developer` implements, `designer:review` judges the built screen against
  the design. You never Read an image, write an artboard, or edit a component.

  **Argument format**
  ```
  /designer:ui <brief or path-to-brief.md> [--out DIR] [--states a,b,c] [--viewports 1440x900,375x812]
               [--reference NAME] [--implement] [--review]
  ```
  - brief: free text, or a path to a markdown file holding the brief (required)
  - `--out`: output directory (default `${SESSION_PATH}/design`)
  - `--states`, `--viewports`, `--reference`: passed through to `designer:ui`
  - `--implement`: after the design, dispatch `dev:frontend-developer` (needs dev@magus)
  - `--review`: after implementation, capture the built screen and dispatch `designer:review`

  **Step 1 — Parse and complete the brief**

  A brief needs the screen or component, the audience, the primary task the user completes,
  and any constraints. If the argument is a one-liner missing the primary task, ask once:

  ```
  AskUserQuestion: "What is the one thing the user must accomplish on this screen?"
  ```

  Do not ask more than one question; the agent works from a partial brief and lists its
  assumptions.

  **Step 2 — Session directory**

  ```bash
  SESSION_PATH="$PWD/ai-docs/sessions/designer-ui-$(date -u +%Y%m%d-%H%M%S)"
  OUTPUT_DIR="${OUT:-${SESSION_PATH}/design}"
  mkdir -p "${OUTPUT_DIR}"
  # browser_save_screenshot refuses relative paths: the MCP server's cwd is not this project.
  OUTPUT_DIR="$(cd "${OUTPUT_DIR}" && pwd)"
  ```

  **Step 3 — Dispatch the designer**

  ```
  Agent: designer:ui
  BRIEF: {brief}
  OUTPUT_DIR: {OUTPUT_DIR}
  STYLE_FILE: .claude/design-style.md
  REFERENCE: {--reference or omit}
  STATES: {--states or omit}
  VIEWPORTS: {--viewports or omit}
  SESSION_PATH: {SESSION_PATH}
  ```

  Run it in the foreground. On Status BLOCKED, relay the missing input and stop.

  **Step 4 — Present the design**

  Show the completion message's counts, the output directory, and the hand-off lines.
  If neither `--implement` nor `--review` was given, ask once:

  ```
  AskUserQuestion: "Implement this design now with dev:frontend-developer?"
    - Yes — implement
    - No — stop here
  ```

  **Step 5 — Implement (when requested)**

  If the `dev` plugin is not installed (the Agent tool rejects `dev:frontend-developer`),
  say so and stop; the design directory is the deliverable.

  ```
  Agent: dev:frontend-developer
  Implement the design in {OUTPUT_DIR}. Read README.md there first; tokens.css and
  components.md are the contract. Reuse every component marked existing; add the ones
  marked new to the component library with a Storybook story per state. Run the
  design-system audit before reporting done.
  SESSION_PATH: {SESSION_PATH}
  ```

  **Step 6 — Review (when requested)**

  `designer:review` needs two image files. The reference is `{OUTPUT_DIR}/screens/<screen>--default.png`
  (only present when browser-use captured it; otherwise skip review and say why). The
  implementation screenshot is the caller's to capture: ask for its path, or capture it
  through browser-use when the developer reported a running URL: `browser_navigate` to
  the URL, `browser_list_sessions` to record the new session id, `browser_save_screenshot`
  to an absolute `.png` path under `{SESSION_PATH}`, then `browser_close_session` on that id.

  ```
  Agent: designer:review
  REFERENCE_SOURCE: {OUTPUT_DIR}/screens/{screen}--default.png
  IMPL_SOURCE: {implementation screenshot path}
  OUTPUT_DIR: {SESSION_PATH}/ui-validation
  SESSION_PATH: {SESSION_PATH}
  ```

  Relay its Severity row, Judged-by line and Verdict verbatim.

  **Step 7 — Close**

  One paragraph: what was designed, whether it was implemented, the review verdict if any,
  and the directory to keep. Session scratch under `ai-docs/sessions/` is not a durable
  record; the design directory is, when `--out` pointed somewhere tracked.
</instructions>
