# Plugin hooks

A hook is a script Claude Code runs at a lifecycle event. It succeeds or fails through its
exit code and its stdout, and several of the rules below are the opposite of what Unix
habit suggests. A hook that gets them wrong usually does not error; it just stops
enforcing anything.

## Where hooks live

`hooks/hooks.json` at the plugin root loads automatically; do not also name it in the
manifest. Event names are the keys, each holding matcher groups, each holding the hooks to
run:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bun --env-file=/dev/null \"${CLAUDE_PLUGIN_ROOT}\"/hooks/block-force-push.ts",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/hooks/session-context.sh" }
        ]
      }
    ]
  }
}
```

- The events plugins use most are `SessionStart` (matchers `startup`, `resume`, `clear`,
  `compact`), `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` and `SubagentStop`.
  Claude Code's hooks documentation lists the rest.
- `type` is usually `command`. The others are `http`, `mcp_tool`, `prompt` and `agent`.
- `timeout` is in seconds.
- Reach bundled scripts through `${CLAUDE_PLUGIN_ROOT}`. In shell form, quote the
  placeholder as above so a path with spaces survives. Exec form avoids quoting:

  ```json
  { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/check.js"] }
  ```
- `${CLAUDE_PLUGIN_ROOT}` is the installed copy of this version and changes on every
  update. Write state and caches under `${CLAUDE_PLUGIN_DATA}`, which persists.
- The script receives the event as JSON on stdin (`tool_name`, `tool_input`, `session_id`,
  `cwd` and event-specific fields), and runs with the user's project as its working
  directory.
- Plugin agents cannot carry hooks; `hooks:` in a plugin agent file is ignored. A plugin's
  hooks go in `hooks/hooks.json`.

## Matchers

- A matcher made only of letters, digits, `_`, `-`, spaces, `,` and `|` is an exact name or
  a list of exact names: `Bash`, `Edit|Write`.
- Anything else is a JavaScript regular expression that matches anywhere in the name, so
  `Edit.*` also matches `NotebookEdit`. Anchor it (`^Edit$`) when you mean one tool.
- For your own plugin's MCP tools, match the full scoped name with a trailing `.*`:
  `mcp__plugin_<plugin>_<server-key>__.*`. Without the `.*` the matcher is an exact string
  and matches no tool, and a matcher on the bare server key never fires for a plugin
  server.
- Omit `matcher` to run on every occurrence of the event.

## What the exit code does

| Exit | Effect | What the model sees |
|---|---|---|
| 0, no output | No decision. The action continues through the normal permission flow. | nothing |
| 0, JSON on stdout | The JSON fields decide (next section). | depends on the field |
| 0, plain text on stdout | Ignored on most events. On `SessionStart` and `UserPromptSubmit` the text is added to the model's context. | the text, on those events |
| 2 | Blocks, on events that can block: `PreToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop` and others. Plain stdout is not shown. | stderr, as the reason, on `PreToolUse`, `Stop` and `SubagentStop`. On `UserPromptSubmit` the user sees it instead, and the prompt is erased. |
| 1, or anything else | A non-blocking error. The action proceeds and the user sees a hook-error notice. | nothing |

What follows from the table:

- A policy hook blocks with `exit 2` and writes to stderr what the model should do
  instead. Exit 1, the usual Unix failure code, blocks nothing.
- Stderr from a hook that exits 0 goes to the debug log only.
- On `PostToolUse` the tool has already run. Exit 2 shows stderr to the model after the
  fact; it cannot undo the call. On `SessionStart`, exit 2 shows stderr to the user only.
- A hook that times out renders no decision, and on `PreToolUse` the call continues through
  the normal permission flow. A slow check is not a gate.
- A script path that does not exist or is not executable produces the same non-blocking
  notice, and the action proceeds. A mistyped path leaves a policy hook silently disabled,
  so watch the first run of any new hook.

## JSON decisions on PreToolUse

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Force-push is blocked here. Push normally."
  }
}
```

- `"deny"` blocks the call, and the reason goes to the model. `"ask"` shows the user a
  permission prompt.
- `"allow"` skips the user's permission prompt for that call. The user's deny and ask rules
  still apply, but nothing else asks. A hook that means to let a call through untouched
  exits 0 with no output, which is "no decision". Printing `"allow"` to be explicit grants
  a permission the user never gave, on every call the matcher catches.
- `updatedInput` replaces the whole tool input, so copy the unchanged fields across.
- Set `hookEventName` to the event's name in every `hookSpecificOutput`.
- Other events use top-level `{ "decision": "block", "reason": "…" }`, for example
  `PostToolUse`, `Stop` and `UserPromptSubmit`.

## Changing the permission mode from a hook

`PermissionRequest` is the only hook event that can change the session's permission mode.
It carries `updatedPermissions`, which no other event's output schema has.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedPermissions": [
        { "type": "setMode", "mode": "plan", "destination": "session" }
      ]
    }
  }
}
```

Emit it on stdout and exit 0; the `decision` object is the mechanism, not an exit code.
Modes: `default`, `acceptEdits`, `plan`, `dontAsk`, `auto`, `bypassPermissions`.
Destinations: `session` (in memory), or `localSettings` / `userSettings` /
`projectSettings` to persist it as `permissions.defaultMode`.

Four constraints, measured against a live session:

1. `updatedPermissions` is read only on the `allow` branch. The deny variant has no
   permissions field, so one response cannot deny a call and change the mode.
2. The trigger must genuinely need permission. Claude Code auto-approves safe commands
   such as `echo`; no permission request means the hook never runs.
3. An `allow` rule for the trigger silently disables it: the hook never fires and the mode
   never changes, with no error.
4. `bypassPermissions` cannot be granted this way unless the session was launched with
   `--allow-dangerously-skip-permissions`, and it is never persisted.

Setting `plan` restricts the session; clearing it does not. Emitting `setMode: "default"`
from plan mode drops read-only enforcement with no `ExitPlanMode` call, no plan file and no
user approval. Gate the clearing direction, or do not ship it.

## Stop hooks

- Exit 2, or `decision: "block"`, keeps the model working, and the reason becomes its next
  instruction.
- The input carries `stop_hook_active: true` when the model is already continuing because
  of a stop hook. Check it, or a condition that never resolves blocks every turn; Claude
  Code overrides the hook after 8 consecutive blocks.

## Runtime notes

- Bun loads the working directory's `.env` before your code runs, and a hook's working
  directory is the user's project. Start Bun hooks with `bun --env-file=/dev/null`.
  Without it the hook inherits the project's secrets, and a `.env` that is a named pipe
  (1Password mounts one) makes the hook exit 1 with no stderr, which is a non-blocking
  error: the hook silently does nothing.
- Decide what an unreadable stdin payload means. For guidance hooks it is "no decision"
  (exit 0, no output); a security gate that has to fail closed exits 2 with a reason.

A complete PreToolUse hook, matching the `hooks.json` above:

```ts
#!/usr/bin/env bun
// Blocks `git push --force`. Every other Bash call gets no decision.
const input = await Bun.stdin.json().catch(() => null);
const command: string = input?.tool_input?.command ?? "";

if (/\bgit\s+push\b.*\s--force(\s|$)/.test(command)) {
  console.error("Force-push is blocked in this project. Push without --force, or ask the user to force-push.");
  process.exit(2);
}
process.exit(0); // no output: the normal permission flow decides
```
