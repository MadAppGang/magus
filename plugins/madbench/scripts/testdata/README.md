# testdata for `stop-wait-for-operator.ts`

Transcript excerpts, in the record shapes Claude Code actually writes to
`~/.claude/projects/<project>/<session>.jsonl`. Each was copied from a real session and
trimmed: the `Agent` tool_use, its "Async agent launched successfully" tool result, the
`<task-notification>` that arrives as a `queue-operation` record, and a `TaskOutput` call
with its result.

Two things are deliberate and worth keeping if these are ever regenerated:

- **The timestamps are fixed.** The hook treats a dispatch older than 45 minutes as dead,
  so a test that passed `Date.now()` would start failing 45 minutes after the file was
  written. Every test derives its `now` from the dispatch timestamp instead.
- **`agentId` is the real 17-character shape** (`a1d5d4f54162a0266`), because the hook
  parses it out of the tool result with a regex and a stand-in like `abc123` would not
  exercise the same match.

| File | What it holds |
|---|---|
| `no-dispatch.jsonl` | A `general-purpose` agent dispatched and completed. No operator anywhere. |
| `dispatch-unreported.jsonl` | An operator dispatch and its launch result. Nothing since. |
| `dispatch-notified.jsonl` | The same, followed by a `<task-notification>` with `<status>completed</status>`. |
| `dispatch-taskoutput-done.jsonl` | The same, closed by a `TaskOutput` result carrying the report. |
| `dispatch-taskoutput-running.jsonl` | A `TaskOutput` result that says the operator is still running. |
| `dispatch-six-blocks.jsonl` | An unreported dispatch with six of this hook's own block reasons after it. |
| `two-dispatches.jsonl` | Two operator dispatches; the first reported, the second not. |
