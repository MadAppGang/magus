---
name: code-search
description: Finds code by meaning, structure or exact text, then reads only the spans returned. Use when searching a codebase, locating a symbol, tracing callers, or about to open three or more files.
allowed-tools: Bash, Read, Grep, Glob
user-invocable: false
---

# Code search

Retrieval is cheap, reading is expensive. Every rule here moves work from the second into
the first.

## The tool surface

| Tool | Present | Arguments |
|---|---|---|
| `code_search` | always | `query` (free-form), `intent`, `scope` |
| `find_dependencies`, `find_dependents`, `call_tree`, `find_implementations`, `impact` | **only when the configured engine genuinely supports the operation** | `symbol`, `depth` / `max_depth`, `scope` |
| `Read`, `Grep`, `Glob` | always | — |

**Read the tool list; never assume a structural tool exists.** Absence means the engine
cannot answer that class of question at all — not that it would be slow or approximate. When
a tool you wanted is missing, say so in the report and answer with what is present.

`code_search` infers the intent from the query, so write the real question rather than a
hint. Pass `intent` only to override an inference you have watched go wrong.

Every response names the capability that served it. Read that field — it teaches the routing
by example at no cost, and it is how you notice a substitution.

## Classify before you query

| The request asks for | Kind | Route to |
|---|---|---|
| meaning, behaviour or a flow — "how does authentication work", "how does user data reach the database" | conceptual | `code_search` |
| the shape of the system, or where a **named** symbol lives and what it touches — "map the service layer", "find class UserService", "who calls parse" | structural | `code_search`, then the structural tools |
| an exact literal, an occurrence count or a filename pattern — "find DEPRECATED_FLAG", "how many TODO comments", "all `*.config.ts`" | lexical | `Grep` / `Glob` |

**Locating a named symbol is structural, not lexical.** Searching text for a class name
returns every mention — comments, strings, imports — unranked, and still misses re-exports.
Ask for the definition instead.

**Lexical tools are the correct tool for the lexical row.** That is routing, not a fallback
and not a violation, and it needs no approval. What is forbidden is doing it silently: name
the method you used.

## Intercept bulk reads

| Situation | Intercept? |
|---|---|
| read 1-2 named files | no |
| read 3+ files in one investigation | **yes** — one ranked query first |
| glob for an exact filename | no |
| glob for pattern discovery, then read every match | **yes** |
| grep for an exact string | no |
| grep for a concept | **yes** |
| "read the files I mentioned" | **yes** — search first, then read the spans |

Ranked results carry the surrounding context, so a hit is frequently the whole answer with
no file opened. When you do open one, **read only the returned line range** — never the
whole file.

Line numbers go stale the moment any edit lands. Re-resolve a span before acting on it.

## The five phases

Each phase narrows the next phase's query. Cost rises sharply left to right, which is the
second reason for the order.

1. **Structure.** Before opening anything, get a task-scoped overview: which files hold
   relevant code, which symbols are central, what the shape is.
2. **Locate.** Resolve a now-known name to an exact span with its kind, signature and export
   status. Disambiguate same-named symbols by centrality and export status.
3. **Dependencies, both directions, before modifying anything.** Inbound edges answer *what
   breaks if I change this*; outbound edges answer *what does this need*. Ask both. Edge
   kind matters as much as edge existence — `call`, `import`, `extends` and `implements`
   have different blast radii.
4. **Full context** for a complex change: definition plus both edge directions together, so
   no step is taken on a partial picture.
5. **Content search last**, only when actual code text is needed. A query written with the
   map already in hand is materially better targeted than the same query written first.

Then read the identified ranges, make the change, and re-check that the inbound edges still
hold.

A text search cannot enumerate call sites — it misses type-aliased calls, cross-file calls
and re-exported names. Use the call graph.

## Centrality

Centrality is how connected a symbol is within the call graph. Treat it as **relative
tiers**, never as an absolute number: the scale differs per engine, so a numeric threshold
copied from one is meaningless in another.

| Tier | Meaning | Action |
|---|---|---|
| top | core abstraction — this tier **is** the architecture | understand first; changing it is expensive |
| second | key building block | worth understanding |
| third | ordinary code | read as needed |
| bottom | leaf or utility | read only if directly relevant; skip in an architecture pass |

Ranking by centrality is what makes "read the top N" sound and "read every match" the
failure mode. It also combines with other signals to produce verdicts no single measure
gives — see the `investigate` and `deep-analysis` skills.

Some engines cannot rank. An absent centrality means *unknown*, not *low*.

## Result discipline

**Never rank-truncate.** `| head`, `| tail`, `sed -n`, `sort | head` over a ranked result
set deletes exactly the results that mattered, because ranking already put them first. Use
`scope` and the query's own limits instead. The ban is on cutting a *ranked* list by line
count; filtering or extracting a field from unrelated shell output stays legitimate.

**An error and an empty result look alike and mean opposite things.** Establish which one
you have before reporting either.

**Empty is not proof of absence.** Symbol vocabulary varies by codebase: if `authenticate`
misses, try `login`, `verify`, `validate`. Rephrase or broaden before concluding the code
does not exist.

**Validate relevance, not just success.** If none of the query's key terms appear anywhere
in the results, the results are off-target — reformulate rather than build on them.

**A clean result is a finding.** Report "no dead code found" with the threshold that
produced it. That is evidence of hygiene, not a failed search.

**Surface advisory notes.** A response may report that the index lags the working tree, or
that a result was cut short. Pass those on; never drop one silently.

**Name the method.** Every report states which method produced each finding. If you moved
from one method to another, say which and what it cost.

**Blocked, never stalled.** You may be running as a subagent, where no tool exists to ask
the user a question. If you genuinely cannot proceed, do not stall waiting for an answer
that cannot arrive, and do not decide on the user's behalf. Return a result beginning
`BLOCKED:` that states what is missing and what would unblock it, and let the dispatching
orchestrator ask.

## What static analysis cannot see

Limits of the category, not of one implementation. A finding touched by any of these is
**"requires manual review"**, never an assertion.

| Pattern | Example | Consequence |
|---|---|---|
| dynamic import | `import()` with a computed path | target looks uncalled |
| reflection, `eval`, bracket dispatch | `obj[methodName]()` | call sites invisible |
| event and callback registration | `emitter.on("x", handler)` | handler shows 0 callers |
| dependency-injection wiring | `container.register(IService, Impl)` | implementation shows 0 callers |
| consumers in another repository | an exported public API | 0 callers here, many outside |

Index-derived metadata — signatures, docstrings — is captured at index time and can lag the
file. When currency matters, or when the name is overloaded (TypeScript, Java, C++) or
generic, open the returned span and read the declaration instead of trusting the summary.

## Renaming and other cross-cutting edits

- Enumerate the **complete** change set before touching anything, and apply it as one
  transaction. A half-applied multi-file rename leaves the tree inconsistent.
- A rename reaches further than call sites: type annotations, generics, import statements,
  test files, and string literals that match the name. Counting callers under-counts it.
- Verify before you mutate — confirm the symbol resolves, confirm its current signature,
  think, then edit. Never grep, read, edit.

## Five recurring shapes

The sequence of questions is the durable part.

| Shape | Sequence | Report |
|---|---|---|
| **Bug** | locate the symptom symbol, full context, trace inbound to the suspected source, full transitive impact, read the ranges, fix, re-check the callers still hold | symptom, root cause, call chain, impact radius, fix, verification |
| **Feature** | map the area, find extension points from the nearest existing feature's outbound edges, full context at the insertion point, follow the existing pattern, check coverage on what you touched | extension point, dependencies, pattern followed, test requirements |
| **Refactor** | confirm the exact symbol, take the transitive impact rather than the direct callers, group by file, update systematically, re-query the new name, run the affected tests | direct vs transitive caller counts, files modified, verification |
| **Architecture** | full structural map, pillars by centrality, full context per pillar, trace major flows outbound, dead-code sweep, test-gap sweep | core abstractions, layers, major flows, health indicators |
| **Security** | map the security vocabulary, find authentication entry points (try synonyms), trace the auth flow both directions, map authorization, map sensitive-data handling, check coverage on security-relevant symbols | entry points, flow, authorization coverage, secret handling, gaps, prioritised recommendations |
