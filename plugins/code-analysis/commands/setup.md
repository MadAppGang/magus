---
name: setup
description: Install and verify the ripgrep shim, check the code-analysis MCP server starts, and report the active search engine and its health
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Set up code-analysis

Three things, in this order: the shim, the server, the engine. Report all three at the end
even when nothing needed changing — a setup command that prints nothing on a healthy system
teaches the user nothing about what healthy looks like.

## 1. The ripgrep shim

The `Grep` tool runs ripgrep as a subprocess and resolves `rg` against `PATH`. A real file at
`$HOME/.local/bin/rg` is what makes that resolution land on us: the directory sits ahead of the
usual package-manager paths, and the file's mere existence stops the shell snapshot from
defining an `rg` function that would beat `PATH` inside Bash.

### Read the current state first

```bash
ls -l "$HOME/.local/bin/rg" 2>/dev/null && head -6 "$HOME/.local/bin/rg" 2>/dev/null
command -v rg
type rg
```

The shim carries an owner marker in its header — `OWNER=` and `VERSION=` within the first six
lines. Parse it and branch:

| `OWNER=` | Do |
|---|---|
| absent (no file) | install |
| `code-analysis` | upgrade in place if `VERSION=` differs from this plugin's version; otherwise leave it |
| anything else | **stop and ask.** Another tool owns that path. Never clobber it silently |

### Install

```bash
mkdir -p "$HOME/.local/bin"
cp "${CLAUDE_PLUGIN_ROOT}/assets/rg" "$HOME/.local/bin/rg"
chmod +x "$HOME/.local/bin/rg"
```

### Route the Grep tool at it

Add to the project's `.claude/settings.json`:

```json
{ "env": { "USE_BUILTIN_RIPGREP": "0" } }
```

**That setting is a preference, not a switch.** The host reads it as *"prefer a system rg"* and
falls through to its embedded copy without saying so when the `PATH` lookup finds nothing. So
never infer routing from the setting — read `ripgrepStatus` instead:

```bash
claude doctor --json
```

`ripgrepStatus.mode` is `system` when routing is live and `embedded` when it is not;
`ripgrepStatus.systemPath` says which file won.

### Three things that break this silently

| Symptom | Check | Meaning |
|---|---|---|
| `command -v rg` is not the shim path | PATH order | something earlier on `PATH` shadows it |
| `type rg` says "shell function" | Bash only | a function beats `PATH`; the shim is bypassed inside Bash calls |
| setting says `0`, `mode` says `embedded` | both of the above, or no file at all | routing is not live, and nothing reported an error |

**`USE_BUILTIN_RIPGREP` is read once at host startup, and the resolved config is memoised after
the first `Grep` call.** If you changed either the setting or the file this session, say plainly
that a restart is required. Re-testing in the same session produces a false green.

## 2. The MCP server

The plugin ships its own MCP server under the key `ca`. Confirm it registered:

- `code_search` is present in the tool list. It is unconditional — if it is missing, the server
  did not start, and nothing downstream will work.
- The structural tools (`find_dependencies`, `find_dependents`, `call_tree`,
  `find_implementations`, `impact`) are present **only** when the configured engine genuinely
  supports each operation. Their absence is a correct answer about the engine, not a fault.

Then call `code_search` once with a real question about this repo and read two fields of the
response: the capability that served it, and any notes. A note carries a stable code
(`index_stale`, `index_missing`, `index_building`, `backend_unavailable`, …) and, where one
exists, a copy-pasteable remedy. Report the remedy verbatim rather than paraphrasing it.

## 3. The engine

The engine is named in project settings, one at a time, and is read from three layers — later
wins:

1. `~/.claude/settings.json`
2. `$CLAUDE_PROJECT_DIR/.claude/settings.json`
3. `$CLAUDE_PROJECT_DIR/.claude/settings.local.json`

```json
{
  "code-analysis": {
    "engine": "<engine-id>",
    "engines": {
      "<engine-id>": { "command": "<binary>", "args": ["--mcp"] }
    }
  }
}
```

**Do not install an engine on the user's behalf, and do not hardcode an install command here.**
Each engine documents its own. What this command does is report which engine the settings name,
which layer named it, whether it answered a probe, and — when it did not — the remedy the probe
returned.

With no `engine` key, the server runs with `code_search` alone. That is a supported
configuration, not a broken one: say so rather than treating it as a failure.

## 4. Project CLAUDE.md

Ask before writing to the user's `CLAUDE.md`:

```typescript
AskUserQuestion({
  questions: [{
    question: "Add the code-analysis tool rules to this project's CLAUDE.md?",
    header: "CLAUDE.md",
    multiSelect: false,
    options: [
      { label: "Yes", description: "Documents the tool surface and the routing rule for every session in this project" },
      { label: "Skip", description: "Tools work either way; sessions just get no routing guidance" }
    ]
  }]
})
```

On yes, append `${CLAUDE_PLUGIN_ROOT}/templates/claude-md-rules.md`. If the heading it starts
with is already in the file, replace that section rather than appending a second copy.

## Report

```
Shim        installed | upgraded | already current | FOREIGN — not touched
            path, owner, version
Routing     system | embedded          (from ripgrepStatus, not from the setting)
            + restart required, if anything changed this session
Server      code_search present: yes/no
            structural tools present: <list, or "none — engine does not support them">
Engine      <id>, from <settings layer>   |   none configured (code_search only)
            probe: ready | <reason> + <remedy>
CLAUDE.md   added | replaced | already present | skipped
```
