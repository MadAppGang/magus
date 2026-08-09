# Refactoring index

You are holding the **index**. It routes a symptom to one technique file and loads nothing
else. Two files is normal; five means the task is several tasks.

## The force

Refactoring is a structural change at **constant observable behavior**, applied to reduce the
cost or blast radius of a specific pending edit. That pending edit is the entire justification:
without one the change carries cost — a diff to review, regression risk, conflicts against
unrelated work — and returns nothing measurable. It also fixes which smell matters (the one in
the path of the edit) and the stop condition (that edit is now cheap).

## The contract: observable behavior is invariant

**Refactoring preserves observable behavior. That is the definition, not a caveat.** If
behavior changed, the change is a rewrite and needs a rewrite's tests, review, release note.

| In the contract — invariant | Not in the contract — free to change |
|---|---|
| return value and thrown error for every input in the domain, including boundary and error inputs | local and non-exported identifier names |
| exported signatures and types anything outside the module compiles against | which non-exported function holds which statement |
| side effects: writes, network calls, and their **order and count** | file layout and import graph inside the module |
| log records and metrics an alert rule matches | comments |
| complexity class a caller relies on (a timeout budget, an O(n) promise) | constant factors below measurement noise |

**Preconditions, before any mechanics:**

1. The suite passes **now** — not in CI last Thursday. Run it. An already-red suite cannot
   attribute a new failure to your edit.
2. The suite is **mutation-sensitive over the target range**: invert a comparison or delete a
   statement there, confirm a test fails. **A test that cannot fail is not coverage.** No
   failure means no contract (`UNI-23`, `UNI-22`).
3. It runs fast enough to execute **between numbered steps** — `bun test x.test.ts --watch`.
   Past roughly 90 s the loop breaks and intermediate steps stop being verified.
4. No test covers the range? The task is now **characterization tests** — assertions
   pinning current output, defects included — in a separate commit. They pin behavior rather
   than specify it, and are deletable once the structure they protected is stable.

**Postcondition, after every technique:** suite green, no new branch in the diff, no changed
signature at an external call site, and `tsc --noEmit` output unchanged.

**Step size is bounded by recovery cost.** Run the suite between moves. If green is more than
about ten minutes away, `git reset --hard` and take a smaller range.

**Commit discipline:** a refactoring commit has an empty behavior diff; a behavior commit has
an empty structural diff. Interleaved, neither is reviewable — the reviewer cannot tell which
hunks are asserted no-ops, so neither half gets checked — and `git bisect` cannot isolate it.

## Smell → technique

Files live at `refactoring/techniques/<name>.md`; the last column uses the short name.

| Short name | File | Techniques | Status |
|---|---|---|---|
| `composing` | `refactoring/techniques/composing-methods.md` | 9 | **written** |
| `moving` | `refactoring/techniques/moving-features.md` | 8 | **written** |
| `conditionals` | `refactoring/techniques/simplifying-conditionals.md` | 8 | **written** |
| `data` | `refactoring/techniques/organizing-data.md` | 15 | **written** |
| `calls` | `refactoring/techniques/simplifying-method-calls.md` | 14 | **written** |
| `generalization` | `refactoring/techniques/dealing-with-generalization.md` | 12 | **written** |

Counts are the 1st-edition catalogue as published: **66 techniques across the six groups**, not
68. Where a technique file additionally covers a 2nd-edition addition (for example `Introduce
Special Case`, which `conditionals` folds into its entry 7), that material is labelled as such
and folded into an existing entry — it never becomes a numbered entry of its own, because the
count column and the file's `## N.` headings must agree. `check-index.sh` enforces that.

When a row points at a file marked *not yet written*, the smell identification, the signal,
and the ordering above still apply — you are on your own for the mechanics. Do not invent a
citation to a file you could not read.

**Catalogue edition.** Names here follow Fowler's *Refactoring* 1st edition (1999), which is
what the smell table and every technique file use. The 2nd edition (2018) renames some
(Move Method → Move Function) and adds others (Introduce Special Case, Slide Statements,
Replace Loop with Pipeline). Where a technique file covers a 2nd-edition addition it says so
in that entry.

| Group | Smell | Signal you can check | Start with |
|---|---|---|---|
| **Bloater** | **Long Method** | body exceeds one screen; section comments delimit phases; ≥4 locals live across the intended cut point | Replace Temp with Query, then Extract Method · `composing` |
| **Bloater** | **Large Class** | fields partition into disjoint sets by which methods read them; high fan-out; the file appears in unrelated PRs | Extract Class · `moving`, then `generalization` |
| **Bloater** | **Primitive Obsession** | `string`/`number` where the domain is constrained; swapping two same-typed arguments at a call site still compiles; identical validation at ≥3 sites | branded type + one parse at the boundary · `data` |
| **Bloater** | **Long Parameter List** | arity ≥4, or ≥2 adjacent parameters of the same primitive type, or boolean flags (`UNI-19`) | Introduce Parameter Object, Preserve Whole Object · `calls` |
| **Bloater** | **Data Clumps** | the same ≥3 parameters recur in the same order across ≥3 signatures | Introduce Parameter Object, Extract Class · `data`, `moving` |
| **OO Abuser** | **Alternative Classes, Different Interfaces** | two types with equivalent postconditions, non-substitutable because the member names differ | Rename Method, then Extract Superclass · `calls`, `generalization` |
| **OO Abuser** | **Refused Bequest** | an override whose body throws or returns a sentinel — a Liskov violation (`UNI-03`) | Replace Inheritance with Delegation · `generalization` |
| **OO Abuser** | **Switch Statements** | the same discriminant switched on in ≥3 modules; adding a variant requires an edit in each (`UNI-02`) | Replace Conditional with Polymorphism · `conditionals` — **read the paradigm section first** |
| **OO Abuser** | **Temporary Field** | a field whose invariant is "non-null only between call A and call B"; `undefined` for the rest of the object's lifetime | Extract Class, Replace Method with Method Object · `moving`, `composing` |
| **Change Preventer** | **Divergent Change** | `git log` on the file shows ≥3 unrelated change reasons | Extract Class, Split Phase · `moving` |
| **Change Preventer** | **Parallel Inheritance Hierarchies** | every subtype of A has a matching subtype of B; adding one forces the other | Move Method/Field to collapse one side · `moving` |
| **Change Preventer** | **Shotgun Surgery** | one conceptual change touches N files; `git log` shows the same set co-changing | Move Method, Move Field, Inline Class · `moving` |
| **Dispensable** | **Comments** | the comment restates the statement below it (`SLOP-04`), or names a block that has no identifier | Extract Method — the name is compiler-checked, the comment is not · `composing` |
| **Dispensable** | **Duplicate Code** | identical or alpha-equivalent expression at ≥3 sites; clone detection | Extract Method; across siblings, Pull Up Method · `composing`, `generalization` |
| **Dispensable** | **Data Class** | accessors only, no enforced invariant | usually **not a smell in TypeScript** — see paradigm fit · `moving` |
| **Dispensable** | **Dead Code** | unreferenced export or unreachable statement; `knip`, `tsc --noUnusedLocals` | delete; version control is the archive |
| **Dispensable** | **Lazy Class** | a type with one member and one call site; inlining removes a hop and no boundary | Inline Class, Collapse Hierarchy · `moving`, `generalization` |
| **Dispensable** | **Speculative Generality** | interface or abstract base with exactly one implementor and no test double requiring it; unused parameters (`UNI-09`, `UNI-10`) | Collapse Hierarchy, Remove Parameter · `generalization`, `calls` |
| **Coupler** | **Feature Envy** | a function references another type's members more often than its own scope's | Extract Method, **then** Move Method · `composing` → `moving` |
| **Coupler** | **Inappropriate Intimacy** | bidirectional import (`TS-13`), or module A reading fields B does not intend as API | Move Method/Field, Extract Class · `moving` |
| **Coupler** | **Message Chains** | accessor chain of depth ≥3; the caller's blast radius includes every intermediate type | Hide Delegate · `moving` |
| **Coupler** | **Middle Man** | more than half a type's members forward without adding a precondition or postcondition | Remove Middle Man, Inline Method · `moving`, `composing` |
| **Coupler** | **Incomplete Library Class** | you need an operation on a type you cannot edit | Introduce Foreign Method, Local Extension · `moving` |

## Paradigm fit — the catalog assumes OO, the module may not

These smells were catalogued for mutable objects with behavior and inheritance; much TypeScript is
pure functions over `readonly` records. **Establish the module's paradigm before applying a smell**,
or the refactoring introduces classes the design did not call for. Long Method, Large Class, Duplicate
Code and the Change Preventers translate unchanged ("extract" = a pure function). These do not:

| Smell | Under pure functions over immutable data |
|---|---|
| **Data Class** | **Usually the target state.** A parsed, validated `readonly` record with no methods is correct: the invariant is enforced once at the parse boundary, and referential transparency downstream depends on the record having no behavior. A smell only when the same derivation over it is duplicated at ≥3 call sites — and the fix is one shared function, not a method on the record. |
| **Switch Statements** | **Not a smell** when it is a single exhaustive `switch` over a discriminated union closed by `assertNever`: the exhaustiveness check turns "added a variant" into a compile error, which is what polymorphism was buying (`TS-07`). It becomes a smell when the same discriminant is switched on in ≥3 modules — Shotgun Surgery with a `switch` in it. Threshold: `selection.md`. |
| **Temporary Field** | **Does not apply** to `readonly` data constructed once — there is no window in which a field is half-initialised. The analogue is a property valid for one variant only (`{ status: "failed"; error?: E }`), fixed by a discriminated union, not Extract Class. |
| **Refused Bequest** | Rare without inheritance. The analogue is an over-wide interface with `throw new Error("unsupported")` implementations (`UNI-04`). Split the interface until every implementor satisfies every member. |
| **Parallel Inheritance Hierarchies** | The analogue is two union types kept in sync by hand. Derive one from the other with a mapped type so divergence becomes a type error. |
| **Primitive Obsession** | Still real. The TypeScript mechanism is a branded type plus one parse function at the boundary — zero runtime cost, and the swapped-argument call site stops compiling. The wrapper class is the Java answer. |
| **Middle Man** | A single forwarding function is correct when it *is* the boundary (a port, an adapter seam): deleting it puts a concrete dependency in the caller's import graph. Judge by the import graph, not the line count. |

## Order of application

Extract Class before Extract Method moves 200-line ranges whose cut points are not yet visible.
The groups form a ladder; skipping down it costs rework:

```
0. tests pass and are mutation-sensitive     the preconditions above
1. composing            shorten and name; eliminate the locals that block a cut
2. conditionals         flatten the branching the shortening exposed
3. moving               units are now small enough that a move is a small diff
4. data                 the moves have revealed the real types
5. generalization       only with three concrete cases in hand
6. calls                last: signature changes propagate to every call site
```

**Renaming is the exception**: a `tsc`-backed rename is total and mechanical, so rename as
soon as an identifier stops describing its value. Every later step inherits the name.

## When NOT to refactor

Every codebase matches some smell. Every detection rule above has a non-zero false-positive
rate, so an unfiltered scan returns findings independent of code quality — **finding count is
not a quality signal.** Twenty-two smells with no threshold is a generator of unrequested
work, the trap `selection.md` names for patterns, one altitude down. **A smell is a
hypothesis, not a verdict.** It earns action only when all three gates hold, and any hard stop
overrides all three.

| Gate | Condition | Fails when |
|---|---|---|
| **Pending change** | a specific edit is named whose cost this reduces | you cannot name it — the change is speculative, the structural form of `UNI-42` |
| **Second occurrence** | the shape has cost you twice | n=1. One occurrence does not identify the axis of change, so the abstraction gets shaped to a single example |
| **Contract** | mutation-sensitive tests cover the range | they do not — characterization tests are now the task |

**Budget: one smell per change.** When the structural diff exceeds the behavioral diff you
came to land, the change is no longer the change.

| Hard stop | Why |
|---|---|
| the range has no scheduled edits | a smell has cost only when someone changes the code; you also rewrite `git blame` and conflict with in-flight branches for no payoff |
| mid-feature | interleaving makes the diff unreviewable and defeats `git bisect` — land the behavior change first |
| **the technique's inverse is also in this catalog** | Middle Man ⇄ Message Chains, Lazy Class ⇄ Large Class, Data Class ⇄ Feature Envy are **duals** — applying one produces the other. With no stated reason to prefer a side, the code oscillates between them across successive refactors |
| inside a release window | non-zero regression risk against a zero user-visible delta; defer past the cut |
| the module is scheduled for deletion or replacement | the payoff period is shorter than the work |
| generated or vendored files | regeneration reverts the change |
| a documented deliberate choice | a hand-tuned hot path with a benchmark beside it is not a smell |
| the suite cannot run locally | there is no verifiable contract, only intent |
| a characterization harness costs more than the range is worth | weigh harness cost against `edit frequency × cost per edit`. Below the line, freeze the range behind a narrow interface and stop extending it |

**The stop condition is "the pending edit is now cheap"**, not "the smell list is empty".

## Cross-refs into `dev:code-roast`

`sin-registry.md` detects; this tree remediates.

| Sin | Smell | Note |
|---|---|---|
| `UNI-01` God Class / God Function | Long Method, Large Class | the registry states no upper bound; use "no scrolling, ≤4 live locals at any cut" |
| `UNI-02` Type Switch Sprawl | Switch Statements | apply `selection.md`'s threshold — an exhaustive union match is not this |
| `UNI-03` Abstract Pretender · `UNI-04` Fat Interface | Refused Bequest, Large Class | Liskov violation and over-wide interface; not naming problems |
| `UNI-09` / `UNI-10` Strategy / Factory Overkill | Speculative Generality, Lazy Class | the over-refactored end — what ignoring the gates produces |
| `UNI-19` Boolean Parameters | Long Parameter List | Replace Parameter with Explicit Methods |
| `UNI-22` / `UNI-23` Flaky / Assertion-Free Tests | — | **blocking**: no preservation contract, therefore no refactoring |
| `UNI-41` Magic Numbers · `UNI-43` TODO Cemetery | Comments, Duplicate Code, Dead Code | Extract Variable to a named constant; delete stale TODOs |

## Attribution and scope

Technique and smell names are Martin Fowler's (*Refactoring*, 2nd ed., 2018) and are standard
terminology. **All text and code in this tree is original to this repository.** refactoring.guru
is useful further reading and is licensed CC BY-NC-ND 4.0 — read it, never copy from it into this
MIT repository. Once structure is settled, `selection.md` decides whether a pattern is warranted.
