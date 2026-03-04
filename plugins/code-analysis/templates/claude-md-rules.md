
## Code Search: CLAUDEMEM MCP

> Added by `code-analysis` plugin v4.0.0

### Available MCP Tools

The code-analysis plugin provides claudemem as an MCP server with tools
organized into functional groups. Use `ToolSearch` with query `"claudemem"`
to discover and load available tools.

**Navigation & Search (9 tools):**

| Tool | Purpose |
|------|---------|
| `search` | Semantic + BM25 hybrid code search |
| `symbol` | Find symbol definition with usages and PageRank |
| `callers` | What depends on this symbol? (call graph up) |
| `callees` | What does this symbol depend on? (call graph down) |
| `context` | Enclosing symbol, imports, and related symbols |
| `map` | Repository structure with PageRank-ranked symbols |
| `references` | All references to a symbol (LSP-backed) |
| `definition` | Symbol definition with surrounding context |
| `search-with-context` | Semantic search plus repository context |

**Edit & Refactor (4 tools):**

| Tool | Purpose |
|------|---------|
| `edit_symbol` | Replace a symbol's body by name — prefer over Read+Edit |
| `edit_lines` | Replace a line range within a file |
| `restore_edit` | Undo the last edit_symbol or edit_lines operation |
| `rename_symbol` | Rename a symbol across the entire codebase (LSP refactoring) |

**LSP Navigation (2 tools):**

| Tool | Purpose |
|------|---------|
| `define` | Jump to declaration via live LSP (textDocument/definition) |
| `hover` | Get type information and documentation for a symbol |

**Memory (4 tools):**

| Tool | Purpose |
|------|---------|
| `memory_write` | Persist a named note across sessions |
| `memory_read` | Retrieve a previously written note |
| `memory_list` | List all available memory keys |
| `memory_delete` | Remove a memory entry |

**Reasoning (1 tool):**

| Tool | Purpose |
|------|---------|
| `think` | Structured reflection checkpoint — use before editing |

**Index Management (2 tools):**

| Tool | Purpose |
|------|---------|
| `index_status` | Index health and server status |
| `reindex` | Trigger background or blocking reindex |

### Freshness Metadata

Every tool response includes freshness metadata:
- `freshness`: `"fresh"` or `"stale"` — whether index is current
- `lastIndexed`: ISO timestamp of last index
- `reindexingInProgress`: whether background reindex is running
- `responseTimeMs`: wall-clock time for the tool call

If results are stale, use the `reindex` tool or wait for auto-reindex (2-minute debounce).

### Recommended Workflow

1. **Architecture overview**: `map` with depth 3-5 for PageRank-ranked structure
2. **Semantic search**: `search` for natural language queries
3. **Symbol investigation**: `symbol` → `callers` → `callees` for dependency analysis
4. **Impact assessment**: `impact` before modifying high-PageRank symbols

### Why Use Claudemem MCP

- **Semantic search**: Finds code by meaning, not just text patterns
- **Pre-indexed**: Instant results from vector database (~50ms)
- **PageRank ranking**: Symbols ranked by architectural importance
- **AST analysis**: Understands code structure (functions, classes, imports)
- **Auto-reindex**: File watcher detects changes, reindexes in background

### CLI Fallback

If MCP tools are unavailable, claudemem CLI commands work via Bash:

```bash
claudemem --agent search "query"     # Semantic search
claudemem --agent symbol "Name"      # Symbol lookup
claudemem --agent map                # Architecture overview
claudemem --agent callers "Name"     # Dependency analysis
claudemem status                     # Index health
claudemem index                      # Manual reindex
```
