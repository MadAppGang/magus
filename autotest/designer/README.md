# Designer Plugin E2E Test Suite

Tests for the designer plugin (v0.2.0): agent routing, skill invocation, slash command parsing, and cross-plugin awareness.

## What It Tests

| Category | Cases | Description |
|---|---|---|
| `agent-routing` | 4 | Correct agent selected: `designer:design-review`, `designer:ui` |
| `skill-routing` | 3 | Skills invoked via Skill tool: `designer:compare`, `designer:ui-analyse`, `designer:design-references` |
| `command-parsing` | 3 | Slash commands route correctly: `/designer:review`, `/designer:ui`, `/designer:create-style` |
| `cross-plugin` | 2 | `dev:frontend` awareness of designer; browser debug direct handling |

## Running

```bash
# All 12 test cases (monitor mode)
./autotest/designer/run.sh --model claude-sonnet-4-6

# Specific test case
./autotest/designer/run.sh --model claude-sonnet-4-6 --cases design-review-explicit-01

# Multiple cases
./autotest/designer/run.sh --model claude-sonnet-4-6 --cases skill-compare-explicit-05,skill-ui-analyse-explicit-06

# Parallel execution
./autotest/designer/run.sh --model claude-sonnet-4-6 --parallel 3

# Dry run (show what would execute without running)
./autotest/designer/run.sh --cases design-review-explicit-01 --dry-run
```

## Analyzing Results

```bash
bun autotest/designer/analyze-results.ts autotest/designer/results/<run-dir>
```

The analyzer produces:
- Per-category pass rates (agent-routing, skill-routing, command-parsing, cross-plugin)
- Agent distribution table (which agents were actually selected)
- Skill invocation summary (which skills were loaded and how often)
- `designer-analysis.json` in the results directory for programmatic access

## Test Case IDs

| ID | Category | What It Checks |
|---|---|---|
| `design-review-explicit-01` | agent-routing | Explicit `designer:design-review` selection |
| `design-review-implicit-02` | agent-routing | Implicit routing for Figma vs live diff |
| `ui-review-explicit-03` | agent-routing | Explicit `designer:ui` selection |
| `ui-review-implicit-04` | agent-routing | Implicit routing for accessibility review |
| `skill-compare-explicit-05` | skill-routing | `designer:compare` via Skill tool, not Task |
| `skill-ui-analyse-explicit-06` | skill-routing | `designer:ui-analyse` via Skill tool |
| `skill-design-refs-07` | skill-routing | `designer:design-references` via Skill tool |
| `command-review-08` | command-parsing | `/designer:review` command |
| `command-ui-09` | command-parsing | `/designer:ui` command |
| `command-create-style-10` | command-parsing | `/designer:create-style` command |
| `cross-plugin-frontend-awareness-11` | cross-plugin | `dev:frontend` mentions designer |
| `cross-plugin-browser-debug-12` | cross-plugin | Browser debug handled without designer |

## Result Classifications

- `PASS` — exact match on expected_agent or all checks pass
- `PASS_ALT` — matches an expected_alternatives value
- `FAIL` — does not match expected or alternatives
- `ERROR` — test crashed or transcript could not be parsed
- `TIMEOUT` — test exceeded the timeout window
