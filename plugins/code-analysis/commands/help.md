---
name: help
description: Show what the code-analysis plugin provides — its agent, commands, skills, tool surface, and which one to reach for
allowed-tools: Read
---

# code-analysis help

Present the following to the user.

---

## code-analysis

Read-only investigation of code you did not write. Ask a question, get file:line locations and
the flow between them.

```
/code-analysis:analyze Where is user authentication handled?
```

---

## The tool surface

| Tool | Present | Takes |
|---|---|---|
| `code_search` | always | `query` (free-form), `intent`, `scope` |
| `find_dependencies`, `find_dependents`, `call_tree`, `find_implementations`, `impact` | only when the configured engine genuinely supports that operation | `symbol`, `depth` / `max_depth`, `scope` |
| `Read`, `Grep`, `Glob` | always | — |

`code_search` is unconditional and infers intent from the query, so ask the real question.
The structural tools appear only when the engine behind them can answer honestly — an absent
tool means the engine cannot do it at all, never that it would be approximate.

**Text search is the right tool for exact literals, occurrence counts and filename patterns.**
That is routing, not a fallback. The only rule is that a report names the method it used.

## The engine

One engine at a time, named in project settings under a `code-analysis` block, read from your
user settings, then the project's, then the project's local overrides. With none named,
`code_search` runs on its own — a supported configuration, not a broken one.

Run `/code-analysis:setup` to see which engine is active, whether it answered a probe, and what
the remedy is when it did not. Engines document their own installation; this plugin does not
install one for you.

---

## Agent (1)

| Agent | What it does |
|---|---|
| `code-analysis:detective` | Investigates read-only — locates implementations, traces a feature end to end, maps inbound and outbound dependencies, tracks a bug to its origin |

Reach for it when you need to understand how a feature works, where logic lives, how data flows,
or why something breaks. It runs in its own context window and never edits anything.

## Commands (3)

| Command | What it does |
|---|---|
| `/code-analysis:analyze` | Dispatch the detective at one question |
| `/code-analysis:setup` | Install and verify the ripgrep shim, check the server, report the engine |
| `/code-analysis:help` | This |

```
/code-analysis:analyze How does the payment processing work?
/code-analysis:analyze Where are API endpoints defined?
/code-analysis:analyze Find every usage of the UserService class
```

## Skills (3)

| Skill | What it does |
|---|---|
| `code-analysis:code-search` | The retrieval mechanics — classify the request, query, read only the returned spans |
| `code-analysis:investigate` | One investigation routed to one of four modes: bug, test gap, architecture, implementation |
| `code-analysis:deep-analysis` | A full audit across seven dimensions, each finding scored with evidence |

### Which one

| The request | Goes to |
|---|---|
| "debug", "error", "broken", "failing", "crash" | `code-analysis:investigate` — bug mode |
| "test", "coverage", "edge case", "mock" | `code-analysis:investigate` — test gap mode |
| "architecture", "design", "structure", "layer" | `code-analysis:investigate` — architecture mode |
| "how does", "implementation", "data flow" | `code-analysis:investigate` — implementation mode |
| "comprehensive", "full review", "audit every dimension" | `code-analysis:deep-analysis` |
| about the query itself — what to ask, and what to read afterwards | `code-analysis:code-search` |

---

## Where it helps

| Situation | What you get |
|---|---|
| New to a codebase | The shape of it, most central symbols first |
| Bug investigation | The path from symptom back to origin |
| Feature planning | The integration points, with their impact radius |
| Code review | The context around the lines that changed |

## More

- Repo: https://github.com/MadAppGang/magus
- Author: Jack Rudenko @ MadAppGang
