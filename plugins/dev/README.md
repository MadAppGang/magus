# dev

Universal development assistant for Claude Code. Language-agnostic: it detects
your stack and loads the matching guidance rather than assuming one.

**Version:** 3.0.0 · **Marketplace:** `magus` · **License:** MIT

## Installation

```bash
/plugin marketplace add MadAppGang/magus
```

Then in `.claude/settings.json`:

```json
{ "enabledPlugins": { "dev@magus": true } }
```

## Commands

| Command | What it does |
|---|---|
| `/dev:help` | Show the detected stack and everything available |
| `/dev:dev` | Feature development workflow, depth-adaptive (quick / standard / full) |
| `/dev:debug` | Structured debugging — quick patch, standard debug, or production fix |
| `/dev:fix` | Production-grade TDD bug fix with review gates and validation |
| `/dev:architect` | Architecture design and technical planning |
| `/dev:research` | Multi-source research with convergence-based finalisation |
| `/dev:interview` | Requirements interview that produces a spec |
| `/dev:investigate` | Read-only code investigation — traces, analysis, bug origins |
| `/dev:audit` | Quality audit — routes to code, UI, docs, security, or plugin reviewers |
| `/dev:design-system` | Validate a project against the design-system guardrails |
| `/dev:doc` | Generate, analyse, or fix documentation |
| `/dev:learn` | Review session learnings, apply (`--apply`) or prune (`--prune`) them |
| `/dev:setup` | Scaffold project context and routing rules |
| `/dev:worktree` | Create, list, and clean up git worktrees (optional DB branching) |

## Agents

Delegated to via the Agent tool; each runs in its own context window.

**Build** — `developer` (multi-file implementation with tests), `frontend`
(React against the project's design system), `devops` (infrastructure).

**Understand** — `researcher` (multi-round web research), `debugger` (root
cause), `architect` (system design), `synthesizer` (consolidating findings),
`stack-detector` (what is this project built with).

**Check** — `reviewer` (3-pass security / correctness / maintainability),
`test-architect` (black-box tests from requirements).

**Document** — `docs` (modes: write / analyze / fix).

**Interview support** — `scribe`, `spec-writer`.

## Skills and knowledge

Two trees, told apart by location alone.

`skills/` holds **procedures** — an ordered workflow with a checkable end state.
Each is registered in `.claude-plugin/plugin.json`, reachable as `/dev:<name>`,
and preloadable by an agent. `knowledge/` holds **reference manuals** — the stack
playbooks, language guides and catalogues consulted at a decision point. Nothing
registers `knowledge/`: it has no manifest entry, costs nothing against the
skill-listing budget, and is reached by path and only by path.

No counts here, on purpose — a hand-copied number drifts the first time a file
moves. The manifest is the list of skills; `knowledge/README.md` is the index of
manuals, one row per file with the question it answers.

Within `skills/`, the split between auto-matched and hidden is deliberate. Claude
Code injects a listing of every auto-matchable skill into **every turn**,
budgeted at `context × 4 × 0.01` characters — about 8,000 on a 200k-token model,
more on a larger one — and that budget is shared across every installed plugin,
not per-plugin. Over budget it shortens descriptions rather than dropping skills,
so an oversized corpus degrades matching for everything the user has installed.

The listed skills are the ones whose *absence changes what you get* rather than
how fast: stack detection, universal patterns, design-system guardrails,
systematic debugging, testing strategies, TDD, verification-before-completion,
worktree lifecycle, documentation standards. Every other skill sets
`disable-model-invocation: true` and costs nothing until `/dev:<name>` or a
`Read` opens it.

Skills are grouped by category — `core/` · `frontend/` · `backend/` ·
`discipline/` · `planning/` — with the routers and standalone workflows at the
top level. `knowledge/` mirrors the same categories.

> **Hiding a skill that an agent preloads silently starves that agent.**
> `disable-model-invocation: true` blocks preloading as well as listing. Check
> `bun scripts/dev-skill-inventory.ts dev` before changing any visibility flag,
> and see `skills/skill-authoring/references/visibility.md`.

## Hooks

| Event | What runs |
|---|---|
| `SessionStart` | Surfaces workflow coaching from previous sessions |
| `Stop` | Analyses the session and queues learnings |
| `Stop` | Blocks the turn when a `/dev:dev` phase was started and left without its artifacts |
| `UserPromptSubmit` | Injects the plan-mode protocol when `/dev:dev` is invoked; on `--resume`, the resume block instead |
| `PostToolUse:ExitPlanMode` | Tells a `/dev:dev` run to continue at Phase 4 once the plan is approved |
| `SessionStart` (`clear|compact`) | After a cleared or compacted context, reads the run state from disk and orders `/dev:dev --resume` — this is what makes the approval dialog's "Yes, clear context" option safe mid-run |

The phase gate exits **2** to block, with the reason on stdout. It allows
whenever it is unsure — no session directory, several open at once, unparseable
input — because a gate that misfires is worse than one that misses.

Coaching writes to two channels. `[human]` suggestions are printed to you
verbatim in a `★ Coaching` box. `[claude]` entries are agent-directed tool advice
("prefer `code_search` over repeated greps") that would read as noise if shown to you.
Model-generated learnings only ever reach the human channel; nothing becomes a
standing directive without your approval through `/dev:learn --apply`.

| Variable | Effect |
|---|---|
| `WORKFLOW_COACHING=off` | Disable coaching entirely |
| `WORKFLOW_LEARNING=off` | Disable the background learner |
| `DEV_COACHING_MODEL` | Override the classifier model |

## Requirements

Claude Code ≥ 0.1.0. Depends on `claudish` (~1.0) and `multimodel` (~3.3).
Hooks and scripts run on `bun`.

## Development

```bash
bun test plugins/dev/hooks/                      # hook + coaching suites
bun test plugins/dev/scripts/outer-loop.test.ts  # outer-loop transitions
bash autotest/dev-plugin-ux/test-phase-loading.sh
bun scripts/skill-budget-check.ts               # listing budget
```

## License

MIT © Jack Rudenko, MadAppGang
