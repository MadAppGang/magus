---
name: performance
description: "Diagnose or fix Bun/TypeScript performance. Loads the performance skill, then works the task through its workflow."
argument-hint: "[what is slow, or what to measure]"
---

<user_request>$ARGUMENTS</user_request>

1. **Read `skills/performance/SKILL.md` in full first**, resolved against this plugin's own
   directory (the tree this command was loaded from). It is the router: it names which files in
   `skills/performance/references/` your task actually needs. Read those too before writing code.

Use this when something is slow, when benchmarking, or when deciding whether an optimisation
is worth it.

2. **Measure before changing anything.** Copy `skills/performance/assets/perf/` and use the
   harness — it warms up, calibrates iterations against the measured ~42 ns clock granularity, and
   reports median/MAD rather than a mean that one GC pause destroys.
3. **Work the optimisation order:** do it fewer times → off the request path → lazily → only then
   make it faster. An accidental O(n²) beats every micro-optimisation applied to it.
4. **Before reporting done:** produce a before/after measurement from the same harness in the same
   session, including the spread. A change inside the noise band is not a change.
