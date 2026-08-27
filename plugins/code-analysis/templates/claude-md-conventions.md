## Code Analysis

### Private Paths -- Do Not Commit

- `.mnemex/` -- Local code index (vectors, AST cache). Machine-specific and rebuildable.
- `.claudemem/` -- Local code index. Same policy.
- `.claude/.coaching/` -- Per-user coaching state (recommendations, learning queue). Session-specific.

An index directory is machine-specific and rebuildable, so it belongs to the machine that
built it and to no commit. These are in `.gitignore`. Never `git add -f` them.

### Code Search

The `code-analysis` MCP server exposes `code_search` — free-form `query`, optional `intent`,
optional `scope` — plus `find_dependencies`, `find_dependents`, `call_tree`,
`find_implementations` and `impact` when the configured search engine genuinely supports them.

**Read the tool list; never assume a structural tool exists.** Absence means the engine cannot
answer that class of question at all. `Read`, `Grep` and `Glob` are always available and are
the right tool for exact literals, occurrence counts and filename patterns — name the method
behind each finding.

Run `/code-analysis:setup` to see which engine is active and whether it is healthy.
