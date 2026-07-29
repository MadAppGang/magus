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

Delegated to via the Task tool; each runs in its own context window.

**Build** — `developer` (multi-file implementation with tests), `frontend`
(React against the project's design system), `devops` (infrastructure).

**Understand** — `researcher` (multi-round web research), `debugger` (root
cause), `architect` (system design), `synthesizer` (consolidating findings),
`stack-detector` (what is this project built with).

**Check** — `reviewer` (3-pass security / correctness / maintainability),
`test-architect` (black-box tests from requirements).

**Document** — `docs` (modes: write / analyze / fix).

**Interview support** — `scribe`, `spec-writer`.

## Skills

48 skills: 22 auto-matched, 26 reference material you summon by name
(`/dev:golang`, `/dev:tanstack-query`, …).

That split is deliberate. Claude Code injects a listing of every auto-matchable
skill into **every turn**, capped at 1% of the context window — 8,000 characters,
shared across all installed plugins. Reference skills set
`disable-model-invocation: true`, which keeps them off that listing while leaving
them one slash command away. Their bodies load only when actually used.

Groups: `core/` (universal patterns, testing, debugging) · `frontend/` (React,
Vue, Tailwind, shadcn, TanStack, CSS modules, browser debugging, design-system
guardrails) · `backend/` (Go, Bun, Python, Rust, Dingo, API design, auth,
databases, DB branching) · `discipline/` (TDD, systematic debugging,
verification, worktree lifecycle, task management) · plus documentation
standards, ADRs, MCP standards, plugin SDK patterns, audit, optimize, test
coverage, code roast, brainstorming.

## Hooks

| Event | What runs |
|---|---|
| `SessionStart` | Surfaces workflow coaching from previous sessions |
| `Stop` | Analyses the session and queues learnings |
| `PreToolUse:TaskUpdate` | Blocks a `/dev:dev` phase marked complete without its artifacts |

The phase gate exits **2** to block, with the reason on stdout. It allows
whenever it is unsure — no session directory, several open at once, unparseable
input — because a gate that misfires is worse than one that misses.

Coaching writes to two channels. `[human]` suggestions are printed to you
verbatim in a `★ Coaching` box. `[claude]` entries are agent-directed tool advice
("prefer `mnemex` over repeated greps") that would read as noise if shown to you.
Model-generated learnings only ever reach the human channel; nothing becomes a
standing directive without your approval through `/dev:learn --apply`.

| Variable | Effect |
|---|---|
| `WORKFLOW_COACHING=off` | Disable coaching entirely |
| `WORKFLOW_LEARNING=off` | Disable the background learner |
| `DEV_COACHING_MODEL` | Override the classifier model |

## Requirements

Claude Code ≥ 0.1.0. Depends on `claudish` (~1.0) and `mnemex` (~1.0).
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
