---
name: clear
description: "Clear all stats data from the SQLite database. Usage: /stats:clear [--force]"
arguments:
  - name: --force
    description: "Skip the confirmation prompt (for scripting)"
    required: false
---

# Stats Clear

You are implementing the `/stats:clear` command. This command permanently deletes all rows from the stats database tables.

## Parse Arguments

- `--force` — boolean flag; if present, skip the interactive confirmation prompt

## Database Location

`~/.claude/stats/stats.db`

## Step 1: Count Existing Data

Before doing anything, query the database to count what will be deleted:

```sql
SELECT COUNT(*) AS session_count FROM sessions;
SELECT COUNT(*) AS tool_call_count FROM tool_calls;
```

If the database does not exist or both counts are 0, print:

```
No stats data found. Nothing to clear.
```

Then exit without prompting.

## Step 2: Confirm Deletion (unless --force)

If `--force` is NOT present, show the user exactly what will be deleted and ask for confirmation:

```
This will permanently delete:
  - N sessions
  - M tool call records

Delete all stats data? This cannot be undone. [y/N]
```

- Default answer is **N** (no)
- If the user types anything other than `y` or `yes` (case-insensitive), print `"Aborted."` and exit without deleting
- If `--force` is set, skip this prompt entirely

## Step 3: Execute Deletion

Run inside a single transaction:

```sql
BEGIN;
DELETE FROM tool_calls;
DELETE FROM sessions;
DELETE FROM daily_stats;
COMMIT;
```

The schema tables (`schema_version`) and the database file itself are preserved. Only data rows are removed.

## Step 4: Confirm Success

Print:

```
Cleared N sessions and M tool calls.
Stats database is now empty. Schema and config preserved.
```

Use the counts from Step 1 in this message.

## Implementation Note

Run this command by executing: `bun ${CLAUDE_PLUGIN_ROOT}/commands/clear.ts`

If the `clear.ts` script does not exist yet, implement the clear operation inline using the Bash tool with `bun -e` or `sqlite3` following the steps above. Use the Read tool to check whether `commands/clear.ts` exists before falling back to inline implementation.
