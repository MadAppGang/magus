# Simplifying Conditional Expressions

**The group's question: is this branching a decision the domain requires, or an artifact of how
the code accreted?**

Eight techniques. Three only rename and deduplicate, one only reshapes control flow, and one —
Replace Conditional with Polymorphism — changes the type structure and is the only member whose
reversal is expensive. That asymmetry sets the order.

**Scope against the canonical group.** Fowler's 1st edition chapter 9 *Simplifying Conditional
Expressions* contains exactly these eight; none is omitted here. The 2nd edition's chapter 10
*Simplifying Conditional Logic* keeps six, **generalises Introduce Null Object into Introduce
Special Case** — a technique not on the list of eight, so it is included below as the second half
of technique 7 — and drops Consolidate Duplicate Conditional Fragments and Remove Control Flag,
reassigning their work to Slide Statements and to array methods respectively. Both are retained
here because both still occur in TypeScript written today, and the array-method answer to a
control flag is exactly what technique 6 prescribes.

Throughout: a **precondition** is a condition that must hold before a step for that step to be
valid; a **postcondition** is what is true after it; an **invariant** is what holds throughout a
region regardless of path. A **side effect** is any observable change outside the expression's own
value — a write, a network call, a log record, a mutation of an argument.

## The force

A conditional you cannot evaluate by reading it. Branch count is the symptom; the obstacle is more
specific: **one construct carries three separable concerns.** The predicate says *what is true*,
the dispatch says *which arm runs*, and each arm says *what to do*. Written as one nested
statement they must be held simultaneously. Nesting compounds it — at depth 4, the statement that
does the work is reached only by a reader who has kept four predicates on a mental stack, and it
is the statement furthest to the right.

**Length is not the symptom.** A twelve-line function nested four deep is harder to evaluate than
a forty-line flat one, and only the second trips `max-lines-per-function`. Reaching for this group
because a function is long is reaching for the wrong group; `composing-methods.md` owns length.

Two metrics measure two different problems here, and confusing them wastes the whole group.

**Cyclomatic complexity** is the number of linearly independent paths through the **control-flow
graph** (the directed graph whose nodes are basic blocks and whose edges are possible transfers of
control). For straight-line code it equals one plus the number of binary decision points, where
`if`, `&&`, `||`, `??`, `?:`, each `case`, each `catch` and each loop each count as one. ESLint's
core `complexity` rule reports it.

**Cognitive complexity** (SonarSource) counts the same structures but charges each `if` an extra
increment per level of nesting, charges each `else` a flat +1, and charges a *sequence* of like
boolean operators once rather than per operator. `sonarjs/cognitive-complexity` and Biome's
`complexity/noExcessiveCognitiveComplexity` report it.

The gap between them decides your move. `if (a) { if (b) { X } }` and `if (a && b) { X }` have
**identical cyclomatic complexity — 3 in both cases**, because both contain two decision points.
Their cognitive complexity is 3 and 2. Consolidation and guard clauses buy the second metric and
leave the first untouched; they remove nesting and duplication, not paths. **Only techniques 5 and
6 remove decision points.** Any claim that flattening a conditional "reduces complexity" has to
name which metric, or it is not checkable.

So the sequence is fixed: **name before you move, flatten before you dispatch.** Techniques 1-3
change no control flow at all. Technique 4 changes control flow but no types. Technique 5 changes
types. Reaching for 5 first is this group's characteristic error, because a conditional that
appeared to need a hierarchy routinely loses half its branches to 2, 3 and 6 before you get there.

| # | Technique | Transformation | Inverse |
|---|---|---|---|
| 1 | **Decompose Conditional** | a predicate and its arms → named functions | Inline Method (`composing-methods.md`) |
| 2 | **Consolidate Conditional Expression** | N tests sharing one outcome → one named predicate | split the predicate back apart |
| 3 | **Consolidate Duplicate Conditional Fragments** | a statement repeated in every arm → one statement outside the conditional | — |
| 4 | **Replace Nested Conditional with Guard Clauses** | a precondition stack → flat early exits | — (nesting is not a destination) |
| 5 | **Replace Conditional with Polymorphism** | dispatch on one discriminant in N modules → one record of per-variant behaviour | inline the record back into a `switch` |
| 6 | **Remove Control Flag** | a boolean encoding "where we are" → `break`/`return`, or an array method | — |
| 7 | **Introduce Null Object** (2nd ed.: Introduce Special Case) | `T \| null` plus N absence checks → a neutral `T`, or a discriminated variant | Replace Null Object with explicit null |
| 8 | **Introduce Assertion** | an invariant stated in a comment → an executable, type-narrowing check | Remove Assertion, once the type proves it |

## Order within the group

```
1  Decompose Conditional                  ─┐  name the predicate and each arm;
3  Consolidate Duplicate Fragments        ─┤  hoist what every arm repeats;
2  Consolidate Conditional Expression     ─┘  collapse the tests that share an outcome
6  Remove Control Flag                     ← delete the boolean that encodes position
4  Replace Nested Cond. with Guard Clauses ← the residual nesting is now genuinely preconditions
8  Introduce Assertion                     ← pin the invariant the guards leave implicit
7  Introduce Null Object / Special Case    ← only if the absence check recurs at 3+ call sites
5  Replace Conditional with Polymorphism   ← LAST, and only past the threshold in
                                             ../../selection.md
```

**Name in the polarity the guard will keep.** The one place that sequence inverts: a predicate
extracted at step 1 from inside nesting that step 4 is about to invert gets named twice — once as
written, once negated — and the second name is the one that survives. When you can already see
that a nested test is a precondition, convert it to a guard first and name it once. The block
above orders work over a *region*; it is not a claim that every instance of 1 precedes every
instance of 4.

**Nesting depth is this group's feedback signal**, the way arity is `composing-methods.md`'s. Run
ESLint's `max-depth` over the range before and after. If depth is still ≥3 once 1, 2, 3, 4 and 6
have been applied, the residual nesting is not control flow:

- **The predicates all read the same discriminant.** That is data-shaped dispatch. Technique 5 is a
  candidate — check the threshold in `../../selection.md` before acting, because most such cases
  want an exhaustiveness check and nothing else.
- **The predicates discriminate on a value's shape** rather than sequencing control. The branching
  wants a discriminated union (`TS-10` Missing Discriminant); `organizing-data.md` takes it from
  there.
- **The predicates are unrelated to each other.** The function is doing several jobs. Go back to
  `composing-methods.md`; this file has nothing left to offer it.

## Does TypeScript already do this

Four of the eight were manual procedures against a compiler that checked none of them. `tsc` and
the lint layer now perform, detect, or obviate parts of each. Knowing which part decides where your
attention goes.

| Technique | Automated or detected by | What remains yours |
|---|---|---|
| **Decompose Conditional** | tsserver *Extract to function* / *Extract to constant* moves the range and computes the signature | the rule's name — the tool copies the expression and never judges it; and the short-circuit precondition if you extract to a `const` rather than a function, which the tool does not check |
| **Consolidate Conditional Expression** | `no-dupe-else-if` (core ESLint) catches only literally identical conditions; `sonarjs/no-duplicated-branches`, `sonarjs/no-all-duplicated-branches`, `sonarjs/no-collapsible-if`; Biome `style/useCollapsedElseIf` | proving the predicates are side-effect free, and judging whether the outcomes are the same *fact* or two facts that happen to share a value |
| **Consolidate Duplicate Conditional Fragments** | `sonarjs/no-duplicated-branches` finds whole identical arms. **Nothing in ESLint or Biome detects a shared prefix or suffix**; a clone detector such as `jscpd` finds the pair | the hoist/sink direction, the ordering question a head hoist raises, and clearing the early-return blocker |
| **Replace Nested Conditional with Guard Clauses** | `max-depth` and `no-else-return` (ESLint) mark candidates and prevent regression; `noImplicitReturns` (tsc) catches a missing final exit; `sonarjs/cognitive-complexity` scores the result | distinguishing a precondition from a symmetric alternative, and deriving each complement. No tool can do the first — it is a statement about the domain |
| **Replace Conditional with Polymorphism** | **`@typescript-eslint/switch-exhaustiveness-check` supplies the exact guarantee this technique was bought for**, usually making it unnecessary; `--noFallthroughCasesInSwitch` closes the other hole | counting dispatch modules, and deciding whether the union is open |
| **Remove Control Flag** | `prefer-const` marks the `let`; `no-unmodified-loop-condition` flags the degenerate case; `tsc --noUnusedLocals` proves the deletion complete | proving the flag is never read as a *result*, and that no work after the exit point is required |
| **Introduce Null Object** | `strictNullChecks` makes every absence a compile error rather than a runtime one; `?.` and `??` collapse a check to one token; `@typescript-eslint/no-unnecessary-condition` finds leftovers | deciding that absence is *neutral* rather than an error — whether "absent" and "present but doing nothing" are the same fact — and finding the identity element |
| **Introduce Assertion** | **assertion signatures (`asserts x is T`, TS 3.7+)** make a runtime assertion narrow the static type, so the assertion replaces a `!` rather than accompanying it; `assertNever` makes an impossible variant a compile error | separating a program invariant from input validation |

**Two of the eight had their economics inverted by the type system.** Introduce Null Object existed
because absence was invisible to the compiler and therefore every call site had to remember;
`strictNullChecks` makes forgetting a compile error, so the technique now has to earn its keep on
duplication alone. Replace Conditional with Polymorphism existed because adding a variant silently
missed dispatch sites; an exhaustive `switch` closed by `assertNever` makes that a build failure —
**which is what polymorphism was bought for**, obtained without a hierarchy.

**`tsc` verifies none of these transforms.** It will accept a guard clause whose inverted predicate
flipped `<` into `>`, a consolidation that changed which side effect ran, a hoisted fragment that
now runs on a path it previously skipped, and a null object that turned a failed lookup into a
plausible-looking number. Types are not a preservation proof — the tests are. The mechanics below
assume a green, mutation-sensitive suite between every numbered step
(`bun test path/to/file.test.ts --watch`), per the preconditions in `../../refactoring.md`.

## Example types

Every example below uses these. The domain is industrial sensor telemetry: readings arrive from
field sensors, are validated, calibrated, and may raise alarms.

```ts
type SensorKind = "thermocouple" | "flow" | "pressure";

type Reading = {
  readonly sensorId: string;
  readonly kind: SensorKind;
  readonly value: number;    // raw, uncalibrated
  readonly takenAt: number;  // epoch ms
};

type Sensor = {
  readonly id: string;
  readonly kind: SensorKind;
  readonly minValid: number;
  readonly maxValid: number;
  readonly maintenanceUntil: number | null;  // epoch ms; null = in service
};

type Calibration = { readonly offset: number; readonly scale: number };

type IngestResult =
  | { readonly status: "accepted";   readonly value: number }
  | { readonly status: "suppressed"; readonly reason: "maintenance" }
  | { readonly status: "dropped";    readonly reason: "stale" | "out-of-range" };

type AlarmPlan = {
  readonly severity: "warn" | "critical";
  readonly notifyAfterMs: number;
};

type IngestListener = {
  batchStarted(sensorId: string): void;
  readingAccepted(sensorId: string, value: number): void;
  readingDropped(sensorId: string, reason: string): void;
  batchFinished(sensorId: string): void;
};

declare const metrics: { increment(name: string, tags: Record<string, string>): void };
declare const audit:   { append(e: { at: string; sensorId: string; outcome: string }): void };
```

`IngestResult` is a **discriminated union**: a union of object types sharing a literal-typed
property (`status`) that identifies which member a value is. TypeScript uses that property for
**type narrowing** — inside `if (r.status === "accepted")`, `r` has type
`{ status: "accepted"; value: number }` and `r.value` compiles.

---

## 1. Decompose Conditional

**Resolves:** Long Method, Comments (`SLOP-04` Narrative Comments), `UNI-41` Magic Numbers. It is
`composing-methods.md`'s Extract Method aimed at a predicate and its arms, and it inherits that
technique's preconditions.

**Force.** The `if` line states a mechanism where the reader needs a rule. `now - r.takenAt >
300_000` is arithmetic; `isStale(r, now)` is the domain concept the arithmetic implements. The
mechanism is usually short and the arms are usually long, so the reader spends attention decoding
the cheap part and skims the expensive part. A comment above the branch does not fix this: it is
checked by nothing and drifts. No test can reach the rule without going through the branch.

**Preconditions**

- Each part to be extracted satisfies Extract Method's preconditions: one exit path, at most one
  assigned variable read afterwards, and no `await` moved out of an enclosing `try`.
- **At most one variable assigned inside an arm is read after the conditional.** Two or more: run
  Split Temporary Variable and Replace Temp with Query (`composing-methods.md`) first, then return
  here.
- **Extraction target is a function, not a variable, whenever the predicate is impure or expensive.**
  Extracting to a *function* called at the original site preserves evaluation order and count
  exactly. Extracting to a `const` evaluated ahead of the branch does not — that is Extract Variable
  and it carries the short-circuit precondition (see 2).
- The predicate has a name you can state as a proposition about the domain. If the best available
  name is `condition1`, `shouldDoIt`, `isValid` or `checkSensor`, the branch is not yet understood
  and extracting it launders that (`SLOP-04` in structural form).

**Mechanics**

1. Extract the predicate into a function returning `boolean`, named for the proposition, not the
   comparison. Run tests.
2. If an operand of the predicate is itself a named rule, extract that too. Repeat until every
   operand has a name or is a bare field read.
3. Extract the then-arm. Name it for its postcondition — the result it produces or the effect it
   has. Run tests.
4. Extract the else-arm the same way. Run tests.
5. Delete the comment that the predicate's name now states. The name is compiler-checked at every
   call site; the comment was checked nowhere.
6. Search for the same predicate written out elsewhere and redirect each occurrence to the new
   function, one occurrence per test run.
7. If the extracted arms turn out to share a signature, record that — it is the precondition
   technique 5 tests for, and usually the only evidence you will get for free.

**Before**

```ts
function ingest(r: Reading, s: Sensor, now: number): IngestResult {
  if (s.maintenanceUntil !== null && s.maintenanceUntil > now) {
    metrics.increment("reading.suppressed", { sensor: s.id });
    return { status: "suppressed", reason: "maintenance" };
  }
  // a reading is stale if it is older than the five minute ingest window
  if (now - r.takenAt > 300_000) {
    metrics.increment("reading.dropped", { sensor: s.id });
    return { status: "dropped", reason: "stale" };
  }
  return { status: "accepted", value: r.value };
}
```

**After**

```ts
const STALE_AFTER_MS = 300_000;

const isUnderMaintenance = (s: Sensor, now: number): boolean =>
  s.maintenanceUntil !== null && s.maintenanceUntil > now;

const isStale = (r: Reading, now: number): boolean => now - r.takenAt > STALE_AFTER_MS;

function ingest(r: Reading, s: Sensor, now: number): IngestResult {
  if (isUnderMaintenance(s, now)) {
    metrics.increment("reading.suppressed", { sensor: s.id });
    return { status: "suppressed", reason: "maintenance" };
  }
  if (isStale(r, now)) {
    metrics.increment("reading.dropped", { sensor: s.id });
    return { status: "dropped", reason: "stale" };
  }
  return { status: "accepted", value: r.value };
}
```

The arms are deliberately left in place. They are two statements each and have no name worth
giving yet; technique 3 will take them apart on better evidence. Extracting them now would produce
`handleMaintenance` and `handleStale` — identifiers that restate the predicate and add a frame.

**Keep the arithmetic exactly as written.** `isStale` could have been `r.takenAt < now -
STALE_AFTER_MS`. That is the same rule rearranged, and rearranging is an edit to review on its own
evidence — the two forms round differently once either operand is not an exact integer, and
nothing in the test suite is aimed at that. Extraction moves an expression; algebra changes one.
Do not do both in one commit.

**Postcondition.** Every decision point in `ingest` has an identifier that appears in branch
coverage output, so an untested predicate is visible in a report rather than only in a diff.
`ingest`'s own cyclomatic complexity falls from 4 to 3 (three decision points to two).
**The module's total rises from 4 to 6**, because each new function contributes a baseline of 1.
That is the honest accounting: decomposition redistributes complexity so that per-function gates
(`complexity`, `max-lines-per-function`) pass — it does not remove paths.

| Gain | Cost |
|---|---|
| The predicate is separately testable: `isStale` takes two values and asserts a boolean, with no `metrics` double required | One function and one call frame per extraction, visible in stack traces and profiles |
| The name is compiler-checked at every call site; the comment it replaces was checked nowhere | A wrong name is a false statement with wider scope than a wrong comment |
| Reusing the same predicate elsewhere makes the rule single-sourced, so a threshold change is one edit | Module-total cyclomatic complexity rises; per-function metrics improve while the sum does not |
| The magic number acquires a name and a single definition site (`UNI-41`) | Extracting a predicate that is used once and already reads as a rule is `SLOP-03` in structural form |
| Each arm becomes reachable from a test without constructing an input that satisfies the predicate | Predicates extracted to `const` rather than to functions can defeat short-circuiting — a real bug class, see 2 |

**When NOT to use this**

- **The predicate is already a named proposition.** `if (account.isSuspended)` needs no wrapper, and
  neither does a single comparison such as `r.value < s.minValid` unless the threshold is itself the
  domain rule.
- **You cannot name the rule.** Extracting produces a callable un-understood range. Names like
  `isValid`, `checkSensor` and `shouldProcess` restate the type signature rather than the rule; the
  branch is then unnamed in two places instead of one. Find out what it means first.
- **The extraction must be a `const` and an operand can throw or is expensive.** Hoisting it out of
  `&&` evaluates it unconditionally. Extract to a function instead, called in place.
- **The arm is a single statement.** A one-line function whose name restates the predicate adds a
  frame and no information. The ternary is already the decomposed form.

---

## 2. Consolidate Conditional Expression

**Resolves:** Duplicate Code across arms, Long Method.

**Force.** Several conditionals with **identical bodies** are one rule expressed as N tests. The
code says "here are four unrelated checks"; the domain says "here is one rule with four inputs".
The reader must diff the bodies to discover they are the same, and a later edit will change one
copy — the failure is silent because nothing relates the copies.

Consolidation relies on **short-circuit evaluation**: `a || b` does not evaluate `b` when `a` is
truthy, and `a && b` does not evaluate `b` when `a` is falsy. This is what makes the transform
order- and count-preserving, and it is also the property you can accidentally destroy.

**Preconditions**

- The bodies are **identical**, not similar — identical in effect, not merely in text. Byte-identical
  after formatting is the cheap check; same captured bindings, same `this`, same argument values is
  the real one. `sonarjs/no-duplicated-branches` and `sonarjs/no-all-duplicated-branches` detect the
  textual case; `sonarjs/no-collapsible-if` detects the nested form.
- The combining operator is short-circuiting (`||`, `&&`, `??`). Sequential guards
  `if (a) return X; if (b) return X;` become `if (a || b) return X` with the same evaluation order
  and count. Nested `if (a) { if (b) …}` becomes `if (a && b)` likewise.
- **Predicate order is preserved.** Reordering operands changes which one runs when an earlier one
  short-circuits. If any predicate has a side effect or can throw, order is observable.
- **Every predicate is synchronous.** See the async note below: a `Promise<boolean>` is truthy, so
  an un-awaited predicate makes `||` select it unconditionally.
- **The combined form is not eagerly evaluated.** `[isA(x), isB(x)].some(Boolean)` evaluates both
  unconditionally and is not equivalent. `.some((f) => f(x))` over an array of functions is.
- The result is one proposition you can name.

**Mechanics**

1. Confirm the bodies are identical.
2. Confirm each predicate is pure, or that the chosen operator preserves order and count.
3. Combine: `||` for sequential tests sharing an outcome, `&&` for nested tests.
4. Run tests.
5. **Extract and name the combined predicate, and each operand that is itself a rule
   (technique 1).** Not optional — consolidation without naming trades N readable tests for one
   unreadable line, which is a net loss, and it is what restores per-rule visibility in coverage
   (see the cost table).

**Before**

```ts
function rejectReason(r: Reading, s: Sensor): string | null {
  if (r.sensorId !== s.id) return "mismatched-sensor";
  if (Number.isNaN(r.value)) return "unusable-reading";
  if (!Number.isFinite(r.value)) return "unusable-reading";
  if (r.value < s.minValid) return "unusable-reading";
  if (r.value > s.maxValid) return "unusable-reading";
  return null;
}
```

**After**

```ts
const isUnusable = (r: Reading, s: Sensor): boolean =>
  !Number.isFinite(r.value) || r.value < s.minValid || r.value > s.maxValid;

function rejectReason(r: Reading, s: Sensor): string | null {
  if (r.sensorId !== s.id) return "mismatched-sensor";
  if (isUnusable(r, s)) return "unusable-reading";
  return null;
}
```

**The `Number.isNaN` test was subsumed, and that is provable rather than assumed.**
`Number.isFinite` returns `false` for `NaN`, `Infinity` and `-Infinity` by definition, so
`Number.isNaN(v) → !Number.isFinite(v)`; the disjunction is unchanged by deleting the first
operand. Deleting a test you can prove redundant from a specification is behaviour-preserving.
Deleting one because it "looks covered" is not, and belongs in a different commit with its own
tests. Consolidation is valuable precisely because it puts redundant operands next to each other
where the subsumption becomes visible.

**The async trap sits in step 5, not in step 3.** Had one test been
`if (await isQuarantined(s.id)) return "unusable-reading";`, combining it into the `||` chain would
still be safe *if the `await` stays inside the expression*. Extracting it is what breaks: a
predicate declared `const isQuarantined = (s: Sensor) => fetchQuarantine(s.id)` returns
`Promise<boolean>`, and **every `Promise` is truthy**, so `isQuarantined(s) || …` selects the first
operand for every input and the remaining tests never run. `tsc` does not object — the operand is a
valid truthy expression — and `@typescript-eslint/no-misused-promises` is the rule that does.
Either keep the `await` visible at the combination site or do not consolidate across it.

**Postcondition.** One body where there were four; a single edit site for the reject reason.
`rejectReason`'s cyclomatic complexity falls from 6 to 3 and `isUnusable` carries 3 — the module
total is unchanged at 6, minus one for the deleted test. Cognitive complexity for the region falls
from 5 (five `if`s at nesting 0) to 3 (two `if`s plus one `||` sequence charged once).

| Gain | Cost |
|---|---|
| One outcome has one site, so it cannot half-change | The combined predicate is longer than any single test and needs a name to stay readable |
| Redundant and contradictory operands become visible by adjacency — `sonarjs/no-identical-conditions` can then see them | **Coverage granularity drops.** One `a \|\| b \|\| c` line reports as fully covered the first time any operand fires, under line-based coverage such as `bun test --coverage` |
| Extracting the operands (step 5) restores per-rule visibility as *function* coverage, so an untested rule is an uncovered function rather than a covered line | Consolidating tests that are *about to diverge* costs a re-split later |
| The extracted predicate is testable in isolation, reusable, and is a unit that Move Method (`moving-features.md`) can relocate | If an operand is impure, the transform is only safe under short-circuit; converting to an eager or async form silently changes evaluation count |

**When NOT to use this**

- **The bodies merely resemble each other.** Different reason strings, different metric names,
  different log fields: these are independent policies. Consolidating them forces a common outcome
  the domain has not agreed to.
- **The caller needs to know which test fired.** Widen the return type — `SkipReason | null` rather
  than `boolean` — and keep the branches. That is a signature change, not this technique.
- **The tests are independent policies that will diverge.** Each has its own rationale and its own
  ticket. The duplication is coincidental; consolidating creates a false coupling.
- **The tests belong to different concerns** — one authorisation, one capacity, one scheduling. One
  `||` across three concerns produces a predicate no single name fits, which step 5 will expose.
- **Any operand has a side effect and the target form evaluates eagerly**, or any operand is a
  `Promise`.
- **The combined predicate cannot be named.** That is evidence the tests are not one rule.
- **Consolidation would hide a boundary case you need to log distinctly.** Observability is part of
  the contract when an alert rule matches on it (`../../refactoring.md`).

---

## 3. Consolidate Duplicate Conditional Fragments

**Resolves:** Duplicate Code. Frequently converts an impure function into a pure one, which is the
larger win. It also clears Split Temporary Variable's precondition in `composing-methods.md`, by
turning the `let` that collected the arm results into a `const`.

**Force.** A statement appears in every arm of a conditional. It is not part of the decision — it is
sequenced around it. Its position inside the arms hides that it is unconditional, so a reader
cannot tell whether it runs always or sometimes, and must compare arms character by character to
locate the one line that actually differs. The next edit changes N-1 of the N copies: one arm's
metric gains a tag, the other does not, and nothing relates them.

**Preconditions**

- The fragment is present in **every** arm, including the implicit `else` and every `case`
  including `default`. One missing arm means moving it changes behaviour on that path.
- The fragment is identical **in effect**, not just in text: same captured bindings, same `this`,
  same argument values at each site.
- The fragment reads no binding declared inside an arm.
- Moving it does not reorder it relative to another side effect. Order and count of side effects
  are in the behaviour contract.

**The two directions are not symmetric, and the asymmetry is the whole precondition.**

- **Head fragment → hoisted above the conditional.** It now runs *before the predicate evaluates*.
  Valid only when neither the fragment nor the predicate has an effect the other can observe, **and
  the predicate cannot throw or reject.** If it can, the fragment previously did not run on that
  path and now does — an effect that appears where none existed. This is the direction people
  hoist without thinking, because the structural blocker (an early exit) is absent.
- **Tail fragment → sunk below the conditional.** Every arm must fall through to the end. One
  `return`, `throw`, `break` or `continue` in any arm and that arm never reached the fragment. This
  is the direction that usually blocks, and it blocks loudly — you can see the `return`.

**Mechanics**

1. Identify the fragment; confirm it appears in every arm and is identical in effect.
2. Head of every arm → move above the conditional, after checking the predicate is effect-free and
   cannot throw. Tail of every arm → move below, after checking every arm reaches it.
3. If arms exit early and the fragment is a tail fragment, first convert the arms to *produce a
   value* instead of returning — typically by extracting the dispatch into its own function — then
   sink the fragment into the caller.
4. A fragment in the middle of each arm is two fragments. Hoist the head half, run tests, then sink
   the tail half, run tests.
5. If each arm now assigns one variable, collapse the `if` to a `const` initialised from a
   conditional expression, and confirm `prefer-const` reports nothing.
6. Run tests after each move.

**Before**

```ts
function record(r: Reading, s: Sensor, now: number): IngestResult {
  if (isUnderMaintenance(s, now)) {
    metrics.increment("reading.suppressed", { sensor: s.id });
    audit.append({ at: new Date(now).toISOString(), sensorId: s.id, outcome: "suppressed" });
    return { status: "suppressed", reason: "maintenance" };
  }
  if (isStale(r, now)) {
    metrics.increment("reading.dropped", { sensor: s.id });
    audit.append({ at: new Date(now).toISOString(), sensorId: s.id, outcome: "dropped" });
    return { status: "dropped", reason: "stale" };
  }
  metrics.increment("reading.accepted", { sensor: s.id });
  audit.append({ at: new Date(now).toISOString(), sensorId: s.id, outcome: "accepted" });
  return { status: "accepted", value: r.value };
}
```

**After**

```ts
function classify(r: Reading, s: Sensor, now: number): IngestResult {
  if (isUnderMaintenance(s, now)) return { status: "suppressed", reason: "maintenance" };
  if (isStale(r, now)) return { status: "dropped", reason: "stale" };
  return { status: "accepted", value: r.value };
}

function record(r: Reading, s: Sensor, now: number): IngestResult {
  const result = classify(r, s, now);
  metrics.increment(`reading.${result.status}`, { sensor: s.id });
  audit.append({ at: new Date(now).toISOString(), sensorId: s.id, outcome: result.status });
  return result;
}
```

Step 3 was required: all three arms returned, so nothing could be sunk until the dispatch moved
into `classify`. The metric name is now the template literal type
`` `reading.${"accepted" | "suppressed" | "dropped"}` ``, which produces exactly the three original
strings — verifiable by hovering the expression, and by a test asserting the emitted names.

**That derivation is a real coupling and belongs in the cost column, not the gain column.**
Renaming a discriminant value now changes a metric name, and therefore a dashboard query and
possibly an alert rule. If that is unacceptable, keep an explicit map from `status` to metric name;
the fragment is still hoisted and the coupling is explicit.

### The other shape: arms that assign rather than return

When the arms assign a shared `let` instead of returning, nothing blocks sinking, both directions
open at once, and the payoff is a `const`:

```ts
const CRITICAL_MARGIN = 1.1;

function planAlarm(r: Reading, s: Sensor, now: number): AlarmPlan {
  let plan: AlarmPlan;
  if (r.value > s.maxValid * CRITICAL_MARGIN) {
    audit.append({ at: new Date(now).toISOString(), sensorId: s.id, outcome: "alarm" });
    plan = { severity: "critical", notifyAfterMs: 0 };
    metrics.increment("alarm.planned", { sensor: s.id });
  } else {
    audit.append({ at: new Date(now).toISOString(), sensorId: s.id, outcome: "alarm" });
    plan = { severity: "warn", notifyAfterMs: 15 * 60_000 };
    metrics.increment("alarm.planned", { sensor: s.id });
  }
  return plan;
}
```

becomes

```ts
function planAlarm(r: Reading, s: Sensor, now: number): AlarmPlan {
  audit.append({ at: new Date(now).toISOString(), sensorId: s.id, outcome: "alarm" });

  const plan: AlarmPlan = r.value > s.maxValid * CRITICAL_MARGIN
    ? { severity: "critical", notifyAfterMs: 0 }
    : { severity: "warn", notifyAfterMs: 15 * 60_000 };

  metrics.increment("alarm.planned", { sensor: s.id });
  return plan;
}
```

**The head hoist is safe here for a reason you can state, not because it looks safe.**
`r.value > s.maxValid * CRITICAL_MARGIN` is arithmetic over two property reads: it has no effect
and cannot throw, so moving `audit.append` above it is unobservable. Had the predicate been
`await lock.isHeld(s.id)`, the audit record would now be written *before* the lock query rather
than after — the same records in a different order, which a log-ordering assertion sees — and if
the query rejects, an audit record now exists where previously none did. Same transform, different
verdict, decided entirely by what the predicate does.

**Postcondition.** `metrics.increment` and `audit.append` each occur at exactly one site, so
changing the audit record shape is a one-line edit rather than an N-arm edit with one forgotten
copy. `classify` is **pure** — same inputs, same result, no side effects — so it is testable with
three literals and no doubles at all, which is the direct counter to `UNI-26` Mocking Everything.
In `planAlarm` the `let` is gone, cyclomatic complexity is unchanged (one `if` became one ternary),
and the range now satisfies Replace Temp with Query's precondition.

| Gain | Cost |
|---|---|
| Each side effect has one site; the "changed 2 of 3 copies" defect becomes unrepresentable | An extra function and an extra call, or a fragment that no longer sits beside the branch it accompanied |
| The arms now diff to exactly the decision, so a reviewer sees the change without re-reading shared setup | The caller now needs the result's shape to drive the effects, which can couple the effect to the discriminant |
| The decision separates from the effects, making the decision pure and testable without doubles | Applicable only when *all* arms share the fragment; partial overlap makes this invalid, not merely awkward |
| The unconditional statement now *looks* unconditional, so a reader stops checking | Hoisting a head fragment is an ordering change whenever the predicate has any effect or can throw |
| The collapse to `const` unblocks Split Temporary Variable and Replace Temp with Query downstream | Sinking requires the arms to stop returning, which is a real edit with its own risk |

**When NOT to use this**

- **Any arm omits the fragment**, or differs in a single argument, or captures a different binding.
  Not duplication. Hoisting into all arms adds executions.
- **The "fragment" is the `return` itself.** Every arm returning is the shape of a dispatch, not a
  repeated statement.
- **Sinking would move a side effect past a `throw`.** The throwing arm currently does not perform
  it; after sinking it still would not, but the ordering relative to the throw changes for the arms
  that do. Verify per arm.
- **The fragment is a `try` block or a resource acquisition.** Moving it changes which frame handles
  a rejection and when the resource is released — both observable, neither type-checked.
- **The fragment is cheap and the arms are about to be extracted anyway.** Extraction may relocate
  it for free.

---

## 4. Replace Nested Conditional with Guard Clauses

**Resolves:** `UNI-39` Callback Hell / Pyramid of Doom in its synchronous form, Long Method,
`UNI-01` God Function.

**Force.** **Nesting states precedence.** Four levels of `if` claim that each condition matters only
inside the previous one, and in a rejection cascade none of them does — the conditions are peers,
any one of which ends the function. Nesting therefore renders two structurally different things
identically. A **decision between alternatives of equal standing** deserves `if/else`: both
outcomes are normal. A **stack of preconditions**, each of which ends the function when it fails,
does not — rendering it as nesting puts the normal path at maximum indentation and forces the
reader to carry every predicate to reach it. **Nesting depth** (ESLint `max-depth`: the maximum
number of enclosing blocks) measures this directly, and cognitive complexity prices it: each `if`
costs 1 plus its nesting level.

**Preconditions**

- Each condition to be converted is a precondition **on the whole function**: when it holds, the
  function has its answer and performs no further work. The cases must be **asymmetric** — one
  normal path, the rest exits.
- The function has exactly one "normal" path. Symmetric alternatives fail this precondition and
  must stay as `if/else` or a conditional expression.
- **Early exit skips no required cleanup.** If a tail block must run on every path, wrap the body in
  `try/finally`, or use `using` / `await using` (TypeScript 5.2 explicit resource management),
  *before* converting.
- The function's declared return type admits every guard's return value, so `noImplicitReturns`
  reports a missing final exit. With an explicit annotation and `strictNullChecks`, `tsc` proves
  this — an unannotated function infers a widened union instead and proves nothing.
- Each guard's condition is the **exact logical complement** of the branch it replaces, and the
  complement is total over the value domain. See the derivation rules below.

**Deriving the complement.** `tsc` checks none of this, and getting it wrong is the group's most
common defect. Three rules cover nearly every case:

1. **De Morgan, not operator-flipping.** The complement of `a || b` is `!a && !b`; of `a && b` it is
   `!a || !b`. The connective changes. In this domain: `isInService(s, now)` is
   `s.maintenanceUntil === null || s.maintenanceUntil <= now`, and its complement is
   `s.maintenanceUntil !== null && s.maintenanceUntil > now` — which is exactly
   `isUnderMaintenance` as defined in technique 1. Flipping only the operators would have produced
   `!== null || > now`, which is true for almost every sensor.
2. **A three-valued comparator keeps equality on the side it was on.** For `cmp(a, b): -1 | 0 | 1`,
   the complement of `cmp(a, b) < 0` is `cmp(a, b) >= 0`, not `> 0`. The `0` case is the one that
   silently moves.
3. **The complement must be total over the value domain.** Negating a floating-point comparison is
   not the complement once `NaN` can reach it: neither `x < s.minValid` nor `x >= s.minValid` holds
   for `NaN`, so the guard and the original branch disagree on that input. Either establish that
   `NaN` cannot arrive — for epoch-integer fields it cannot — or keep the negation as `!(x < …)`,
   or test `Number.isNaN` explicitly.

**Mechanics**

1. Classify every condition: precondition (guard) or alternative (keep).
2. Take the outermost `if` whose `else` holds the abnormal case. Write its complement by the rules
   above, exit immediately, and unindent the remainder. Run tests.
3. Repeat inward, one level per test run.
4. Stop when the remaining body is the normal path at depth 0. Do not convert the alternatives.
5. Name any inverted predicate that is not self-evident (technique 1).
6. Set `max-depth` to the depth you reached so the state cannot regress, and confirm
   `complexity/noExcessiveCognitiveComplexity` reports nothing for the function.

**Before**

```ts
function calibratedValue(
  r: Reading, s: Sensor, cal: Calibration | null, now: number,
): number | null {
  if (r.sensorId === s.id) {
    if (!isUnderMaintenance(s, now)) {
      if (!isStale(r, now)) {
        if (cal !== null) {
          return r.value * cal.scale + cal.offset;
        } else {
          return r.value;
        }
      } else {
        return null;
      }
    } else {
      return null;
    }
  } else {
    throw new Error(`reading ${r.sensorId} routed to sensor ${s.id}`);
  }
}
```

**After**

```ts
function calibratedValue(
  r: Reading, s: Sensor, cal: Calibration | null, now: number,
): number | null {
  if (r.sensorId !== s.id) throw new Error(`reading ${r.sensorId} routed to sensor ${s.id}`);
  if (isUnderMaintenance(s, now)) return null;
  if (isStale(r, now)) return null;

  return cal === null ? r.value : r.value * cal.scale + cal.offset;
}
```

**The innermost conditional was deliberately not converted.** "Calibration present" and
"calibration absent" are both normal outcomes producing a value, so it is an alternative, not a
precondition; it stays as a conditional expression. Making that distinction is the technique —
converting it too would produce `if (cal === null) return r.value;` which reads as an error path
and is not one.

The two `return null` guards were also left unconsolidated, though technique 2's mechanical
preconditions are satisfied. They answer different questions and are the likeliest pair to diverge
(a maintenance reading may later return the last known value while a stale one still returns
nothing). Technique 2's "independent policies" exclusion governs.

**Postcondition.** `max-depth` over this function falls from 4 to 1. Cognitive complexity falls
from **14 to 4** by the SonarSource definition — before: 1 + 2 + 3 + 4 for the four nested `if`s
plus 1 for each of four `else` blocks; after: three `if`s at nesting 0 plus one ternary.
**Cyclomatic complexity is unchanged at 5 in both versions** (four decision points before, three
`if`s plus one `?:` after). The number of paths is a property of the domain rules; only deleting a
rule changes it. Anyone reporting this transform as a cyclomatic-complexity reduction has measured
something else.

| Gain | Cost |
|---|---|
| The normal path is the last statement at depth 0, where it is found by reading downward | More exit points; a debugger user sets more breakpoints to catch "which way did it go" |
| The exits are enumerated top to bottom in evaluation order, so a new rejection is one line at a known place | Genuine alternatives converted by rote produce an error-shaped branch for a normal outcome |
| Each precondition is adjacent to its consequence, so a reader verifies one rule at a time | Complements are hand-derived and `tsc` checks none of them; a wrong boundary compiles |
| `max-depth` pins the result, preventing the next edit from re-nesting | Any trailing cleanup is now skipped by every guard — `try/finally`, `using`, or nothing |
| Guards typically shrink the live-local set, unblocking Extract Method in `composing-methods.md` | A guard that must skip cleanup requires a `try/finally` first, which is its own change |

**When NOT to use this**

- **The arms are symmetric alternatives.** Two normal outcomes. Use `if/else` or `?:`. Turning one
  into a guard asserts a hierarchy the domain does not have.
- **A required tail block would be skipped** and no `finally` / `using` is in place. Convert the
  cleanup first, in its own commit.
- **The "guard" holds the bulk of the logic.** `if (rare) { 60 lines } else return;` inverted gives
  you a guard with a body, which is not a guard. Extract the 60 lines first
  (`composing-methods.md`), then convert.
- **The guards would mix failure protocols for the same class of outcome** — some `return`, some
  `throw`, some sentinel, all answering the same kind of question. That is `SLOP-06` Inconsistent
  Error Handling; pick one protocol before flattening. A thrown *invariant violation* beside a
  returned *domain outcome* is not a mixture — that is the split technique 8 draws, and
  `calibratedValue` above is deliberately built that way.
- **The guard count exceeds roughly five.** That is not a function with preconditions, it is
  unvalidated input reaching business logic wearing an operation's name. Move the checks into a
  parse function at the boundary that returns a proven type; the business function then has no
  guards at all.
- **A codebase convention enforces single exit** with `consistent-return` configured that way.
  Argue the convention on its merits separately; do not violate it silently in a refactoring
  commit.

---

## 5. Replace Conditional with Polymorphism

**Resolves:** `UNI-02` Type Switch Sprawl — **in its Shotgun Surgery form only.** Over-applied, it
produces `UNI-09` Strategy Overkill and `UNI-10` Factory Overkill, which is why the preconditions
below are countable rather than advisory.

**Read this before the mechanics.** The cost of a `switch` is not the `switch`. It is that adding a
variant requires *finding* every site that dispatches on the discriminant, with nothing to tell you
when you have found them all. In 1999 the language offered no help, so moving the arms into
subclasses — where the compiler demands an implementation per variant — was the available answer.

TypeScript already solves the finding problem. An **exhaustiveness check** — a `default` branch
passing the discriminant to a function taking `never` — makes the compiler prove that every variant
is handled:

```ts
const assertNever = (x: never): never => {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
};
```

Add a member to `SensorKind` and every such `switch` fails to compile, naming its file and line.
**That is precisely the guarantee polymorphism was bought for**, obtained with no hierarchy. A class
hierarchy does not strictly dominate it: adding a subclass that omits an override is a compile error
only where the base member is `abstract`, and any `instanceof` chain elsewhere in the codebase
continues to compile and fails at runtime. On the axis that motivates this technique, the switch is
**stronger** than the hierarchy.

**Two compiler mechanisms, not one, and they cover different switch shapes.** A *value-returning*
switch over a union is already checked without `assertNever`: with `strictNullChecks` and a declared
return type of `number`, a non-exhaustive switch fails with **TS2366**, *Function lacks ending
return statement and return type does not include 'undefined'*. `assertNever` is what you need for
*statement* switches, which have no return for the compiler to catch, and it is the form that names
the offending variant in the message. `--noFallthroughCasesInSwitch` closes the remaining hole.

So `TS-07` Discriminated Union Without Exhaustiveness names the actual defect: the *absence* of the
check, not the presence of the switch. **A single exhaustive `switch` closed by `assertNever` is
not a smell and this technique does not apply to it.** `../../refactoring.md`'s paradigm-fit table
states the same conclusion from the smell side.

**Force, stated as the condition that actually warrants the change.** The same discriminant is
switched on **across 3 or more modules**, each dispatch enumerates the same variant set, and the
variants own state or dependencies that each arm currently reconstructs. Then the cost is not
missed sites — the compiler finds those — it is that adding a variant means N edits in N files
owned by N reviewers, and that per-variant knowledge is scattered across those files instead of
being expressible in one place.

**Preconditions** — all five, checkable

1. **Dispatch-module count ≥ 3.** Count them, do not estimate:
   `rg -l 'switch \(\w+\.kind\)|\.kind === "' src | wc -l`. Below 3, `assertNever` is sufficient and
   cheaper; `../../selection.md` sets 1-2 branches as "keep the switch" and 3-4 as judgement.
2. **The variant set is open.** New variants arrive on a schedule, or are contributed by other
   teams or plugins. `../../selection.md`: *"any count, extended by other teams — extract
   immediately"*, and conversely a genuinely closed set (three sensor kinds fixed by the installed
   hardware) is correctly served by a switch at any size.
3. **The arms share a shape.** Same parameters, same return type, at every dispatch site. If they
   do not, the dispatches are unrelated and merging them yields an over-wide interface — `UNI-04`
   Fat Interface, which the group's remedy is to split, not create.
4. **The arms are behaviourally independent.** Arms that share most of their body and differ in one
   step are Form Template Method (`dealing-with-generalization.md`,
   `../../patterns/template-method.md`), not this.
5. **The pending edit is not already cheap.** Add `assertNever` to every existing switch, then add
   the new variant. If the build now names every site that must change and each change is local,
   the gate in `../../refactoring.md` fails and you stop here.

**Mechanics**

1. Run precondition 5 first. It resolves most cases without this technique.
2. Define one record mapping each discriminant value to per-variant data or behaviour, typed
   `Record<Kind, T>`. **The index signature is the enforcement**: a missing key is a compile error
   naming the key. An `instanceof` chain or a `Map` with a `get` returning `T | undefined` is not.
3. Move one variant's arms from every dispatch site into its record entry. Run tests.
4. Repeat per variant, one test run each.
5. Replace each dispatch site with a record lookup, one module per test run.
6. Delete the switches and the `assertNever` helpers they leave behind. Re-run the command from
   precondition 1 and confirm the count fell to 1.

**Before** — three modules, each enumerating `SensorKind`:

```ts
// ingest/units.ts
function unitFor(kind: SensorKind): string {
  switch (kind) {
    case "thermocouple": return "degC";
    case "flow":         return "l/min";
    case "pressure":     return "kPa";
    default:             return assertNever(kind);
  }
}

// report/format.ts
function decimalsFor(kind: SensorKind): number {
  switch (kind) {
    case "thermocouple": return 1;
    case "flow":         return 2;
    case "pressure":     return 0;
    default:             return assertNever(kind);
  }
}

// alerting/defaults.ts
function defaultAlarm(kind: SensorKind): { high: number; low: number } {
  switch (kind) {
    case "thermocouple": return { high: 260, low: -40 };
    case "flow":         return { high: 90, low: 0 };
    case "pressure":     return { high: 900, low: 5 };
    default:             return assertNever(kind);
  }
}
```

**After**

```ts
// sensors/profiles.ts — the single site that enumerates SensorKind
type SensorProfile = {
  readonly unit: string;
  readonly decimals: number;
  readonly defaultAlarm: { readonly high: number; readonly low: number };
};

export const SENSOR_PROFILES: Record<SensorKind, SensorProfile> = {
  thermocouple: { unit: "degC",  decimals: 1, defaultAlarm: { high: 260, low: -40 } },
  flow:         { unit: "l/min", decimals: 2, defaultAlarm: { high: 90,  low: 0 } },
  pressure:     { unit: "kPa",   decimals: 0, defaultAlarm: { high: 900, low: 5 } },
};

// call sites
SENSOR_PROFILES[r.kind].unit;
SENSOR_PROFILES[r.kind].decimals;
```

Adding `"humidity"` to `SensorKind` now produces **exactly one** error — **TS2741**, *Property
'humidity' is missing in type … but required in type 'Record<SensorKind, SensorProfile>'* — at the
object literal, listing the three properties that must be supplied. Three edit sites in three
modules became one, and the compiler still enumerates the obligation.

**Be honest about what changed.** The switch form was never unsafe: `assertNever` already made the
missing variant a compile error in all three modules. What it was, was **expensive** — three
coordinated edits per variant, in three files, by whoever remembered all three. This transformation
trades N edits for one. That is the entire gain, and it only becomes a gain once N ≥ 3.

**This is deliberately not a class hierarchy.** In TypeScript the record-of-behaviour form gives the
same closure property with less machinery; `../../selection.md`'s "check the language first" table
makes the same call for Strategy. Where the per-variant behaviour is a function rather than data,
the record holds functions:

```ts
type Converter = (raw: number) => number;
const CONVERTERS: Record<SensorKind, Converter> = {
  thermocouple: (raw) => raw,
  flow:         (raw) => raw * 60,
  pressure:     (raw) => raw / 1000,
};
```

Reach for classes only when a variant needs its own identity, mutable state, or several methods
that must be swapped together and injected as a unit — `../../patterns/strategy.md`, and
`../../patterns/state.md` when the variant also determines transitions.

**Postcondition.** The number of modules enumerating the discriminant is 1, verifiable by re-running
the precondition-1 command. Adding a variant is one compile error at one location. The dispatch
sites lose their decision points: each former `switch` of N arms had cyclomatic complexity N+1 and
is now a property access with complexity 1. Exhaustiveness is still compiler-enforced, now by
`Record` key completeness rather than by `assertNever`, and no call site changed shape — the diff
is confined to the record and the thin accessors.

| Gain | Cost |
|---|---|
| Per-variant knowledge is co-located, so adding a variant is one edit reviewed by one owner | **The transposition is total.** Adding an *operation* now edits every variant entry instead of one switch |
| A missing variant is a compile error naming the missing key, not a runtime `undefined` | An indirection between the call site and the behaviour: reading one variant's code requires opening the registry |
| The registry shows the whole variant matrix at once — every behaviour × every variant, on one screen | Arms with genuinely different signatures do not fit one record type and get forced into optional members (`UNI-04`) |
| The dispatch sites become straight-line code | Over-applied below the threshold it is `UNI-09`/`UNI-10` — indirection with one implementation |
| The registry is a natural seam for tests, for per-variant configuration, and for a Strategy to attach to later | Per-variant *state* pushes you to classes, and classes give up the compile-time exhaustiveness you came here for |

That first cost is the **Expression Problem**: a design can make it cheap to add variants *or*
cheap to add operations, not both without extra machinery. A `switch` groups by operation and is
cheap to extend with operations; this technique groups by variant and is cheap to extend with
variants. **Choose the axis that actually changes**, measured from `git log`, not the one that feels
more object-oriented.

**When NOT to use this**

- **A single exhaustive `switch` closed by `assertNever`.** Not a smell. `TS-07` is the missing
  check, and adding it is the entire fix. Extracting a record here adds a file and removes nothing.
- **The variant set is closed.** Fixed by hardware, by a standard, or by a specification.
  `../../selection.md`: a switch is correct at any size for a closed set, and exhaustiveness
  checking makes it safer than a hierarchy.
- **Operations change more often than variants.** The technique inverts your costs. `git log` on the
  dispatching files answers this in one command.
- **Fewer than three dispatch modules**, unless external code contributes the variants — in which
  case the count is irrelevant and you extract immediately.
- **The arms share most of their body and differ in one step.** That is Form Template Method
  (`../../patterns/template-method.md`); check `../../selection.md`'s threshold before adopting it.
- **The arms differ in *when* they run rather than *what* they do.** That is State
  (`../../patterns/state.md`), and the transition table is the thing to model.
- **The "polymorphism" would be an `instanceof` chain.** Same conditional, worse tooling: TypeScript
  checks nothing about its completeness.
- **The dispatch is on a value that is not a type discriminant** — an HTTP status, a locale, a
  currency. A lookup table is the answer, and it needs no types-and-hierarchies discussion.
- **The discriminant is an unconstrained `string`** arriving from a wire payload. Parse it into a
  union at the boundary first — that is Primitive Obsession and `TS-10`, and it routes to
  `organizing-data.md`. Dispatching on an unvalidated string moves the bug rather than fixing it,
  and the record's index signature then enforces nothing.

---

## 6. Remove Control Flag

**Resolves:** Long Method, `UNI-39`. Unblocks Extract Method in `composing-methods.md`, because a
control flag is by construction a live local assigned in one range and read in another.

**Force.** A boolean local whose value encodes *where in the algorithm we are*. It exists because
the loop or branch chain cannot exit at the point the answer is known, and it **splits one decision
into two events**: the write, where the rule is decided, and the read, where it takes effect,
separated by arbitrary distance so that neither site states the rule. The exit condition becomes
non-local — to know when the loop stops, the reader must find every write — the loop keeps running
after the answer is known, so the reader must also prove the remaining iterations do nothing, and
the flag raises the arity of every extraction across it.

**Preconditions**

- The flag is read **only** to decide control flow: a loop condition or a branch guard. It is never
  returned, logged, or otherwise observed. If it is part of the result, it is a value, not a flag,
  and the fix is to return the value directly.
- Each write establishes a condition under which no subsequent iteration or branch can change the
  answer. If work must continue after the write, it is an accumulator.
- Exiting early skips no required side effect. Check the loop body after the write point and any
  code after the loop; trailing teardown statements must become `finally` first.
- The replacement preserves the return type exactly, or the type change is taken deliberately —
  `Array.prototype.find` returns `T | undefined`, not `T | null`, and that is a signature change.
- **For the array-method form, the predicate is synchronous.** `Array.prototype.find` does not
  await its callback, and every `Promise` is truthy, so an `async` predicate makes the *first*
  element match unconditionally. `some`, `every` and `filter` fail the same way. Async iteration
  keeps `for await … break`.

**Mechanics**

1. Locate every write and every read of the flag; `prefer-const` gives you the candidate `let`s.
2. Confirm nothing after the last write depends on continuing, and that no read uses the flag as a
   result.
3. Replace write-then-continue with `break`, `return` or `throw` at the write site.
4. Delete the declaration; `tsc --noUnusedLocals` proves nothing still reads it.
5. **If the loop is a search, a membership test, or a fold, replace it with the array method it was
   imitating.** A control flag over a loop is almost always a hand-written `find`, `some` or
   `every`. Extract the predicate first, then substitute the method.
6. Verify the count change: the flagged loop typically visited every element; `find` and `some`
   stop at the first match. Unobservable for an array of plain records; observable if the elements
   are accessors, the array is a `Proxy`, or the predicate has a side effect.

**Before**

```ts
function firstAlarm(readings: readonly Reading[], s: Sensor): Reading | null {
  let found = false;
  let hit: Reading | null = null;
  for (const r of readings) {
    if (!found) {
      if (r.value > s.maxValid) {
        hit = r;
        found = true;
      }
    }
  }
  return hit;
}
```

**After**

```ts
const firstAlarm = (readings: readonly Reading[], s: Sensor): Reading | null =>
  readings.find((r) => r.value > s.maxValid) ?? null;
```

**The `?? null` is load-bearing.** `find` returns `undefined` when nothing matches; the original
returned `null`. Without the coalesce the return type becomes `Reading | undefined`, which is a
signature change — `tsc` will find every call site, but a caller doing `x === null` still compiles
under a widened parameter type and silently stops matching. Preserve the contract here; change it
in a separate commit if you want to.

**Two counts to check, not assume.** The predicate `r.value > s.maxValid` ran on every element
before *and* runs on every element up to the first match after — the original's `if (!found)` guard
already stopped it evaluating past the hit, so the *predicate* count is unchanged. What changes is
the **iteration** count: the original walked the whole array doing nothing, `find` returns at the
match. For a plain array of records that is unobservable; for a `Proxy` or an array of accessors it
is not.

**Postcondition.** No local's value is required to interpret the loop, and the exit occurs at the
point where the answer is known. Cyclomatic complexity falls from 4 (three decision points: `for`,
`if`, `if`) to 2 — this is one of the two techniques in the group that genuinely removes decision
points. `prefer-const` and `--noUnusedLocals` report nothing, and the rule that lived across two
statements is now one expression a test can call with a single `Reading`.

| Gain | Cost |
|---|---|
| The exit condition is local: it sits at the write site instead of being reconstructed from N writes | Multiple exits from a loop, if your codebase's convention resists that |
| Removes two live locals, so extractions across the loop drop to arity 0-1 | The array-method form changes iteration count; verify against accessors, proxies, and impure predicates |
| Cyclomatic complexity falls for real | `find`'s `undefined` versus a hand-rolled `null` is a genuine contract difference that `??` must absorb |
| Array methods carry their own postcondition in the name, so no comment is needed | **No array method has an async form.** Converting an `await`-ing loop to `find`/`some` is a defect, not a refactoring — the first element always matches |
| The extracted predicate is independently testable and reusable | Very large arrays: `find` allocates a closure per call — measure before caring (`UNI-42`) |

**When NOT to use this**

- **The flag is part of the result.** `hasErrors` returned to the caller is a value; there is no
  flag to remove, only a misplaced return.
- **The loop must complete for a side effect** — collecting every failure, emitting a metric per
  element. That is an accumulator; if it is collecting, collect into an array and drop the boolean.
- **`break` would skip required cleanup** with no `finally` in place.
- **The iteration is asynchronous.** `for await (const r of pages) { if (await isAlarming(r)) break; }`
  is the correct form and no array method replaces it.
- **Nested loops share one exit.** A labelled `break` states the intent more directly than
  extracting both loops into a function so that a single `return` can serve.
- **The flag has more than two meaningful states**, or a second flag encodes a combination. That is
  a state variable, not a control flag: model it as a discriminated union (`TS-10` Missing
  Discriminant) or, if transitions matter, `../../patterns/state.md`.
- **The loop's early exit is already correct** and the flag only exists to satisfy a single-exit
  style rule. Then the flag is the convention's cost, and the convention is what to argue about.

---

## 7. Introduce Null Object (2nd ed.: Introduce Special Case)

**Resolves:** repeated absence checks at 3+ call sites; `TS-03` Non-Null Assertion Overuse where the
`!` covers an absence the design never decided about.

**Read the paradigm note first.** In a language without non-nullable types, every call site must
remember to check, forgetting is invisible to the compiler, and the check is duplicated everywhere —
so a Null Object (an instance with the same interface and neutral behaviour) pays for itself
immediately. TypeScript with `strictNullChecks` removes the invisibility entirely: `Calibration |
null` cannot be dereferenced without narrowing, and `tsc` names every site that fails to. `?.` and
`??` reduce a check to one token, and `@typescript-eslint/prefer-optional-chain` and
`prefer-nullish-coalescing` will do the rewrite for you. **A null object deletes a
compiler-enforced obligation.** That is this technique's cost, not a footnote to it.

**So the TypeScript default is: keep the union, narrow once, and use `??` with a named default.**
This technique earns its place only when the absent case has *behaviour* — when `?? DEFAULT` at each
site would still be followed by more conditional logic — or when the same neutral decision is being
re-made at three or more sites.

**Preconditions**

- The same absence check appears at **≥3 call sites**, and every one of them does the same thing on
  absence. Enumerate with `rg 'cal === null|cal \?\?'` or by temporarily removing `| null` from the
  producer's return type and reading `tsc`'s error list. Below 3, `??` at the site is cheaper —
  `../../selection.md`'s second-occurrence gate.
- **A neutral value exists and is an identity element** for every operation in the interface: an
  input that leaves the result unchanged, for every input. If you cannot name it, the case is not
  neutral and you would be hiding a decision.
- The interface is **totally implementable** by the neutral value: every member has a defined,
  non-throwing answer. If any member must throw, or must return a domain value with no identity —
  a price, an identifier, a policy decision — this is `UNI-03` Abstract Pretender / Refused Bequest
  wearing a null object's clothes. Stop.
- **No member carries a required side effect.** A no-op that silently swallows an audit write is a
  defect, not a default.
- **No call site needs to distinguish "absent" from "present and doing nothing."** If one does, the
  null object erases information the type was carrying.
- The neutral value is **immutable and shared safely**. A mutable singleton is a cross-call-site
  defect waiting to happen.
- **Absence is not an error.** If a missing record indicates a bug or a failed lookup, a null object
  converts a diagnosable failure into a plausible wrong number.

**Mechanics**

1. Enumerate the absence checks.
2. Define the neutral value as a `const` of the same type, named for its **behaviour**, not for its
   absence: `IDENTITY_CALIBRATION`, never `NULL_CALIBRATION`.
3. Change the producer to return the neutral value instead of `null` — or make it the parameter
   default — narrowing the type from `Calibration | null` to `Calibration`.
4. Delete the checks, one per test run. Turn on `@typescript-eslint/no-unnecessary-condition`: it
   reports every check that is now provably always-true, and reaching zero reports is the
   completion signal.
5. Confirm `tsc` reports no site still passing `null` or `undefined`.
6. Run tests. Add one asserting the neutral path produces the unchanged value.

**Before**

```ts
const calibrationFor = (id: string): Calibration | null => CALIBRATIONS.get(id) ?? null;

// site 1
const cal = calibrationFor(s.id);
const value = cal === null ? r.value : r.value * cal.scale + cal.offset;

// sites 2 and 3 repeat the same ternary with different variable names
```

**After**

```ts
const IDENTITY_CALIBRATION: Calibration = { offset: 0, scale: 1 };

const calibrationFor = (id: string): Calibration =>
  CALIBRATIONS.get(id) ?? IDENTITY_CALIBRATION;

const applyCalibration = (c: Calibration, raw: number): number => raw * c.scale + c.offset;

// every site
const value = applyCalibration(calibrationFor(s.id), r.value);
```

This is correct because `{ offset: 0, scale: 1 }` is the **identity element** of the calibration
operation: `raw * 1 + 0 === raw`. That algebraic fact is the precondition, and it is checkable.

**It is not quite total, and the exception is the kind you must look for.** For `raw = -0`,
`-0 * 1` is `-0` and `-0 + 0` is `+0` under IEEE-754, so the neutral value maps `-0` to `+0`. If
signed zero is observable in this domain — it is not, for a thermocouple reading — the identity does
not hold and the precondition fails. Finding out which is the work this technique demands.

### The easiest case to verify: an interface whose members all return `void`

When every member returns nothing, "does nothing" is trivially total, and the precondition needs no
algebra:

```ts
const SILENT_LISTENER: IngestListener = {
  batchStarted() {},
  readingAccepted() {},
  readingDropped() {},
  batchFinished() {},
};

function ingestBatch(
  rs: readonly Reading[], s: Sensor, now: number,
  listener: IngestListener = SILENT_LISTENER,
): void {
  listener.batchStarted(s.id);
  for (const r of rs) {
    const result = record(r, s, now);
    if (result.status === "accepted") listener.readingAccepted(s.id, result.value);
    else listener.readingDropped(s.id, result.reason);
  }
  listener.batchFinished(s.id);
}
```

Progress reporting is the case that qualifies: every member returns `void`, doing nothing is
correct for all four, and no caller distinguishes "no listener" from "a listener that ignores
everything". **Swap `IngestListener` for the audit log and the identical shape becomes a compliance
defect** — the records stop being written and nothing reports an error. `void` return type is
necessary for this form and nowhere near sufficient; the "no required side effect" precondition is
what separates the two cases, and only the domain can answer it.

### The 2nd edition's generalisation: Introduce Special Case

Fowler's 2nd edition replaces Introduce Null Object with the broader **Introduce Special Case**: the
exceptional case need not be absence, and it may carry data — "decommissioned sensor", "unknown
id", "awaiting first reading". In TypeScript the mechanism is a **discriminated union variant, not a
subclass**:

```ts
type SensorLookup =
  | { readonly kind: "known";          readonly sensor: Sensor }
  | { readonly kind: "decommissioned"; readonly retiredAt: number }
  | { readonly kind: "unknown";        readonly id: string };
```

This is **strictly stronger than a null object** and strictly different in intent. A null object is
designed to be *indistinguishable* from a real one, so consumers cannot behave differently. A
special-case variant is designed to be *distinguishable*, and exhaustiveness checking forces every
consumer to handle it — it keeps the compiler-enforced obligation the null object deletes. Choose by
that question alone: must consumers treat this case differently? If yes, use the union. If they
must not, use the null object.

**Postcondition.** The `| null` is gone from the producer's type, so `tsc` proves no site can check
and no site can forget. `no-unnecessary-condition` reports zero absence checks in the range. The
default lives at exactly one site — a constant, or the parameter default in the signature, where a
reader looks first — and can be changed there.

| Gain | Cost |
|---|---|
| The absence decision is made once, in the producer, rather than re-decided at each site | **Absence becomes silent.** A failed lookup that should have been an error now produces a plausible number or missing output, and the defect surfaces far from its cause |
| The type narrows, so downstream code loses a whole class of narrowing boilerplate | The compiler no longer forces any caller to think about absence — that obligation was doing work |
| Adding a member to the interface fails to compile *at the null object*, so the no-op stays complete | One more implementation of the interface to keep in step, for zero behaviour |
| `no-unnecessary-condition` gives a mechanical completion signal | If a later member has no neutral answer, the null object becomes a Refused Bequest and must be unwound |
| The special-case union form makes each exceptional case compiler-enforced at every consumer | The union form pushes a branch to every consumer — which is the point, and is a real cost when there are many |

**When NOT to use this**

- **Fewer than three sites**, or the sites disagree about what absence means. Use `??` per site.
- **Absence is an error.** This is the dominant failure mode of the technique. Emit a `Result`, a
  thrown error, or the special-case variant — anything a consumer must acknowledge.
- **Any member must return a domain value with no identity element.** A no-op that has to invent a
  number invents a wrong one somewhere.
- **The behaviour is required.** Audit logs, billing events, security decisions. Absence must fail
  loudly, not proceed quietly.
- **No identity element exists.** If "no calibration" means "reject the reading" here and "pass
  through" there, there is no neutral value and the disagreement is the actual finding.
- **Any interface member cannot be implemented totally** by the neutral value (`UNI-03`).
- **The neutral value is mutable, or call sites compare against it with `===`.** The second is the
  absence check re-introduced under another name, and it is now unchecked by the type system.
- **You would need to log "used the default".** That telemetry is an admission that consumers do
  care — use the special-case variant.

---

## 8. Introduce Assertion

**Resolves:** invariants stated only in comments (`SLOP-04`); `TS-03`, where `!` tells the compiler
something nothing verifies; silent `NaN`/`Infinity` results from unstated numeric preconditions.

**Force.** A section of code is correct only if some condition holds, and that condition is written
nowhere executable. The reader cannot distinguish "this cannot happen" from "we did not think about
this", and when it does happen, the failure surfaces at a distance from its cause — as a wrong
number in a report rather than a stack trace at the point of violation.

**The distinction that governs everything below.** An **assertion** documents a *programmer error*:
a condition that a correct program cannot violate, whose violation is a bug in this codebase.
**Validation** handles *input*: a condition a correct program can legitimately receive as false and
must answer for.

| | Assertion | Validation |
|---|---|---|
| Detects | a broken internal invariant | bad input from outside |
| Triggered by | a bug, always | a user, a peer service, a file, a queue |
| Belongs | inside the module, past the trust boundary | at the boundary, once — parse, then operate |
| Correct response | fail, with the invariant and the offending values in the message | a typed error the caller handles (`UNI-20` Inconsistent Error Codes) |
| Removable from a build | only behind a build-time constant a bundler can dead-code-eliminate; **nothing strips it by default** | never |

Asserting on external input converts a legitimate 4xx into a 500 (`UNI-20`). Validating a
programmer error hides a bug behind a fallback, which is the shape `SLOP-06` Inconsistent Error
Handling detects. Assertions are for the first case only.

**Preconditions**

- The condition is a **program invariant**, not a property of external input. The test: could a
  well-behaved caller passing well-formed data make it false? If yes, it is validation and belongs
  at a boundary.
- The check is **side-effect free and cheap on every call**. There is no `-ea` switch here:
  `node:assert` is not compiled out, and neither Bun nor `tsc` strips assertions. Two consequences.
  An O(n) invariant check on a hot path is a permanent cost unless you gate it behind a build-time
  constant a bundler can eliminate — and the moment you do, a side-effecting assertion such as
  `assert(queue.shift() !== undefined)` changes behaviour in the gated build only, which is the
  worst place for a defect to live.
- **Removing the assertion changes the behaviour of no currently-passing case.** If it does, it is a
  new precondition and therefore a behaviour change, not a refactoring
  (`../../refactoring.md`'s contract).
- Failure is unrecoverable at this level. If a caller could sensibly handle it, return a typed
  result instead.
- The invariant is not already guaranteed by the type. `@typescript-eslint/no-unnecessary-condition`
  flags provably-always-true checks; adding one is `SLOP-03` Over-Engineered One-Liners.

**Mechanics**

1. State the invariant as a boolean expression over values in scope — start from the comment or the
   `!` that currently stands in for it.
2. Write it as an **assertion function with an assertion signature**, not a bare `if (…) throw`, so
   the compiler narrows on it:

   ```ts
   function assertDefined<T>(v: T | undefined, what: string): asserts v is T {
     if (v === undefined) throw new Error(`invariant violated: ${what}`);
   }
   ```

   `asserts v is T` (TypeScript 3.7+) means every statement after the call sees `v` as `T`. The
   assertion **replaces** a `!` rather than accompanying it — that narrowing is the whole difference
   between this and a thrown guard, which changes control flow and nothing else. **Declare it with
   `function`, not as an arrow assigned to an untyped `const`** — TypeScript requires the call
   target to have an explicit type annotation, and violating this yields `ts(2775)`: *"Assertions
   require every name in the call target to be declared with an explicit type annotation."*
3. Place the assertion where the invariant becomes true, not where it is first relied on. The gap
   between those two points is where the bug lives. Within a function, that is after the guard
   clauses and before the work.
4. Put the offending value in the message. `"invariant violated"` with no value costs a debugging
   session; the value usually ends it.
5. Delete the comment and every `!` the narrowing made redundant. Run tests.
6. For an unreachable variant of a discriminated union, use `assertNever` (defined in technique 5) —
   it fails at compile time as well as run time.
7. Add a test that violates the invariant and asserts the message, so the new throw path is covered
   rather than being an unexercised branch (`UNI-23` Assertion-Free Tests, in its inverse form).

**Before**

```ts
function trendPerMinute(window: readonly Reading[]): number {
  // callers only ever pass a window of at least two readings, oldest first
  const first = window[0]!;
  const last = window.at(-1)!;
  return ((last.value - first.value) / (last.takenAt - first.takenAt)) * 60_000;
}
```

Three defects, none of which `tsc` will report. The `!` asserts to the compiler what nothing checks
(`TS-03`). The comment states the invariant where nothing enforces it (`SLOP-04`). And with a
single-element window, `last.takenAt - first.takenAt` is `0`, so the function returns `NaN` (for a
zero numerator) or `±Infinity` — a value that flows into a report and is discovered days later.

**After**

```ts
function assertDefined<T>(v: T | undefined, what: string): asserts v is T {
  if (v === undefined) throw new Error(`invariant violated: ${what}`);
}

function trendPerMinute(window: readonly Reading[]): number {
  const first = window[0];
  const last = window.at(-1);
  assertDefined(first, "trendPerMinute: empty window");
  assertDefined(last, "trendPerMinute: empty window");

  const spanMs = last.takenAt - first.takenAt;
  if (spanMs <= 0) {
    throw new Error(
      `trendPerMinute: window spans ${spanMs}ms (${window.length} readings); needs a positive span`,
    );
  }
  return ((last.value - first.value) / spanMs) * 60_000;
}
```

`window[0]` has type `Reading | undefined` under `noUncheckedIndexedAccess`, and `window.at(-1)` has
that type unconditionally. After the two `assertDefined` calls both are `Reading` — **no `!` remains
anywhere**, and the narrowing is backed by a runtime check rather than by an assertion to the
compiler. The `spanMs <= 0` check covers both the single-reading case and out-of-order input, and
replaces a silent `Infinity` with a message naming the span and the count.

### The stronger form: assert into a named type

When the invariant is about a *property* rather than a local, narrow to an intersection type and the
proof becomes reusable — neighbouring signatures can then demand it, and those functions need no
check at all:

```ts
type Scheduled = Sensor & { readonly maintenanceUntil: number };

function assertScheduled(s: Sensor): asserts s is Scheduled {
  if (s.maintenanceUntil === null) {
    throw new Error(`invariant violated: sensor ${s.id} reached the maintenance report with no window`);
  }
}

// downstream, the check is gone entirely — the type carries it
const maintenanceEndsAt = (s: Scheduled): number => s.maintenanceUntil;
```

This is the migration path out of the technique: each signature that accepts `Scheduled` instead of
`Sensor` moves one runtime check to compile time, until the assertion survives at exactly one
place — the boundary where the fact is first established.

**Postcondition.** Every invariant the function depends on is executable, named, and fails at the
point of violation with the offending value in the message. Non-null assertions in the range: zero,
verifiable with `@typescript-eslint/no-non-null-assertion`. The previously-reachable `Infinity`
output is unreachable.

| Gain | Cost |
|---|---|
| The failure moves from the point of *consequence* to the point of *violation*, which is where the fix is | A new throw path that some caller must be prepared for; if none is, the assertion has changed how the process fails |
| Assertion signatures convert the check into static narrowing, deleting `!` rather than annotating it | Runtime cost is permanent — no build step strips it, unlike Java's `-ea` |
| The invariant becomes reviewable and greppable instead of living in a comment | Over-assertion turns internal design decisions into a public failure mode, and each one is then hard to remove |
| A narrowed type such as `Scheduled` lets neighbouring signatures demand the invariant at compile time | One more type and one more function per invariant |
| `assertNever` makes an impossible union variant a compile error as well as a runtime one | An assertion on external input converts a 400 into a 500 (`UNI-20`) — the technique's dominant misuse |

**When NOT to use this**

- **The condition is about external input** — a request body, a file, a message from a queue. That
  is validation, it belongs at the boundary, and it should return a typed error rather than throw.
- **The type system can make the state unrepresentable.** A parse function returning
  `{ first: Reading; last: Reading }` proves the invariant once and carries the proof in the type;
  an assertion re-checks it at every entry point. Prefer the type whenever the invariant is
  structural. **The best assertion is the one you can delete because the type now proves it.**
- **The invariant is already guaranteed.** `no-unnecessary-condition` flags it; adding the check is
  `SLOP-03`, and it will rot into a false comment.
- **The condition has a side effect.** Non-negotiable: the assertion is then load-bearing and can
  never be gated out or deleted.
- **You want control flow.** Throwing where the contract is a typed result is `UNI-20`; return the
  error.
- **The check is expensive and sits on a measured hot path** (`UNI-42` Premature Optimization cuts
  both ways — measure before removing it too).
- **The assertion would change the behaviour of a currently-passing case.** Then it is a new
  precondition. Ship it as a behaviour change with its own tests and release note.

---

## Group failure modes

| Failure | Detection | Correction |
|---|---|---|
| **Boundary flip** | the diff contains a changed comparison operator inside a refactoring commit; a mutation test at the boundary value passes when it should fail | negate mechanically: the negation of `a < b` is `!(a < b)`, **not** `a > b`, and the complement of `a \|\| b` is `!a && !b`, not `!a \|\| !b`. Under IEEE-754 the operator flip also breaks totality: if either operand is `NaN`, `!(a < b)` is `true` while `a >= b` is `false`. For any float-valued predicate, keep the `!` or prove neither operand can be `NaN` |
| **Predicate laundering** | the extracted predicate is named `isValid`, `checkSensor`, `shouldProcess` — names that restate the signature | the rule is still unnamed, now in two places. Find what the branch decides, or revert the extraction; the smell is unresolved either way |
| **Guard-clause inflation** | exit count exceeds the number of genuine preconditions; symmetric alternatives rendered as guard-plus-tail so a normal outcome reads as an error path | revert the symmetric ones to `if/else` or `?:`. The classification in technique 4 step 1 is the whole technique |
| **Guard cascade** | nine guards, then four lines of work | the function is a validator carrying an operation's name. Parse at the boundary and let the operation take an already-valid input |
| **Polymorphism for one switch** | the precondition-1 command reports a single dispatch module; the registry has one implementation per key and always will | revert; add `assertNever` and stop. The switch was already exhaustive and cost one file less. This is `UNI-09`/`UNI-10` |
| **Consolidation without naming** | one predicate wider than the formatter's print width; nobody can state the rule it encodes; line coverage reports the whole rule green after one operand fires | apply technique 1 to the combined predicate *and* to each operand. Consolidation's step 5 exists for this |
| **Async predicate in a boolean position** | a `\|\|` chain or a `find` matches on the first candidate for every input; `@typescript-eslint/no-misused-promises` fires | every `Promise` is truthy and no array method awaits its callback. Keep the `await` at the combination site, or use `for await … break` |
| **Null object hiding a lookup failure** | a bug report describes plausible but wrong numbers; a metric or audit count drops with no change in error rate; nothing distinguishes "found" from "defaulted" | a required effect became a no-op. Switch to a special-case union variant so consumers must decide, or restore the error |
| **Assertion used as validation** | the throw is reachable from unvalidated request data; the service returns 500 for malformed input | move the check to a boundary parse returning a typed error (`UNI-20`) |
| **Hoisted fragment reordered effects** | log- or metric-ordering assertions fail while every value stays correct | a head fragment now runs before the predicate. Restore it inside the arms, or confirm the order is not part of the contract — and check whether the predicate can throw, which changes *whether* it runs, not just when |
| **Metric drift after fragment hoisting** | a dashboard panel goes flat after a "no-behaviour-change" refactor | log records and metrics an alert matches are **in** the contract (`../../refactoring.md`). Assert the emitted names in a test before hoisting |
| **Behaviour riding along** | an existing test's expected value changed in a refactoring commit | split the commit. A refactoring commit's test diff is empty except for added tests |

## Relations

- **`composing-methods.md` runs first.** Technique 1 here *is* its Extract Method aimed at a
  predicate and its arms, and inherits that technique's preconditions verbatim. Its guidance on
  arity as a feedback signal is the direct analogue of nesting depth here. A conditional inside a
  200-line function has cut points you cannot see until that file has run.
- **Applying 3, 4 and 6 reduces the live-local count**, which unblocks Extract Method, Split
  Temporary Variable and Replace Temp with Query. The two files feed each other, which is why
  `../../refactoring.md`'s ladder puts `composing` at step 1 and `conditionals` at step 2 rather
  than treating them as independent.
- **`../../selection.md` owns the threshold for technique 5** and reconciles `UNI-02` Type Switch
  Sprawl against `UNI-09` Strategy Overkill. Do not restate the threshold from memory; the file has
  the branch-count table and the "who edits it" override.
- **`../../refactoring.md`'s paradigm-fit table is binding for technique 5.** Its Switch Statements
  row states the rule this file elaborates: an exhaustive union match closed by `assertNever` is not
  a smell, and the smell begins at ≥3 dispatch modules.
- **`../../patterns/strategy.md` and `../../patterns/state.md`** are where technique 5 lands when
  the variants need identity, injected dependencies, or transitions;
  `../../patterns/template-method.md` is where it lands when the arms share most of their body.
  `../../patterns/visitor.md` is the other side of the Expression Problem — reach for it when
  *operations* are the open axis. A dispatch record is where a Strategy attaches later; building the
  Strategy first is the over-refactored end of this group.
- **`organizing-data.md`** takes over when flattening does not reach depth ≤2, and when the
  discriminant is an unconstrained `string`. Branching that survives technique 4 is discriminating
  on a value's shape, and the fix is a discriminated union (`TS-10`) — Primitive Obsession, not more
  control flow. Fix the type before applying technique 5, or the record's index signature enforces
  nothing.
- **`moving-features.md`** follows when an extracted predicate reads only another type's fields.
  That is Feature Envy: extracted here, moved there by Move Method.
- **A boolean parameter is a conditional pushed onto the caller** (`UNI-19`). Its remedy, Replace
  Parameter with Explicit Methods, is technique 11 in `simplifying-method-calls.md`.
- **`dev:code-roast`'s `sin-registry.md` detects; this file remediates.** Cited above: `UNI-01`,
  `UNI-02`, `UNI-03`, `UNI-04`, `UNI-09`, `UNI-10`, `UNI-19`, `UNI-20`, `UNI-23`, `UNI-26`,
  `UNI-39`, `UNI-41`, `UNI-42`, `TS-03`, `TS-07`, `TS-10`, `SLOP-03`, `SLOP-04`, `SLOP-06`.
- Technique names are Martin Fowler's (*Refactoring*, 1st and 2nd eds.) and are standard
  terminology; all text and code in this file is original to this repository.
