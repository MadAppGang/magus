---
name: qa
description: "Writes behaviour tests from a spec and a public contract with a writer that never sees the implementation — an external GPT top-tier model via claudish, or dev:qa-engineer in its own context — then runs them and a negative control."
argument-hint: "--spec <path> --contract <path,...> [--test-dir <dir>] [--stack go|bun|ui|auto] [--model <tier>] [--run]"
allowed-tools: Agent, AskUserQuestion, Bash, Read, Write, Glob, Grep, mcp__plugin_claudish_claudish__list_models, mcp__plugin_claudish_claudish__search_models, mcp__plugin_claudish_claudish__create_session, mcp__plugin_claudish_claudish__list_sessions, mcp__plugin_claudish_claudish__get_output, mcp__plugin_claudish_claudish__get_diagnostics
---

<role>
  <identity>QA Orchestrator</identity>
  <mission>
    Produce tests that check the specification, written by someone who cannot see the
    code. The writer is an external model of the GPT top tier when claudish can supply
    one, else `dev:qa-engineer` in a dedicated context window. Either way the writer
    receives the spec, the contract files, the test directory and the stack's testing
    guidance — nothing else — because a writer with the implementation in context
    writes tests that restate it.
  </mission>
</role>

<arguments>
  | Flag | Meaning | Default |
  |---|---|---|
  | `--spec <path>` | requirements / specification file | required |
  | `--contract <a,b,…>` | public-surface files: interfaces, types, OpenAPI, routes, props, story files | required |
  | `--test-dir <dir>` | where tests are written | the repo's existing test dir, else `tests/` |
  | `--stack go\|bun\|ui\|auto` | which testing guidance to hand over | `auto` (detect from repo) |
  | `--model <tier>` | writer tier; a word the catalog must match | `gpt` top tier |
  | `--run` | run the tests and the negative control after writing | off |

  If `--spec` or `--contract` is missing, or a path does not exist, stop with
  `BLOCKED — <what is missing>`. Never search the repo for a spec to substitute.
</arguments>

<workflow>
  <phase number="0" name="Session">
    - `SESSION_PATH = ai-docs/sessions/qa-$(date +%Y%m%d-%H%M%S)`; create `${SESSION_PATH}/qa/`.
    - Resolve the stack: `--stack` if given; else `auto` — `go.mod` → `go`; `bunfig.toml`
      or `package.json` with `bun` → `bun`; any `*.stories.*` among the contract paths or
      `playwright.config.*` → add `ui`. Several stacks are allowed.
    - Copy the inputs into an isolated sandbox the writer will see as its whole world:
      `${SESSION_PATH}/qa/sandbox/spec.md`, `${SESSION_PATH}/qa/sandbox/contract/<basename>`
      for each contract path, the test dir's existing files under
      `${SESSION_PATH}/qa/sandbox/tests/`, and the test config files
      (`playwright.config.*`, `vitest.config.*`, `bunfig.toml`, `go.mod`, `package.json`).
      No implementation file is copied.
    - Put the writer itself in the sandbox, because an external writer cannot reach this
      plugin. A claudish child started with `work_dir` = the sandbox is its own Claude Code
      project, so it loads only USER-scope plugins. Where `dev` is installed at PROJECT
      scope, `agent = "dev:qa-engineer"` fails within a second as `agent_rejected`
      (`--agent 'dev:qa-engineer' not found`, measured 2026-10-20). A project-level agent
      inside the sandbox is found whatever the install scope:
      - copy `${CLAUDE_PLUGIN_ROOT}/agents/qa-engineer.md` to
        `${SESSION_PATH}/qa/sandbox/.claude/agents/qa-engineer.md`;
      - copy the stack guidance into `${SESSION_PATH}/qa/sandbox/loadout/`, keeping each
        source's tree: `loadout/<plugin>/<path under that plugin's root>`. Never flatten
        it. Two files are both `SKILL.md`, and a skill links to its own `references/`. For
        each guidance file, copy its whole skill directory or knowledge folder, leaving out
        `assets/` and `node_modules/`. The child has no `CLAUDE_PLUGIN_ROOT`, so it can read
        guidance only from the sandbox. Per resolved stack:

        | Stack | Copy, when found |
        |---|---|
        | go | `${CLAUDE_PLUGIN_ROOT}/../go/knowledge/roles/tester/` and `…/go/knowledge/references/testing-patterns.md`, or the same under `${CLAUDE_PLUGIN_ROOT}/../../go/*/` |
        | bun | `${CLAUDE_PLUGIN_ROOT}/../bunjs/skills/testing/`, or `${CLAUDE_PLUGIN_ROOT}/../../bunjs/*/skills/testing/` |
        | ui | `${CLAUDE_PLUGIN_ROOT}/skills/testing/ui-playwright/` and `${CLAUDE_PLUGIN_ROOT}/knowledge/frontend/testing-frontend.md` |
        | always | `${CLAUDE_PLUGIN_ROOT}/skills/core/testing-strategies/` |

        A stack whose guidance is not installed gets none. Record the gap in `inputs.json`;
        the writer cannot install it.
    - Snapshot the tests as they went in: `shasum` of every file under
      `${SESSION_PATH}/qa/sandbox/tests/`, saved to `${SESSION_PATH}/qa/tests.before`.
      Phase 1 compares against it.
    - Write `${SESSION_PATH}/qa/inputs.json` listing exactly what went in, the agent and
      every loadout file included.
  </phase>

  <phase number="1" name="Resolve the writer">
    Read `plugins/claudish/skills/claudish-usage/SKILL.md` under the installed claudish
    root first (resolve it with `claude plugin list --json`); the calls below follow it.

    1. Check for child mode first, as "Inside a claudish session (child mode)" in that
       skill describes. `list_models` still answers in child mode, so it cannot tell you.
       In child mode you are already the delegate: go to step 4, and the report says
       `writer: internal (nested claudish session; blindness by agent contract)`.
       Otherwise, `list_models()`: if the tool is unavailable or errors, the writer is
       internal (go to step 4) and the report says `writer: internal (claudish unreachable)`.
    2. `search_models({ query: "<tier word>" })` with the `--model` value (default `gpt`).
       Pick the top-tier model of that family from the live results. The tier the user
       named is a hard constraint: if the catalog has no model matching it, stop and show
       the live alternatives from the search; never pick a lower tier because its name
       is closer. Record the chosen id.
    3. External writer:
       ```
       create_session(
         model = <resolved id>,
         agent = "qa-engineer",                  // the sandbox's own copy, from phase 0
         work_dir = "${SESSION_PATH}/qa/sandbox",
         timeout_seconds = 900,
         prompt = <the writer prompt below, with sandbox-relative paths>
       )
       ```
       `work_dir` is the sandbox, so the child starts with nothing but the sandbox in view.
       The sandbox still lives inside the repository, though: a shell can climb out of it,
       and Claude Code loads the repo's ancestor `CLAUDE.md`. So blindness rests on the
       agent's contract (Reads only under the given paths) and on the `Files Read` check
       in phase 2, not on the file system alone.
       Then wait for the session to end (poll `list_sessions(include_completed=true)`
       about every 10 s; nothing is pushed). On
       `COMPLETED` call `get_output(session_id)`; on `FAILED` or `TIMEOUT` call
       `get_diagnostics(session_id)`, record it with the row's `reason_detail`, and fall
       through to step 4 with `writer: internal (external failed: <reason>)`.
       `COMPLETED` is not success on its own. A provider error ends the turn as
       `COMPLETED`, with output such as `[API Error: server_is_overloaded …]` and no test
       file written. Hash `<sandbox>/tests/` again and compare it with
       `${SESSION_PATH}/qa/tests.before`. If no file was added or changed, the writer
       failed:
       - on a transient provider error (overloaded, rate limited, timeout), retry once
         with a new `create_session` and the same arguments;
       - otherwise, or when the retry fails too, fall through to step 4 with
         `writer: internal (external failed: COMPLETED with no tests written)`.
    4. Internal writer:
       ```
       Agent(
         subagent_type: "dev:qa-engineer",
         run_in_background: false,
         description: "blind tests: <feature>",
         prompt: <the same writer prompt, sandbox paths>
       )
       ```
       The subagent runs in its own context window; the prompt names only sandbox
       paths, and the agent's own contract refuses Reads outside them.

    Writer prompt (both routes):
    ```
    SPEC_PATH: <sandbox>/spec.md
    CONTRACT_PATHS: <sandbox>/contract/<each>
    TEST_DIR: <sandbox>/tests
    STACK: <stack list>
    STOP_AT: implement
    SESSION_PATH: <sandbox>
    LOADOUT: <sandbox>/loadout/ — the stack guidance, each source under its own tree;
             read it for stack guidance and do not run your knowledge routing's discovery
    Write the plan and the tests. Do not read anything outside the paths above.
    ```
  </phase>

  <phase number="2" name="Bring the tests home">
    - Copy `<sandbox>/tests/**` into `TEST_DIR`, and `<sandbox>/qa/test-plan.md` (or
      `<sandbox>/tests/TEST-PLAN.md`) to `${SESSION_PATH}/qa/test-plan.md`.
    - Read the writer's completion message: its `Files Read` section must list only
      sandbox paths. Any other path is a blindness breach — report it in red and keep
      the tests marked "suspect".
  </phase>

  <phase number="3" name="Run and prove" optional="true">
    Only with `--run`.
    1. Run the stack's test command from the repo root (`go test ./...`, `bun test`,
       `bunx playwright test`), capture output to `${SESSION_PATH}/qa/test-results.md`,
       and map each result to its `REQ-n` from the plan.
    2. Negative control: mutate one expected value in one test (a status code, a string,
       a count), run that file, paste the failure, restore the test. Without a pasted
       failure the run is `not proven`.
    3. Failures → dispatch `dev:qa-engineer` once more with `STOP_AT: analyse`,
       `RESULTS_PATH: ${SESSION_PATH}/qa/test-results.md`, same sandbox inputs, to
       classify each as TEST_ISSUE / IMPLEMENTATION_ISSUE / AMBIGUOUS. Implementation
       fixes go to the user or `dev:developer`; this command never edits implementation.
  </phase>

  <phase number="4" name="Report">
    Print, in this order:
    - `writer: <model id> (external)` or `writer: internal (<reason>)`
    - inputs handed over (from `inputs.json`), one line each
    - tests written (paths) and the coverage map (requirement → tests, gaps)
    - test results line verbatim, or "not run"
    - negative control: the failure line verbatim, or `not proven`
    - blindness check: `clean` or the breaching paths
    - `${SESSION_PATH}/qa/` as the artifact directory
  </phase>
</workflow>

<critical_constraints>
  - Model IDs come from `list_models` / `search_models` at run time. Never write one in a
    file or reuse one from an earlier run.
  - claudish is used only through its MCP tools. Never `claudish` on the command line.
  - The implementation is never copied into the sandbox and never quoted in the writer
    prompt. If a contract file contains implementation bodies, warn and pass it anyway;
    the writer uses its exported signatures only.
  - This command writes tests and reports. It does not change implementation code.
</critical_constraints>
