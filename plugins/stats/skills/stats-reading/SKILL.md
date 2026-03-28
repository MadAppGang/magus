---

## Understanding Stats Output

### Session Summary

- **Sessions** — Number of Claude Code sessions in the selected time window. Each session corresponds to one `claude` process invocation.
- **Avg duration** — Mean session length in minutes. Computed from transcript timestamps (first to last assistant message).
- **Total tools** — Sum of all tool calls across all sessions. One call per tool invocation.

### Activity Categories

The stats plugin classifies every tool call into one of five categories:

| Category | Tools Included | What It Means |
|
user-invocable: false
---|---|---|
| `research` | Read, Grep, Glob, WebFetch, WebSearch, `mcp__*` | Information gathering: reading code, searching, web lookups |
| `coding` | Write, Edit, MultiEdit, Bash build commands | Creating or modifying files, building artifacts |
| `testing` | Bash with test/lint/check patterns | Running tests, linting, type-checking, validation |
| `delegation` | Task | Spawning sub-agents for parallel or specialized work |
| `other` | Bash (unclassified), all other tools | Shell operations, setup, clipboard, miscellaneous |

**Important:** Activity ratios in the report exclude `other` from the denominator. Only classified calls (research + coding + testing + delegation) are used when computing percentages. This means percentages can add up to 100% without `other`.

### Reading the Sparkline

The duration trend sparkline uses Unicode block characters `▁▂▃▄▅▆▇█` to represent relative values. Each character represents one day, left-to-right (oldest to newest). Taller bars = more tool calls or longer sessions on that day. The scale adapts to the data range — all bars are relative, not absolute.

### Trend Indicator (↑ ↓ →)

Appears next to session count. Compares avg tool calls per session in the most recent half of the window vs the older half:
- `↑` more than 10% higher recently
- `↓` more than 10% lower recently
- `→` within 10% — stable trend

---

## Common Patterns and Interpretations

### High Research Ratio (>40%)

You spend most of your time reading and searching code. This is normal for investigation tasks but may indicate inefficiency for implementation tasks.

Productive actions:
- Use the **code-analysis** plugin with `mnemex` for semantic symbol search — find a function definition in one query instead of dozens of sequential Reads
- Replace `Read` → `Grep` for finding content; `Glob` for finding files by pattern
- Use `WebSearch` before `WebFetch` to target the right page first

### Low Testing Ratio (<5%)

Tests are rarely run during sessions. This often correlates with bugs caught late and longer debug cycles.

Productive actions:
- Run `bun test --watch` (or equivalent) via the terminal plugin to keep tests running continuously
- Use `/dev:tdd` for test-driven feature development
- Add a lint/typecheck step before each commit

### Increasing Duration Trend

Sessions are getting longer over recent days. This can indicate scope creep, context accumulation, or increasing task complexity.

Productive actions:
- Break large tasks into smaller focused sessions with clear stopping conditions
- Use the `Task` tool to delegate investigation to sub-agents, keeping the main context lean
- Start sessions with a written goal: "today I will implement X and stop"

### Low Delegation (delegation_calls near 0)

All work is done in the main context with no sub-agents. Sub-agents can parallelize work and prevent context window saturation.

Productive actions:
- Use `dev:developer` for implementation tasks
- Use `code-analysis:detective` for investigation tasks
- Use `run_in_background: true` for parallel sub-tasks that don't need immediate results

### High Other Ratio

A large fraction of calls are unclassified Bash commands. This is normal for infrastructure-heavy projects but may indicate opportunities to replace shell scripting with dedicated tools.

---

## Using Stats Commands

```
/stats:report                        # 7-day ASCII report for current project
/stats:report --days 30              # Last 30 days
/stats:report --all-projects         # Cross-project view (all tracked projects)
/stats:report --project /path/to/x   # Specific project
/stats:dashboard                     # ASCII dashboard with full breakdown
/stats:config                        # Show current config
/stats:config --retention-days 30    # Keep only 30 days of data
/stats:config --enabled off          # Pause all collection
/stats:clear                         # Wipe all data (requires confirmation)
/stats:help                          # Show all commands
```

---

## Privacy Notes

The stats plugin records only:
- Tool names and call counts
- Tool execution durations (milliseconds)
- Session start/end timestamps
- Working directory path (project identity)

The stats plugin **never** records:
- File contents
- Tool parameters or outputs (no `tool_input`, no `tool_response`)
- Message text or conversation content
- Any personally identifiable information beyond the project path

Data is stored locally at `~/.claude/stats/stats.db` and never transmitted.

---

## Responding to Stats Questions

When a user asks about their stats, follow this sequence:

1. **Run the report first** — execute `/stats:report` or query the DB inline before interpreting
2. **Identify the dominant pattern** — check which activity category has the highest ratio
3. **Cross-reference with suggestions** — if `getSuggestions()` fired a rule, explain why
4. **Offer one concrete action** — pick the most relevant recommendation from the patterns above
5. **Stay concise** — one insight and one action is more useful than a full analysis lecture

Do not speculate about stats you have not queried. Always ground interpretations in actual data.
