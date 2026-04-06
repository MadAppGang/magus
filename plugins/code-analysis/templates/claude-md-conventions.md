## Code Analysis (mnemex)

### Private Paths -- Do Not Commit

- `.mnemex/` -- Machine-specific code index (vector DB, AST cache). Rebuilt per-machine via `mnemex index`.
- `.claudemem/` -- Legacy code index (predecessor to mnemex). Same policy.
- `.claude/.coaching/` -- Per-user coaching state (recommendations, learning queue). Session-specific.

These directories are in `.gitignore`. Never `git add -f` them.

### Semantic Code Search

The mnemex MCP server provides semantic search, AST navigation, and refactoring tools.
Use `ToolSearch` with query `"mnemex"` to discover available tools.

Key tools: `search` (semantic), `map` (architecture overview), `symbol` (definition + PageRank),
`callers`/`callees` (call graph), `edit_symbol` (refactor by name).

If MCP tools are unavailable, fall back to CLI: `mnemex --agent search "query"`.
