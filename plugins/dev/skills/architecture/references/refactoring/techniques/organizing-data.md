# Organizing Data

**The group's question: does each value's type state the constraints the domain places on it,
and does each fact have exactly one owner?**

Fifteen techniques. One names a literal, three add encapsulation to mutable objects, two give
a name to a shape that had none, three deal with type codes, one flattens a hierarchy back
into data, two are exact inverses over identity, two are exact inverses over association
direction, and one is a GUI technique from 1999 that has since inverted.

**The parse boundary is this group's load-bearing idea, and it is not a separate technique.**
It is where `unknown` becomes a domain type, and it is the endpoint of techniques 5 and 7
rather than an entry of its own. Read those two together before applying anything else here.

## The force

A field's type is a claim about what values can appear in it. `string` claims "any sequence
of UTF-16 code units", which is almost never the claim the domain makes. Every gap between
the declared type and the real constraint has to be closed somewhere else: by validation
duplicated at each entry point, by a comment, by a convention, or — the usual case — by
nothing, and the constraint holds until it doesn't.

Three consequences follow, and they are the three things this group repairs.

1. **Unstated constraints are checked repeatedly or not at all.** The same regex, range test,
   or null guard appears at every site that touches the value, and the sites drift.
2. **Same-typed values are interchangeable to the compiler.** Two adjacent `string` parameters
   can be swapped at a call site and the program still compiles, still runs, and is wrong.
3. **A fact with two homes has no owner.** Two copies of the same datum, or two directions of
   the same link, disagree the moment one write path forgets the other. Nothing detects this;
   a query simply starts returning a stale answer.

The group's remedies are ordered by cost. Naming a literal costs nothing. Branding a primitive
costs one parse function. Introducing a registry costs a lifecycle. Introducing a back-link
costs an invariant that the language will not enforce for you. **Spend down that list, not up.**

| # | Technique | Transformation | Inverse |
|---|---|---|---|
| 1 | **Replace Magic Number with Symbolic Constant** | a bare literal → a named binding stating the decision | inline the constant |
| 2 | **Self Encapsulate Field** | a type's own direct field reads → its own accessor | remove the accessor |
| 3 | **Encapsulate Field** | a publicly writable field → a guarded write path, or `readonly` | — |
| 4 | **Encapsulate Collection** | a live collection handed out by reference → a read-only view + named mutators | — |
| 5 | **Replace Data Value with Object** | a constrained primitive → a branded type + one parse | erase the brand |
| 6 | **Replace Array with Object** | heterogeneous positional slots → named fields | — |
| 7 | **Replace Type Code with Class** | an open primitive code → a closed named set + a total table | — |
| 8 | **Replace Type Code with Subclasses** | an immutable code that selects behaviour → a discriminated union | 10 |
| 9 | **Replace Type Code with State/Strategy** | a *mutable* code that selects behaviour → State or Strategy | — |
| 10 | **Replace Subclass with Fields** | variants differing only in constants → one type + a lookup table | 8 |
| 11 | **Change Value to Reference** | many equal copies → one shared referent with identity | 12 |
| 12 | **Change Reference to Value** | a shared mutable referent → an immutable copy with structural equality | 11 |
| 13 | **Change Unidirectional Association to Bidirectional** | a one-way link → two links plus an invariant | 14 |
| 14 | **Change Bidirectional Association to Unidirectional** | two links → one link plus a derived query | 13 |
| 15 | **Duplicate Observed Data** | domain data trapped in a widget → a domain copy plus one-way sync | delete the copy |

## Order within the group

```
1  Replace Magic Number with Symbolic Constant   ← free; do it while reading
5  Replace Data Value with Object                ← establish ONE boundary where untyped
                                                   input becomes domain types
6  Replace Array with Object                     ← name the positional shapes that survived
7  Replace Type Code with Class                  ← close the sets; must precede 8 and 9
8  Replace Type Code with Subclasses            ─┐ pick ONE by mutability of the code:
9  Replace Type Code with State/Strategy        ─┘ immutable → 8, mutable → 9
10 Replace Subclass with Fields                  ← the undo, when 8 bought only constants
11 Change Value to Reference                    ─┐ identity: pick a side with the criterion
12 Change Reference to Value                    ─┘ in technique 11, or these oscillate
2  Self Encapsulate Field                       ─┐ only if the module is mutable objects.
3  Encapsulate Field                             │ Under readonly records the problem
4  Encapsulate Collection                       ─┘ does not arise — see the paradigm note
13 Change Unidirectional → Bidirectional        ─┐ last: each adds an invariant the
14 Change Bidirectional → Unidirectional        ─┘ compiler will not check
15 Duplicate Observed Data                       ← only for imperative UI surfaces
```

**Establish the boundary before anything else.** Techniques 5 and 7 both end in a parse
function. If they end in separate parse functions at separate call sites, the guarantee
is only as strong as the sloppiest one. One boundary, then everything downstream is typed by
construction.

**The compiler is the worklist generator.** Every technique here has the same third step:
change a type, run `tsc`, and treat the error list as the set of sites to convert. If a
technique gives you no error list, you have not actually narrowed anything.

## Does TypeScript already do this

| Technique | Automated / subsumed by | What remains yours |
|---|---|---|
| **1 Replace Magic Number** | `no-magic-numbers` (ESLint) / `style/noMagicNumbers` (Biome) locates them; both are noisy by default and need an ignore list | the name, and deciding whether two occurrences are the same decision |
| **2 Self Encapsulate Field** | **the language.** A `get x()` is source-compatible with a field read, so the transformation needs zero call-site edits — the property Fowler constructed by hand | verifying no serializer depends on the field being an own enumerable property |
| **3 Encapsulate Field** | `readonly` (compile time) and `Object.freeze` (runtime) replace the setter entirely for immutable data | deciding whether the object is mutable at all — usually it should not be |
| **4 Encapsulate Collection** | `readonly T[]` removes the mutating methods **from the type** at zero runtime cost, and `T[]` is assignable to it | the copy-vs-view decision at an untrusted boundary; `ReadonlyArray` is shallow |
| **5 Replace Data Value with Object** | branded types — a compile-time-only intersection. `tsc` reports every unbranded construction site | writing the one parse function and putting it at the boundary |
| **6 Replace Array with Object** | labelled tuple types give per-index types and names at zero runtime cost — a usable intermediate when the array is the storage format | the final object, and whether the format may change at all |
| **7 Replace Type Code with Class** | `as const` array + `typeof A[number]` + `satisfies Record<Code, T>` — the total-table check is a compile error, not a test | the boundary parse; a union type checks nothing at runtime |
| **8 Replace Type Code with Subclasses** | discriminated unions + `switch` closed by `assertNever`; `switch-exhaustiveness-check` (`TS-07`) prevents regression | designing the variants so each carries only its own valid fields |
| **9 Replace Type Code with State/Strategy** | a function type *is* a one-method Strategy; a `satisfies` transition table *is* a small state machine | the State-vs-Strategy call; see `../../patterns/state.md` |
| **10 Replace Subclass with Fields** | `satisfies Record<Variant, Fields>` — a missing variant is a compile error | proving every difference really is a constant |
| **11 Change Value to Reference** | nothing. There is no interning, no identity map, no `Map` keyed by structural equality | the registry, its lifecycle, and its test isolation |
| **12 Change Reference to Value** | `readonly` prevents mutation; **nothing gives value equality.** `===` on objects is always reference equality and there is no operator overloading | a structural `equals`, and finding the `===` sites `tsc` will not flag |
| **13 Uni → Bidirectional** | nothing. TypeScript cannot express "these two fields agree" | the single write path, and the test that asserts the invariant |
| **14 Bi → Unidirectional** | delete the field and `tsc` enumerates the readers; `knip` finds unread exports | replacing each read with a derived query |
| **15 Duplicate Observed Data** | declarative UI frameworks make this **unnecessary and usually wrong** — render is already a function of state | recognising the inverted case (`REACT-07`) and deleting the copy instead |

**Paradigm note, and it is the widest gap in the catalog.** Techniques 2, 3 and 4 exist to add
encapsulation to *mutable objects*. Under `readonly` records constructed once at a parse
boundary and never written again, **the problem they solve does not arise**: there is no
uncontrolled write to guard, no invariant that a setter must re-check, no live array a caller
can `push` into. In that module the correct action is not to add accessors — it is to notice
you already have the postcondition those techniques were reaching for, and move on. Adding
getters and setters to immutable records is ceremony, `UNI-10` in a different costume. The
entries below say so in place rather than teaching you Java accessors.

Note also what `readonly` is and is not: it is **erased at compile time**. It stops TypeScript
callers and does nothing to JavaScript callers, `as` casts (`TS-09`), or `Object.assign`. The
runtime form is `Object.freeze`, which is shallow and costs a real (small) allocation-time
penalty. Choose by whether the consumer is inside your type system.

## Example types

Every example below uses these. Domain: freight consignments moving between depots.

```ts
type Depot = {
  readonly code: string;              // hub code, three uppercase letters
  readonly name: string;
  readonly tzOffsetMinutes: number;
};

type Consignment = {
  readonly waybill: string;           // "AWB-2291-0043"
  readonly origin: string;            // a depot code
  readonly destination: string;       // a depot code
  readonly grossMassKg: number;
  readonly declaredValueMinor: number; // EUR cents — minor units, never floats
};

type Leg = {
  readonly waybill: string;
  readonly carrier: string;
  readonly departedAtEpochMs: number;
};

const assertNever = (x: never): never => {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
};
```

`origin` and `destination` are both `string`, and both are depot codes. That is technique 5's
force, sitting in the example types where you can see it.

---

## 1. Replace Magic Number with Symbolic Constant

**Resolves:** `UNI-41` Magic Numbers / Strings, Duplicate Code, Comments.

**Force.** A literal encodes a decision, and no identifier records what the decision was. Two
occurrences of `31.5` may be the same rule or a coincidence; nothing in the code distinguishes
them, so changing one is a guess about the other. The comment that explains it is checked by
nothing and drifts on the first edit (`SLOP-04`).

**Preconditions**

- The literal has a domain meaning **not derivable from its surroundings**. `* 2` in a midpoint
  computation and `+ 1` in an index shift derive their meaning from the operation; they are not
  this.
- Every occurrence you intend to point at the same constant denotes the **same decision**. The
  check: *if this rule changed, would all of these have to change together?* If no, they are
  homonyms and must stay separate — collapsing them creates a false coupling that the next
  editor cannot see.
- The constant's home module is importable from every occurrence **without creating an import
  cycle** (`TS-13`). If it would, the constant belongs in a leaf module both sides already import.
- The value does not vary by deployment. If it does, it is configuration, not a constant
  (`UNI-40`), and belongs in typed env parsing.

**Mechanics**

1. Name the **decision**, not the value. `MANUAL_LIFT_LIMIT_KG`, never `THIRTY_ONE_POINT_FIVE`.
   Put the unit in the identifier; a bare `LIMIT` reintroduces the ambiguity you are removing.
2. Declare it at module scope with `as const` where the literal type matters.
3. Replace **one** occurrence. Run tests.
4. For each remaining occurrence, apply the same-decision check before replacing. One per test run.
5. If the literal turns out to be one member of a closed set of codes, stop — that is technique 7,
   and a bag of loose constants is the wrong destination.

**Before**

```ts
function surchargeMinor(c: Consignment): number {
  let extra = 0;
  if (c.grossMassKg > 31.5) extra += 1800;                    // two-person lift
  if (c.declaredValueMinor > 250_000) {
    extra += Math.round(c.declaredValueMinor * 0.004);
  }
  return extra;
}
```

**After**

```ts
/** Above this a piece needs two handlers; carrier tariff §4.2. */
const MANUAL_LIFT_LIMIT_KG = 31.5;
const HEAVY_PIECE_SURCHARGE_MINOR = 1_800;
const HIGH_VALUE_THRESHOLD_MINOR = 250_000;
const AD_VALOREM_RATE = 0.004;

function surchargeMinor(c: Consignment): number {
  const heavy = c.grossMassKg > MANUAL_LIFT_LIMIT_KG ? HEAVY_PIECE_SURCHARGE_MINOR : 0;
  const valuable =
    c.declaredValueMinor > HIGH_VALUE_THRESHOLD_MINOR
      ? Math.round(c.declaredValueMinor * AD_VALOREM_RATE)
      : 0;
  return heavy + valuable;
}
```

`31.5` also appeared in the label printer, which prints a two-person-lift sticker above the same
threshold. Same decision, so it imports `MANUAL_LIFT_LIMIT_KG`. `31.5` in the pallet-height
validator is a different rule that happens to share a number; it keeps its own constant. **That
distinction is the technique.** The comment survives because it names the tariff clause — a fact
the identifier cannot carry.

**Postcondition.** Every numeric literal remaining in the range is 0, 1, an array index, or a
mathematical identity. A tariff change is a one-line diff whose blast radius is the constant's
import list.

| Gain | Cost |
|---|---|
| The decision has a name that appears in the import graph, so its consumers are enumerable | A wrong name is a false statement with module-wide scope, worse than a wrong comment |
| A rule change becomes one edit instead of a `grep` for a number that also matches unrelated code | Reading now requires one jump to the declaration |
| Two occurrences that must change together are provably linked; two that must not are provably separate | Collapsing homonyms creates a coupling nothing warns about |

**When NOT to use this**

- **Identity elements.** `0`, `1`, `-1`, `2` in a halving. `const ONE = 1` is naming laundering.
- **Inside a test.** The literal *is* the specification there. `expect(fee).toBe(1800)` states the
  expected value; `expect(fee).toBe(HEAVY_PIECE_SURCHARGE_MINOR)` computes the expectation from
  the same constant the implementation uses, so the test passes when the constant is wrong. That
  is `UNI-23` with extra steps.
- **The value varies per environment.** Config, not constant (`UNI-40`).
- **The enclosing function's name already states the rule** and the literal appears once
  (`const isHeavy = (kg: number) => kg > 31.5` inside a five-line module). Marginal; do it when
  you are there, do not open a PR for it.

---

## 2. Self Encapsulate Field

**Resolves:** nothing on its own. It is a precondition-clearing step: it creates the single
read site that techniques 7, 11 and subclass overriding all need.

**Force (1999).** A class reads its own field directly in twenty methods. You now want the value
lazily computed, or overridden by a subclass, or validated. Every one of those requires a hook
at the read, and there are twenty reads.

**Force (TypeScript).** Mostly absent, because a getter is *source-compatible with a field read*:
converting `depot.capacityKg` from a field to `get capacityKg()` edits no call site. The
transformation Fowler describes as a preparatory chore is performed by the language. What
remains is one genuinely checkable hazard, below.

**Preconditions**

- The type is a `class` with instance fields. **If it is a `readonly` record, this technique does
  not apply** — there is no `this`, no override, and nothing to hook.
- At least one of: a subclass must vary the value; the value should become lazily computed and
  cached; a write must be validated.
- **No consumer depends on the field being an own enumerable data property.** This is the trap.
  An accessor declared with `get` lives on the prototype, so it is invisible to `JSON.stringify`,
  to object spread `{...depot}`, to `Object.keys`, and to `structuredClone`. Check each of those
  four before converting a field that crosses a serialization boundary, an ORM hydration, or a
  React prop spread.
- The getter is **pure and cheap**. A getter that performs I/O is the `PY-15` hazard transplanted:
  callers reasonably assume property access cannot fail or block.

**Mechanics**

1. Rename the field to a private one: `capacityKg` → `#capacityKg`.
2. Add `get capacityKg()` returning it. Add a setter **only if writes exist**.
3. Compile. With no setter, `tsc` reports every internal write — that list is the worklist, and
   it is usually shorter than expected.
4. Route internal reads through the accessor. They already are, since the public name moved.
5. Verify the four serialization checks. If one fails, expose an explicit `toJSON()` rather than
   reverting.
6. Now apply the technique that motivated this — lazy computation, override, or validation.

**Before**

```ts
class DepotCapacity {
  constructor(
    public bays: number,
    public bayCapacityKg: number,
    public capacityKg: number,   // must always equal bays * bayCapacityKg
  ) {}
}
```

The invariant in the comment is enforced by nothing, and `capacityKg` can be assigned
independently of the two values that define it.

**After**

```ts
class DepotCapacity {
  constructor(
    readonly bays: number,
    readonly bayCapacityKg: number,
  ) {}

  /** Derived, never stored: cannot disagree with its inputs. */
  get capacityKg(): number {
    return this.bays * this.bayCapacityKg;
  }
}
```

Every existing `dc.capacityKg` read is untouched. The invariant is now unbreakable rather than
documented, because the second copy of the fact no longer exists. **Note that `capacityKg` is
absent from `JSON.stringify(dc)` after this change** — that is precondition three, and it is the
only thing here that can break a caller.

**Postcondition.** The value has exactly one production site. A subclass override, a memo, or a
validation hook is now a one-line change instead of a twenty-site edit.

| Gain | Cost |
|---|---|
| One read site, so lazy computation, caching, override or validation become local changes | An accessor is not an own enumerable property: serialization, spread and clone silently drop it |
| A derived value computed in the getter cannot disagree with its inputs — the second copy is gone | Recomputation on every read; on a measured hot path, memoize deliberately (`UNI-42`) |
| Reads and writes become breakpoint targets | Property access now runs user code, so it can throw where callers assume it cannot |

**When NOT to use this**

- **The module is `readonly` records and pure functions.** Nothing to encapsulate; the technique
  has no referent.
- **The field crosses a serializer or ORM you do not control.** Accessors change the observable
  shape; that is a behavior change, not a refactoring.
- **You are not about to use the hook.** Adding an accessor with no override, no validation and
  no laziness is indirection bought for nothing.
- **The getter would do I/O, mutate, or be expensive.** Make it a method with a verb name.

---

## 3. Encapsulate Field

**Resolves:** Data Class in the OO sense; `CSHARP-22` Public Fields Instead of Properties;
`JAVA-16` Mutable Public Fields in Data Classes.

**Distinction from 2, and it is the whole reason both exist.** Technique 2 is about a type's
access to **its own** field. Technique 3 is about **foreign** access. Applying 3 without a
foreign writer is ceremony; applying 2 without an override, cache or validation is also ceremony.

**Force.** A field is writable from outside the module, and an invariant depends on its value.
Any external write can break the invariant, and the object cannot detect it or react to it. The
blast radius of the invariant is therefore the whole program, not the module.

**Preconditions**

- The field is **written** from outside the declaring module. Reads alone do not motivate this;
  a public readable field with no external writer is fine.
- At least one of: a write can break an invariant; a write must invalidate a derived value or
  cache; a write must emit a notification.
- **If neither holds, stop.** A setter whose body is `this.#x = v` is a public field with three
  extra lines and a stack frame.
- The object is genuinely mutable after construction. If it is not, apply `readonly` and stop —
  that is strictly better than any accessor pair.

**Mechanics — take the first branch that applies**

1. **Immutable branch (prefer this).** Mark the fields `readonly`, construct through one
   function, and express updates as a function returning a new record. `tsc` lists every external
   write; each becomes a call to the update function.
2. **Mutable branch.** Make the field private, add a getter, and add a setter that enforces the
   invariant and throws on violation.
3. Compile. Every external write is now an error; convert them one at a time, running tests.
4. Add one test per rejected write. A setter with no test proving it rejects is not a guard.
5. If the untrusted caller may be JavaScript, `Object.freeze` at construction — `readonly` is
   erased and stops nothing at runtime.

**Before**

```ts
class Dispatch {
  openLanes = 0;                    // invariant: 0 <= openLanes <= bays
  constructor(readonly bays: number) {}
}

// anywhere in the program:
dispatch.openLanes = -1;            // compiles, runs, corrupts every later computation
```

**After — the immutable branch, the usual right answer**

```ts
type Dispatch = { readonly bays: number; readonly openLanes: number };

function openLane(d: Dispatch): Dispatch {
  if (d.openLanes >= d.bays) throw new RangeError(`all ${d.bays} bays already open`);
  return { ...d, openLanes: d.openLanes + 1 };
}

function closeLane(d: Dispatch): Dispatch {
  if (d.openLanes === 0) throw new RangeError("no open lane to close");
  return { ...d, openLanes: d.openLanes - 1 };
}
```

**After — the mutable branch, when the object has a lifecycle it must keep**

```ts
class Dispatch {
  #openLanes = 0;
  constructor(readonly bays: number) {}

  get openLanes(): number { return this.#openLanes; }

  set openLanes(next: number) {
    if (!Number.isInteger(next) || next < 0 || next > this.bays) {
      throw new RangeError(`openLanes must be an integer in [0, ${this.bays}], got ${next}`);
    }
    this.#openLanes = next;
  }
}
```

The immutable branch makes the illegal state unreachable; the mutable branch makes it detectable.
Prefer unreachable. Take the mutable branch only when identity matters — which is technique 11's
criterion, and this is where the two techniques meet.

**Postcondition.** Every write to the field passes through code that can enforce the invariant.
The set of write paths is enumerable by `tsc` rather than by `grep`.

| Gain | Cost |
|---|---|
| The invariant's blast radius shrinks from the program to the module | The immutable branch allocates per update; measure before rejecting it — it is almost always irrelevant |
| Illegal writes fail at the write, naming the field and the bound, instead of surfacing as a wrong number downstream | A setter that only assigns adds indirection for nothing, and looks like a guard to the next reader |
| Write sites become breakpoint- and log-able | `readonly` is erased: JavaScript callers and `as` casts (`TS-09`) still write through |

**When NOT to use this**

- **Immutable data.** `readonly` already gives the postcondition. Accessors on a frozen record
  are pure ceremony.
- **No invariant, no derived value, no notification.** Then the setter is a public field.
- **A DTO at a parse boundary.** Its job is to carry parsed data; the guard belongs in the parse
  (technique 5), not in an accessor on the result.
- **The framework requires plain data** — Redux state, structured-clone messages, React props.
  Accessors break those; see precondition three in technique 2.

---

## 4. Encapsulate Collection

**Resolves:** Inappropriate Intimacy; aliasing defects; `UNI-01` where a type grew because
callers reached into its internals.

**Force.** `depot.pendingLegs` returns the live array. A caller's `push`, `splice`, `sort` or
`reverse` mutates the owner's state with no method call, no validation, and no notification. Two
of those are frequently missed: **`sort` and `reverse` mutate in place** and return the same
array, so `const ordered = depot.pendingLegs.sort(byTime)` silently reorders the owner's state
and looks like a pure expression at the call site.

**Preconditions**

- A member or function returns a collection that is **also retained as state** by the owner. If
  it returns a freshly built array each call, the aliasing hazard does not exist.
- At least one external site mutates it, or could — checkable by changing the exposed type to
  `readonly T[]` and reading the errors.
- The owner has an invariant over the collection (ordering, uniqueness, membership, a bounded
  size, an index kept in sync). **If not, the array is just data and a `readonly` annotation is
  the whole fix.**
- You know whether consumers are inside your type system. `readonly T[]` binds TypeScript callers
  only; it is erased at runtime.

**Mechanics**

1. Change the exposed type from `T[]` to `readonly T[]`. This alone is behaviourally inert —
   `T[]` is assignable to `readonly T[]`, so the owner keeps its mutable array internally.
2. Compile. Every external mutation is now an error. **That list is the worklist.**
3. Convert each error into a named method on the owner (`addLeg`, `cancelLeg`, `reorderLegs`)
   that enforces the invariant. One method, one test, one test run.
4. Decide view-vs-copy by trust boundary: a `readonly` view for in-repo TypeScript callers, a
   defensive copy or `Object.freeze` where untyped JavaScript or a plugin can reach it.
5. Never expose a method whose return type is `T[]` and whose body returns the field. That
   re-opens the hole through a signature the caller reasonably trusts.

**Before**

```ts
class DepotQueue {
  legs: Leg[] = [];                        // invariant: sorted by departedAtEpochMs, ascending
  constructor(readonly code: string) {}
}

// elsewhere — both of these corrupt the invariant, and neither looks like a mutation:
queue.legs.push(lateLeg);
const nextUp = queue.legs.sort((a, b) => a.carrier.localeCompare(b.carrier))[0];
```

**After**

```ts
class DepotQueue {
  #legs: Leg[] = [];                       // invariant: sorted by departedAtEpochMs, ascending
  constructor(readonly code: string) {}

  /** A view, not a copy: zero allocation, and TypeScript callers cannot mutate it. */
  get legs(): readonly Leg[] { return this.#legs; }

  enqueue(leg: Leg): void {
    const at = this.#legs.findIndex((l) => l.departedAtEpochMs > leg.departedAtEpochMs);
    this.#legs.splice(at === -1 ? this.#legs.length : at, 0, leg);   // invariant preserved here
  }

  cancel(waybill: string): boolean {
    const at = this.#legs.findIndex((l) => l.waybill === waybill);
    if (at === -1) return false;
    this.#legs.splice(at, 1);
    return true;
  }
}

// the sort site now fails to compile, and its fix is a non-mutating copy:
const nextUp = [...queue.legs].sort((a, b) => a.carrier.localeCompare(b.carrier))[0];
```

**`readonly T[]` is shallow.** It removes `push`/`splice`/`sort` from the array type and says
nothing about the elements. `queue.legs[0].carrier = "X"` still compiles unless `Leg`'s fields
are themselves `readonly` — which, in the example types above, they are. Check that; a read-only
array of mutable objects is a half-closed door.

**Postcondition.** Every mutation of the collection runs code that can preserve the invariant.
The set of mutators is the owner's method list, which is enumerable and testable. Callers get a
compile error, not a corrupted ordering discovered three screens later.

| Gain | Cost |
|---|---|
| The invariant is enforceable, because every mutation has an owner-controlled entry point | The owner grows methods for operations callers previously did inline |
| `readonly T[]` costs nothing at runtime and is assignable from `T[]`, so step 1 is a pure type change | Erased at runtime: `as Leg[]` (`TS-09`) or a JavaScript caller writes straight through |
| The mutation worklist comes from `tsc`, not from review | A defensive copy at a hot boundary is O(n) per call — measure before choosing copy over view |

**When NOT to use this**

- **The field is already `readonly` on a `readonly` record.** Done; there is no live handle.
- **The collection has no invariant.** A bag of items with no ordering, uniqueness or bound
  constraint does not need named mutators; annotate it `readonly` and stop.
- **The function builds and returns a fresh array each call.** No aliasing exists, so there is
  nothing to encapsulate.
- **A measured hot path** where defensive copying dominates. Use the view form, and if untrusted
  callers exist, fix that at the module boundary instead.

---

## 5. Replace Data Value with Object

**Resolves:** Primitive Obsession; Long Parameter List where adjacent parameters share a
primitive type; Duplicate Code where the same validation appears at ≥3 sites.

**In TypeScript this is a branded type plus one parse function, not a wrapper class.** A branded
type is an intersection of the primitive with a phantom property that exists only in the type
system: it is **erased at compile time**, so the runtime value stays a `string`, the JSON shape
is unchanged, and there is no allocation. The only way to obtain one is through a function that
checks the constraint. The class form is the answer in a language without structural typing;
take it only under the condition stated below.

**Force.** `origin: string` and `destination: string`. Both are depot codes; both are `string`.
`legFor(consignment.destination, consignment.origin)` compiles, runs, and routes freight
backwards. Meanwhile the three-uppercase-letters check is written at the HTTP handler, at the CSV
importer, and in a scheduled job, and the three have already drifted.

**Preconditions**

- The primitive has a constraint its type does not express: a format, a range, a unit, a
  non-empty requirement, or membership in a set.
- At least one of: **≥2 same-typed parameters appear adjacent in a signature** (the swap hazard),
  or the same validation appears at ≥3 sites.
- There is a **single boundary** where values enter — an HTTP handler, a row mapper, a CLI parse
  — or you can create one. A brand's guarantee is exactly as strong as the least disciplined
  construction site, so if values are minted in ten places, fix that first.
- The value must serialize as the bare primitive (no wrapper in JSON, no migration). The brand
  satisfies this by construction; a wrapper class does not without a `toJSON`.

**Mechanics**

1. Declare the brand with a `unique symbol` so no other module can forge it structurally.
2. Write **one** parse function. It is the only place the constraint is checked and the only
   place the assertion to the branded type appears.
3. Change the field and parameter types from `string` to the branded type. Compile.
4. `tsc` now lists every site that constructs one from a bare `string` — the worklist. Route each
   through the parse function, moving the call **toward the boundary**, not leaving it at the
   interior call site.
5. Delete the now-redundant validation at interior sites. The type carries it; a second check is
   dead code that will drift.
6. Add tests for the parse function's rejections, one per rejected shape.

**Before**

```ts
function legFor(origin: string, destination: string): Leg { /* … */ }

// every one of these compiles; the second is wrong and nothing says so.
legFor(c.origin, c.destination);
legFor(c.destination, c.origin);
legFor(c.waybill, c.origin);
```

**After**

```ts
declare const depotBrand: unique symbol;
export type DepotCode = string & { readonly [depotBrand]: "DepotCode" };

const DEPOT_CODE = /^[A-Z]{3}$/;

export function parseDepotCode(raw: string): DepotCode {
  if (!DEPOT_CODE.test(raw)) throw new TypeError(`not a depot code: ${JSON.stringify(raw)}`);
  return raw as DepotCode;                       // the ONLY assertion in the program
}

declare const waybillBrand: unique symbol;
export type Waybill = string & { readonly [waybillBrand]: "Waybill" };

function legFor(origin: DepotCode, destination: DepotCode): Leg { /* … */ }

legFor(c.origin, c.destination);                 // ok
legFor(c.waybill, c.origin);                     // Error: Waybill is not assignable to DepotCode
legFor("MUC", "LHR");                            // Error: string is not assignable to DepotCode
```

The swapped-pair call `legFor(c.destination, c.origin)` still compiles — **both are `DepotCode`,
so branding cannot distinguish them.** Saying otherwise would be false. Two same-branded
parameters are a Long Parameter List problem, fixed by Introduce Parameter Object in
`simplifying-method-calls.md` (`{ from, to }`), and this technique only removes the
*cross-kind* confusions. State the limit; do not oversell the brand.

**The class form, and its one condition.** Take a class when the value has **behaviour plus more
than one field** — a `Money` with an amount and a currency, where addition must reject mixed
currencies. Then it is a genuine object and the wrapper earns its allocation and its `toJSON`.
A class wrapping a single primitive with no behaviour is the Java answer to a problem TypeScript
does not have.

**Postcondition.** Validation exists at exactly one site. A cross-kind argument mix-up is a
compile error. The runtime representation and the JSON wire format are unchanged, so the change
requires no data migration and no consumer coordination.

| Gain | Cost |
|---|---|
| Cross-kind argument mix-ups stop compiling, at zero runtime cost — the brand is erased | Same-branded neighbours are still swappable; that needs a parameter object |
| Validation has one home, so it cannot drift between entry points | Every construction site must route through the parse, including tests and fixtures |
| The type documents the constraint where it is read, not in a comment near where it is checked | A parse that only casts, with no check, is a lie the compiler will now enforce everywhere |
| JSON and DB representation unchanged: adoptable incrementally, one field at a time | One `as` assertion must exist; it must be the only one, and reviewable as such |

**When NOT to use this**

- **The primitive is genuinely unconstrained free text** — a display name, a note field. There is
  nothing for the parse to check, so the brand asserts nothing.
- **The value appears in exactly one signature with no same-typed sibling** and is validated
  where it is used. No swap hazard, no duplication, no payoff.
- **A schema validator already issues the type.** `z.infer` on a refined schema is this technique,
  already applied; adding a second brand on top duplicates the boundary.
- **You do not control the entry points.** With ten construction sites you cannot consolidate,
  the brand advertises a guarantee it does not have — worse than an honest `string`.

---

## 6. Replace Array with Object

**Resolves:** Primitive Obsession in aggregate form; `TS-02`/`TS-09` where indexing a mixed array
forces a cast at every read; Comments that document index meanings.

**Force.** `["MUC", "LHR", 4, 1200]`. Position carries meaning, and position is not checkable.
`row[2]` has type `string | number` at best and `any` at worst, so every read either casts or
widens. Inserting a column shifts every index in the program, and nothing fails to compile.

**The distinguishing test:** an array whose elements are **homogeneous and interchangeable** is
correct and is not this technique. This applies only where **index `i` means something different
from index `j`**.

**Preconditions**

- Elements are heterogeneous by position: the slots have distinct meanings and, usually, distinct
  types.
- **≥2 sites index it by an integer literal.** One site that immediately destructures into named
  bindings is already doing the technique's job.
- The array's length is fixed by the schema, not by data volume.
- If the array crosses a wire or storage boundary you do not control, converting the *stored*
  form is a format change, not a refactoring. In that case the object lives on your side of a
  mapper, and the mapper is the deliverable.

**Mechanics**

1. **Introduce a labelled tuple type at the source.** `[origin: string, destination: string,
   pieces: number, massKg: number]` gives per-index types and names in the IDE at zero runtime
   cost, and is behaviourally inert. Run tests; this step alone should be a green no-op. It is
   also where the checking starts, which is why it is worth doing even if you stop here: verified
   against `--strict`, a fixed-arity tuple turns an out-of-range read into `TS2493 Tuple type
   'ManifestRow' of length '4' has no element at index '7'` and a mistyped read into `TS2322`,
   where the bare `(string | number)[]` reports **nothing** for either. `noUncheckedIndexedAccess`
   does not close that gap — it widens an array element to `T | undefined`, but it never
   bounds-checks a literal index.
2. Write one mapping function `const toManifestRow = (t: RawRow): ManifestRow => ({ … })`. That
   function is the only place an integer literal indexes the array.
3. Convert consumers to the object, one per test run. Each conversion deletes an index literal.
4. When no consumer indexes the tuple, decide: if you own the representation, push the object to
   the source and delete the tuple; if the array **is** the storage format, keep the tuple type at
   the boundary and the mapper beside it.

**Before**

```ts
type RawRow = (string | number)[];

function feeMinor(row: RawRow): number {
  const pieces = row[2] as number;
  const massKg = row[3] as number;
  return pieces * 250 + Math.round(massKg * 12);
}

function label(row: RawRow): string {
  return `${row[0] as string} → ${row[1] as string}`;   // same indices, restated, uncheckable
}
```

**After**

```ts
/** Step 1: the CSV column order, named. Zero runtime cost, still an array. */
type RawRow = readonly [origin: string, destination: string, pieces: number, massKg: number];

type ManifestRow = {
  readonly origin: string;
  readonly destination: string;
  readonly pieces: number;
  readonly massKg: number;
};

/** Step 2: the only place a column index appears in the program. */
const toManifestRow = ([origin, destination, pieces, massKg]: RawRow): ManifestRow => ({
  origin, destination, pieces, massKg,
});

const feeMinor = (r: ManifestRow) => r.pieces * PIECE_FEE_MINOR + Math.round(r.massKg * PER_KG_MINOR);
const label = (r: ManifestRow) => `${r.origin} → ${r.destination}`;
```

Adding a column now edits `RawRow` and `toManifestRow`. Every other function is untouched, and
reordering columns upstream produces a type error in the destructure rather than silently
swapping two values of the same type. The relational analogue of the starting state is `SQL-10`:
structure encoded inside a cell, invisible to the schema.

**Postcondition.** No integer literal indexes the structure outside one mapping function. Adding,
removing or reordering a slot changes exactly two declarations. Every read site names the field
it reads and gets its precise type.

| Gain | Cost |
|---|---|
| Reads are checked by name; the `string \| number` union and its casts disappear | One mapping function and one extra type where there was an array literal |
| Reordering or inserting a slot fails to compile in one place instead of silently shifting meaning | An allocation per row; on a multi-million-row ingest, measure |
| Step 1 (the labelled tuple) is a pure type change, so it can land alone and be reviewed as a no-op | If the array is the storage format, you now maintain both representations |

**When NOT to use this**

- **Homogeneous collections.** A list of legs is a list of legs.
- **A fixed pair with a well-known convention on a measured hot path** — `[x, y]` in a geometry
  inner loop, where the array's flat layout is the reason it is an array. Keep the tuple type;
  skip the object (`UNI-42` applies in both directions).
- **The array is the external format and exactly one consumer reads it.** One destructure at the
  boundary is already the technique's postcondition.
- **The "array" is a two-element pair used as a `Map` entry** and never indexed by literal.

---

## 7. Replace Type Code with Class

**Resolves:** Primitive Obsession on a code field; `UNI-41` where each code value is a bare
literal; Duplicate Code where a `code → attribute` mapping is restated at several sites.

**Fowler's form** is a class with a private constructor and a fixed set of static instances, so
only legal codes can exist. **TypeScript's form** is a union of string literals plus a total
lookup table, which achieves the same closure with no runtime object graph.

**Use this when the code is a label** — possibly with attached data — **and does not select
behaviour.** If ≥2 sites branch on it, the destination is technique 8 or 9, and stopping here
leaves the branching in place.

**Preconditions**

- The set of legal values is **closed and knowable at compile time**. A user-extensible set is not
  this.
- The code does **not** select behaviour at ≥2 sites. Check by grepping for the field name and
  counting `switch`/`if` chains.
- Values enter from outside (a payload, a DB column, a CLI flag). Then a runtime parse must exist:
  **a union type checks nothing at runtime**, and `row.hazard as HazardClass` is `TS-09`.
- Any per-code data you intend to attach is a **constant** per code. Per-code data that is
  computed from instance state is behaviour, and belongs in 9.

**Mechanics**

1. Declare the values once: `const HAZARD_CLASSES = [...] as const`.
2. Derive the type: `type HazardClass = (typeof HAZARD_CLASSES)[number]`. One source, no drift.
3. Attach per-code data in **one** table typed with `satisfies Record<HazardClass, Spec>`. This is
   the total-function check: adding a code without adding a row is a compile error. It reproduces
   the "one instance per code" guarantee with no instances.
4. Write `parseHazardClass(raw: string): HazardClass` at the boundary, using the array as the
   membership test.
5. Change the field type. Compile; convert the sites `tsc` reports.
6. Delete the scattered `code → attribute` lookups; they are now the table.

**Before**

```ts
type Piece = { readonly waybill: string; readonly hazardCode: number };  // 0=none 1=flammable
                                                                        // 2=corrosive 3=radioactive
function placardFor(p: Piece): string {
  if (p.hazardCode === 1) return "FLAM";
  if (p.hazardCode === 2) return "CORR";
  if (p.hazardCode === 3) return "RAD";
  return "";
}

function segregationMetres(p: Piece): number {
  return p.hazardCode === 3 ? 8 : p.hazardCode === 1 ? 3 : 0;   // the same mapping, restated
}
```

**After**

```ts
export const HAZARD_CLASSES = ["none", "flammable", "corrosive", "radioactive"] as const;
export type HazardClass = (typeof HAZARD_CLASSES)[number];

type HazardSpec = { readonly placard: string; readonly segregationMetres: number };

/** `satisfies` makes a missing class a compile error — the totality guarantee. */
const HAZARD: Record<HazardClass, HazardSpec> = {
  none:        { placard: "",     segregationMetres: 0 },
  flammable:   { placard: "FLAM", segregationMetres: 3 },
  corrosive:   { placard: "CORR", segregationMetres: 2 },
  radioactive: { placard: "RAD",  segregationMetres: 8 },
} satisfies Record<HazardClass, HazardSpec>;

export function parseHazardClass(raw: string): HazardClass {
  const found = HAZARD_CLASSES.find((h) => h === raw);
  if (!found) throw new TypeError(`unknown hazard class: ${JSON.stringify(raw)}`);
  return found;
}

type Piece = { readonly waybill: string; readonly hazard: HazardClass };

const placardFor = (p: Piece) => HAZARD[p.hazard].placard;
const segregationMetres = (p: Piece) => HAZARD[p.hazard].segregationMetres;
```

**Not `enum`** (`TS-06`), and the reasons are concrete rather than stylistic: a numeric `enum`
accepts numbers outside its members in older configurations and generates a reverse mapping
object; every `enum` is nominal, so a structurally identical literal from another module is not
assignable; and it emits runtime code, which a `const` array plus a derived type does not need
beyond the array itself.

**Postcondition.** An illegal literal is a compile error. An illegal runtime value is rejected at
the boundary, naming the field and listing the legal set. Adding a hazard class forces every table
to be completed before the build passes. The `code → attribute` mapping has one home.

| Gain | Cost |
|---|---|
| The legal set is closed at compile time and checked once at runtime | A union type is erased; without the boundary parse it guarantees nothing |
| `satisfies Record<Code, T>` makes an incomplete table a compile error, replacing a class of tests | The table must live somewhere both consumers import — watch for cycles (`TS-13`) |
| String codes are self-describing in logs and DB columns; a numeric code needs a decoder ring | Migrating a stored numeric column to strings is a data migration, not a refactoring |

**When NOT to use this**

- **The set is open.** User-defined tags or plugin-supplied kinds must stay `string` with a
  registry; a fabricated closed union will be wrong on the first extension.
- **The code selects behaviour.** Go to 9 (immutable code) or 10 (mutable code); this technique
  closes the set but leaves the branching untouched.
- **A generated client forces an `enum`.** Wrap it once at your boundary; do not fight the
  generator, and do not spread its enum through the domain.
- **There is one value and a "someday there will be more."** Speculative Generality; wait for the
  second.

---

## 8. Replace Type Code with Subclasses

**In TypeScript this is a discriminated union, and the union is strictly stronger than
subclassing for the property you care about:** adding a variant becomes a **compile error at
every exhaustive site**. Adding a subclass gives you no such signal — the new subclass silently
inherits base behaviour, and you discover the omission in production.

**Resolves:** `UNI-02` Type Switch Sprawl; `TS-10` Missing Discriminant in Union Types;
`TS-07` Discriminated Union Without Exhaustiveness; Temporary Field, where a property is valid
for one code value only.

**Preconditions**

- The code selects behaviour, or the variants carry **different fields**. Different fields is the
  stronger signal, because it is what makes optional properties multiply.
- **The code is immutable for the object's lifetime.** This is the precondition that separates 8
  from 9, and it is checkable: grep for assignments to the field. If an instance's code changes,
  a union member must be *replaced* rather than mutated, and every alias holding the old value is
  now stale — that is technique 9's problem, and 9 is the right technique.
- Consumers are enumerable. Once the union exists, `tsc` enumerates them for you.
- Technique 7 has closed the set, or you close it here as step 1.

**Mechanics**

1. Give the variants a **literal discriminant property**, conventionally `kind` or `type`. Without
   one, narrowing does not work (`TS-10`).
2. Define the union so **each member carries only the fields valid for it**. This is where the
   `field?: T, only present when code === X` shapes die, and it is most of the value.
3. At each branching site, convert the `if`/`else` chain to `switch (x.kind)` with
   `default: assertNever(x)`. One site per test run.
4. Enable `@typescript-eslint/switch-exhaustiveness-check` so the guarantee cannot regress
   (`TS-07`).
5. **Add the new variant last.** `tsc` now enumerates every site that must handle it. That
   enumeration is the payoff; do not spend it by adding the variant first with a `default` branch.

**Before**

```ts
type Leg = {
  readonly waybill: string;
  readonly mode: "road" | "air" | "sea";
  readonly plateNumber?: string;   // road only
  readonly flightNo?: string;      // air only
  readonly vesselImo?: string;     // sea only
};

function trackingRef(leg: Leg): string {
  if (leg.mode === "road") return `TRK:${leg.plateNumber!}`;   // TS-03, three times
  if (leg.mode === "air") return `FLT:${leg.flightNo!}`;
  return `IMO:${leg.vesselImo!}`;
}
```

Three optionals, three non-null assertions, and `{ mode: "air", plateNumber: "X-99" }` is a
perfectly legal value of this type.

**After**

```ts
type RoadLeg = { readonly kind: "road"; readonly waybill: string; readonly plateNumber: string };
type AirLeg  = { readonly kind: "air";  readonly waybill: string; readonly flightNo: string };
type SeaLeg  = { readonly kind: "sea";  readonly waybill: string; readonly vesselImo: string };
type Leg = RoadLeg | AirLeg | SeaLeg;

function trackingRef(leg: Leg): string {
  switch (leg.kind) {
    case "road": return `TRK:${leg.plateNumber}`;   // narrowed; no assertion, no optional
    case "air":  return `FLT:${leg.flightNo}`;
    case "sea":  return `IMO:${leg.vesselImo}`;
    default:     return assertNever(leg);
  }
}
```

Adding `type RailLeg = { kind: "rail"; waybill: string; wagonNo: string }` to the union produces
a compile error in `trackingRef` and in every other exhaustive site — `leg` is `RailLeg` at the
`default`, which is not assignable to `never`. **That error list is the technique's entire
value.** The illegal combination `{ kind: "air", plateNumber }` no longer typechecks.

**Postcondition.** Every optional property that existed only to serve one code value is gone.
Each variant's required fields are required. Adding a variant fails the build at every site that
must change, before any test runs.

| Gain | Cost |
|---|---|
| Adding a variant is a compile error at every exhaustive site — a guarantee subclassing does not provide | Every consumer must handle every variant, including consumers that only cared about one |
| Illegal field combinations become unrepresentable, so the non-null assertions (`TS-03`) delete | Shared fields are repeated across members, or need an intersection with a base type |
| Narrowing is automatic inside each branch; no casts | Serialization must carry the discriminant; adding it to stored rows is a migration |
| Variants are constructible in tests as literals — no class, no factory | With one branching site and a stable set, this is over-structure (`UNI-09`) |

**When NOT to use this**

- **The variants differ only by constant data.** That is technique 10 run backwards, or the
  lookup table in technique 7. A union of three members whose only difference is a number is
  three types bought for one table row.
- **The code changes during the object's lifetime.** Use 9; a variant cannot mutate into another.
- **One branching site, a stable set of two.** `UNI-09`; an `if` is correct.
- **The discriminant cannot be added to the persisted shape.** Then the union exists only
  in-memory and the parse must derive `kind` — legitimate, but it is the parse boundary's job
  (technique 5), and the
  derivation rule needs a test.

---

## 9. Replace Type Code with State/Strategy

**Resolves:** `UNI-02` Type Switch Sprawl where the code is mutable; Switch Statements repeated
across methods; state machines whose legal transitions are implicit in scattered conditionals.

**This entry does not restate the patterns.** Structure, trade-offs and the TypeScript forms are
in `../../patterns/state.md` and `../../patterns/strategy.md`; read one of those before
applying. What follows is what belongs to the *refactoring*: when it applies, and how to get
there without a behavior change.

**Force.** The same discriminant is branched on in several methods, and — unlike technique 8 —
**the discriminant changes during the object's lifetime**. A union cannot express that: a value
does not mutate into another variant, so every alias to the old value would go stale. What varies
is not the object's identity but its behaviour, which is exactly what State and Strategy separate.

**The selection rule, in one line:** *if an implementation ever assigns the next implementation,
it is State; if the caller picks from outside and the alternatives are unaware of each other, it
is Strategy.*

**Preconditions**

- The code selects behaviour at **≥2 sites** — one site is an `if` (`UNI-09`).
- **The code is mutated after construction.** If it is not, use 8; it is cheaper and gives
  exhaustiveness.
- For State: the legal transitions form a machine worth writing down, and an illegal transition is
  a real failure mode with a real cost.
- For Strategy: the alternatives are **independent** — they share no state, do not call each
  other, and change for different reasons.
- `../../selection.md`'s threshold is met. Below it, a table or a `switch` is correct and the
  pattern is `UNI-09`/`UNI-10`.

**Mechanics**

1. Apply technique 7 first. A pattern over an open `string` code has no closure to rely on.
2. Classify with the selection rule above. Getting this wrong produces a State that cannot
   transition or a Strategy that secretly sequences itself.
3. **For State, write the transition table before writing any class.** In TypeScript the table is
   frequently the whole answer — it puts the entire machine in one readable place, which the class
   form distributes. See the table form in `../../patterns/state.md`.
4. Lift to one object per state **only if** states carry distinct data or substantially distinct
   behaviour beyond "which transitions are legal".
5. For Strategy, start from a function type. A one-method interface is a function type; a class
   with a single `execute()` is that function wearing a costume — see `../../patterns/strategy.md`.
6. Delete the code field **last**, after every branch site routes through the table or the object.
   Deleting it first leaves you with no way to reconstruct the old behaviour during the migration.

**Before**

```ts
class Shipment {
  status: "booked" | "loaded" | "departed" | "arrived" = "booked";

  load()    { if (this.status !== "booked") throw new Error("bad"); this.status = "loaded"; }
  depart()  { if (this.status !== "loaded") throw new Error("bad"); this.status = "departed"; }
  arrive()  { if (this.status !== "departed") throw new Error("bad"); this.status = "arrived"; }
  cancel()  { if (this.status === "departed" || this.status === "arrived") throw new Error("bad");
              this.status = "booked"; }
}
```

Four methods, the same chain in each, and the machine exists only in the reader's head.

**After — the table form, which is where to stop for a machine this size**

```ts
type Status = "booked" | "loaded" | "departed" | "arrived" | "cancelled";
type Action = "load" | "depart" | "arrive" | "cancel";

const TRANSITIONS = {
  booked:    { load: "loaded",   cancel: "cancelled" },
  loaded:    { depart: "departed", cancel: "cancelled" },
  departed:  { arrive: "arrived" },
  arrived:   {},
  cancelled: {},
} as const satisfies Record<Status, Partial<Record<Action, Status>>>;

export function apply(from: Status, action: Action): Status {
  const to = TRANSITIONS[from][action as keyof (typeof TRANSITIONS)[typeof from]];
  if (!to) throw new Error(`cannot ${action} a shipment that is ${from}`);
  return to;
}
```

The machine is now one readable object, `satisfies` makes a missing status a compile error, and
the four near-identical guards collapse into one. Only if a status also carries its own data or
its own substantially different behaviour do you lift the table into state objects — that
decision, and its costs, are in `../../patterns/state.md`.

**Postcondition.** Legal transitions are stated in one place instead of being inferred from
conditionals in N methods. Adding a status is one table entry plus whatever the compiler then
demands. Illegal transitions fail in one function with a message naming both the state and the
action.

| Gain | Cost |
|---|---|
| The machine becomes readable data; adding a state does not edit the existing branches | Behaviour moves away from the call site — the price of every indirection in this group |
| Illegal transitions fail in exactly one place, with both operands in the message | The class form distributes the machine across files; no one file shows it (the table form is the fix) |
| Each state's behaviour becomes independently testable | Below `../../selection.md`'s threshold this is `UNI-09`/`UNI-10`: a pattern bought for two branches |

**When NOT to use this**

- **The code never changes after construction.** Technique 8; the union is stronger.
- **Two states with a trivial difference.** A boolean and an `if`.
- **Transitions are fixed and the machine is small.** Stop at the table. Do not lift to classes to
  match a diagram.
- **The alternatives are not independent and one decides which runs next** — then it is not
  Strategy, whatever the ticket called it. `../../patterns/state.md` states the distinction.

---

## 10. Replace Subclass with Fields

**The inverse of 9**, and the one that runs when 9 was applied too eagerly — or when a hierarchy
that once carried behaviour has been hollowed out by later edits until only constants remain.

**Resolves:** Lazy Class; Speculative Generality; `UNI-09`/`UNI-10` where a hierarchy or factory
exists to deliver constants.

**Force.** Three subclasses, or three union members, whose only difference is the literal each
returns. Each costs a type, a construction decision, a place in the factory, and a file in the
reader's working set — and buys a number. The variance is data pretending to be polymorphism.

**Preconditions — the first is the whole technique**

- **Every difference between the variants is a constant.** Check each differing member: its body
  must return a literal, with no branching, no I/O, and no read of instance data. One member that
  reads instance state disqualifies the whole set — that member is real behaviour, and collapsing
  it hides a branch inside a table.
- No variant carries a field the others lack. If the field sets are disjoint, technique 8 is doing
  real work and this would resurrect the optional-property shape it removed.
- No consumer relies on the variant as a **nominal type**: no `instanceof`, no narrowing whose
  purpose is to reach a variant-only field, no external code implementing the base.
- No variant is constructed polymorphically through a mechanism (a plugin registry, a
  deserializer) that would also have to collapse.

**Mechanics**

1. Enumerate the differing members and verify each returns a constant. Write them into a table on
   paper first; a member you cannot write as a table cell is the disqualifying case.
2. Build one `satisfies Record<Variant, Fields>` table. `satisfies` makes a missing variant a
   compile error, which replaces the coverage the subclasses gave you for free.
3. Replace constructions with a single factory reading the table. Keep the discriminant field —
   you still need to say **which** one it is; you are removing the *types*, not the distinction.
4. Delete one variant at a time and let `tsc` enumerate its sites. Test run between each.
5. Delete the base type or interface if nothing implements it.

**Before**

```ts
abstract class LegKind {
  abstract handlingFeeMinor(): number;
  abstract maxMassKg(): number;
  abstract requiresCustoms(): boolean;
}
class RoadKind extends LegKind {
  handlingFeeMinor() { return 400 }  maxMassKg() { return 24_000 }  requiresCustoms() { return false }
}
class AirKind extends LegKind {
  handlingFeeMinor() { return 2_500 } maxMassKg() { return 1_200 } requiresCustoms() { return true }
}
class SeaKind extends LegKind {
  handlingFeeMinor() { return 900 }  maxMassKg() { return 60_000 } requiresCustoms() { return true }
}
```

Three classes, nine methods, zero behaviour.

**After**

```ts
export const LEG_MODES = ["road", "air", "sea"] as const;
export type LegMode = (typeof LEG_MODES)[number];

type LegKind = {
  readonly mode: LegMode;
  readonly handlingFeeMinor: number;
  readonly maxMassKg: number;
  readonly requiresCustoms: boolean;
};

const LEG_KINDS = {
  road: { mode: "road", handlingFeeMinor:   400, maxMassKg: 24_000, requiresCustoms: false },
  air:  { mode: "air",  handlingFeeMinor: 2_500, maxMassKg:  1_200, requiresCustoms: true  },
  sea:  { mode: "sea",  handlingFeeMinor:   900, maxMassKg: 60_000, requiresCustoms: true  },
} satisfies Record<LegMode, LegKind>;

export const legKind = (mode: LegMode): LegKind => LEG_KINDS[mode];
```

The whole variance is now visible as a grid, which is also the form in which a domain expert can
check it — the previous version required reading three files to answer "which modes need
customs". Adding a mode is one row, and `satisfies` fails the build until it is complete.

**Postcondition.** One type where there were N. The per-variant data is a single table, readable
as a matrix. Adding a variant is one row plus whatever the compiler demands.

| Gain | Cost |
|---|---|
| N types, N files and a construction decision collapse into one table | The variants stop being distinct types, so `instanceof`-style narrowing is gone |
| The variance is visible as a grid and reviewable by someone who does not read TypeScript | Reintroducing genuine behaviour later means running technique 8 again |
| `satisfies Record<Variant, T>` keeps totality as a compile error | If one difference is behaviour, the table hides a branch — the disqualifying precondition |

**When NOT to use this**

- **Any variant's differing member branches, does I/O, or reads instance data.** Not constants;
  keep 9.
- **The variants carry disjoint fields.** The union is preventing illegal combinations, which is
  worth more than the type count.
- **A named upcoming edit adds behaviour to one variant.** Then the hierarchy is about to earn
  itself. *Named*, with a ticket — not "we might".
- **External code implements the base type.** Collapsing it is a breaking API change, not a
  refactoring.

---

## 11. Change Value to Reference

**Definitions, because the rest of this entry and all of 13 depend on them.**

- **Value semantics.** Two instances with equal fields are interchangeable. Identity carries no
  information; copying is free and safe; the type should be immutable. Equality is *structural*.
- **Reference semantics.** Exactly one object exists per real-world entity. Identity carries
  information; every holder holds the same object, so **a mutation through any alias is
  observable through all of them**. Equality is `===`.

**Aliasing** is what makes them differ: two names bound to the same object. That is the point of a
reference and the defect of a value.

**These two techniques are exact inverses, so state the criterion or the code oscillates between
them across successive refactors.** The criterion:

| Question | Reference | Value |
|---|---|---|
| Does the thing have a **lifecycle** that outlives any one record? | yes | no |
| Must an update be visible to **every** holder? | yes | no — holders keep their own |
| Does identity carry information beyond the field values? | yes | no |
| Is it **mutated after construction**? | it must be a reference | may be either; value is simpler |
| Is it a **historical snapshot** — a fact as of a moment? | no | yes, always |

The last row is the one that gets decided wrongly. A consignment's destination *depot record as
printed on the waybill* is a snapshot and must be a value; the *current* state of that hub is an
entity and must be a reference. They look identical in a type declaration and are opposites.

**Resolves:** Duplicate Code where the same update must be applied to N copies; inconsistent
reads where two copies of one entity disagree; memory pressure from thousands of equal copies.

**Force.** Four thousand `Consignment` records each embed a full `Depot`. The Munich hub changes
its name. There is now no single write that fixes it: every copy must be found and updated, and
until each one is, two copies of the same hub disagree. The record has stopped being a function of
the world it describes.

**Preconditions**

- The embedded object corresponds to a **real-world entity with its own lifecycle**, not a
  measurement, amount, coordinate, or snapshot.
- There is a **unique and stable identity field**. Checkable: could two distinct entities ever
  share this key, and can the key itself change? If the key can change, the "reference" is not one.
- There is **one place** the registry can be populated — a repository load, a boundary fetch, a
  startup import. Two population paths means two registries.
- Direct construction can be made unavailable. If any module can still build a `Depot` literal,
  duplicates survive and the technique's guarantee does not hold.
- The graph is not serialized with `JSON.stringify` after this change, or the cycle is broken by a
  `toJSON` that emits the key. A reference graph with a back-link throws on stringify.

**Mechanics**

1. Choose the identity field and verify uniqueness and stability against real data, not against
   intention.
2. Build the registry: a `Map<Key, T>` populated **once** from a single source, exposed through a
   lookup function. Populate it eagerly at a known point rather than lazily on first miss; lazy
   population makes the failure mode "silently absent" instead of "loudly missing".
3. Make the lookup the **only** construction path from outside the module. Do not export the
   record's constructor or a bare literal factory.
4. Replace the embedded copy with the key on the holding record, and resolve at use.
5. Convert **one consumer at a time**, running tests between. The intermediate state — some
   consumers embedding, some resolving — is valid and safe.
6. Delete the embedded field only after no consumer reads it.

**Before**

```ts
type Consignment = {
  readonly waybill: string;
  readonly originDepot: Depot;         // a full copy, per consignment
  readonly destinationDepot: Depot;    // another
};

// A hub renames. There is no single write that fixes this.
```

**After**

```ts
const depots = new Map<string, Depot>();

/** The only construction path. Populated once, at startup, from one source. */
export function loadDepots(rows: readonly Depot[]): void {
  depots.clear();
  for (const d of rows) depots.set(d.code, d);
}

export function depot(code: string): Depot {
  const found = depots.get(code);
  if (!found) throw new Error(`unknown depot: ${code}`);   // loud, not undefined
  return found;
}

type Consignment = {
  readonly waybill: string;
  readonly origin: string;             // a depot code
  readonly destination: string;
};

const originName = (c: Consignment) => depot(c.origin).name;
```

**The aliasing consequence, stated plainly:** after this change every holder sees the same `Depot`
object, so a mutation through one is observable through all. **That is precisely the point when
the depot is one real hub, and precisely the defect when the embedded copy was a snapshot of the
hub as of shipping time.** Decide which you have before starting; the two produce identical code
and opposite correctness.

**Postcondition.** Exactly one live object per identity. `a === b` holds if and only if they are
the same entity. An update to an entity is a single write, visible to every holder immediately.

| Gain | Cost |
|---|---|
| An entity update is one write, seen by every holder; two holders can no longer disagree | The registry is shared mutable state: it has a lifecycle, an owner, and a staleness question |
| Memory drops from N copies to one, and equality becomes `===` instead of a field-by-field walk | Test isolation breaks — a module-level registry leaks between tests (`UNI-25`); reset it per test |
| Unknown keys fail loudly at lookup rather than silently as a missing field | `JSON.stringify` on a graph with back-links throws; serialization now needs an explicit shape |
| The identity question is answered once, in one module | A global registry with no injection point is `UNI-06` in a different shape |

**When NOT to use this**

- **The embedded copy is a historical snapshot.** A waybill's printed origin details must not
  change when the hub is renamed. Snapshots are values, permanently.
- **No unique, stable key.** Without one the registry is a guess.
- **The object is immutable and small, and sharing would buy only memory.** That is Flyweight, not
  this: measure first, and read `../../patterns/flyweight.md` — it is an optimization, not a
  design improvement (`UNI-42`).
- **The registry would be a mutable global with no injection point.** Then you have swapped a
  duplication problem for `UNI-06`. Pass the registry, or make it explicitly a boundary-owned
  cache.

---

## 12. Change Reference to Value

**The inverse of 12.** Use the criterion table in 12 to pick a side — with no stated reason to
prefer one, this pair oscillates across successive refactors, which is one of the hard stops in
`../../refactoring.md`.

**Resolves:** `UNI-25` Test Data Coupling, where a shared registry makes tests order-dependent;
`CSHARP-09`-shaped defects, where a mutation through one alias surprises another holder;
Inappropriate Intimacy through a global identity map.

**Force.** A `MassKg` (or a `Money`, a `GeoPoint`, a `DateRange`) lives in a registry, is looked up
by id, and is mutated in place. Every holder must now defend against a mutation it did not make.
Equality requires resolving both sides. The registry is shared mutable state, so tests must run in
a fixed order, and a scheduled job that adjusts one instance changes a report that was already
computed. None of this buys anything, because two masses of 4.2 kg are interchangeable — the
identity the registry maintains carries no information.

**Preconditions**

- **Identity carries no information.** Checkable: no site compares instances with `===` or by id
  *expecting entity identity*, and no site would behave differently if handed an equal copy.
- The object is not mutated after construction, or every mutation site can be rewritten as
  "construct a new one". Enumerate them before starting.
- The object is **small enough that copying is not measured cost**. This is the one precondition
  that is genuinely a measurement, not an inspection.
- No invariant depends on there being exactly one instance — a lock, a connection, a counter, a
  subscription. Those are entities by definition.
- No site uses the object as a `Map`/`Set` key. See the hazard below.

**Mechanics**

1. Make the type immutable: every field `readonly`; every mutator becomes a function returning a
   new instance. Compile — the mutation sites are the worklist.
2. Write a structural `equals`, and **replace every `===` comparison between instances**. `tsc`
   will not find these: `===` on two values of the same type is always legal. Grep the type name,
   inspect each comparison by hand, and note in the PR description that this was done — it is the
   only unverifiable step in the technique.
3. Replace registry lookups with direct construction or embedding.
4. Delete the registry. Delete the tests that existed only to reset it.
5. If untrusted JavaScript consumers exist, `Object.freeze` at construction; `readonly` is erased.

**Before**

```ts
class MassKg {
  private constructor(readonly id: string, public kg: number) {}
  private static all = new Map<string, MassKg>();
  static get(id: string) { return MassKg.all.get(id)! }
  static create(id: string, kg: number) { const m = new MassKg(id, kg); MassKg.all.set(id, m); return m }
}

// A holder's value changes under it, from a module it never imported.
MassKg.get("m-91")!.kg = 5.0;
```

**After**

```ts
export type MassKg = { readonly kg: number };

export const mass = (kg: number): MassKg => {
  if (!Number.isFinite(kg) || kg < 0) throw new RangeError(`mass must be finite and >= 0: ${kg}`);
  return Object.freeze({ kg });
};

export const addMass = (a: MassKg, b: MassKg): MassKg => mass(a.kg + b.kg);
export const massEquals = (a: MassKg, b: MassKg): boolean => a.kg === b.kg;
```

**The JavaScript hazard, and it is silent.** `===` on objects is *always* reference equality, and
there is no operator overloading, so value semantics here are a convention enforced by the absence
of mutators and by review — not by the language. The concrete failure: a value object used as a
`Map` or `Set` key is keyed by **reference**, so `set(mass(4.2), x).get(mass(4.2))` returns
`undefined` and no type error is produced. Key by a derived primitive (`m.kg`, or a canonical
string) instead. This is the TypeScript analogue of `JAVA-04` — value equality defined without the
hashing contract that collections require.

**Postcondition.** The type has no mutators, no registry, and no lifecycle. Instances are freely
copyable and shareable across threads, tests and caches with no aliasing hazard. Equality is a
named function, applied consistently.

| Gain | Cost |
|---|---|
| Aliasing defects become impossible: no holder can be surprised by a mutation it did not make | Copying allocates; on a measured hot path with large objects this is real |
| The registry's lifecycle, staleness and test-isolation problems disappear with it | `===` between instances silently becomes wrong, and `tsc` flags none of it |
| Instances are constructible in tests as literals; no fixture, no reset hook (`UNI-25`) | Using a value as a `Map`/`Set` key silently keys by reference — key by a derived primitive |
| Immutability makes memoization and structural sharing safe | An update must be propagated to holders explicitly; nothing broadcasts it |

**When NOT to use this**

- **Identity is meaningful.** A user, an account, a session, a device: two records with equal
  fields are still two different things.
- **The object is mutated and holders must see the mutation.** That is the definition of a
  reference.
- **It is large and copied on a measured hot path.** Measure; `UNI-42` cuts both ways.
- **It owns a resource or has a lifecycle** — a connection, a file handle, a subscription. Those
  are never values.

---

## 13. Change Unidirectional Association to Bidirectional

**Resolves:** a query that scans a whole collection to invert a link; Message Chains where callers
walk a long path to answer "who points at me".

**The cost of this technique is an invariant the language will not enforce.** After it, two fields
must agree, and TypeScript cannot express "these two agree". Every mutation path must update both
sides, and any path that updates one leaves the model inconsistent in a way nothing detects — a
query simply returns the wrong answer, later, somewhere else. Weigh that before starting: **this is
the most expensive technique in the group.**

**Preconditions**

- There is a **named, existing** need to navigate from B to A. Not "we might" — a specific call
  site that exists today and is currently doing a scan.
- **The back-link cannot be derived cheaply enough.** Check this first and honestly: a `Map` index
  rebuilt when the collection loads is *derived*, so it cannot disagree with its source. `Map.groupBy`
  builds one in a line. Prefer it unless the collection mutates continuously.
- **One side is designated the owner** of the link, and only the owner's methods mutate it. Two
  owners means two update paths and eventual disagreement; this precondition is not optional.
- The graph is not serialized with `JSON.stringify` as-is. A cycle throws.
- The two modules do not end up importing each other (`TS-13`). If they would, the link belongs in
  a third module that owns the relation.

**Mechanics**

1. **Try the derived index first and stop there if it works.** It is one line, has no invariant,
   and cannot go stale.
2. If it does not, decide the owner. The owner is the side whose lifecycle governs the link —
   usually the "many" side, which cannot exist without the "one".
3. Add the back-link as a private field, never assigned from outside.
4. Add **one** method that sets both sides. Delete every other write path; making both fields
   private or `readonly`-typed lets `tsc` enforce that there is exactly one.
5. Add a removal path in the same commit. Forgetting removal is where the defect lives: a stale
   back-link keeps a removed object reachable, which is `UNI-07`'s shape without an event emitter.
6. Add a test asserting the invariant in both directions, after an add **and** after a remove. That
   test is the only thing standing between you and silent divergence.

**Before — and the derived alternative, which is usually where to stop**

```ts
// Unidirectional: a Leg names its consignment. "Which legs belong to this consignment?" is a scan.
const legsOf = (waybill: string, all: readonly Leg[]) => all.filter((l) => l.waybill === waybill);

// Derived index: built once, cannot disagree with its source, needs no invariant.
const byWaybill = Map.groupBy(allLegs, (l) => l.waybill);
```

**After — the genuine bidirectional form, when the graph mutates continuously**

```ts
class Consignment {
  readonly #legs = new Set<MutableLeg>();
  constructor(readonly waybill: string) {}

  get legs(): readonly MutableLeg[] { return [...this.#legs] }   // technique 4 applies here too

  /** The ONLY writer of either direction. */
  attach(leg: MutableLeg): void {
    if (leg.consignment === this) return;                        // idempotent: re-entrancy guard
    leg.consignment?.detach(leg);                                // leave the previous parent first
    this.#legs.add(leg);
    leg.setConsignment(this);
  }

  detach(leg: MutableLeg): void {
    if (!this.#legs.delete(leg)) return;
    leg.setConsignment(undefined);                               // both sides, always
  }
}

class MutableLeg {
  #consignment: Consignment | undefined;
  constructor(readonly carrier: string) {}
  get consignment(): Consignment | undefined { return this.#consignment }

  /** @internal — called only by Consignment.attach/detach. */
  setConsignment(c: Consignment | undefined): void { this.#consignment = c }
}
```

The invariant is *`leg ∈ c.legs` if and only if `leg.consignment === c`*. Nothing in the type
system says so; the single write path and the test do. Note the two guards that are easy to omit
and expensive to debug: the idempotence check that prevents infinite recursion between `attach` and
`detach`, and the detach-from-previous-parent step without which a leg appears in two consignments.

**Postcondition.** Exactly one function mutates the relation. The invariant is stated in a test
that runs on every commit. Navigation in both directions is O(1) rather than O(n).

| Gain | Cost |
|---|---|
| Reverse navigation becomes O(1) instead of a scan of the collection | An invariant across two fields, enforced by discipline and one test, never by the compiler |
| Cascading operations (detach all legs of a cancelled consignment) become expressible | `JSON.stringify` on the cycle throws; serialization needs an explicit shape |
| Both endpoints are reachable from either handle, so callers stop threading collections through | Two modules that know about each other — watch for an import cycle (`TS-13`) |
| — | A stale back-link keeps a removed object reachable: a leak with no event emitter to blame |

**When NOT to use this**

- **A derived index suffices.** It has no invariant. This is the common case and the first thing
  to try.
- **The data is `readonly` records.** Then compute the grouping (`Map.groupBy`) — a back-link in
  immutable data must be established at construction, which is impossible for a genuine cycle
  without a mutable initialization window.
- **The graph is serialized as-is.** Cycles and `JSON.stringify` do not coexist.
- **An ORM already manages the relation.** Maintaining both sides by hand alongside it produces
  two owners, which is the precondition you were told not to violate.
- **The need is speculative.** No current call site, no technique.

---

## 14. Change Bidirectional Association to Unidirectional

**The inverse of 14, and the more commonly needed direction.** Bidirectional links accumulate:
each was added for a query that has since moved or been deleted, and the invariant maintenance
outlives the reason for it.

**Resolves:** Inappropriate Intimacy; `TS-13` Circular Import Dependencies; the invariant burden
introduced by 14.

**Force.** Two links must agree, and maintaining that agreement costs a write path, a removal path,
a re-entrancy guard, and a test — for a direction nothing reads any more, or reads once, cheaply
derivable.

**Preconditions**

- One direction has **no reader**, or its readers can be served by a derived query at acceptable
  cost. Checkable, and this is the definitive check: **delete the field and read `tsc`'s error
  list.** `knip` finds unread exports; neither `grep` nor inspection is sufficient, because
  re-exports and dynamic access hide readers.
- Removing it does not break a serializer's expected shape or an ORM mapping (the ORM case usually
  means the link is not yours to delete).
- The surviving direction is the one whose lifecycle governs the relation. If you keep the wrong
  side, every query inverts and you have made things worse.

**Mechanics**

1. Delete the field. Compile. The error list is the complete set of readers.
2. For each reader, substitute a query through the surviving direction, or a derived index built
   at the call site's scope.
3. When no reader remains, delete the field permanently along with **the code that maintained it**
   — the setter, the removal path, the re-entrancy guard.
4. Delete the invariant test from technique 13. It now asserts a relation that does not exist, and
   a test that cannot fail is worse than no test (`UNI-23`).
5. Run the suite. Check the import graph: this change frequently breaks a cycle, and that is worth
   noting in the commit message.

**Before**

```ts
class MutableLeg {
  #consignment: Consignment | undefined;                 // one reader left, in a report
  get consignment(): Consignment | undefined { return this.#consignment }
  setConsignment(c: Consignment | undefined): void { this.#consignment = c }
}
```

**After**

```ts
class MutableLeg {
  constructor(readonly carrier: string) {}               // no back-link, no setter, no guard
}

/** The one reader, served by the surviving direction. */
function consignmentOf(leg: MutableLeg, all: readonly Consignment[]): Consignment | undefined {
  return all.find((c) => c.legs.includes(leg));
}
```

`Consignment.attach` loses its `leg.setConsignment` calls and its detach-from-previous-parent step,
because there is no longer a second field that could disagree. **The invariant is gone, not
maintained — that is the deliverable**, and the diff is mostly deletions, which is the shape a
successful application of this technique has.

**Postcondition.** One direction of navigation. No cross-field invariant. `JSON.stringify` works on
the graph again. The import graph is a DAG if the removed direction was the back edge.

| Gain | Cost |
|---|---|
| An invariant the compiler could not check simply ceases to exist | Reverse navigation becomes O(n) — measure if it is on a hot path |
| The write path, removal path, re-entrancy guard and invariant test all delete | If the direction is needed again, technique 13 must run again with all its costs |
| Frequently breaks an import cycle (`TS-13`) and makes the graph serializable | Picking the wrong survivor inverts every query; verify by reader count before deleting |

**When NOT to use this**

- **The reverse query is O(n) on a measured hot path.** Keep the link, or replace it with a derived
  index maintained at one place.
- **An ORM's cascade or lazy-loading depends on the mapping.** Deleting the field fights the
  framework and the framework wins.
- **Readers exist that `tsc` will not show you** — dynamic property access, a serializer reading by
  string key, a template. Grep for the field name as a string before concluding it is unread.

---

## 15. Duplicate Observed Data

**Mark this one honestly: it is a GUI technique from 1999 that assumes a specific MVC arrangement,
and in a declarative UI it is inverted.**

Its original context: a windowing toolkit (Swing, AWT, VB forms) where widget objects held the only
copy of application data in their own fields, mixed with layout and event handling. There was no
mechanism to derive one from the other, so the remedy was to create a second, domain-side copy and
keep the two in sync with Observer. **In React, Svelte or Solid, render is already a function of
state**; the widget holds no authoritative data, so the technique's premise is absent and its
remedy — add a second copy and sync it — is the modern anti-pattern (`REACT-07`, derived state
stored in `useState`). If you find yourself applying this to a declarative component, apply the
inverse: delete the copy and compute the value during render.

**Where it still genuinely applies**, and this is a real and non-trivial set: an imperative UI
surface that owns a mutable model you cannot render from state. A `<canvas>` or WebGL scene graph.
A code editor with its own document model (CodeMirror, Monaco). A charting library holding a series
buffer. A native control behind a bridge. There the widget really does own mutable state, and you
really do need two copies plus a stated sync direction.

**Resolves:** domain logic trapped in a UI class where it cannot be tested without the UI; a
domain rule that exists only as a widget event handler.

**Force.** The rule "a consignment over the manual-lift limit needs a two-handler flag" lives in a
drag-handler on a dispatch board. It cannot be tested without instantiating the board, cannot be
reused by the batch importer, and drifts from the server's copy of the same rule.

**Preconditions**

- A UI component holds domain data in its own **mutable** fields, and ≥1 non-UI consumer (a test,
  a batch job, a second view, the server) needs the same data or the same rule.
- **The data cannot be derived from domain state at render time.** If it can, this is `REACT-07`
  and the correct action is to delete the copy, not to add sync.
- **One side can be designated authoritative.** Two authoritative copies is replication and needs a
  merge policy; that is a different and much larger problem.
- Every observer registration has a matching deregistration path (`UNI-07`). An unsubscribed
  listener on a destroyed widget is a leak and, worse, keeps applying updates to a dead view.

**Mechanics**

1. Define the domain type **outside** the UI module, and move the invariant into it. It must be
   constructible and testable with no UI import at all — that is the acceptance criterion for this
   whole technique.
2. Make the domain copy authoritative. The widget's copy becomes a projection of it.
3. Wire one direction first: domain change → widget update. Subscribe, and **return the unsubscribe
   function from the subscribe call** so deregistration cannot be forgotten; see
   `../../patterns/observer.md`.
4. Wire the reverse as **intents, not writes**. The widget emits "the user dragged piece X to bay
   3"; the domain validates, applies, and re-emits. The widget never writes its own copy directly —
   that is what makes the two diverge.
5. **Guard re-entrancy.** Applying a domain change updates the widget, which may emit an event,
   which re-enters the domain. Compare-before-set, or an explicit applying flag. Without this the
   loop has no fixed point.
6. Write the domain test with no UI in it. If that test needs a DOM, step 1 is not finished.

**Before**

```ts
class DispatchBoard {
  private pieces: { waybill: string; massKg: number; bay: number }[] = [];

  onDrop(waybill: string, bay: number) {
    const p = this.pieces.find((x) => x.waybill === waybill)!;
    if (p.massKg > 31.5 && bay !== 0) { this.flash("needs two handlers"); return; }  // the rule
    p.bay = bay;
    this.repaint();
  }
}
```

The lift rule is reachable only through a drop event on a live board.

**After**

```ts
// domain/dispatch.ts — no UI import, testable with literals.
export type Placement = { readonly waybill: string; readonly massKg: number; readonly bay: number };

export class DispatchPlan {
  #placements: readonly Placement[];
  #listeners = new Set<(p: readonly Placement[]) => void>();

  constructor(initial: readonly Placement[]) { this.#placements = initial }

  subscribe(fn: (p: readonly Placement[]) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);          // deregistration cannot be forgotten
  }

  /** An intent, not a write. Returns why it was refused. */
  place(waybill: string, bay: number): { ok: true } | { ok: false; reason: string } {
    const target = this.#placements.find((p) => p.waybill === waybill);
    if (!target) return { ok: false, reason: `no such piece: ${waybill}` };
    if (target.massKg > MANUAL_LIFT_LIMIT_KG && bay !== GROUND_BAY) {
      return { ok: false, reason: "needs two handlers; ground bay only" };
    }
    if (target.bay === bay) return { ok: true };       // re-entrancy guard: no event, no loop
    this.#placements = this.#placements.map((p) => (p === target ? { ...p, bay } : p));
    for (const fn of [...this.#listeners]) fn(this.#placements);
    return { ok: true };
  }
}

// ui/board.ts — projection only. Holds no rule.
class DispatchBoard {
  #unsubscribe: () => void;
  constructor(private plan: DispatchPlan) {
    this.#unsubscribe = plan.subscribe((p) => this.repaint(p));
  }
  onDrop(waybill: string, bay: number) {
    const result = this.plan.place(waybill, bay);      // intent
    if (!result.ok) this.flash(result.reason);         // the widget never writes its own copy
  }
  destroy() { this.#unsubscribe() }                    // UNI-07
}
```

The lift rule is now testable with three literals and no DOM, and it is the same function the batch
importer calls. The board renders and reports; it decides nothing.

**Postcondition.** The domain rule is invocable and testable with no UI construction. The widget
holds no authoritative data. Sync is one-directional with a stated owner, and re-entrancy
terminates because an unchanged placement emits nothing.

| Gain | Cost |
|---|---|
| Domain rules become testable without a DOM, and reusable by non-UI consumers | A second copy of the data exists, and it can be stale between an update and its notification |
| One authoritative side means divergence has a single possible cause, not two | Subscription lifecycle: every subscribe needs a matching unsubscribe (`UNI-07`) |
| The widget's responsibilities shrink to render and report | Re-entrancy is a real hazard and needs an explicit guard, as in `place` above |
| The same rule serves the UI and the batch path | In a declarative framework this is exactly backwards — see `REACT-07` |

**When NOT to use this**

- **A declarative UI where the value is derivable from state.** Delete the copy; compute during
  render. Applying this technique there *creates* `REACT-07`.
- **Server-rendered or request-scoped views.** There is no long-lived widget to observe.
- **Two copies that must both accept writes.** That is replication with a merge policy; observers
  do not solve it and will hide the conflict.
- **The UI is a thin form over a request.** Parse the form at submit (technique 5) and skip the
  observer entirely.

---

## Group failure modes

| Failure | Detection | Correction |
|---|---|---|
| **Wrapper tax** | every primitive is branded, and several parse functions check nothing | a brand with no constraint asserts nothing; revert those to the primitive. Keep brands where a check exists (technique 5, precondition 1) |
| **Multiple parse sites** | the same schema or regex appears at 3 entry points | the guarantee is only as strong as the sloppiest site. Consolidate to one boundary before continuing |
| **Encapsulation theatre** | accessors whose bodies only assign; getters and setters on a `readonly` record | `UNI-10` in a different costume. Delete them; the paradigm note above applies |
| **Type-code half-migration** | the discriminated union was added and the old code field kept "for compatibility" | two sources of truth for the same fact, drifting. Finish the migration or revert it; never ship both |
| **Reference/value oscillation** | this quarter's PR is 11; last quarter's was 12 on the same type | no criterion was written down. Apply the table in technique 11 and record the answer next to the type |
| **Snapshot converted to reference** | a historical record changes when the entity is edited; an audit query returns today's values | technique 11's last precondition was violated. Snapshots are values, permanently |
| **Invariant with two owners** | two code paths write the same bidirectional link | technique 13's owner precondition. One writer, or delete the direction (14) |
| **Constant-naming laundering** | `const TWO = 2`, `const EMPTY_STRING = ""` | the name adds no information. Technique 1's "when NOT" list |
| **Union of constants** | three union members whose only difference is a number | technique 10: one type plus a table |
| **Refactoring with no pending edit** | no named edit whose cost this reduces | stop; the gates are in `../../refactoring.md` |

## Relations

- **`composing-methods.md` feeds this group.** An Extract Method whose computed arity is ≥3 is a
  Data Clump made visible by the parameter list; techniques 5 and 6 name the shape those
  parameters were describing.
- **`moving-features.md`** is where Extract Class lives. This group names the *values*; that group
  moves the *behaviour* onto them. Run this group first — moving a method onto a type whose fields
  are still untyped primitives moves it twice.
- **`simplifying-method-calls.md`** takes over where branding stops: two same-branded neighbours in
  a signature are Introduce Parameter Object, not a stronger brand (technique 5's stated limit).
- **`dealing-with-generalization.md`** holds the class-hierarchy duals of 8 and 10 — Extract
  Subclass and Collapse Hierarchy. If the module uses classes rather than unions, that file's
  mechanics apply and these entries' preconditions still hold.
- **`../../patterns/state.md` and `../../patterns/strategy.md`** are technique 9's destination and
  are not duplicated here. **`../../patterns/flyweight.md`** is the measured-memory case that
  technique 11 is often mistaken for. **`../../patterns/observer.md`** is technique 15's mechanism.
- **`../../selection.md`** holds the threshold that decides whether 9 is warranted at all. Check
  it before adding indirection; `UNI-09` and `UNI-10` are what ignoring it produces.
- Technique and smell names are Martin Fowler's (*Refactoring*); all text and code in this file is
  original to this repository.
