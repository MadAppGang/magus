---
name: investigate
description: Routes a code investigation to one of four modes — bug, test gap, architecture, implementation — and runs the query sequence that mode needs. Use when asked to investigate, trace, or debug code.
allowed-tools: Bash, Agent, Read, Grep, Glob
user-invocable: false
---

# Investigate

One investigation, one mode. Pick the mode from the request, announce it, then run that
mode's sequence. The retrieval mechanics live in the `code-search` skill; this skill is
about which questions to ask and in what order.

## Routing

| Mode | Trigger keywords | Question sequence |
|---|---|---|
| **Bug** | debug, error, broken, failing, crash | full context → inbound → outbound → transitive impact |
| **Test gap** | test, coverage, edge case, mock | inbound filtered to test files → gap detection |
| **Architecture** | architecture, design, structure, layer | structural map → centrality → dependency closure |
| **Implementation** *(default)* | how does, implementation, data flow | locate → inbound → outbound → full context |

**Collision order: Bug > Test > Architecture > Implementation.** No keyword matches →
Implementation.

**Announce the routing before executing it** — print the query, the chosen mode, and the
one-line reason. A wrong route is then correctable in one turn instead of after the
investigation is spent.

## Discipline that applies to every mode

- **Never rank-truncate a result set.** Ranking already put the important results first;
  cutting by line count deletes them. Narrow with `scope` instead.
- **An error and an empty result look alike and mean opposite things.** Establish which one
  you have before you report either.
- **Name the method** behind every finding. Lexical search is the right tool for exact
  strings, counts and filename patterns — using it is routing, not a fallback. Using it
  without saying so is the defect.
- **Blocked, never stalled.** A subagent has no tool for asking the user a question. If you
  cannot proceed, do not wait for an answer that cannot arrive and do not decide on the
  user's behalf: return a result beginning `BLOCKED:` naming what is missing and what would
  unblock it, and let the dispatching orchestrator ask.
- **Centrality is relative.** Treat it as tiers — core, key, ordinary, leaf — never as a
  number to threshold. An absent centrality means unknown, not low.

---

## Architecture mode

**Use when:** "what is the architecture", "how are the layers structured", "find the design
patterns", "map the system".

The highest-centrality symbols *are* the architecture. Start there, and skip the leaves.

**Find the layers** by running the same structural query against three vocabulary families
and reading the file distribution of the results:

```
code_search(query: "controller handler endpoint route")   # presentation
code_search(query: "service business logic domain")       # business
code_search(query: "repository persistence database query") # data
```

Boundaries and wiring show up under `interface contract abstract`, `inject provider module`
and `config bootstrap initialize`.

**Find the patterns** the same way — the pattern names are in the source:

```
code_search(query: "factory create builder")
code_search(query: "interface abstract contract")
code_search(query: "event emit subscribe")
code_search(query: "repository persist unit of work")
```

**Then take the closure.** Direct callers are one level; the blast radius of an
architectural change is the transitive closure, grouped by depth.

```
find_dependents(symbol: "PaymentService")
impact(symbol: "PaymentService", max_depth: 3)
```

**Report:** detected pattern, core abstractions with their centrality tier and file:line,
the layer diagram, the major flows, and the health indicators.

### Persist what you derived

Architecture knowledge is expensive to re-derive and cheap to record. Write it down once
derived — as bullet summaries plus `file:line` pointers, **never pasted code**. Code goes
stale on the next edit; pointers survive it.

---

## Implementation mode (default)

**Use when:** "how does X work", "trace the data flow", "where is X defined".

1. **Locate** the symbol — exact span, kind, signature, export status.
2. **Inbound edges** — every place that calls it. This is the impact of changing it.
3. **Outbound edges** — everything it calls. These are its dependencies and the data-flow
   path.
4. **Full context** when the change is non-trivial: definition plus both directions at once.

Edge kind matters as much as edge existence: `call`, `import`, `extends` and `implements`
have different blast radii. Say which kind an edge is when it changes the conclusion.

**Direct callers are one level. `impact` is the transitive closure.** Refactoring decisions
need the closure; a direct-caller count under-states the work every time.

**Before editing:** confirm the symbol resolves, confirm its current signature, think, then
edit. Never grep → read → edit. Index-derived signatures are captured at index time and can
lag the file — when the name is overloaded or generic, read the declaration at the returned
span rather than trusting the summary.

**Report:** primary location with `file:line`, inbound edges, outbound edges, and the
end-to-end flow.

---

## Test gap mode

**Use when:** "what is tested", "find the coverage gaps", "audit test quality", "missing
tests", "edge cases".

Tests appear in the graph as **callers of the code they test**. Zero test callers on code
that has production callers is the high-priority case.

1. Take the inbound edges of each critical symbol.
2. Classify each caller as test or production by path, using one pattern set:

   ```
   *.test.*  *.spec.*  __tests__/  tests/
   *_test.go  *_test.py  test_*.py  src/test/java/  *_test.rs
   ```

3. **Report both counts.** Production callers > 0 and test callers = 0 is the finding worth
   escalating; low-centrality untested code is not a gap worth reporting.

**The convention is incomplete, and the verdict must say so.** Filename matching misses
integration tests in non-standard locations, inline test modules (Rust `#[cfg(test)]`),
end-to-end suites that reach the code indirectly, and any language whose convention is not
in the list above. A "0 test callers" result from filename matching alone is a hypothesis,
not a coverage verdict.

**Two methods will disagree, and that is information.** Mock registration (`vi.mock`,
`jest.mock`) and generated cases (`describe.each`) are call sites that AST edges miss but a
reference-level lookup finds. When the two counts differ, report both rather than picking
one.

**Report:** framework, test file count, a per-function table of test callers, then the
high-priority list (production callers, no test callers) and the medium list (few test
callers, no error scenarios).

---

## Bug mode

**Use when:** "why is X broken", "find the bug source", "root cause analysis", "trace this
error".

**Trace backwards through callers to find the cause; trace forwards through callees to find
the effect.** The full chain is the root-cause picture.

1. Locate the symbol named in the error, and take its full context.
2. Walk inbound edges outward — caller of the symbol, caller of that caller — until the
   chain reaches something that explains the symptom.
3. Walk outbound edges to see what the failure propagates into.
4. Take the transitive impact for post-fix verification and regression scope.

**Check the type boundary explicitly.** Mismatches between a symbol's actual signature and
what its callers assume are a leading cause of runtime errors, and they are invisible in a
call graph that only records that an edge exists. Read the declaration and read one caller.

**Error origin hunting:** map the error vocabulary (`throw error exception`), locate the
error type, then take *its* inbound edges — whoever constructs it is where the condition is
detected.

**State mutation tracking:** locate the mutator (`set state update mutate`), then enumerate
who calls it.

**Report:** symptom → the backwards call chain → root cause with `file:line` → the evidence
that establishes it → the count of affected locations. Every step carries its evidence; a
root cause asserted without a chain is a guess.

---

## Reading "0 callers"

**Zero inbound edges has three readings, and they are not interchangeable:**

1. **Entry point** — expected and correct. CLI mains, HTTP handlers, exported public API,
   test-only helpers.
2. **Dead code** — genuinely unreachable.
3. **A call the graph cannot see** — dynamic import, reflection, bracket dispatch, event or
   callback registration, dependency-injection wiring, or a consumer in another repository.

**Never collapse the three.** Report which one you concluded and the evidence for it.

**This skill does not authorise deletion.** A dead-code verdict needs all three of: zero
inbound edges, low centrality, and **not exported** — an export is a public contract whose
consumers may be outside this tree. Even with all three, the finding is labelled *requires
manual review* until a human has checked it against the dynamic-dispatch list above.

**High centrality with zero callers means something broke recently** — a deleted call site,
a botched merge — and is an investigation, not a cleanup. Low centrality with zero callers
is a cleanup *candidate*, which is a proposal, not a verdict.
