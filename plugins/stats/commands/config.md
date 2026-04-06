---
name: config
description: "View or update stats plugin configuration. Usage: /stats:config [--retention-days N] [--session-summary on|off] [--enabled on|off] [--show]"
arguments:
  - name: --retention-days
    description: "Set data retention period in days (1–3650, default: 90)"
    required: false
  - name: --enabled
    description: "Enable or disable all stats collection (on|off, default: on)"
    required: false
  - name: --session-summary
    description: "Toggle SessionStart context injection (on|off, default: on)"
    required: false
  - name: --show
    description: "Explicitly show the current config (same as no arguments)"
    required: false
---

# Stats Config

You are implementing the `/stats:config` command. This command reads and writes the stats plugin configuration stored at `~/.claude/stats/config.json`.

## Config File Location

`~/.claude/stats/config.json`

## Default Configuration

```json
{
  "enabled": true,
  "retention_days": 90,
  "session_summary": true
}
```

- **enabled** — When `false`, all hooks exit immediately without writing any data. Equivalent to pausing the plugin without uninstalling it.
- **retention_days** — Sessions older than this many days are automatically purged at the end of each session (by the Stop hook aggregator). Valid range: 1–3650.
- **session_summary** — When `true`, a one-line summary of recent sessions is injected into the Claude context at the start of each new session.

## Parse Arguments

- `--retention-days N` — integer, must be in range [1, 3650]
- `--enabled on|off` — sets `enabled: true` or `enabled: false`
- `--session-summary on|off` — sets `session_summary: true` or `session_summary: false`
- `--show` or no arguments — display current config without changes

Multiple flags may be combined in a single invocation, e.g. `--retention-days 30 --session-summary off`.

## Show Current Config (no args or --show)

Read the config file (or use defaults if it does not exist) and print:

```
Stats Plugin Configuration
──────────────────────────────────────
  enabled          true
  retention_days   90 days
  session_summary  true

Config file: ~/.claude/stats/config.json
```

## Update Config

For each recognized flag:

1. Validate the value (range check for `--retention-days`, on/off for boolean flags)
2. If invalid, print an error and exit without writing:
   ```
   Error: --retention-days must be between 1 and 3650. Got: 0
   ```
3. Apply all valid changes atomically (read → modify → write)
4. Print the updated config in the same format as the show view, with a change summary:
   ```
   Updated: retention_days 90 → 30

   Stats Plugin Configuration
   ──────────────────────────────────────
     enabled          true
     retention_days   30 days
     session_summary  true

   Config file: ~/.claude/stats/config.json
   ```

## Effect of --enabled off

When the user sets `--enabled off`, also note:

```
Stats collection is now disabled. No data will be recorded until you run:
  /stats:config --enabled on
```

## Implementation Note

Run this command by executing: `bun ${CLAUDE_PLUGIN_ROOT}/commands/config.ts`

The `config.ts` script uses `getConfig()` and `saveConfig()` from `lib/config.ts`. If the script does not exist yet, implement the config operations inline using the Bash tool with `bun -e`, reading/writing `~/.claude/stats/config.json` directly and following the validation and display rules above.
