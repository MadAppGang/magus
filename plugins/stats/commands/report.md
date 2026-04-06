---
name: report
description: "Show an ASCII terminal report of session stats. Usage: /stats:report [--days N] [--project <path>] [--all-projects] [--json]"
arguments:
  - name: --days
    description: "Number of days to include (default: 7)"
    required: false
  - name: --project
    description: "Filter to a specific project path (default: current directory)"
    required: false
  - name: --all-projects
    description: "Include data from all projects, not just current one"
    required: false
  - name: --json
    description: "Output raw JSON instead of ASCII report"
    required: false
---

# Stats Report

You are implementing the `/stats:report` command. Query the stats SQLite database and render a formatted ASCII report to the terminal.

## Parse Arguments

Extract from the user's invocation:
- `--days N` — integer, default `7`
- `--project <path>` — string, default is the current working directory
- `--all-projects` — boolean flag; if present, do not apply any project filter
- `--json` — boolean flag; if present, output JSON instead of ASCII

## Database Location

The SQLite database is at `~/.claude/stats/stats.db`. Use bun:sqlite to query it.

## Queries to Run

Run all queries inside a single read-only connection. Time window cutoff: `DATE('now', '-N days')` where N is `--days`.

**1. Session summary** — from `sessions` table:
```sql
SELECT
  COUNT(*) AS session_count,
  ROUND(AVG(duration_sec) / 60.0, 1) AS avg_duration_min,
  SUM(total_tool_calls) AS total_tool_calls,
  SUM(research_calls) AS research_calls,
  SUM(coding_calls) AS coding_calls,
  SUM(testing_calls) AS testing_calls,
  SUM(delegation_calls) AS delegation_calls,
  SUM(other_calls) AS other_calls
FROM sessions
WHERE date >= DATE('now', '-N days')
  [AND project = '<cwd>' if not --all-projects]
```

**2. Top 10 tools** — from `tool_calls` joined to `sessions`:
```sql
SELECT tc.tool_name, COUNT(*) AS call_count,
  ROUND(AVG(tc.duration_ms) / 1000.0, 2) AS avg_duration_sec,
  tc.activity_category
FROM tool_calls tc
JOIN sessions s ON tc.session_id = s.id
WHERE s.date >= DATE('now', '-N days')
  [AND s.project = '<cwd>' if not --all-projects]
GROUP BY tc.tool_name, tc.activity_category
ORDER BY call_count DESC
LIMIT 10
```

**3. Duration trend** — from `sessions`, last 14 days:
```sql
SELECT date, SUM(total_tool_calls) AS daily_calls, COUNT(*) AS session_count
FROM sessions
WHERE date >= DATE('now', '-14 days')
  [AND project = '<cwd>' if not --all-projects]
GROUP BY date
ORDER BY date ASC
```

**4. Recent sessions for suggestions** — last 20 sessions:
```sql
SELECT * FROM sessions
WHERE date >= DATE('now', '-N days')
  [AND project = '<cwd>']
ORDER BY created_at DESC
LIMIT 20
```

## ASCII Output Format

If the database file does not exist or session_count is 0, print:

```
No stats data found. Start a session to collect data.
  Run /stats:help for more information.
```

Otherwise render:

```
Stats Report — last 7 days — /path/to/project
─────────────────────────────────────────────────
Sessions: 12    Avg duration: 38m    Total tools: 847
─────────────────────────────────────────────────
Activity Breakdown:
  research   ████████████████░░░░░░░░░░░░  38%
  coding     ████████████░░░░░░░░░░░░░░░░  35%
  testing    █████░░░░░░░░░░░░░░░░░░░░░░░  12%
  delegation ████░░░░░░░░░░░░░░░░░░░░░░░░   8%
  other      ███░░░░░░░░░░░░░░░░░░░░░░░░░   7%
─────────────────────────────────────────────────
Top Tools:
  Read       247 calls   2.1s avg   research
  Bash       189 calls   1.8s avg   other
  Grep        98 calls   0.3s avg   research
  Write       71 calls   0.1s avg   coding
  Edit        58 calls   0.1s avg   coding
─────────────────────────────────────────────────
Tool Call Trend (14 days):
  ▁▂▃▂▄▃▅▄▃▆▅▄▇▆
─────────────────────────────────────────────────
```

### Bar chart rendering rules

- Total bar width: 28 characters
- Fill character: `█` (U+2588), empty: `░` (U+2591)
- Ratio computed as: category_calls / (research + coding + testing + delegation) — excludes `other` from denominator
- Each label padded to 10 chars, percentage right-aligned to 4 chars
- Show `other` row always, but note it is excluded from ratio denominator

### Sparkline rendering rules

- Use block characters `▁▂▃▄▅▆▇█` scaled to the range [min, max] of daily tool call counts
- Show the last 14 days left-to-right (oldest to newest)
- If fewer than 14 days of data exist, show only available days
- If all values are equal, show `▄` for all bars

### Duration formatting

- < 60 seconds: show as `Ns`
- < 60 minutes: show as `Nm`
- >= 60 minutes: show as `NhMm`

## Suggestions Section

After the main report, if the suggestions engine returns any items, append:

```
─────────────────────────────────────────────────
Suggestions:
  * High research ratio detected (>40%)...
  * Low testing ratio (<5%)...
─────────────────────────────────────────────────
```

Use the logic from `lib/suggestions.ts`: pass the recent sessions array to `getSuggestions()` and render each suggestion as a bullet point, wrapping at 72 characters.

## JSON Output (--json flag)

If `--json` is passed, output a single JSON object:

```json
{
  "period_days": 7,
  "project": "/path/to/project",
  "summary": {
    "session_count": 12,
    "avg_duration_min": 38.2,
    "total_tool_calls": 847
  },
  "activity": {
    "research": 322,
    "coding": 297,
    "testing": 102,
    "delegation": 68,
    "other": 58
  },
  "top_tools": [...],
  "daily_trend": [...],
  "suggestions": [...]
}
```

## Trend Indicators

Add a trend arrow after the session count if there are at least 2 weeks of data:
- Compare avg tool calls per session in the last 7 days vs the prior 7 days
- Up `↑` if current > prior by >10%, down `↓` if current < prior by >10%, else `→`

## Implementation Note

Run: `bun ${CLAUDE_PLUGIN_ROOT}/dashboard/render.ts --days 7 --compact`

Parse `--days`, `--project`, and `--all-projects` from `$CLAUDE_ARGS` and pass them through.
The `--compact` flag limits top tools to 5 and shows one suggestion maximum for a concise output.

For `--json` output or `--all-projects`, fall back to inline queries per the query structure above and format as specified.
