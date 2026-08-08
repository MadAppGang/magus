# Composing Methods

**The group's question: is each unit the right size, and does its identifier describe the
value it produces?**

Nine techniques. Two of them extract; the other seven exist to make an extraction possible,
or to undo one that bought nothing.

## The force

A function you cannot read in one pass. Length is the symptom; the obstacle is more specific:
**its locals are entangled.** A variable assigned near the top and read forty lines down is
live across every cut point in between, so any Extract Method there needs it as a parameter
and, if it is also assigned, as part of a return value. Five such locals and the extracted
function has arity 5 and returns a tuple — strictly worse than the range you started with.

So the sequence is fixed: **reduce the live locals first, then cut.** That is what Split
Temporary Variable, Remove Assignments to Parameters, Extract Variable, Replace Temp with
Query and Replace Method with Method Object are for. Extract Method is the payoff, not the
first move.

| # | Technique | Transformation | Inverse |
|---|---|---|---|
| 1 | **Extract Method** | a statement range → a named function | Inline Method |
| 2 | **Inline Method** | a function whose identifier adds nothing → its body | Extract Method |
| 3 | **Extract Variable** | a subexpression → a named `const` | Inline Temp |
| 4 | **Inline Temp** | a `const` whose identifier adds nothing → its initializer | Extract Variable |
| 5 | **Replace Temp with Query** | a local → a function returning that value | keep the temp |
| 6 | **Split Temporary Variable** | one `let` with two meanings → two `const`s | — |
| 7 | **Remove Assignments to Parameters** | a parameter used as scratch → a local binding | — |
| 8 | **Replace Method with Method Object** | entangled locals → fields of a dedicated object | Inline Class (`moving-features.md`) |
| 9 | **Substitute Algorithm** | a body → a different body with an identical postcondition | — |

## Order within the group

```
6  Split Temporary Variable          ─┐  every binding gets one meaning
7  Remove Assignments to Parameters  ─┘  and becomes const
3  Extract Variable                  ─┐  name the subexpressions
5  Replace Temp with Query           ─┘  and remove the locals that raise the cut's arity
1  Extract Method                     ← now the cut has arity 0-2
8  Replace Method with Method Object  ← only where 5 fails its purity precondition
2  Inline Method / 4 Inline Temp      ← remove indirection that returned nothing
9  Substitute Algorithm               ← separate commit; the only behavior-risky step
```

**Arity is the feedback signal.** If the extraction your editor offers takes three or more
parameters, the cut runs across a data dependency rather than a phase boundary. Go back to
5 and 6.

## Does TypeScript already do this

Several of these were manual procedures in 1999 and are now performed or enforced by the
toolchain. Knowing which is which decides where your attention goes.

| Technique | Automated by | What remains yours |
|---|---|---|
| **Extract Method** | tsserver *Extract to function* / *Extract to method*: computes the parameter list and return type and moves the range | the cut point and the name — and reading the computed arity as feedback |
| **Extract Variable** | tsserver *Extract to constant* | the name, and the short-circuit precondition, which the tool does not check |
| **Inline Method / Inline Temp** | no tsserver refactor; WebStorm has *Inline*. Otherwise delete the declaration and let `tsc` enumerate the call sites | deciding whether the identifier was carrying meaning |
| **Split Temporary Variable** | `prefer-const` (ESLint) / `style/useConst` (Biome) marks every binding that never needs `let`; the surviving `let`s are your worklist | splitting the live ranges and naming each one |
| **Remove Assignments to Parameters** | `no-param-reassign` (ESLint) / `style/noParameterAssign` (Biome) detects it and prevents regression | the rewrite, and distinguishing rebinding from argument mutation |
| **Replace Temp with Query** | nothing | purity and snapshot analysis |
| **Replace Method with Method Object** | nothing | usually the wrong technique in TypeScript — see the entry |
| **Substitute Algorithm** | nothing, by definition | all of it |

**Two of the nine are artifacts of Java 1999.** Replace Method with Method Object exists
because the language had no closures — a closure captures exactly the locals that technique
promotes to fields, at zero declaration cost. Remove Assignments to Parameters is a lint rule
here, not a procedure.

**Rename changed the economics of naming.** A `tsc`-backed rename is total across the project,
so a name chosen at extraction time is correctable later at no cost. Do not spend minutes on a
name mid-transformation; extract, then rename.

**`tsc` does not verify any of these transforms.** It will accept an Extract Method that
changed `this` binding, an Extract Variable that defeated short-circuiting, and a Replace Temp
with Query over `Date.now()`. Types are not a preservation proof — the tests are. Run
`bun test path/to/file.test.ts --watch`; the mechanics below assume a green suite between
every numbered step.

## Example types

Every example below uses these:

```ts
type Plan    = { readonly name: string; readonly includedCalls: number; readonly overageCents: number };
type Usage   = { readonly calls: number; readonly storageGb: number };
type Account = { readonly id: string; readonly plan: Plan; readonly usage: Usage; readonly loyaltyYears: number };
```

---

## 1. Extract Method

**Resolves:** Long Method, Duplicate Code, Comments. Enables Move Method in
`moving-features.md`, which is the actual remedy for Feature Envy.

**Force.** A statement range has one purpose and no identifier. It cannot be called, tested in
isolation, or named in a stack trace, and the section comment marking it is checked by nothing.

**Preconditions**

- The range has exactly one exit path: no `return`, `break`, `continue` or `throw` that leaves
  the enclosing function from inside the range — unless the extracted function returns a value
  the caller re-dispatches on.
- The range assigns **at most one** variable that is read after the range. Two or more: apply
  6 or 5 first, or accept an object return.
- Free variables the range reads are passable. Their count is the new function's arity.
- The range does not `await` inside a `try` whose `catch` is outside it; moving it changes
  which frame handles the rejection, which is observable.

**Mechanics**

1. Delimit the range. List the free variables it reads (→ parameters) and the variables it
   assigns that are read later (→ return value).
2. If the arity is ≥3, stop and reduce locals with 5 and 6 first.
3. Declare the new function. Name it for its postcondition — the value it returns or the effect
   it has — not for the statements it contains.
4. Move the range verbatim. Add parameters; return the single assigned variable.
5. Replace the range with the call. Run tests.
6. Search for structurally identical ranges elsewhere and redirect them to the new function.
   One redirect per test run.

**Before**

```ts
function renderInvoice(account: Account): string {
  let out = `Invoice for ${account.id}\n`;

  // charge for calls beyond the plan
  const overage = Math.max(0, account.usage.calls - account.plan.includedCalls);
  const overageCents = overage * account.plan.overageCents;
  out += `  overage: ${overage} calls = ${(overageCents / 100).toFixed(2)}\n`;

  // loyalty discount, capped at 20%
  const rate = Math.min(0.2, account.loyaltyYears * 0.05);
  const discountCents = Math.round(overageCents * rate);
  out += `  loyalty: -${(discountCents / 100).toFixed(2)}\n`;

  out += `  total: ${((overageCents - discountCents) / 100).toFixed(2)}\n`;
  return out;
}
```

**After**

```ts
function renderInvoice(account: Account): string {
  const charge = overageChargeCents(account);
  const discount = loyaltyDiscountCents(account, charge);

  let out = `Invoice for ${account.id}\n`;
  out += `  overage: ${overageCalls(account)} calls = ${money(charge)}\n`;
  out += `  loyalty: -${money(discount)}\n`;
  out += `  total: ${money(charge - discount)}\n`;
  return out;
}

const overageCalls = (a: Account) => Math.max(0, a.usage.calls - a.plan.includedCalls);
const overageChargeCents = (a: Account) => overageCalls(a) * a.plan.overageCents;
const loyaltyDiscountCents = (a: Account, base: number) =>
  Math.round(base * Math.min(0.2, a.loyaltyYears * 0.05));
const money = (cents: number) => (cents / 100).toFixed(2);
```

The string assembly is untouched on purpose: the transformation is extraction only, so the
output is identical by construction. `money` came from step 6 — the same expression appeared
three times.

**Postcondition.** The enclosing function's cyclomatic complexity drops by the branches moved
out; each extracted range has an identifier that appears in stack traces and coverage reports;
each is callable from a test without constructing the enclosing call.

| Gain | Cost |
|---|---|
| The range becomes independently callable, so it can be tested without the caller's setup | One more stack frame per call. A chain of one-line functions costs more to trace than it saves |
| The name is compiler-checked at every call site; a section comment is not | A wrong cut shows up as high arity — the parameter list encodes the coupling you did not remove |
| Structurally identical ranges collapse onto one definition, removing Duplicate Code at the root | `this` binding and closure capture change: an extracted arrow keeps lexical `this`, a `function` declaration does not |

**When NOT to use this**

- **Two or more assigned variables are read after the range.** The extraction produces a tuple
  return and a wide signature. Run 5 and 6 first.
- **You cannot state the postcondition in one sentence.** `processData`, `handleItem`,
  `doPart2` make the range callable while leaving it unnamed — `SLOP-04` in structural form.
- **The range is a single expression** already delimited by the surrounding statement. That is
  Extract Variable (3).
- **The call sits on a benchmarked hot path and the frame shows in the profile.** Measure first
  (`UNI-42`); JavaScriptCore inlines small monomorphic functions, so usually it does not.

---

## 2. Inline Method

**Resolves:** Middle Man, Lazy Class, Speculative Generality.

**Force.** A function whose body states its postcondition as directly as its identifier does.
The indirection costs one hop when reading and one frame when debugging, and returns neither
naming nor reuse value.

**Preconditions**

- Not polymorphic: not a member of an interface with other implementors, not overridden.
- **Not exported beyond the module's public surface.** Inlining an export is a breaking change
  for consumers, which is a contract change, not a refactoring.
- Every call site is enumerable. Deleting the declaration and running `tsc` enumerates them;
  `grep` does not (re-exports, dynamic property access).
- The body's side effects, if any, do not change in count when duplicated across call sites.

**Mechanics**

1. Check the preconditions. If the symbol is exported, stop or deprecate first.
2. Substitute the body at each call site, renaming parameters to the argument expressions. If
   an argument expression is impure or is used more than once in the body, bind it to a `const`
   at the call site first — otherwise the evaluation count changes.
3. Compile. `tsc` reports every site you missed.
4. Delete the declaration. Run tests.
5. If a call site is now long, apply Extract Method (1) at a better boundary.

**Before**

```ts
function isEligibleForLoyalty(a: Account): boolean {
  return hasEnoughYears(a);
}
function hasEnoughYears(a: Account): boolean {
  return a.loyaltyYears >= 1;
}
```

**After**

```ts
const isEligibleForLoyalty = (a: Account) => a.loyaltyYears >= 1;
```

`hasEnoughYears` restated its caller. `isEligibleForLoyalty` does not — it names a rule that
`>= 1` does not express, so it survives.

| Gain | Cost |
|---|---|
| One less hop when reading and one less frame when debugging | If the identifier carried domain meaning, that meaning is now distributed across call sites |
| Removes a symbol that had to be kept named, tested and documented | Duplicated bodies must be re-extracted if a second implementation ever appears |
| Exposes the real structure, so 1 can be reapplied at a boundary that matters | Inlining across module boundaries adds edges to the import graph |

**When NOT to use this**

- **The identifier names a domain rule referenced outside the code** — a spec, a ticket, a
  compliance control. The name is the value; body length is irrelevant.
- **It is a seam.** A test substitutes it, or a module boundary depends on it. See the Middle
  Man row in `../../refactoring.md`'s paradigm section.
- **It is exported.** Then this is an API change and needs that review.
- **It is recursive**, or inlining would give the call site a dependency it does not currently
  import.

---

## 3. Extract Variable

**Resolves:** Long Method, Comments, `UNI-41` Magic Numbers.

**Force.** A subexpression whose meaning is not derivable from its operators. Every reader
recomputes the intent, and the debugger has no binding to inspect at the point of interest.

**Preconditions**

- The subexpression is pure and referentially transparent at the extraction point.
- **Extraction must not change evaluation order or count.** Hoisting an operand out of `&&`,
  `||` or `?.` defeats short-circuiting: the operand is then evaluated unconditionally. If it
  can throw, is expensive, or has side effects, this precondition fails.
- No mutation occurs between the new declaration site and the original use that would change
  the value.

**Mechanics**

1. Verify purity and short-circuit safety.
2. Declare a `const` immediately before the first use, named for the concept the value
   represents, not for the operation that produced it.
3. Replace the occurrences with the identifier.
4. Run tests. Repeat until every operand of the enclosing expression is named.

**Before**

```ts
if (
  account.usage.calls > account.plan.includedCalls * 1.5 &&
  account.usage.storageGb > 500 &&
  account.loyaltyYears < 1
) {
  flagForReview(account);
}
```

**After**

```ts
const heavyOverage = account.usage.calls > account.plan.includedCalls * 1.5;
const heavyStorage = account.usage.storageGb > 500;
const newCustomer  = account.loyaltyYears < 1;

if (heavyOverage && heavyStorage && newCustomer) flagForReview(account);
```

All three operands are property reads and comparisons — pure, cheap, non-throwing — so
evaluating them unconditionally is not observable. **That check is the technique.** Had
`heavyStorage` been `await fetchUsage(account)`, the transformation would be a behavior change.

**Postcondition.** Each operand is named and separately inspectable in the debugger and in
branch-coverage output. Cyclomatic complexity is unchanged: this is a naming transform, not a
control-flow transform.

| Gain | Cost |
|---|---|
| The predicate reads as its business rule; each operand can be logged or breakpointed | One binding and one line per operand |
| Names appear in coverage reports, so an untested operand is visible | A wrong name is now a false statement with wider scope than a comment |
| Prepares the range for Extract Method (1) by shrinking the expression | Short-circuit evaluation is lost unless every operand is verified cheap |

**When NOT to use this**

- **Any operand can throw or is expensive and was previously short-circuited.** Leave it
  inline, or extract it as a thunk that the condition still calls conditionally.
- **The expression is already self-describing** (`price * quantity`). The binding adds a line
  and no information.
- **The same expression appears in two scopes.** That is Extract Method (1) or Replace Temp
  with Query (5) — a local `const` does not deduplicate anything.
- **Inside a benchmarked hot loop** where extraction forces work the branch previously skipped.

---

## 4. Inline Temp

**Resolves:** nothing by itself. It is a precondition-clearing step for 5 and 1.

**Force.** A `const` whose identifier restates its initializer. It adds a binding, a line, and
a name the reader must carry, and returns no information.

**Preconditions**

- Assigned exactly once. If `prefer-const` cannot make it `const`, it is reassigned — apply 6
  first.
- The initializer is pure. If the temp is read N times, inlining multiplies evaluations by N,
  so the initializer must also be cheap.
- Nothing (a breakpoint, a log line, a type assertion) depends on the binding existing.

**Mechanics**

1. Confirm single assignment and purity of the initializer.
2. Substitute the initializer at each read.
3. Delete the declaration.
4. Run tests.

**Before**

```ts
const calls = account.usage.calls;
return calls > account.plan.includedCalls;
```

**After**

```ts
return account.usage.calls > account.plan.includedCalls;
```

| Gain | Cost |
|---|---|
| One less binding to track; the comparison reads as one statement | If the initializer is a call, the call count changes with the number of reads |
| Removes a name that could drift from its value | Loses a breakpoint target in code that is debugged often |

**When NOT to use this**

- **The identifier carries meaning the expression does not** (`const isOverIncluded = …`).
  Inlining that is Extract Variable run backwards and it destroys information.
- **The temp is read more than once and the initializer is a function call.** Inlining changes
  the call count, observable whenever the call has side effects.
- **The temp is a snapshot of a time-varying or mutable source** — `Date.now()`, a mutable
  field, a generator. Inlining reintroduces the read at each use and the values can differ.

---

## 5. Replace Temp with Query

**Resolves:** Long Method — specifically, it clears the precondition that blocks Extract Method.

**Force.** Extract Method fails because locals declared in the range are read after it. Each
such local adds one to the cut's arity. Converting the local into a function that recomputes
the value removes it from the live set, and the arity falls toward zero.

**Preconditions**

- The temp is assigned exactly once from a **pure** expression. The query must be referentially
  transparent: same inputs, same result, every call.
- The temp is not a loop accumulator and not a snapshot of a time-varying or mutable source.
- Recomputation cost is acceptable. The query may be invoked more times than the temp was
  assigned; on a benchmarked path, verify.

**Mechanics**

1. Confirm the temp is `const` and its initializer is pure.
2. Extract the initializer into a function named for the value it returns.
3. Replace reads of the temp with calls. Optionally keep the temp bound to the call for one
   green test run, then delete the declaration.
4. Repeat until the live-local count at the intended cut point is ≤1.
5. Apply Extract Method (1). The extracted function now has arity 0-1.

**Before**

```ts
function invoiceTotalCents(a: Account): number {
  const overage = Math.max(0, a.usage.calls - a.plan.includedCalls);
  const overageCents = overage * a.plan.overageCents;
  const rate = Math.min(0.2, a.loyaltyYears * 0.05);
  const discountCents = Math.round(overageCents * rate);
  return overageCents - discountCents;
}
```

**After**

```ts
const overageCalls  = (a: Account) => Math.max(0, a.usage.calls - a.plan.includedCalls);
const overageCents  = (a: Account) => overageCalls(a) * a.plan.overageCents;
const loyaltyRate   = (a: Account) => Math.min(0.2, a.loyaltyYears * 0.05);
const discountCents = (a: Account) => Math.round(overageCents(a) * loyaltyRate(a));

const invoiceTotalCents = (a: Account) => overageCents(a) - discountCents(a);
```

`overageCents` is now evaluated twice per invoice, and `overageCalls` twice with it. That is
the trade, stated rather than hidden: four arithmetic operations against four independently
testable queries. If the query performed I/O or allocation, the precondition would fail.

**Postcondition.** Zero locals remain, so any subset of the computation can be extracted, tested
or moved with arity 0. Each query is callable from a test with one `Account` literal.

| Gain | Cost |
|---|---|
| Removes the live locals that were raising every cut's arity — the reason to do this | Recomputation. Bounded only if the expression is genuinely cheap |
| Each intermediate value becomes independently testable and reusable | The body is no longer a top-to-bottom read; the reader follows calls |
| Statement order stops mattering, because nothing is sequenced through a binding | A query with arity ≥2 is not a query; it is an extracted method wearing the name |

**When NOT to use this**

- **The initializer performs I/O, mutates, or is non-deterministic.** `const now = Date.now()`
  read three times is a **snapshot**; as a query it returns three different values. That is a
  behavior change, therefore not a refactoring.
- **The temp is a loop accumulator.**
- **Recomputation is measurable on a path you have benchmarked.** Memoize at the boundary or
  keep the temp.
- **Nothing is blocked.** A `const` in a five-line pure function is not a smell. This technique
  is a means to an extraction, not an end.

---

## 6. Split Temporary Variable

**Resolves:** Long Method. A binding with two meanings has no correct name and blocks 5.

**Force.** A `let` reassigned to a value of a different kind. The identifier now denotes two
things, so no name is accurate, and any extraction spanning the reassignment must carry the
variable in as a parameter *and* out as a return value.

**Preconditions**

- The variable is assigned more than once, and the assignments are **not** accumulation
  (`+=`, `push`, a fold) and not a loop induction variable.
- Each assignment starts a live range that is read before the next assignment. If not, the
  earlier assignment is a dead store — delete it instead.

**Mechanics**

1. Enumerate the assignments and the live range each one starts.
2. For the first live range, declare a `const` named for that meaning; replace the reads inside
   that range only.
3. Run tests.
4. Repeat for each subsequent live range, one at a time, with a test run between.
5. The original `let` is now unread. Delete it.

**Before**

```ts
function costReport(a: Account): string[] {
  let cost = a.usage.calls * 0.001;
  const lines = [`api: $${cost.toFixed(2)}`];
  cost = a.usage.storageGb * 0.02;
  lines.push(`storage: $${cost.toFixed(2)}`);
  return lines;
}
```

**After**

```ts
function costReport(a: Account): string[] {
  const apiCostUsd = a.usage.calls * 0.001;
  const storageCostUsd = a.usage.storageGb * 0.02;
  return [`api: $${apiCostUsd.toFixed(2)}`, `storage: $${storageCostUsd.toFixed(2)}`];
}
```

**Postcondition.** Every binding in the range is `const` with exactly one live range and one
meaning. 5 and 1 now apply per binding, because no binding spans a cut point twice.

| Gain | Cost |
|---|---|
| Each value gets an accurate name, which is the precondition for every other technique here | Two bindings where there was one — real, and smaller than the ambiguity it removes |
| `const` throughout means the reader can stop tracking reassignment | Neither change is detected by `tsc`; only the tests confirm equivalence |

**When NOT to use this**

- **Accumulators and loop variables.** `let total = 0; for (…) total += x` is one meaning
  updated repeatedly. Splitting it is meaningless.
- **A `let` assigned once per branch of an `if/else` and read after.** Fix it with a `const`
  initialized from a conditional expression, or Extract Method returning the value — not two
  bindings.

---

## 7. Remove Assignments to Parameters

**Resolves:** Long Method; unblocks 1, since the parameter's value at the cut point is not the
argument.

**Force.** The parameter identifier stops denoting the argument. Anyone reasoning from the
signature is wrong from the first reassignment onward, and the function loses the property that
its inputs are its parameters.

**Two cases, and only the first is this technique:**

| Case | What actually happens | Fix |
|---|---|---|
| `p = expr` — rebinding the parameter | the caller's variable is unaffected; only local reasoning breaks | this technique |
| `p.field = expr` — mutating the argument | the caller's object changes through the alias; an observable side effect | **not a refactoring.** It is part of the behavior contract; changing it needs the caller-facing review |

**Preconditions**

- The assignment is a rebinding, not a mutation of the referenced object.
- No call site uses the parameter as an output channel.

**Mechanics**

1. Introduce a binding initialized from the parameter, named for what the value becomes.
2. Replace reads after the first assignment with the new binding.
3. Delete the assignment to the parameter.
4. If the function is a transformation chain, prefer one `const` per step, each named for that
   step's postcondition.
5. Enable `no-param-reassign` (ESLint) or `style/noParameterAssign` (Biome) so the state cannot
   regress.

**Before**

```ts
function applyDiscounts(cents: number, a: Account): number {
  if (a.loyaltyYears >= 3) cents = Math.round(cents * 0.9);
  if (a.plan.name === "enterprise") cents = Math.round(cents * 0.95);
  return cents;
}
```

**After**

```ts
function applyDiscounts(baseCents: number, a: Account): number {
  const afterLoyalty = a.loyaltyYears >= 3 ? Math.round(baseCents * 0.9) : baseCents;
  const afterPlan = a.plan.name === "enterprise" ? Math.round(afterLoyalty * 0.95) : afterLoyalty;
  return afterPlan;
}
```

Order is preserved deliberately: `Math.round` twice in sequence is not the same as rounding a
product of both factors. Reassociating those operations would be technique 9, not this one.

| Gain | Cost |
|---|---|
| The signature stays true for the whole body; each intermediate value is named and inspectable | One binding per stage |
| Each stage is separately extractable, since nothing is threaded through a mutable binding | Long chains want a pipeline; at four-plus stages, extract them |
| A lint rule prevents regression at zero ongoing cost | Enabling the rule surfaces existing violations across the repo — schedule that |

**When NOT to use this**

- **A single normalizing assignment at the top** (`path = path.trim()`) with no later reader who
  could mean the raw argument. A `const` is still preferable; this alone does not justify a PR.
- **The reassignment implements a default.** Use a default parameter.
- **Never file argument mutation under "not applicable".** It is a larger problem that this
  technique does not address — see the table above.

---

## 8. Replace Method with Method Object

**Resolves:** Long Method where 5 is inapplicable. Note that it *produces* Temporary Field by
construction, so it is an intermediate state, not a destination.

**Force.** The locals are mutually dependent and impure, so Replace Temp with Query cannot
convert them, and every cut has arity ≥4. Promoting the locals to fields of a dedicated object
drops the arity of every subsequent extraction to zero.

**Preconditions**

- 5 has been attempted and fails its purity precondition.
- The exported signature is preserved by a thin wrapper; otherwise this is an API change.
- The internal step order is preserved exactly. Fields reintroduce order dependence, and a
  reordered call sequence in `run()` is a behavior change.

**Mechanics**

1. Create a class named for the **operation** (`SettlementRun`), not a noun bag
   (`SettlementHelper`).
2. Constructor parameters = the original parameters, stored `private readonly`.
3. Copy the body verbatim into `run()`. It compiles, because the parameters are now fields.
4. Promote one local at a time to a `private` field, running tests after each.
5. Extract private methods (technique 1). Each has arity 0, because every input is a field.
6. Replace the original body with `new SettlementRun(...).run()`. The exported signature is
   unchanged, so no call site is touched.

**Before**

```ts
type Charge  = { readonly kind: "charge" | "refund"; readonly cents: number };
type FxRates = { rateFor(code: string): number };

// Seven interdependent locals. Any Extract Method here takes five parameters.
function settle(batch: Charge[], fx: FxRates, feeBps: number) {
  let gross = 0;
  let refunds = 0;
  for (const c of batch) {
    if (c.kind === "refund") refunds += c.cents;
    else gross += c.cents;
  }
  const net = gross - refunds;
  const fee = Math.round((net * feeBps) / 10_000);
  const payoutUsd = (net - fee) / 100;
  const payoutEur = payoutUsd * fx.rateFor("EUR");
  return { gross, refunds, net, fee, payoutUsd, payoutEur };
}
```

**After**

```ts
class SettlementRun {
  private gross = 0;
  private refunds = 0;

  constructor(
    private readonly batch: Charge[],
    private readonly fx: FxRates,
    private readonly feeBps: number,
  ) {}

  run() {
    this.tally();                                  // must precede every read of gross/refunds
    const net = this.gross - this.refunds;
    const fee = this.feeOn(net);
    return { gross: this.gross, refunds: this.refunds, net, fee, ...this.payout(net - fee) };
  }

  private tally(): void {
    for (const c of this.batch) {
      if (c.kind === "refund") this.refunds += c.cents;
      else this.gross += c.cents;
    }
  }

  private feeOn(net: number): number {
    return Math.round((net * this.feeBps) / 10_000);
  }

  private payout(cents: number) {
    const payoutUsd = cents / 100;
    return { payoutUsd, payoutEur: payoutUsd * this.fx.rateFor("EUR") };
  }
}

export const settle = (batch: Charge[], fx: FxRates, feeBps: number) =>
  new SettlementRun(batch, fx, feeBps).run();
```

**Postcondition.** The exported signature and return shape are unchanged, so no call site is
edited. Each private method has arity ≤1 and is reachable from a test through one constructor
call.

| Gain | Cost |
|---|---|
| Extraction becomes free: private methods read fields instead of taking parameters | A class that exists only to hold locals — scaffolding, not a domain type |
| Steps become individually testable, and the object is where a Strategy would later attach | Mutable fields reintroduce order dependence: `run()` must call `tally()` before reading `gross` |
| The public signature is untouched, so the change is provably local | Stopping after step 4 leaves Temporary Field, which is worse than the starting state |

**When NOT to use this**

- **The locals are independent and pure.** 5 is cheaper and leaves no type behind.
- **The computation is a sequence of pure transformations.** A pipeline of named `const`s or
  small pure functions has no order-dependence to protect. Prefer that form in TypeScript —
  this technique is the group's most direct import from a language without closures.
- **You would not write the class from scratch.** It is scaffolding for step 5; if step 5 does
  not happen, revert.
- **The operation is already a fold** over a typed accumulator. The accumulator is the method
  object; you have done this already.

---

## 9. Substitute Algorithm

**Resolves:** Long Method, Duplicate Code, control flow that accreted instead of being designed.

**Force.** You can state the function's postcondition precisely, and implement it more directly
than the present body does. Every other technique in this group rearranges statements; this one
replaces them. The test suite is the entire safety net.

**Preconditions** — strictest in the group

- The full postcondition is known **and covered by tests**, including error and boundary inputs.
  Where coverage is incomplete, write characterization tests against the current implementation
  before editing it.
- The observable properties outside the type signature are enumerated: iteration order,
  stability of a sort, throw-versus-sentinel on absence, floating-point rounding, and evaluation
  count where inputs may be accessors or proxies.
- No structural refactoring shares the commit.

**Mechanics**

1. Write the replacement alongside the original. Delete nothing yet.
2. Compare over the same inputs. For any nontrivial domain, property-based generation or replay
   of recorded inputs beats hand-written cases.
3. Reconcile every difference. A difference is either a defect in the replacement or an
   undocumented behavior of the original that some caller depends on. Decide which, explicitly.
4. Switch the call sites and delete the original **in the same commit**, so no dead branch
   survives.
5. Run the suite; run the benchmark if performance motivated the change.

**Before**

```ts
function findPlan(name: string, plans: Plan[]): Plan | undefined {
  let found: Plan | undefined = undefined;
  for (let i = 0; i < plans.length; i++) {
    if (plans[i].name.toLowerCase() === name.toLowerCase()) {
      if (found === undefined) found = plans[i];
    }
  }
  return found;
}
```

**After**

```ts
const findPlan = (name: string, plans: Plan[]): Plan | undefined => {
  const target = name.toLowerCase();
  return plans.find((p) => p.name.toLowerCase() === target);
};
```

Two differences to check, not assume. The original reads every element; `find` stops at the
first match — unobservable for an array of plain records, observable if elements are accessors
or the array is a `Proxy`. The original called `name.toLowerCase()` once per element; the
replacement calls it once, which is a pure-function evaluation-count change and therefore not
observable. Enumerating both is the work this technique demands.

| Gain | Cost |
|---|---|
| The implementation matches the postcondition, so the next reader derives behavior from the code | Highest regression risk in the group: no structural correspondence to check the diff against |
| Usually removes several other smells at once — the branches disappear with the algorithm | Requires characterization tests up front, which is often the larger half of the work |
| The new body is typically smaller, so review is bounded | Undocumented behavior is silently dropped unless it was enumerated first |

**When NOT to use this**

- **The current behavior is not fully known.** Undocumented edge-case handling is
  indistinguishable from noise right up to the moment you delete it. Characterize first.
- **A caller depends on a property outside the stated contract** — ordering, timing, allocation
  pattern. Then the substitution is a behavior change and needs that review.
- **Performance motivates it and no benchmark exists** (`UNI-42`).
- **Anything else is in the commit.** Combined with a structural change, `git bisect` can no
  longer attribute the regression.

---

## Group failure modes

| Failure | Detection | Correction |
|---|---|---|
| **Extraction sprawl** | the call graph is deeper than the original function was long; a change requires opening five files, none of which holds a decision | extract to reach a name a caller or a test needs, not a line-count target. `UNI-01` sets no upper bound; use "no scrolling, ≤4 live locals at any cut point" |
| **Naming laundering** | you cannot state the extracted function's postcondition in one sentence (`processData`, `handleItem`) | the smell is unresolved; find the real boundary or revert |
| **Behavior riding along** | a test's expected value changed in a refactoring commit | split the commit. A refactoring commit's test diff is empty except for added tests |
| **Refactoring with no pending edit** | no named edit whose cost this reduces | stop; see the gates in `../../refactoring.md` |
| **Premature Method Object** | a class with mutable private fields where all locals were pure | revert to 5 and a pipeline of `const`s |

## Relations

- **`moving-features.md` depends on this group.** Extract Class before Extract Method moves
  ranges whose boundaries have not been established. Feature Envy's remedy is Extract Method
  here, then Move Method there.
- **`simplifying-conditionals.md`** overlaps: Decompose Conditional is technique 1 applied to a
  predicate and each arm.
- **An Extract Method with arity ≥3 is a Data Clump made visible by the parameter list.**
  `organizing-data.md` and `simplifying-method-calls.md` take it from there.
- **Once a method object exists**, `../../patterns/strategy.md` and
  `../../patterns/template-method.md` become applicable — check `../../selection.md`'s threshold
  before adopting either. Extraction is not a reason to add a pattern.
- Technique names are Fowler's (*Refactoring*, 2nd ed.); all text and code here is original to
  this repository.
