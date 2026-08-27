## Code Search

Added by the `code-analysis` plugin.

### The tool surface

| Tool | Present | Takes |
|---|---|---|
| `code_search` | always | `query` (free-form), `intent`, `scope` |
| `find_dependencies`, `find_dependents`, `call_tree`, `find_implementations`, `impact` | only when the configured engine genuinely supports that operation | `symbol`, `depth` / `max_depth`, `scope` |
| `Read`, `Grep`, `Glob` | always | — |

**Read the tool list; never assume a structural tool exists.** Absence means the configured
engine cannot answer that class of question at all — not that it would be slower or
approximate. Say so in the report and answer with what is present.

`code_search` infers intent from the query, so write the real question. Pass `intent` only to
override an inference you have watched go wrong. Every response names the capability that
served it — read that field.

### Routing

| The request is about | Route to |
|---|---|
| meaning, behaviour or a flow | `code_search` |
| the shape of the system, or a **named** symbol and what touches it | `code_search`, then the structural tools |
| an exact literal, an occurrence count, or a filename pattern | `Grep` / `Glob` |

Text search is the correct tool for the third row — that is routing, not a fallback. The rule
is to name the method behind each finding, never to avoid a tool.

### Discipline

- Search before reading. Three or more files in one investigation means one ranked query first.
- Read only the line ranges returned, and re-resolve them before acting — edits move them.
- Never rank-truncate a result set; narrow with `scope` instead.
- An error and an empty result look alike and mean opposite things. Establish which you have.
- Centrality is tiers, not a threshold. Absent centrality means unknown, not low.
