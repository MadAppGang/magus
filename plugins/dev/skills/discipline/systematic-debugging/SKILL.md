---
name: systematic-debugging
description: "Root-cause debugging — reproduce, localize, explain, verify — with depth routing and a technique catalogue for stack traces, wolf fence and data-flow tracing. Use when anything errors, crashes or misbehaves, even on a bare pasted trace."
user-invocable: false
---

# Systematic Debugging

One entry point for finding why code is wrong. Read the section you need; each
links to a sibling file with the full detail.

## The rule

**No fix without a root cause.** If you cannot say which line produces the wrong
value and why, you are guessing. A guess that happens to work is a latent bug —
it will come back wearing different symptoms.

Red flags that you have skipped the diagnosis: changing code to "see if it
helps", adding defensive checks around a symptom, fixing the same area twice,
or being unable to explain why the fix works.

## Pick a depth

| Situation | Do this |
|---|---|
| Obvious cause, one file, low risk | Fix inline. No ceremony. |
| Needs investigation, unclear origin | Follow `workflow.md` |
| Production-critical, intermittent, or uncertain | Run `/dev:fix` — full TDD with review gates |

`/dev:debug` routes between these three for you.

## The four phases

1. **Reproduce** — a failing case you can run on demand. Without this you cannot
   tell a fix from a coincidence.
2. **Localize** — narrow to the specific code producing the wrong value.
   Strategies in `localization.md`.
3. **Explain** — state the mechanism: this input, through this path, yields this
   wrong output. Then predict what changing it will do.
4. **Verify** — the reproduction now passes, and you can say why. Re-run the
   surrounding tests; a fix that breaks a neighbour was the wrong fix.

Full walkthrough with output schemas: `workflow.md`.

## Reference files

| File | Contents |
|---|---|
| `method.md` | Principles, red flags, hypothesis discipline, strategies by problem type (performance, intermittent, regression, integration) |
| `workflow.md` | The phase-by-phase standard workflow with report schemas |
| `localization.md` | Three fault-localization strategies — stack-trace grep, BM25 keyword search, AST context expansion — plus context-budget rules and the large-codebase path |
| `session-setup.md` | Session directory layout, stack detection, reproduction capture, bug-report schema. Shared by `/dev:debug` and `/dev:fix`. |
| `references/techniques.md` | The technique catalogue — stack-trace reading, error categories, wolf fence, data-flow tracing, logging, breakpoints, plus browser and Node.js specifics |

**Read `references/techniques.md` in the Localize phase**, when you know which phase you
are in and need the concrete move. It is a catalogue, not a method — reading it first
invites picking a technique before you have a hypothesis.

## Related

- `dev:browser-debugging` — anything involving a browser, console, or network tab
- `dev:test-driven-development` — writing the failing test that pins the bug
