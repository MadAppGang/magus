---
name: deep-analysis
description: Audits a codebase across seven dimensions, from architecture to code health, scoring each finding with evidence. Use for a full codebase review, tech-debt assessment, or post-incident analysis.
allowed-tools: Bash, Agent, Read, Grep, Glob
model: opus
user-invocable: false
---

# Deep analysis

A multi-dimensional audit. Retrieval mechanics live in the `code-search` skill and
single-thread investigation in `investigate`; this skill is the dimension set, the verdict
definitions, and the report contract.

## When this is the right depth

- A review asked for as comprehensive, full, or end-to-end
- A bug that crosses more than one system
- A major refactor or an architecture decision record
- Tech-debt assessment and prioritisation
- Onboarding someone to an unfamiliar codebase
- Post-incident root-cause analysis
- A security audit
- One dimension was already investigated and proved insufficient

## Discipline

- **Never rank-truncate a result set** — narrow with `scope`, not with `head`.
- **An error and an empty result mean opposite things.** Establish which you have.
- **A clean result is a finding.** "No dead code found" is evidence of hygiene; report it
  with the threshold that produced it rather than dropping it.
- **Validate relevance, not just success.** If none of the query's key terms appear in the
  results, reformulate rather than build on them.
- **Name the method** behind every finding, including the dimensions where lexical search
  was the correct tool.
- **Blocked, never stalled.** A subagent cannot ask the user a question. Return a result
  beginning `BLOCKED:` naming what is missing and what would unblock it, and let the
  dispatching orchestrator ask.
- **Centrality is relative** — tiers, not numbers. An absent centrality means unknown.

---

## The seven dimensions

| # | Dimension | Question | Primary signal |
|---|---|---|---|
| 1 | **Architecture** | What is the shape, and what are its pillars? | Highest-centrality symbols *are* the architecture. Layers from presentation / business / data vocabularies; patterns from factory, interface, event vocabularies |
| 2 | **Implementation** | How does the critical path actually run? | Outbound edges of the high-centrality symbols (dependencies), inbound edges of the critical functions (usage), full context for the complex ones |
| 3 | **Test coverage** | What is untested that matters? | Inbound edges filtered to test files. High centrality plus zero test callers = critical gap |
| 4 | **Reliability** | How does it fail, and does it recover? | Error-handling chains via full context; exception flow via throw/error/exception vocabulary; inbound edges of custom error types; retry/fallback/circuit-breaker vocabulary |
| 5 | **Security** | Where are the trust boundaries? | Authentication entry points with both edge directions; authorization via permission/role/guard vocabulary; sensitive data via password/hash/token/secret vocabulary; inbound edges of encryption |
| 6 | **Performance** | What is structurally slow? | Database and batch query patterns, async and parallel patterns, cache and memoize patterns |
| 7 | **Code health** | What is rotting? | Dead code split by centrality, and test gaps with the full impact pulled for the critical ones |

A dimension with nothing to report still gets a line. Silence reads as "not checked".

---

## Workflow

1. **Map the architecture.** Full structural overview; record the pillars by centrality
   tier.
2. **Walk the critical paths.** For each pillar: locate, outbound edges, inbound edges, full
   context where it is complex.
3. **Assess coverage.** Inbound edges of each critical symbol, classified test vs
   production.
4. **Identify risk.** Security vocabulary and its edges, error handling, external
   integrations.
5. **Inventory debt.** Dead code, orphans, god classes, deprecated markers.

Each step narrows the next one's queries. Do not start at step 5 — a debt list with no
architecture behind it cannot be prioritised.

---

## Verdict definitions

These are the definitions the report must use. They exist because each one has been
collapsed into a weaker form somewhere and produced a wrong call.

| Verdict | Requires | Not to be confused with |
|---|---|---|
| **Dead code** | zero inbound edges **and** low centrality **and** not exported | *orphaned*, which drops the export check |
| **Orphaned** | zero inbound edges **and** low centrality | *dead*, which additionally requires the export check |
| **Something broke** | zero inbound edges **and** high centrality | dead code — this is an investigation, not a cleanup |
| **Test gap** | zero inbound edges from test files **and** high centrality | untested leaf code, which is not worth reporting |
| **God class** | one symbol with more than roughly 20 outbound edges | a large file |

**An export is a public contract.** Exported symbols are excluded from dead-code verdicts by
default, because their consumers may be outside this tree.

**Every dead-code and coverage verdict is labelled "requires manual review"** unless a human
has checked it against what static analysis cannot see — dynamic imports, reflection and
bracket dispatch, event and callback registration, dependency-injection wiring, and callers
in another repository. That list is in the `code-search` skill; it is a limit of the
category, not of any one engine. This skill never authorises a deletion.

**For a critical gap, pull the full transitive impact before prioritising it.** Centrality
alone under-states risk: a mid-centrality symbol on the payment path outranks a
high-centrality logger.

---

## Splitting the audit across roles

When the audit is dispatched to several agents, split it by perspective, not by directory —
each role runs the analyses its perspective needs and reports in the same shape.

| Role | Focus | Primary | Secondary | Also |
|---|---|---|---|---|
| **Architect** | structure, cleanup, what to record | structural map, dead code | full context, dependency closure | persist the architecture findings |
| **Developer** | modification scope, safe edits | inbound edges, outbound edges, transitive impact | locate symbol | verify signature before proposing an edit |
| **Tester** | coverage priorities | test-gap detection | inbound edges | reference-level lookup, which catches mocks and generated cases the AST edges miss |
| **Debugger** | error tracing, type verification | full context, transitive impact | locate symbol, inbound edges | read declarations where dispatch is dynamic |
| **Comprehensive** | all seven dimensions | all | all | all |

Every agent queries the same resident search surface, so there is nothing to pre-compute and
share — do **not** run one analysis to a scratch file for the others to read. For fanning
work out across models, use the `multimodel` plugin.

---

## Report contract

**Executive summary** — an overall score, a score per dimension, and Critical / Major /
Minor counts. Name the method used for each dimension.

**Architecture section** — core abstractions with centrality tier and `file:line`; the layer
structure as a diagram; the major flows.

**Per-dimension findings** — each carrying its evidence: `file:line`, the edge counts that
produced it, and the verdict definition it satisfies. A finding without evidence is an
opinion and does not go in the report.

**Action items, bucketed and prioritised by centrality impact:**

- **Immediate** — affects high-centrality code
- **Short-term** — important, bounded
- **Medium-term** — improvement, not urgent

Each item names the finding, the evidence, and what would close it.
