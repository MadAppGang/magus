# Terminal Plugin E2E Test Suite

Tests whether Claude accomplishes real developer tasks using terminal plugin MCP
tools (`mcp__ht__*` and `mcp__tmux__*`).

## What It Tests

9 advanced scenarios: ht-mcp-only (HTTP server, vim, Python REPL, log monitoring,
process management, env inspection), tmux-only (session inspection, command capture),
and cross-backend (both in one task).

## Prerequisites

- `claudish` CLI (`npm install -g claudish`), `bun`, `jq`
- Terminal plugin enabled with ht-mcp and tmux MCP servers configured
- `tmux` available on the system

## Running

```bash
./autotest/terminal/run.sh                                      # all tests
./autotest/terminal/run.sh --cases tmux-inspect-sessions-01    # single test
./autotest/terminal/run.sh --model google/gemini-2.5-flash     # different model
./autotest/terminal/run.sh --parallel 3                        # parallel
./autotest/terminal/run.sh --dry-run                           # preview only
```

## Check Types

| Check | Description |
|---|---|
| `has_tool_prefix` | At least one call starts with this MCP prefix |
| `has_tool_prefix_also` | Also has calls with a second prefix (cross-backend) |
| `tools_used_include_any` | At least one full tool set from the OR list satisfied |
| `min_tool_calls` | Minimum total MCP tool calls |
| `min_tool_calls_by_name` | Minimum calls per named tool |
| `response_contains` | Final response contains a specific string |
| `response_contains_any` | Final response contains at least one of these strings |

Tool names are normalized: `mcp__ht-mcp__*` = `mcp__ht__*`, `mcp__tmux-mcp__*` = `mcp__tmux__*`.

## Results

Written to `autotest/terminal/results/run-<timestamp>/`:
- `terminal-analysis.json` — structured check results per test
- `results-summary.json` — aggregated summary
- `<model>/<case_id>/transcript.jsonl` — full conversation transcript

## Latest Results (v1.2.0)

Tested on 2026-02-26 with 3 models:

| Model | Pass Rate | Avg Turns |
|-------|-----------|-----------|
| Claude Sonnet 4.6 | 9/9 (100%) | ~12 |
| GPT-5-mini | 9/9 (100%) | ~13 |
| GPT-5.2 | 9/9 (100%) | ~12 |

### Known Limitations

- **Debug log parsing**: Only works for OpenRouter-routed models. Native Anthropic and
  OpenAI Direct logs use different SSE formats. Response content checks work for all models.
- **Parallel execution**: Running with `--parallel` causes debug log cross-contamination
  (all tests share the claudish proxy). `no_tool_prefix` checks were removed in v1.2.0
  for this reason. Run with `--parallel 1` for clean per-test metrics.
