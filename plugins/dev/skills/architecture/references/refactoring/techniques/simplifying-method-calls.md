# Simplifying Method Calls

**The group's question: does each signature state exactly what the callee needs, and can a
reader tell what a call does from the call site alone?**

Fourteen techniques. Every one of them edits a **signature** — the parameter list, the return
type, the name, or the visibility of a callable — so every one of them propagates to call sites.
That single fact determines how this group is applied and why the index schedules it last.

## The force

A signature is a contract held by N call sites. A technique in `composing-methods.md` costs
O(1) — the diff is bounded by the enclosing function. A technique here costs **O(N)**, where N
is the number of call sites, and N is not under your control: it includes tests, adjacent
modules, and — once a symbol is exported from a published package — consumers you cannot see.

**Blast radius** is the term for that set: the code that must be read, edited, or re-verified
because of one change. This group's entire economics is the size of that set.

Two consequences, both load-bearing:

1. **Apply this group last.** Arity, naming and visibility are downstream of structure. If you
   fix a signature before the unit's boundaries have settled — before `composing-methods.md`
   has cut the function at the right place and `moving-features.md` has put it in the right
   module — you pay the O(N) cost, then pay it again when the boundary moves. The index's work
   order (`../../refactoring.md`, "Order of application") puts `calls` at step 6 for exactly
   this reason.
2. **The compiler is what makes O(N) affordable.** `tsc --noEmit` enumerates the affected call
   sites exactly and mechanically. When it does, the work is bounded, reviewable, and finite:
   the error list *is* the worklist, and an empty error list *is* the proof of completeness.

So the property that matters per technique is not "is it hard" but **does the compiler
enumerate the sites, or does the change compile everywhere and silently mean something
different?** A change is *compiler-enumerated* when `tsc --noEmit` prints every affected site
with a file and a position. A change is *silent* when every existing call site still compiles
while meaning something new. **Silent changes are not smaller. They are unmeasured.**

Two more terms used throughout. *Arity* is the number of parameters a function declares. A
*call site* is a syntactic location that invokes or references the symbol.

## Blast radius: what the compiler prints

This table is the group's operating instruction. Read column 3 before starting any technique
here, and column 4 before treating a clean compile as proof.

**Every diagnostic code below was produced by compiling a probe file against `tsc --strict`
(TypeScript 6.0.2). None is quoted from memory.** A code you cannot make fire is a code you
should not cite — the point of naming them is that a reviewer can reproduce the claim, and a
wrong code turns a checkable statement back into an assertion.

| # | Technique | Enumerated? | What `tsc` prints | The gap — where it compiles and means something new |
|---|---|---|---|---|
| 1 | Rename Method | **total** | nothing; tsserver rewrites declaration and every reference in one AST operation | any reference that is a **string**: `obj["send"]`, `Reflect.get`, decorator metadata, an RPC method, a DB column, an event discriminant, a log query, an alert rule |
| 2 | Add Parameter — **required** | **total** | `TS2554` Expected 3 arguments, but got 2 | none. This is the expensive, safe form |
| 2 | Add Parameter — **defaulted / optional** | **none** | *nothing at all* | **the first sharp case.** Every existing site compiles unedited and now runs with the default. No output anywhere lists them |
| 3 | Remove Parameter — direct calls | **total** | `TS2554` Expected 1 arguments, but got 2 | deleting the argument also deletes its **evaluation**: `send(r, audit(r))` silently loses the audit record |
| 3 | Remove Parameter — value/callback position | **none** | *nothing* | a lower-arity function is assignable where a higher-arity one is expected, so `items.map(fmt)` keeps compiling. Removing a *middle* parameter shifts the rest, and a same-typed shift through a wider function type compiles |
| 4 | Separate Query from Modifier | **partial** | `TS2322`/`TS2345` at sites that consumed the discarded return value, once the command returns `void` | sites that called it **for the effect** and ignored the value are invisible; repointing one at the query silently deletes the write. Plus **call order**: a query run after the mutation where the original computed before returns a different value |
| 5 | Parameterize Method | **total** | `TS2304` Cannot find name 'urgentBackoffMs' — after the originals are deleted | if the varying value is typed `number`/`string` rather than a closed union, an out-of-set value compiles |
| 6 | Replace Parameter with Explicit Methods | **total** | `TS2304` at every reference to the deleted original | nothing *after* the delete. Before it, the old function still compiles, and a site left pointing at it means the split never finished |
| 7 | Preserve Whole Object | **total** | `TS2345` Argument of type 'string' is not assignable to parameter of type 'Recipient' | if the object is mutable, the callee gains write access to fields it could not previously name |
| 8 | Replace Parameter with Method Call | **total** | `TS2554` on the arity drop | **provenance.** The value moves from "computed at the call site" to "computed during the call". Across an `await`, a mutation, or a clock read, it can differ |
| 9 | Introduce Parameter Object | **total** | `TS2345` on the shape, plus `TS2561` on a misspelled field of a **fresh literal** | excess-property checking does not reach a **pre-built variable**; a field made optional with a default reintroduces row 2's silent gap one level down |
| 10 | Remove Setting Method | **total in typed code** | `TS2540` Cannot assign to 'openedAt' because it is a read-only property | `readonly` is erased at emit. `Object.assign`, an ORM hydrator or `class-transformer` writes it with no complaint |
| 11 | Hide Method — module scope | **total** | `TS2459` Module declares 'buildPayload' locally, but it is not exported | a name-keyed dispatch table is not a compile reference; consumers outside the compilation unit are unreachable |
| 11 | Hide Method — class scope | **total for dotted access** | `TS2341` Property 'index' is private and only accessible within class 'Ledger' | **`ledger["index"]` compiles.** Element access is a documented escape hatch, and `private` is erased at runtime; `#index` is not |
| 12 | Replace Constructor with Factory Method | **only after `private constructor`** | `TS2673` Constructor of class 'Ledger' is private | until that step lands, every `new X(...)` compiles and bypasses the factory's invariants. Reflective construction bypasses it always |
| 13 | Replace Error Code — **widening** to a union | **total** | `TS2339` Property 'minutes' does not exist on type 'NextRun' | template interpolation still compiles: `` `${nextRun(id)} min` `` prints `[object Object]` |
| 13 | Replace Error Code — **narrowing** to `T` plus a throw | **none** | *nothing* | **the second sharp case.** A narrowed type is assignable everywhere the wider one was. Sites that checked keep dead guards; sites that never checked start throwing in production |
| 14 | Replace Exception with Test | **none** | *nothing* — deleting a `catch` changes no type | the `catch` was absorbing more than the condition it was written for. Removing it surfaces those — desirable, and behaviour-visible |

**Three corrections this table carries, each the result of running the probe rather than
reasoning about it.** They are recorded because each one was believed in the opposite direction
first, and each one changes what a reviewer should ask for.

- **`TS2367` does *not* fire on `x === null` when `x` is non-nullable.** TypeScript exempts
  `null` and `undefined` from the no-overlap comparison check. So dropping `| null` from a
  return type is enumerated by **nothing** — not "partly enumerated". `m === null`, `m ?? 0`,
  `m?.toFixed(2)` and `!m` all compile clean against a plain `number`, and all four are now dead
  code that reads like a live guard. `TS2367` is real, but it fires on genuinely disjoint
  operands (`label === 1` where `label: string`). Sweep the dead guards with
  `@typescript-eslint/no-unnecessary-condition`, which needs type-aware linting on; `tsc` will
  not do it.
- **The excess-property typo diagnostic is `TS2561`, not `TS2353`.** `TS2561` is the near-miss
  form and carries the suggestion — *"…but 'dryRunn' does not exist in type 'SendOptions'. Did
  you mean to write 'dryRun'?"* `TS2353` is the same check with no near miss to suggest. The
  typo case — which is the one technique 9 is sold on — is `TS2561`.
- **Hiding a module-scope symbol is `TS2459`, not `TS2305`.** Deleting the `export` keyword
  leaves the declaration in place, and the compiler says so: *"declares 'buildPayload' locally,
  but it is not exported."* `TS2305` ("has no exported member") is what you get when the symbol
  does not exist at all. The distinction matters when reading a build log: `TS2459` means you
  hid something, `TS2305` means you deleted something.

**The silent set, verified.** Each of these compiled with **zero** diagnostics under
`--strict`, and each is a place where a reviewer must supply what the compiler will not:

```ts
formatAt(Date.now(), "en-GB");        // a new defaulted parameter — every site unedited
items.map(oneParam);                  // lower arity assignable to higher
const shifted: Formatter = (locale, title, timeZone) => …;  // same-typed middle shift
ledger["index"];                      // element access past `private`
Object.assign(attempt, { attempt: 99 });                    // write past `readonly`
m === null;  m ?? 0;  m?.toFixed(2);  !m;                   // dead guards on a plain number
`${nextRun(id)} min`;                 // union interpolated, not narrowed
send(prebuilt);                       // pre-built options object keeps its typo
```

**Three techniques can change meaning with a clean compile: 2 (defaulted), 12 (constructor left
public), 13 (narrowing in one step).** Each entry below states the step that removes the gap.

## The fourteen

| # | Technique | Transformation | Inverse |
|---|---|---|---|
| 1 | **Rename Method** | an identifier that misstates its postcondition → one that states it | itself |
| 2 | **Add Parameter** | information the callee cannot derive → a declared parameter | Remove Parameter |
| 3 | **Remove Parameter** | a parameter the body never reads → arity − 1 | Add Parameter |
| 4 | **Separate Query from Modifier** | one member that answers *and* mutates → a pure query + a `void` command | recombine (only under an atomicity argument) |
| 5 | **Parameterize Method** | N bodies differing by a constant → one body + a parameter | Replace Parameter with Explicit Methods |
| 6 | **Replace Parameter with Explicit Methods** | a parameter selecting a behaviour → one named function per behaviour | Parameterize Method |
| 7 | **Preserve Whole Object** | k fields of one record → the record | pass the fields |
| 8 | **Replace Parameter with Method Call** | a value every caller derives identically → a call inside the callee | Add Parameter |
| 9 | **Introduce Parameter Object** | a recurring parameter clump → one named `readonly` type | flatten to positional |
| 10 | **Remove Setting Method** | a post-construction write → a constructor parameter and `readonly` | add the setter — a mutability decision |
| 11 | **Hide Method** | an exported/public member with no external consumer → `private` / `#` / non-exported | widen visibility — an API decision, not a refactoring |
| 12 | **Replace Constructor with Factory Method** | `new X(...)` at every site → a named function, constructor `private` | inline the factory |
| 13 | **Replace Error Code with Exception** | a sentinel inside the success type → a typed failure variant or a `throw` | Replace Exception with Test |
| 14 | **Replace Exception with Test** | `try/catch` over a predictable condition → a branch, `??`, `?.`, or narrowing | Replace Error Code with Exception |

## Order within the group

```
1  Rename Method                          ← continuously, ungated; a tsserver rename is total
4  Separate Query from Modifier           ← CQS first: nothing below is safe on a member that
                                             both answers and mutates
11 Hide Method — FIRST PASS               ← the only technique here that REDUCES N
13 Replace Error Code with Exception     ─┐ settle the FAILURE channel before reshaping the
14 Replace Exception with Test           ─┘ success signature; both change return types
3  Remove Parameter                      ─┐ shrink before you reshape — every later step
8  Replace Parameter with Method Call     │ costs one edit per parameter per call site
7  Preserve Whole Object                 ─┘
5  Parameterize Method  ⇄  6 Replace Parameter with Explicit Methods  ← duals; choose ONCE
2  Add Parameter                          ← last resort, only after 7, 8 and 9 are ruled out
9  Introduce Parameter Object             ← the fix for whatever is still arity ≥4
10 Remove Setting Method                 ─┐ construction-time invariants, once the shape has
12 Replace Constructor with Factory Method─┘ settled
11 Hide Method — SECOND PASS              ← what the steps above orphaned
```

**Hide Method appears twice, and that is not an error.** It is the only technique in this group
that *reduces* N, so an hour spent early un-exporting six symbols with no external consumer is
repaid by every signature change afterwards — those symbols' arity, parameter order and names
become file-local decisions, and O(N) becomes O(1) for each. But you can only hide what you can
already prove is unreferenced, and the later techniques orphan more: 8 absorbs a derivation that
was the helper's only caller, 12 moves construction behind a factory. Run the cheap pass first
for the proven cases, and a second pass at the end for what the work created.

**The call-site count is the cost, and `tsc` will print it for you.** Before committing to a
signature change, make it, run `tsc --noEmit`, and read the error count. That number is the
blast radius, and you will pay it again for every future change to the same signature. Under
about 30, edit by hand. Above that, either write a codemod or land the change in two steps: add
the new signature alongside the old, migrate, then delete the old one and let the compiler find
the stragglers.

**Order the shrinking techniques before the reshaping ones for a measurable reason.** Applying
3, 8 and 7 first reduces the parameter count; 9 then converts what remains, and the conversion
cost is one edit per call site regardless of arity. Doing 9 first converts parameters you are
about to delete.

**Arity is the feedback signal, as in `composing-methods.md` — but read in the opposite
direction.** There, arity ≥3 on a fresh extraction means the cut was wrong. Here, arity ≥4 on an
existing signature means a type is missing, and 9 declares it.

### The duals, and how to break the tie

This group holds more inverse pairs than any other. `../../refactoring.md` lists a hard stop for
exactly this: when a technique's inverse is also in the catalog, applying either without a
stated reason lets the code oscillate between them across successive refactors. Each pair needs
a tie-breaker you can check, not a preference — and the reason belongs in the code, not the PR.

| Pair | Take the left when | Take the right when |
|---|---|---|
| 2 Add Parameter ⇄ 3 Remove Parameter | the body reads a value that is not in the signature | the body never reads the parameter |
| 2 Add Parameter ⇄ 8 Replace Parameter with Method Call | the value is impure, or a test must substitute it | the derivation is pure and identical at every call site |
| 5 Parameterize Method ⇄ 6 Replace Parameter with Explicit Methods | the values differ in **degree** — a threshold, a rate, a cap | the values select different code paths, and every site passes a literal |
| 7 Preserve Whole Object ⇄ 9 Introduce Parameter Object | every argument comes from one existing object | the arguments come from several sources, so the object must be built |
| 13 Replace Error Code with Exception ⇄ 14 Replace Exception with Test | the condition cannot be decided before attempting the operation | a cheap, race-free predicate decides it |

## Does TypeScript already do this

| Technique | Automated / enforced by | What remains yours |
|---|---|---|
| **Rename Method** | tsserver *Rename Symbol* (F2): declaration, every reference, overrides, re-exports, shorthand punning, and `keyof`-derived uses | the name, and every reference that is a **string** rather than a symbol — tsserver cannot see those |
| **Add Parameter** | nothing. `tsc` enumerates the sites *only* in the required form | the required-versus-defaulted decision, which is the entire risk |
| **Remove Parameter** | `noUnusedParameters`; ESLint `no-unused-vars` with `args: "after-used"`; Biome `correctness/noUnusedFunctionParameters`. No tsserver *Change Signature* refactor exists; WebStorm has one | interface members and overrides, callback positions, and whether the argument expression had an effect |
| **Separate Query from Modifier** | nothing — no mainstream rule models command-query separation. `readonly` types make accidental mutation an error *once the split exists* | enumerating the effects, judging atomicity, and the call-ordering precondition |
| **Parameterize Method** ⇄ **Replace Parameter with Explicit Methods** | nothing; a clone detector finds the sibling set. `UNI-19`'s stated detection — functions with 2+ boolean parameters — is a grep | the direction. Getting it wrong makes the pair oscillate across successive refactors |
| **Preserve Whole Object** | nothing in tsserver. `Pick<T, K>` lets you collapse arity without granting the whole record | whether the callee may depend on the whole type |
| **Replace Parameter with Method Call** | nothing | purity, and proving the callee-computed value equals the caller-passed one *at the moment it is read* |
| **Introduce Parameter Object** | tsserver *Convert parameters to destructured object* performs the mechanical half, call sites included | naming the type, splitting required from optional, and checking every default |
| **Remove Setting Method** | `readonly` + `strictPropertyInitialization` make the end state compiler-enforced; `@typescript-eslint/prefer-readonly` flags private fields never written outside the constructor | whether the value is configuration (freeze it) or state (name the transition) |
| **Hide Method** | `private`, `protected`, `#name`, module non-export; `knip` reports exports with no importer | deciding what the boundary *is*, and the tests that call the member |
| **Replace Constructor with Factory Method** | `private constructor` is what makes it compiler-enumerated | which of four capabilities you actually need — `../../patterns/factory-method.md` |
| **Replace Error Code with Exception** | `strictNullChecks` makes a `null` sentinel unignorable. **A `throw` is invisible to the type system:** TypeScript has no checked exceptions, and `useUnknownInCatchVariables` types `catch (e)` as `unknown` | the throw-versus-typed-failure decision, and applying it module-wide |
| **Replace Exception with Test** | `?.`, `??`, `in`, `Map.has`, narrowing, `URL.canParse`, `Number.isFinite`; `noUncheckedIndexedAccess`; `@typescript-eslint/no-unnecessary-condition` finds the tests that became dead | knowing whether the condition is genuinely predictable |

**Three of the fourteen are answered by a tsconfig flag rather than by a procedure.**
`noUncheckedIndexedAccess` types `record[key]` as `T | undefined` — verified: it turns
`lanes[k].toUpperCase()` into `TS2532 Object is possibly 'undefined'`, which converts most of
technique 14 into a compile error at the index access. `strictNullChecks` already delivers
technique 13's endpoint for the `undefined` sentinel. `useUnknownInCatchVariables` (on under
`strict` since TypeScript 4.4) types `catch (e)` as `unknown` — verified: reading `e.message`
is `TS18046 'e' is of type 'unknown'`, which is precisely why the compiler can tell you nothing
about what a `catch` block catches.

**Two of the fourteen are largely artifacts of a pre-TypeScript world.** Replace Error Code with
Exception assumes a language whose default failure channel is an integer status code;
TypeScript's default is already `throw`, so the live question is a different one (see entry 13).
Remove Setting Method assumes mutable objects with accessor pairs; under `readonly` fields set
once at construction — the ordinary shape of a TypeScript module — there is no setter to remove
and the technique is moot.

**Rename is the exception to the gates.** `../../refactoring.md` requires a pending edit, a
second occurrence, and a mutation-sensitive contract before any refactoring. A `tsc`-backed
rename is mechanical and provably behaviour-preserving for every reference the type system can
see, so it is exempt: rename as soon as an identifier stops describing its value, and every
later technique inherits the corrected name.

**`tsc` verifies arity and types, never meaning.** The compiler's error list is a complete
inventory of *syntactic* breakage and no inventory at all of *semantic* breakage. It will accept
a Separate Query from Modifier that reordered the query after the mutation, a Preserve Whole
Object that let the callee mutate its argument, a Remove Parameter that deleted a side-effecting
argument expression, and an Add Parameter whose default reprices every existing caller. Types
are not a preservation proof — the tests are. Run `bun test path/to/file.test.ts --watch`; the
mechanics below assume a green, mutation-sensitive suite between every numbered step.

## Example types

Every example below uses these:

```ts
type Channel   = "email" | "slack" | "webhook";
type Recipient = { readonly id: string; readonly address: string; readonly channel: Channel;
                   readonly locale: string; readonly timeZone: string };
type Report    = { readonly id: string; readonly title: string; readonly rows: number;
                   readonly generatedAt: number };
type Delivery  = { readonly reportId: string; readonly recipientId: string; readonly attempt: number };

const assertNever = (x: never): never => { throw new Error(`unreachable: ${String(x)}`); };
```

`assertNever` is the exhaustiveness helper referenced throughout: a `switch` whose `default`
returns it fails to compile the moment a union gains a variant no case handles (`TS-07`). Where
an example names `Bug`, `Counters`, `Config` or a transport helper (`push`, `page`,
`enqueueBatch`), those stand for the surrounding module; nothing here depends on their
definitions beyond the names. `Bug` in particular is the programmer-error class from the `bunjs`
plugin's errors skill (`plugins/bunjs/skills/errors/SKILL.md`).

---

## 1. Rename Method

**Resolves:** Alternative Classes with Different Interfaces (the index routes it here first),
Comments (`SLOP-04`) — specifically the comment that exists to correct a name — and the naming
half of every other smell.

**Force.** The identifier states a postcondition the body does not deliver. The type checker
verifies the shape of the value and never the claim in the name, so a wrong name is the one part
of a signature that no tool contradicts. Every reader who reasons from it reasons wrongly, and
the cost compounds: a name is read far more often than the body under it. A comment correcting
the name is a second statement that can also drift.

**The one ungated technique.** tsserver's rename is an AST operation over the project's symbol
graph: it rewrites the declaration, every reference, every override, and every `keyof`-derived
use in one step, with no behaviour change possible for references the type system can see.
Because the cost is near zero and the correction is total, this does not wait for a pending edit
the way the rest of the catalog does.

**Preconditions**

- `tsc --noEmit` is clean **now**, and one program includes both the declaration and every
  referencing file. tsserver operates on the bound program; in a project with binding errors it
  can silently skip files it failed to resolve. Confirm coverage with `tsc --noEmit --listFiles`.
- **No reference is a string.** Check:
  `grep -rn '"oldName"' --include='*.ts' --include='*.json' --include='*.sql' .` returns nothing
  outside the declaration. A member name that also appears as an RPC method, an event `type`, a
  database column, a feature-flag key, a metric label or a serialized discriminant is **data**,
  and renaming it is a migration, not a refactoring.
- No dynamic access: `obj[name]`, `Reflect.get`, a template-literal key, or a decorator reading
  `propertyKey`.
- The new name is not already bound in the same scope and does not collide with a member of a
  supertype — a collision silently converts a fresh method into an override.
- It is not a conventional name the runtime or a framework dispatches on: `toString`, `then`,
  `Symbol.iterator`, a lifecycle method. Renaming those unwires them; that is not a rename.
- If exported from a published package, the change is semver-major, or the old name is retained
  as a deprecated alias.

**Mechanics**

1. State the new name's **postcondition** in one sentence — the value returned or the effect
   had, not the steps performed. A query gets a noun phrase; a command gets a verb phrase.
2. Run the string search above. Any hit outside the declaration file stops the rename.
3. Put the cursor on the declaration and invoke tsserver *Rename Symbol*. **Not find/replace:**
   textual replacement hits comments, string literals and unrelated identically-named symbols in
   other scopes, and misses nothing it should have missed only by luck.
4. `tsc --noEmit`. Zero new errors is the expectation; an error means the symbol escaped the
   project graph — a hand-written `.d.ts`, another workspace package, a generated client.
5. Run tests, and rename test names mentioning the old identifier. A test name is documentation.
6. Across a published boundary: keep the old name as a deprecated forwarder for one release,
   and schedule its deletion.
7. Commit alone. A rename diff is reviewable only when nothing else is in it.

**Before**

```ts
class DeliveryQueue {
  #pending: Delivery[] = [];
  send(d: Delivery): void { this.#pending.push(d); }   // does not send; it appends
}

type Op = keyof DeliveryQueue;                          // derived — tsserver updates this
const auditCounts: Record<"send" | "drain", number> = { send: 0, drain: 0 };  // literal — it does not
```

**After**

```ts
class DeliveryQueue {
  #pending: Delivery[] = [];
  enqueue(d: Delivery): void { this.#pending.push(d); }
}

type Op = keyof DeliveryQueue;                          // now "enqueue" | … — updated for free
const auditCounts: Record<"send" | "drain", number> = { send: 0, drain: 0 };  // still says "send"
```

Those two lines are the whole point of the preconditions. `Op` is derived from the class through
`keyof`, so the rename carries. `auditCounts` names the method with a string literal that has no
relationship to the class, so it compiles unchanged and now refers to a method that does not
exist. **The compiler enumerated everything it could see and said nothing about the one thing it
could not.**

**Postcondition.** Every reference in the program binds to the new identifier, which states what
the member does. `grep -rn` for the old name returns only deliberate compatibility aliases.
`tsc --noEmit` output is unchanged, and the diff contains no character other than the identifier.

| Gain | Cost |
|---|---|
| The name becomes compiler-checked at every reference, unlike the comment that was compensating for it; that comment can be deleted | `git blame` churn on every touched line, and merge conflicts against in-flight branches proportional to the reference count |
| Every later technique inherits the corrected name, so the naming cost is paid once | Across a published boundary it stops being a rename and becomes a deprecation cycle with two names to maintain |
| Provably behaviour-preserving for symbol-graph references — the only technique here with that property, which is why it needs no test argument | A large rename produces a diff nobody reads line by line, which is why it must be a lone commit |

**When NOT to use this**

- **The name is also data** — an RPC method, a persisted column, an event discriminant, a metric
  label, a config key. Renaming the symbol without migrating the data produces two names for one
  thing and no error. Neither `tsc` nor the suite will tell you.
- **It is published and there is no deprecation path.** Then this is a migration.
- **You cannot state the new name's postcondition in one sentence.** That means the member has
  more than one postcondition; apply 4 first and name the pieces.
- **The new name is a synonym.** `fetchQuote` → `getQuote` costs a repo-wide diff and returns no
  information. Rename to correct a false statement, not to satisfy a preference.

---

## 2. Add Parameter

**Resolves:** nothing on its own. It is the enabling step for a behaviour change, it is this
group's main producer of Long Parameter List, and **it is this group's most common mistake** —
because 7, 8 and 9 exist specifically to avoid it.

**Force.** The callee needs a value it cannot derive. Adding a parameter raises arity, and arity
is the parameter list's encoding of coupling: each additional parameter is one more thing every
call site must know how to produce, forever. Adding it is behaviour-preserving only while the
body ignores it; the commit in which the body starts reading it is a behaviour change and needs
a behaviour change's tests and review.

**The required-versus-defaulted decision is the whole technique.**

| Form | What `tsc` does at existing call sites | Blast radius |
|---|---|---|
| `f(a: A, b: B, c: C)` | `TS2554 Expected 3 arguments, but got 2` at every site | **enumerated.** The error list is the audit list |
| `f(a: A, b: B, c: C = fallback)` | nothing; every site compiles unedited | **invisible.** No tool can tell you which sites now take `fallback` |

A default value is a **behaviour decision applied to every existing call site at once, with an
empty diff**. If `fallback` reproduces the previous observable behaviour exactly, the change is a
true refactoring and the default is correct. If it does not, you have shipped a behaviour change
wearing an additive signature change's clothes — the worst outcome available in this group,
because the diff shows one file and the effect reaches all of them.

**Preconditions**

- The value is genuinely not derivable inside the callee from what it already holds (else 8), and
  is not a field of an object already passed (else 7).
- **Arity after the change, stated.** If it reaches 4, apply 9 first and add a field instead.
- The parameter is not a boolean (`UNI-19`). A boolean parameter is a policy decision passed
  anonymously; the remedy is 6 or 9.
- The new parameter does **not** share a primitive type with an adjacent one. Two adjacent
  `string`s means a transposed pair at a call site compiles. Fix with a branded type or 9.
- If defaulted: you can state, in one sentence, why the default reproduces the previous
  behaviour at **every** existing site, **and you have the list of sites**, because `tsc` will
  not produce one.

**Mechanics**

1. Try 8, then 7, then 9. Record why each failed — that record is the justification for this
   change.
2. Add the parameter as **required**, at the end of the list, even when you intend it to be
   defaulted. The compile-error list is the entire value of this step.
3. `tsc --noEmit`. Record the error count in the commit message: that is the blast radius, and
   it is the number every future signature change to this function will cost.
4. Fill each site with the value that reproduces existing behaviour — deliberately, not
   mechanically. Tests green, behaviour diff empty. Commit.
5. **Separate commit:** make the body use the parameter, with tests for the new behaviour.
6. **Only then**, if a majority of sites pass the same value, consider converting it to a
   default — and only to the value they already pass. The review now has a diff showing which
   sites were considered before they were collapsed.
7. Prefer `c: T = x` over `c?: T` unless an explicit `undefined` from a caller is meaningful:
   the two differ in that `c?: T` admits `f(a, b, undefined)` as distinct from `f(a, b)`.

**Before**

```ts
function formatGeneratedAt(report: Report, locale: string): string {
  return new Intl.DateTimeFormat(locale).format(report.generatedAt);
}
```

**After — required, and therefore enumerated**

```ts
function formatGeneratedAt(report: Report, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone }).format(report.generatedAt);
}
```

Arity rises from 2 to 3, so every call site is `TS2554` until edited. That is the cost, and it is
also the safety property: nothing ships until each site has been visited.

**The trap, for contrast**

```ts
function formatGeneratedAt(report: Report, locale: string, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat(locale, { timeZone }).format(report.generatedAt);
}
```

This compiles at every existing site with no edit — verified, zero diagnostics. It is also a
behaviour change at every one of them: `Intl.DateTimeFormat(locale)` formats in the **host**
time zone, while `{ timeZone: "UTC" }` formats in UTC. Every rendered timestamp in the product
just moved, the diff is four lines, and nothing in the toolchain reports it.

The same shape with a genuinely inert default — a rate parameter defaulting to `0` where the body
multiplies by `1 + rate` — is a true refactoring. The two diffs are indistinguishable in review,
and no tool separates them for you. That is why step 2 is not optional.

**Postcondition.** Arity is N+1 and stated. Required form: every call site has been visited and
edited, so the set of affected sites **is** the commit's diff. Defaulted form: zero sites edited,
and the set of affected sites is enumerated nowhere — acceptable only when the default is
provably behaviour-preserving. In both, the body still ignores the parameter, so the behaviour
diff of *this* commit is empty.

| Gain | Cost |
|---|---|
| The callee's dependency is declared rather than smuggled through a module-level variable, so its inputs equal its parameters | Arity +1 at every call site, permanently. Arity is the one number in this group that only ratchets up unless someone applies 7, 8 or 9 |
| The required form turns the compiler into an exhaustive audit of affected sites — rare, and worth using even when you plan a default | The defaulted form turns that audit off entirely, and is indistinguishable in review from a behaviour change |
| Splitting "add" from "use" gives two reviewable commits, one of which is an asserted no-op | Passing infrastructure (clock, logger, request id) down every leaf signature is how a codebase acquires four-parameter functions everywhere |

**When NOT to use this**

- **The value is derivable inside the callee** → 8.
- **It is a field of an object already passed** → 7.
- **Arity would reach 4, or the parameter duplicates an existing parameter type** → 9 first. Note
  that a field added to an options object is *also* silent when optional: the same default rule
  applies, one level down.
- **It is a boolean** → 6 or 9 (`UNI-19`).
- **Only one caller needs it** → a wrapper for that caller, or a separate function. A parameter
  that is constant at every site but one is a constant with extra steps.
- **"For future flexibility" with no named consumer** — Speculative Generality, and an unread
  parameter is Dead Code charging rent at every call site.
- **You are defaulting it because the required form's error list looked long.** The length of
  that list is the change's true cost; hiding it does not reduce it, it moves it to whoever is
  debugging next quarter.

---

## 3. Remove Parameter

**Resolves:** Speculative Generality (`UNI-09`, `UNI-10`), Dead Code, Long Parameter List.

**Force.** A parameter the body never reads is a **false claim in the signature**: it states that
the result depends on the value. Every caller must produce that value, and the false dependency
propagates into the caller's own graph — a module imports a type, or calls a function, only to
feed an argument that is discarded. The dependency list is also how people estimate blast radius,
and an inflated one makes every future change look more expensive than it is.

**Preconditions**

- The parameter is unread in the body, including after destructuring and through `arguments`
  (which exists only in non-arrow functions). `noUnusedParameters` produces the worklist — but a
  leading `_` suppresses the check, so scan for that convention before trusting a clean run.
- **The declaration is not an interface member or an override whose contract owns the
  parameter.** This is the group's quietest hazard: **removing a parameter from one implementor
  still satisfies the interface**, because a function with fewer parameters is assignable to one
  with more. `tsc` reports nothing, and the implementations now disagree about their inputs.
  Remove it from the interface, or not at all.
- It is the **last** parameter. Removing a middle one shifts every later one, and a same-typed
  shift compiles — verified silent. Removing a middle parameter is 9 instead.
- **Each argument expression at each call site is side-effect free**, or you have decided where
  the effect goes. Deleting an argument deletes its evaluation.
- It is not positional-by-protocol — a middleware `(req, res, next)`, or `Array.prototype.map`'s
  `(value, index, array)`, where the runtime supplies arguments by position and the contract owns
  the slot. Rename it `_req` instead.
- It is not a documented extension point with a **named, scheduled** consumer. "Might need it" is
  Speculative Generality, which is what this technique removes.

**Mechanics**

1. Set `"noUnusedParameters": true` to generate the worklist. Confirm the declaration is not
   bound by an interface, an override or a callback contract.
2. Delete it from the declaration. If it was not last, stop — see preconditions.
3. `tsc --noEmit`. Direct call sites report `TS2554`; that list is complete **for direct calls**.
4. Know the three places the enumeration does not reach, and check them by hand:
   - the function passed **as a value** to a higher-order caller that supplies more arguments
     (`items.map(fmt)`). Assignability permits fewer parameters, so the extra argument is
     silently dropped — harmless when the parameter was genuinely unused, but confirm rather
     than assume;
   - a call through `any`, an index signature, or a spread of a loosely typed tuple;
   - a re-export consumed outside the project graph.
5. At each site, **read the argument expression before deleting it.** `send(r, audit(r))` loses
   an audit record when you delete the argument, and no test that did not assert on the audit
   will notice.
6. Delete anything upstream that just became dead. Run `knip` and `tsc --noUnusedLocals`: the
   deleted expression is often the only consumer of a computation which is now dead too.

**Never combine this with a reorder.** Transposing `(a: string, b: string)` compiles at every
call site and swaps the values at all of them — the only fully silent signature change in this
file with no defence at all. Convert to a parameter object (9), where argument order does not
exist, then rearrange the type's fields freely.

**Before**

```ts
function auditLabel(reportId: string, actorId: string, recipientId: string): string {
  return `${reportId} -> ${recipientId}`;      // actorId is never read
}
```

**After**

```ts
function auditLabel(reportId: string, recipientId: string): string {
  return `${reportId} -> ${recipientId}`;
}
```

Arity falls from 3 to 2, so every three-argument call is `TS2554` and gets visited. Note what the
removal did *not* fix: the two survivors are both `string` and adjacent, so
`auditLabel(rec.id, report.id)` still compiles and still produces a reversed label. Removing a
parameter shortens the list; it does not make the list type-safe. That is 7 or 9.

**Postcondition.** The parameter list equals the function's actual input set.
`noUnusedParameters` is clean for the declaration, no caller computes a value that is discarded,
and no argument expression carrying an effect was silently dropped.

| Gain | Cost |
|---|---|
| Arity −1 at every call site, and one fewer input to reason about when estimating blast radius | Direct sites error, callback sites do not — the compiler's enumeration is incomplete for function-valued usage |
| Frequently cascades: the orphaned argument expression is dead code, and so is whatever produced it, often removing a coupling edge | Deleting an argument deletes its evaluation; an effectful expression disappears with it |
| The signature stops advertising a dependency the function does not have | Restoring the parameter later costs a full Add Parameter, including its call-site edits |

**When NOT to use this**

- **An interface, supertype or override declares it.** Removing it from one implementor compiles
  and diverges silently. The base's ignoring it is not evidence — narrowing the base signature
  can also make a subclass's use unreachable, which is `UNI-03`.
- **The signature is fixed by a library or a protocol**, and the parameter documents the contract
  even where this implementation ignores it. Prefix with `_`.
- **The body is temporarily stubbed.** The parameter is unused because the implementation is
  missing, not because the input is. A `locale` accepted and ignored by a formatter is a defect
  report, not a cleanup.
- **A named consumer lands in this change.** Then the parameter is not speculative — but "named"
  means named, not imagined.
- **It is read only inside a `// TODO` branch** (`UNI-43`). Decide: implement the branch, or
  delete branch and parameter together. Leaving both is the smell.
- **You want to reorder.** Use 9.
- **Published API without a deprecation window.**

---

## 4. Separate Query from Modifier

**Resolves:** the untestability that makes most of this group unsafe; Temporary Field; and it is
a precondition for 5, 8 and 11. Cross-language analogue in the registry: `PY-15` `@property`
With Side Effects — the same sin, expressed through a getter.

**Command-query separation (CQS)** is the rule that every function is either a **query** —
returns a value, causes no observable side effect, and may be called any number of times in any
order without changing program behaviour — or a **command** — causes a side effect and returns
nothing. A member that does both cannot be asked for its answer without also causing its effect.

**Force.** The consequences are mechanical, not stylistic. A fused member is not **idempotent**
(N invocations observably differ from one), so no caller may retry, cache, memoize, log or assert
on it without changing the program. It is not **referentially transparent** (the call cannot be
replaced by its value), so Replace Temp with Query in `composing-methods.md` and technique 8 here
both fail their preconditions against it. And a test that wants to check the answer must accept
the effect.

**Preconditions**

- Every side effect is enumerated: field assignment, cache write, counter increment, a log line
  an alert rule matches, network call, database write.
- **The returned value is derivable without performing the effect.** If it is a *product* of the
  effect — an auto-increment id from an insert, an HTTP `Response` from a POST, the item removed
  by a dequeue — CQS does not apply. That function is a command reporting its outcome, and it is
  correct as it stands.
- The **count and order** of those effects are not something a caller depends on. If a caller
  relies on "asking also advances the cursor", splitting changes behaviour unless every caller
  then calls both, in order.
- **No atomicity requirement.** In synchronous single-tick JavaScript, `peek()` then `take()` has
  no window between them. The moment either half is `async`, or the caller `await`s between them,
  another consumer can interleave — the pair is then a check-then-act race and must stay fused.
- At least one caller, test, or planned caller wants exactly one half. If every caller wants
  both, the split adds a call and buys nothing.

**Mechanics**

1. Enumerate the call sites and record, for each, **whether it consumes the return value.** This
   list is the safety net, because step 5's compiler check covers only half of it.
2. Create the query: same body, effects removed, returns the value. Name it for the value.
3. Rewrite the original to call the query, then perform the effect, returning what it returned
   before. **Compile and test here** — no call site has changed yet, and this state is green.
4. Redirect call sites to the query, the command, or both **in the order the original performed
   them**. If the original computed the value *before* mutating, the query must be called first:
   a query called after the mutation may return a different value, and nothing errors. One site
   per test run.
5. Change the command's return type to `void`. `tsc` errors at any caller still reading the
   result — that is the check that step 4 is complete for value-consuming sites.
6. **Walk the step 1 list for the sites that ignored the return value.** The compiler said
   nothing about those, and repointing one at the query silently deletes a write.
7. Rename both halves (1) so the names say which is which.

**Before**

```ts
class DeliveryQueue {
  #pending: Delivery[] = [];
  #dispatched = 0;

  nextDelivery(): Delivery | undefined {   // query-shaped name; also mutates twice
    const d = this.#pending.shift();
    if (d) this.#dispatched += 1;
    return d;
  }
}
```

Two calls return two different values, so the member is not referentially transparent. A test
asserting "the head of the queue is X" consumes X to find out. A log line added around it changes
the queue.

**After**

```ts
class DeliveryQueue {
  #pending: Delivery[] = [];
  #dispatched = 0;

  peek(): Delivery | undefined { return this.#pending[0]; }   // query: no writes
  take(): void {                                              // command: returns nothing
    if (this.#pending.shift()) this.#dispatched += 1;
  }
}
```

Call sites become `const d = q.peek(); if (d) { q.take(); dispatch(d); }` — two calls where there
was one. That is the cost, and it is what makes `peek` assertable, cacheable and safe to log, and
`take` analysable for retry. **`take(): void` is load-bearing:** a `void` return makes any caller
that tries to read a result a compile error, which is how step 5 proves the split is finished.

**Postcondition.** Every member is a query (returns a value, writes nothing observable) or a
command (returns `void`, writes). The query is **referentially transparent** — callable from a
test, an assertion, a retry or a log statement without changing program state, and testable from
an object literal. Techniques 5, 8 and 11 now have a member they can operate on.

| Gain | Cost |
|---|---|
| The query becomes referentially transparent, unblocking memoization, retry, logging, and the substitutions 8 and `composing-methods.md`'s Replace Temp with Query depend on | Two calls where there was one, and the **caller** now owns an ordering the fused member enforced |
| A test can assert the answer without causing the effect — usually the reason this is worth doing | The pair is no longer atomic; under `async` that is a race, not an inconvenience |
| `void` on the command turns "someone still reads this" into a compile error | If the value and the effect shared expensive work, it is now done twice unless the caller passes the query's result into the command |
| Retry applies to the command alone; the query cannot double-apply anything | Sites that **ignored** the return value are invisible to the compiler, and repointing one deletes a write |

**When NOT to use this**

- **The pair must be atomic.** Pop, compare-and-swap, `Map.prototype.delete` returning whether it
  deleted, a claim-a-job query on a shared queue. Splitting introduces a check-then-act race that
  fails rarely and unreproducibly, and this is the one legitimate reason to run the inverse.
- **The value is a product of the effect.** An insert returning its generated id, a queue's
  `pop`. Splitting these is not possible without performing the effect twice or inventing a
  second source of truth.
- **The write is not observable.** A private memoization cache writes to the heap but not to the
  contract; a memoized pure function is still a query. Judge by observability.
- **The idiom returns a value from a mutator and callers rely on it** — `Array.prototype.push`
  returning the new length, a fluent builder returning `this`. That is a chosen convention, and
  splitting it fights the idiom.
- **One caller wants both and no test wants either alone.** The second-occurrence gate in
  `../../refactoring.md` fails.
- **The return value is a diagnostic nobody reads.** Delete it; that is Remove Parameter's
  return-side sibling, not this technique.

---

## 5. Parameterize Method

**Resolves:** Duplicate Code across near-identical members; Large Class measured by member count;
and Shotgun Surgery in its smallest form — one conceptual change applied to N bodies.

**Force.** N functions whose bodies are **alpha-equivalent** — identical up to the renaming of
bound names — except for one or more literal constants. Each is separately maintained, and a fix
applied to one is silently absent from the others. Nothing detects the divergence, because there
is no shared declaration for a type error to attach to.

**Preconditions**

- The bodies are identical after substituting the varying literals. Verify by **diffing** them,
  not by reading them. Any structural difference — an extra branch, a different call order —
  means these are not one function.
- The varying values differ in **degree**, not in **kind**: a threshold, a rate, a limit, a base.
  If each value selects a different code path, this is the wrong direction — go to 6.
- The new parameter can be given a name stating its role. If the only honest name is `mode`,
  `kind` or `flag`, the members differ in kind.
- Prefer a **closed union of literals** or a `const` object over a bare `number`/`string`, so an
  unlisted value stops compiling.
- The parameter does not become a boolean (`UNI-19`), and resulting arity stays ≤3.

**Mechanics**

1. Diff the bodies pairwise and list every difference. One structural difference stops this.
2. Pick the most representative body. Add a parameter per varying value and substitute.
3. For each original, assert that the parameterized call reproduces its constant exactly. Write
   that test **before** deleting anything.
4. Redirect each original to the parameterized version, keeping it as a one-line forwarder. Run
   tests. **This is a green state you may stop at.**
5. Inline the forwarders (Inline Method, `composing-methods.md`) only where the name carried
   nothing, one per test run. `TS2304` enumerates anything missed once an original is deleted.
6. Do not add a value to the set that has no caller. An unused variant is Speculative Generality
   with a table to hide in.

**Before**

```ts
function standardBackoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** (attempt - 1), 30_000);
}
function urgentBackoffMs(attempt: number): number {
  return Math.min(200 * 2 ** (attempt - 1), 5_000);
}
function bulkBackoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** (attempt - 1), 300_000);
}
```

Adding jitter to this backoff is three edits, and omitting one of them is undetectable.

**After**

```ts
type BackoffPolicy = { readonly baseMs: number; readonly capMs: number };

const POLICY = {
  standard: { baseMs: 1_000, capMs:  30_000 },
  urgent:   { baseMs:   200, capMs:   5_000 },
  bulk:     { baseMs: 5_000, capMs: 300_000 },
} as const satisfies Record<string, BackoffPolicy>;

const backoffMs = (attempt: number, p: BackoffPolicy): number =>
  Math.min(p.baseMs * 2 ** (attempt - 1), p.capMs);
```

Call sites become `backoffMs(d.attempt, POLICY[tier])` with `tier: keyof typeof POLICY`, so a
misspelled tier is a compile error and a fourth tier is a data edit. Jitter is now one edit, and
the variant set is derived from the table rather than declared beside it, so there is no second
place that can drift.

**The two varying values are both `number`, and the policy object does not make them type-safe**
— `{ baseMs: 30_000, capMs: 1_000 }` compiles and produces a cap below the base. The object makes
the transposition *legible*; making it *impossible* requires branded types
(`organizing-data.md`). State which of the two you bought.

**Postcondition.** One definition. The variation is data, so an algorithm change costs 1 edit
instead of N, and a new variant costs one record instead of one function. The variant set is
`keyof typeof POLICY`, enumerable by the type system rather than by grep.

| Gain | Cost |
|---|---|
| The shared rule exists once; divergence between variants becomes impossible rather than merely unlikely | The call site loses N domain-named identifiers and gains one identifier plus a literal — a real loss of vocabulary |
| Deriving the variant set from the table (`keyof typeof`) makes "add a variant" a one-line data edit, reviewable as data | If the table is typed loosely, an out-of-set value compiles and the check the technique bought is gone |
| N stack frames and N coverage rows collapse to one | Over-applied, it produces one function with a parameter for every difference anyone ever noticed — the input to 6 |

**When NOT to use this**

- **The values select different code paths.** Parameterizing then forces a branch on the new
  parameter, which is `UNI-02` in miniature and strictly worse than the duplication. Go to 6.
- **A boolean parameter is the result** (`UNI-19`). Same answer: 6.
- **The bodies differ structurally.** They are not one function wearing three names.
- **The variant names are domain vocabulary callers depend on.** `urgentBackoffMs` documents a
  decision that `backoffMs(attempt, POLICY.urgent)` does not. Parameterize underneath and keep
  the named surface — stop at step 4.
- **There is one variant plus a hypothetical second.** The second-occurrence gate in
  `../../refactoring.md` fails.
- **The value set is open-ended and configuration-driven.** Then it is data, and the function
  should take the value — which it already does.

---

## 6. Replace Parameter with Explicit Methods

**Resolves:** **`UNI-19` Boolean Parameters / Flag Arguments** — this is the registry's own stated
fix ("Use enums or separate methods") — Long Parameter List, and the branch-on-parameter shape
that hides two functions inside one declaration.

**Force.** The parameter is not data; it selects behaviour. Three checkable consequences: no
single call exercises both paths, so the function's tests are really two functions' tests; the
return type is the union of two unrelated results; and at the call site `deliver(r, to, true)`
names nothing — a reader must open the callee to learn what `true` means, and there is no way to
tell `true` for *urgent* from `true` for *dry run* if both exist. It is the exact inverse of 5:
use 5 when the variation is a value, 6 when it is a behaviour.

**Preconditions**

- The parameter's domain is **closed and small** — a boolean, or a union of at most about four
  literals.
- **Every call site passes a literal.** This is the deciding test. Any site passing a computed
  value cannot be split and needs a dispatcher (step 5). If most sites compute the argument, this
  technique moves a branch into N call sites, which is Shotgun Surgery.
- The body branches on the parameter at the **top level**, and the branches share a minority of
  their statements. If they share most of it, the variation is data → 5.
- The resulting names are distinct and pronounceable. If the honest names are `doItA` and
  `doItB`, the split is not real.
- The resulting function count stays small. One boolean gives 2; two booleans give 4, which is
  itself evidence that they are orthogonal configuration (9) rather than a behaviour selector.

**Mechanics**

1. Enumerate call sites and classify each: literal argument (splittable) or computed (needs the
   dispatcher).
2. Extract the shared portion of the body into a private helper first (Extract Method,
   `composing-methods.md`), so splitting does not duplicate it.
3. Create one function per literal value, containing only its branch, **named for the behaviour**
   — `deliverNow`, not `deliverUrgentTrue`.
4. Rewrite the original to dispatch to them. Compile and test — no call site has changed yet.
   Then redirect the literal sites, one per test run.
5. If step 1 found computed sites, keep the dispatcher, but **change its parameter from a boolean
   to a union type** and close its `switch` with `assertNever` (`TS-07`). It now has exactly one
   job: mapping a value to a function.
6. Delete the original once no caller remains. `TS2304` proves it, and `knip` finds the dead
   export.

**Before**

```ts
async function deliver(report: Report, to: Recipient, urgent: boolean): Promise<void> {
  if (urgent) {
    await push(to.address, renderShort(report));
    await page(to.id);
  } else {
    await enqueueBatch({ reportId: report.id, recipientId: to.id, attempt: 1 });
  }
}

await deliver(report, to, false);   // `false` names nothing at the call site
```

**After**

```ts
const deliverNow = async (report: Report, to: Recipient): Promise<void> => {
  await push(to.address, renderShort(report));
  await page(to.id);
};

const deliverBatched = async (report: Report, to: Recipient): Promise<void> => {
  await enqueueBatch({ reportId: report.id, recipientId: to.id, attempt: 1 });
};

// only for sites that compute the choice:
type Urgency = "now" | "batched";
const deliverBy = (u: Urgency, report: Report, to: Recipient): Promise<void> => {
  switch (u) {
    case "now":     return deliverNow(report, to);
    case "batched": return deliverBatched(report, to);
    default:        return assertNever(u);
  }
};
```

The union fixes a second defect the boolean had structurally: **a boolean has exactly two values
forever**, so a third policy forces a signature change at every site, while `Urgency` absorbs one
and `assertNever` turns the addition into a compile error at the single place that dispatches
(`TS-07`). Each half's branch count is now strictly lower than the original's.

**Postcondition.** No parameter of any resulting function selects which of its behaviours runs.
Every call site names the behaviour it wants in the identifier it calls, so no reader needs the
declaration to decode a positional literal. Each behaviour has an identifier that appears in
stack traces and coverage reports. Where a dispatcher survives, it exists **once**, over a
closed union, with exhaustiveness enforced.

| Gain | Cost |
|---|---|
| The call site states the behaviour; `deliverNow(...)` needs no lookup, `deliver(..., true)` does (`UNI-19`) | Two exported symbols where there was one, plus a dispatcher if any site computes the choice |
| Each function's paths, tests and coverage are its own; neither carries the other's branches, and each is independently deprecatable | Shared setup between the branches is now duplicated, or must be extracted first — which is why step 2 exists |
| A third policy extends a union with an exhaustiveness error (`TS-07`), which a boolean parameter can never have | Applied where the values differ in degree, it multiplies near-identical functions — the input to 5, and the `UNI-10` shape one altitude down |

**When NOT to use this**

- **Most sites compute the argument** and there is no natural place for a single dispatcher. The
  split relocates the branch to N callers instead of removing it.
- **The branches share most of their statements.** The difference is data → 5.
- **The boolean is forwarded, not branched on** — passed unexamined into a lower layer that also
  treats it as data (a query filter, a serialization option). Splitting propagates the split
  downward for no gain; name it in an options object (9) instead.
- **Two or more flags.** Splitting gives 2ⁿ functions; those flags are orthogonal configuration
  and belong in an options object (9).
- **The split would produce five or more functions.** The variation is data-shaped; use a lookup
  (5), or a Strategy after checking `../../selection.md`'s threshold.
- **The parameter is data.** `send(r, to, retryBudget)` is not a flag, however tempting the
  symmetry.
- **An options object already names the flag.** `deliver(r, to, { urgent: true })` fixes the
  call-site naming defect and not the branching defect. Decide which one you have.

---

## 7. Preserve Whole Object

**Resolves:** Long Parameter List, Data Clumps; and it makes Feature Envy visible where it
exists. Incidentally resolves `UNI-19` for any boolean that was a field of the object.

**Force.** The caller destructures a record and passes its parts, and the callee reassembles the
relationship between them. Three costs, all checkable: every new field the callee needs raises
arity by one and edits **every signature on the path**; the parameter list restates a structure
that already has a name and a type; and same-typed neighbours make argument transposition a
runtime bug that compiles.

**Preconditions**

- At **every** call site, all the extracted values come from **one** object. Check each site. If
  any assembles arguments from two sources, or computes one rather than reading it, passing "the
  whole object" means constructing one — which is 9, not this.
- The callee may legitimately depend on the whole type. **This is the real cost and it is a
  design decision:** after the change the callee's declared dependency is `Recipient`, not
  `string`. A leaf formatting helper taking `(locale, timeZone)` is reusable anywhere; the same
  helper taking `Recipient` is reusable only where a `Recipient` exists — and testable only by
  constructing one.
- The object is `readonly`, or the callee provably does not mutate it. Passing a whole mutable
  object hands the callee write access to fields it previously could not name — a widening of
  authority that no type error reports.
- The callee is not in a layer that must not know the type. A domain type crossing into a
  transport or rendering module inverts the dependency direction and can create a cycle
  (`TS-13`).

**Mechanics**

1. Verify single-source at every call site.
2. Add the whole object as a new **required** parameter (2). Do not remove the old ones yet.
3. Inside the callee, replace each extracted parameter's reads with a field read, one at a time,
   running tests between. If the body is long, bind the fields to named `const`s at the top so it
   still reads in domain terms rather than in accessor chains.
4. Remove the now-unread parameters (3). `TS2345` and `TS2554` enumerate the sites; delete the
   destructuring that existed only to feed the call.
5. **Narrow the parameter's type to the fields actually read** where the callee should not depend
   on the whole type: `Pick<Recipient, "locale" | "timeZone">`. This keeps the arity collapse
   while granting access only to what the callee needs, it is compiler-checked, and `Recipient`
   satisfies it structurally with no adapter at the call site.
6. **Count what the callee now reads.** If it reads most of the object's members and little of
   its own scope, that is Feature Envy, and the function probably belongs with the type —
   `moving-features.md`.

**Before**

```ts
function deliveryHeader(address: string, locale: string, timeZone: string, title: string): string {
  return `${title} · ${address} · ${new Intl.DateTimeFormat(locale, { timeZone }).format(Date.now())}`;
}

deliveryHeader(to.address, to.locale, to.timeZone, report.title);
```

Four parameters, three of them `string` and adjacent.
`deliveryHeader(to.locale, to.address, to.timeZone, report.title)` compiles and renders a wrong
header.

**After**

```ts
function deliveryHeader(to: Recipient, report: Report): string {
  return `${report.title} · ${to.address} · ` +
    new Intl.DateTimeFormat(to.locale, { timeZone: to.timeZone }).format(Date.now());
}

deliveryHeader(to, report);
```

Arity falls from 4 to 2, and the two survivors have **distinct types**, so the transposed call
`deliveryHeader(report, to)` is now `TS2345`. That is the measurable win, and it is a different
win from shortening the list: a class of runtime bug became a class of compile error. The second
win is prospective — adding `to.displayName` to the header is one edit inside the function and
zero at any call site.

**The middle option people skip.** Where the callee needs two fields and should not depend on the
whole type:

```ts
function stamp(at: Pick<Recipient, "locale" | "timeZone">, when: number): string { /* … */ }
```

`Pick` gives this technique's arity with the extracted parameters' coupling — a position
positional parameters cannot express.

**Postcondition.** The parameter count equals the number of distinct sources the function reads
from. No two parameters share a primitive type, so transposition does not compile. The next field
the callee needs costs **zero** call-site edits, and the `Pick` documents — and the compiler
enforces — exactly which fields the callee reads.

| Gain | Cost |
|---|---|
| Arity drops to the number of sources; transposition of the survivors becomes a type error | The callee's declared dependency widens from primitives to a domain type, narrowing reuse and requiring one to be constructed in tests |
| Adding an input the callee needs stops being an O(N) signature change — usually the reason to do it | Without a `Pick`, the callee can read fields it has no business reading, and a later edit widens coupling with no signature change to review |
| `Pick<T, K>` gives a middle ground positional parameters cannot express: arity 1 with an explicit, checked field list | If the object is mutable, the callee gains write access to fields it could not previously name; and it can create an import cycle (`TS-13`) |
| Reveals Feature Envy: a function reading most of one type's members belongs near that type | Across a package boundary the caller must now import the type |

**When NOT to use this**

- **The callee is a general-purpose utility.** A `formatMoney(cents, locale)` helper coupled to
  `Recipient` loses every context that has no recipient. Use `Pick`, or leave it.
- **The values come from different objects at any site**, or one is computed rather than read → 9.
- **It would invert a dependency or create a cycle.**
- **The object is mutable and the callee should not have the extra authority** → `Readonly<T>` or
  `Pick`.
- **The callee is exercised in tests far more often than in production** and constructing the
  whole object dominates the test's cost. Needing a factory to test it is itself evidence the
  type is doing too much.
- **The callee is a public API whose consumers do not hold the object.** You would be exporting
  the type to make the signature shorter.

---

## 8. Replace Parameter with Method Call

**Resolves:** Long Parameter List, Data Clumps, and caller-side Duplicate Code — every caller was
computing the same argument.

**Force.** A parameter whose value every caller derives the same way from something the callee
can already reach. The derivation exists at N sites, so a change to the rule is N edits, and the
one you miss is a defect no type error announces. The parameter also permits any one site to pass
a value inconsistent with the rest, which is a bug the signature invites.

**Preconditions — the strict one is the third**

- The callee can reach **every input** of the derivation without a new parameter, and without a
  new import crossing a boundary its module does not already cross.
- The derivation is a **query** in technique 4's sense: pure, no observable effect. If it is not,
  apply 4 first.
- **The derivation is referentially transparent at the moment the callee will run it.** This is
  the precondition that fails most often. Before the change, the value is a *snapshot* taken at
  the caller's moment; after, it is read at the callee's moment. If anything can change between
  the two — a clock, a counter, a mutable field, an intervening `await` — the two values differ
  and this is a behaviour change. `tsc` reports the signature change and nothing about this.
- **Every call site passes the same derivation.** Read them all. One site passing an override is
  the entire reason the parameter exists, and this technique deletes that capability.
- The derivation's cost is acceptable at the callee's call frequency. If the caller hoisted it
  out of a loop, this un-hoists it.

**Mechanics**

1. Read every call site; confirm the argument expression is the same derivation at each. One
   exception invalidates the technique outright.
2. Confirm purity, reachability and the timing precondition.
3. Inside the callee, replace reads of the parameter with the call. **Keep the parameter for one
   green run** — this isolates "the computed value is equal" from "the signature changed", and
   the existing suite verifies it.
4. Delete the parameter (3). `TS2554` enumerates every direct call site.
5. Delete the now-orphaned argument expressions and anything that existed only to build them. Run
   `knip` and `tsc --noUnusedLocals` for producers that just became dead.

**Before**

```ts
class ThrottleGate {
  constructor(private readonly counters: Counters) {}

  shouldThrottle(r: Recipient, sentInWindow: number, limit: number): boolean {
    return sentInWindow >= limit;
  }
}

gate.shouldThrottle(to, counters.sentInWindow(to.id), limitFor(to.channel));  // at every site
```

**After**

```ts
class ThrottleGate {
  constructor(private readonly counters: Counters) {}

  shouldThrottle(r: Recipient): boolean {
    return this.counters.sentInWindow(r.id) >= limitFor(r.channel);
  }
}

gate.shouldThrottle(to);
```

Arity falls from 3 to 1, and the channel→limit rule now exists once instead of at every call
site. **Two consequences to state rather than discover.** First, a capability was removed: a test
that passed a small `limit` to exercise throttling can no longer do so — the seam moved from the
parameter to `counters`, and that test now needs a `Counters` double. Second, the provenance
changed: `sentInWindow` is read when `shouldThrottle` runs, not when the caller prepared its
arguments. If the counter advances in between, the answers differ, and no compile error marks the
difference.

**Postcondition.** The parameter list holds only values the callee cannot derive. The derivation
exists once, so a change to the rule is a one-file edit, and no site can pass a value that
disagrees with the rest. The test seam is the collaborator, not the argument — a relocation that
is deliberate and recorded.

| Gain | Cost |
|---|---|
| One definition of the derivation; a fix lands once instead of N times | The callee gains a dependency on the collaborator it must now reach through — arity traded for a coupling edge, and `TS-13` if it closes a cycle |
| Inconsistent arguments become unrepresentable — including the site that passed a *slightly different* derivation of the same type, which the type system could never catch | The override capability is deleted; tests that used it must move to the collaborator. If a second policy appears, this becomes Add Parameter again |
| Arity drops, and the call site reads as the operation rather than as the operation plus its prerequisites | Provenance moves from caller-time to callee-time — invisible to the compiler, visible in production. And a cached value is now recomputed per call |

**When NOT to use this**

- **Any call site legitimately passes a different value** — an override, a replayed historical
  value, a test fixture. The parameter is a genuine variation point and a seam; deleting a seam is
  not a refactoring win. That is Strategy's entry condition, and `../../selection.md` sets the
  threshold for whether it is worth a pattern.
- **The derivation is not referentially transparent** — clock, counter, random, mutable field,
  I/O. A passed-in `now` is a **snapshot**; computed inside, each call gets a different value.
  An injected clock is usually the deliberately correct design, because it is what makes the
  callee testable and time-independent (`UNI-28`). Do not "simplify" it away.
- **The callee is a pure function and reaching the value means giving it a dependency.** Purity is
  worth more than one parameter.
- **The derivation is expensive and the caller hoisted it out of a loop**, or holds it cached
  across several calls.

---

## 9. Introduce Parameter Object

**Resolves:** Long Parameter List, Data Clumps, and **`UNI-19` Boolean Parameters / Flag
Arguments**. The registry's fix hint for `UNI-19` is "use enums or separate methods"; the options
object is the third answer, and it is the right one when the flags are genuinely orthogonal
configuration rather than a behaviour selector. When they select a behaviour, use 6.

**Force — two distinct defects, and this fixes both.**

1. **Positional ambiguity.** Same-typed parameters make transposition compile. A signature with k
   parameters of one type accepts k! orderings, and the compiler distinguishes none of them.
2. **Anonymity.** TypeScript has no named-argument syntax. `sendReport(r, to, 3, 30_000, 1_000,
   false, true)` carries no names at the site, and the reader must count positions against the
   declaration. **An object literal parameter *is* TypeScript's named-argument mechanism**, and it
   brings two properties positional parameters cannot have: order-independence, and defaults on
   any field rather than only on trailing ones. (A defaulted positional parameter must be last, or
   callers must pass `undefined` to skip it; a defaulted field has no such rule.)

**Preconditions** — any one of these is sufficient:

- Arity ≥4.
- Two or more adjacent parameters share a primitive type, so a transposed pair compiles.
- Any parameter is a boolean (`UNI-19`).
- The same ≥3 parameters recur in the same order across ≥2 signatures (Data Clumps).

Plus, in all cases:

- **The group has a name in the domain.** If the only honest name is `Params`, it is a bag, and it
  will accrete unrelated fields until it is a `Record<string, unknown>` with extra steps.
  Acceptable for a genuine options bag; not for a clump that is really a domain type — that is
  Extract Class in `organizing-data.md`.
- Every member is an **input**. A parameter used as an output channel does not belong in a shared
  input object.
- Any invariant spanning two fields is either expressible in the type or enforced by a
  construction function you are prepared to add.

**Mechanics**

1. Run tsserver *Convert parameters to destructured object* on the declaration. It rewrites the
   signature and every call site mechanically.
2. **Name the type**, and make every field `readonly`. The tool emits an inline literal; a named
   `type` is the point — it makes the clump greppable and reusable across the signatures that
   share it.
3. Split required from optional. Optional fields carry defaults in the implementation's
   destructuring pattern, not as `| undefined` unions in the type, so each is independently
   omittable.
4. **Re-check every default against pre-change behaviour**, by the same rule as technique 2. A
   field that is optional with a default differing from what a site used to pass changes that site
   silently, and object-literal sites that omit the field produce no error.
5. Compile; run tests. At each site, replace positional arguments with an object literal.
6. Convert the other signatures that take the same clump to the named type. That is the payoff:
   one type instead of k parameter lists, and the next field is one edit.
7. If the object later acquires derivations of its own, it has become a domain type — Extract
   Class, in `moving-features.md`.

**Before**

```ts
async function sendReport(
  report: Report, to: Recipient,
  attempts: number, timeoutMs: number, backoffBaseMs: number,
  compress: boolean, dryRun: boolean,
): Promise<Delivery> { /* … */ }

await sendReport(report, to, 30_000, 3, 1_000, false, true);
```

Arity 7. Three adjacent `number`s: the call above passes 30,000 attempts with a 3 ms timeout, and
it compiles. Two adjacent booleans that no reader can decode without the declaration.

**After**

```ts
type SendOptions = {
  readonly attempts?: number;
  readonly timeoutMs?: number;
  readonly backoffBaseMs?: number;
  readonly compress?: boolean;
  readonly dryRun?: boolean;
};

async function sendReport(
  report: Report,
  to: Recipient,
  {
    attempts = 3,
    timeoutMs = 30_000,
    backoffBaseMs = 1_000,
    compress = false,
    dryRun = false,
  }: SendOptions = {},
): Promise<Delivery> { /* … */ }

await sendReport(report, to, { timeoutMs: 5_000, dryRun: true });
```

Every value is named; order is irrelevant; a sixth option costs zero call-site edits; and a
misspelled key is a compile error — verified: `send({ timeoutMs: 5_000, dryRunn: true })` is
**`TS2561` … 'dryRunn' does not exist in type 'SendOptions'. Did you mean to write 'dryRun'?**
That is a check positional arguments cannot perform at all.

**Three things it does not fix, stated so they are not assumed.**
`{ attempts: 30_000, timeoutMs: 3 }` still compiles — both fields are `number`, so the object
makes the transposition *visible*, not impossible; impossibility needs branded types
(`organizing-data.md`). **Excess property checking applies to object literals written at the call
site, not to a pre-built variable** — verified: `const o = { timeoutMs: 5_000, dryRunn: true };
sendReport(report, to, o)` compiles clean, so a site that builds its options elsewhere keeps its
typo. And `dryRun: true` fixes the naming half of `UNI-19`, not the branching half — if `dryRun`
selects a wholly different path inside, that is still 6.

**Postcondition.** The positional part of the signature holds only operands; everything
policy-shaped is named at the call site. Adding an option is a type edit with **zero** call-site
edits. A transposed pair of booleans no longer compiles, because they are no longer positional.
The clump has a name that `grep` and Find All References can follow across the signatures that
share it.

| Gain | Cost |
|---|---|
| Named arguments, order-independent per-field defaults, and excess-property checking on literals — three things positional parameters cannot give you | One type declaration and one allocation per call, usually escape-analysed away; measure before caring (`UNI-42`) |
| Adding, defaulting or deprecating an option stops touching call sites | That same additivity is how the object becomes a junk drawer. The Long Parameter List moves inside the type, where no arity check reaches it |
| The type is a place to hang a single parse/validation function that runs once at the boundary | Optional fields reintroduce technique 2's silent-default hazard one level down |
| A named type is greppable and reusable; a parameter list is neither | Three booleans inside an options object are **still `UNI-19`** if they select among four behaviours rather than configuring one — see 6 |

**When NOT to use this**

- **Arity ≤3 with distinct types and no boolean.** `f(report, recipient)` is clear; the object
  adds a declaration and removes nothing.
- **The fields are not one concept**, or never co-vary. An options bag accreting unrelated fields
  is Long Parameter List with the arity check removed, and the name will be a lie.
- **The clump is a domain concept with an invariant** → Extract Class with a parse boundary,
  `organizing-data.md`, not a bare record.
- **The options select a behaviour rather than configure one.** Four boolean combinations that
  mean four different operations is 6.
- **The callee would mutate the object.** Then it is not a parameter object; it is shared mutable
  state passed by reference.
- **A profiled hot loop** where the literal genuinely allocates. Measure first.

---

## 10. Remove Setting Method

**Resolves:** Temporary Field, the mutable half of Inappropriate Intimacy, and the bug class where
an object is observed between two writes. The registry's nearest entries are `JAVA-16` Mutable
Public Fields in Data Classes and `CSHARP-22` Public Fields Instead of Properties; there is no
TypeScript-specific ID.

**Paradigm precondition, checked first.** This technique presupposes a **mutable object**. Under
`readonly` fields assigned once at construction — or a `readonly` record produced by a factory
function, which is the shape the `Example types` above use — there is no setter, and the technique
is moot: the state it aims at is the state you are in. Check before reading further: does the type
have any assignable field? `Readonly<T>`, `as const`, or `readonly` on every member means skip
this entry entirely.

**Force.** A field that must not change after construction, exposed by a setter. Two checkable
consequences. First, the type has an **initialization window** — a period in which some fields are
set and others are not, during which any code that observes the object sees a state its own type
declares impossible. Second, no **invariant** spanning two fields can be enforced, because each
setter sees only its own field: consequently no invariant over that field can be established
anywhere except immediately before each read, so every reader must re-check, and every reader that
forgets is a latent defect.

**Preconditions**

- The value is known at construction time at **every** construction site. Check: for each `new X(`,
  find the matching `x.setFoo(`. If any setter call is separated from its `new` by a branch, a loop
  or an `await`, the value is not construction-time and freezing it requires restructuring —
  usually a builder, or a two-phase type.
- No caller changes the value after construction for a legitimate reason. Runtime-reloaded
  configuration is state, not construction data.
- The setter enforces no invariant the constructor does not. If it validates, move the validation
  to the constructor or parse function **first, in a separate commit**.
- No framework requires a no-argument constructor followed by property assignment — some DI
  containers, ORMs and deserializers do, and they assign reflectively where `tsc` cannot see it.

**Mechanics**

1. Enumerate the setter's callers with Find All References.
2. Add the value as a constructor parameter, stored `readonly`.
3. Move the value into the `new` expression at each site, one per test run.
4. Delete the setter. `tsc` enumerates any caller you missed.
5. Mark the field `readonly`. **Any surviving assignment is now `TS2540 Cannot assign to 'x'
   because it is a read-only property`** — that is the check that the removal is complete, not
   merely started.
6. Where a writer legitimately produces a **different** value, return a new object rather than
   mutating: `{ ...prev, attempt: prev.attempt + 1 }`. That replacement is the point of the
   technique — the change becomes a value, visible at the caller.
7. Enable `@typescript-eslint/prefer-readonly` so the state cannot regress. If several fields moved
   and the constructor reached arity ≥4, apply 9 to it.

**Before**

```ts
class DeliveryAttempt {
  recipientId!: string;
  startedAt!: number;
  attempt = 1;

  setRecipientId(id: string) { this.recipientId = id; }
  setStartedAt(t: number)    { this.startedAt = t; }
}
```

The `!` definite-assignment assertions are the tell: `strictPropertyInitialization` rejects these
fields, and the assertions exist to silence it. They are a written admission, in the source, that
the field is `undefined` for part of the object's life. Between `new DeliveryAttempt()` and the
second setter call, `startedAt` is `undefined` while its declared type says `number` — every
reader in that window is type-checked against a lie.

**After**

```ts
class DeliveryAttempt {
  constructor(
    readonly recipientId: string,
    readonly startedAt: number,
    readonly attempt: number = 1,
  ) {}
}
```

**The form to prefer in TypeScript**, where the class holds no behaviour:

```ts
type DeliveryAttempt = {
  readonly recipientId: string;
  readonly startedAt: number;
  readonly attempt: number;
};

const startAttempt = (recipientId: string, startedAt: number, attempt = 1): DeliveryAttempt =>
  ({ recipientId, startedAt, attempt });

const retry = (a: DeliveryAttempt): DeliveryAttempt => ({ ...a, attempt: a.attempt + 1 });
```

`retry` produces a **new value** rather than mutating one that other holders have a reference to.
That difference — not the deletion of two methods — is what the technique is actually buying.

**Postcondition.** Every field is assigned exactly once, at construction, so any invariant checked
there holds for the object's entire lifetime and readers need not re-check. There is no state in
which the type's invariants fail to hold, `strictPropertyInitialization` passes with no
definite-assignment assertion, and a would-be mutation is a compile error rather than a review
comment.

| Gain | Cost |
|---|---|
| The initialization window closes: no observer can see a partially built object, because no such state exists | Every construction site must supply every value, which can raise constructor arity to the point of needing 9 |
| Invariants spanning several fields become enforceable, because one function sees them all — checked once instead of at every read | Values genuinely unavailable at construction now need a builder or a two-phase type |
| `readonly` + `prefer-readonly` make accidental mutation a compile error at zero ongoing cost | **`readonly` is erased at emit** — verified: `Object.assign(attempt, { attempt: 99 })` compiles clean. A hydrating library still writes the field, and it breaks at runtime |
| Callers that shared a mutable instance to communicate must now pass the new value explicitly | That is more code — and more honest |

**When NOT to use this**

- **Under `readonly` already.** There is no setter. The technique does not apply; do not invent
  work by looking for one.
- **The field genuinely varies over the object's lifetime** — a connection's status, a circuit
  breaker's consecutive-failure count, a pool's in-flight count. That is state, and the fix is not
  removal but naming: the setter becomes a command (4) that enforces the transition,
  `recordFailure()` rather than `setFailures(n)`.
- **The value is unavailable at some construction sites.** That is Temporary Field, and the answer
  is a builder or a state union (`{ status: "draft" } | { status: "sent"; delivery: Delivery }`),
  not a constructor parameter that takes `undefined`.
- **A framework assigns properties reflectively** — form state, ORM entities, reactive stores. The
  framework owns the write path.

---

## 11. Hide Method

**Resolves:** Large Class measured by public surface, `UNI-04` Fat Interface, Inappropriate
Intimacy, Speculative Generality — and, structurally, the cost of every other technique in this
group.

**Force.** Every exported symbol is a signature you cannot change without enumerating consumers,
and beyond a package boundary you cannot enumerate them at all. The public surface is the part of
N you do not control. Public is a promise: it constrains every future edit, it is what a
consumer's test may depend on, and it is what a reviewer must weigh when estimating blast radius.
An unreferenced public member charges all of that and returns nothing. Hiding is therefore the
cheapest available reduction in blast radius: each symbol hidden here is a set of call sites no
later technique has to visit.

**Preconditions**

- No reference from outside the type or module. Check in this order, because each catches what the
  previous misses:
  1. tsserver *Find All References* — complete for the symbol graph, blind to strings;
  2. `knip` — reports exports with no importer, across a workspace;
  3. `grep -rn '\.methodName\b'` across the whole repo, tests and JSON/YAML included.

  Then establish it properly by **deleting the `export` and compiling**, not by grep: re-exports
  through a barrel file (`TS-01`) and dynamic property access do not grep.
- Not part of a published package's entry point, or a semver-major is acceptable.
- **No test calls it.** This is the usual blocker and it is a signal rather than an obstacle:
  either the behaviour is reachable through the public API (rewrite the test), or the helper wants
  its own module with its own contract (extract it first — `moving-features.md`), or the test is
  asserting on internals (`UNI-26`) and should assert through the boundary instead.
- Not a member declared by an implemented interface. `tsc` rejects narrowing an interface member to
  `private` in an implementor.

**Mechanics**

1. Run all three checks.
2. Choose the mechanism deliberately; they differ in who enforces them:

| Mechanism | Enforced by | Diagnostic | Still reachable via |
|---|---|---|---|
| `private` | `tsc` only — the property exists at runtime | `TS2341` on dotted access | **`obj["m"]` — verified to compile.** Also `(obj as any).m()`, `Object.keys`, JSON, a debugger |
| `#name` | the **runtime** — it is not a property, and no string names it | `TS18013` on outside access | nothing |
| module non-export | the module system | `TS2459` (declared locally, not exported) | nothing; no importer can name it |

3. Apply the narrowest that works. For a free function, deleting `export` is the entire technique.
   Prefer `#name` to `private` for anything an untyped consumer could reach.
4. `tsc --noEmit`. Every error is a real consumer; zero errors is the common and successful case.
5. For each real consumer, choose: move the consumer inside the boundary, or expose a **narrower**
   operation expressing what the consumer actually needs, and keep the helper hidden. Do not
   re-export the helper because one caller wanted it.
6. Re-run `knip`. A hidden member frequently orphans a sibling whose only caller it was.

**Before**

```ts
export class WebhookSender {
  async send(report: Report, to: Recipient): Promise<void> {
    await fetch(to.address, { method: "POST", body: this.buildPayload(report) });
  }

  buildPayload(report: Report): string {          // public; no external caller
    return JSON.stringify({ id: report.id, title: report.title, rows: report.rows });
  }
}
```

**After**

```ts
export class WebhookSender {
  async send(report: Report, to: Recipient): Promise<void> {
    await fetch(to.address, { method: "POST", body: buildPayload(report) });
  }
}

const buildPayload = (report: Report): string =>
  JSON.stringify({ id: report.id, title: report.title, rows: report.rows });
```

Two things changed, and the second is the interesting one. The member left the class entirely,
because **it read no instance state** — a method with no `this` reference is a function that has
been given a receiver it does not use, and moving it out is `moving-features.md`'s Move Method, not
an access-modifier change. And it is unexported, which is strictly stronger than `private`: an
importer naming it gets `TS2459`, whereas `private` is erased at runtime and
`(sender as any).buildPayload` still works.

**Postcondition.** The module's changeable surface is exactly its export list, and the type's
public surface is exactly the set of members with at least one external caller. `tsc` proves
nothing outside binds to the rest, and `knip` reports no unused exports. A signature change to a
hidden member has a blast radius bounded by the file — so the O(N) techniques above became O(1)
for each symbol hidden, at the cost of deleting a keyword.

| Gain | Cost |
|---|---|
| Directly reduces N for every other technique in this group — the cheapest move here, and the only one that shrinks the problem | Hiding something three modules legitimately need is not hiding, it is a Move Method in disguise (`moving-features.md`) |
| The export list becomes a readable statement of the module's contract instead of an accident of typing `export` | Tests that reached in must be rewritten against the public API, or the unit must be extracted — real work |
| Frequently reveals a Move: a member with no `this` was never a member | `#private` fields are excluded from `Object.keys`, spread and structured clone — real consequences for serialization and snapshot tests |
| `knip` keeps it from regressing at near-zero ongoing cost | For a published package, hiding is a major-version break; and `private` is compile-time only, so assuming runtime enforcement it does not have is its own defect |

**When NOT to use this**

- **It is a seam.** A test substitutes it, or a port/adapter boundary depends on it being
  replaceable. Judge by the import graph, not the line count.
- **It is a documented extension point** — a plugin hook, or a `protected` step of a template
  method (`../../patterns/template-method.md`).
- **It is the published API.** Then this is a deprecation, not a refactoring.
- **Three or more modules need it.** The member is in the wrong module; move it
  (`moving-features.md`) rather than hiding it and re-exporting it from two places.
- **A framework reaches it by string name** — a serializer, a DI decorator, a route table. The name
  is data.
- **There is no pending edit, and you are only reducing a count.** Hiding every currently
  unreferenced member reduces a blast radius of zero; a public helper with two honest consumers is
  not a smell. The gates in `../../refactoring.md` apply here as everywhere.

---

## 12. Replace Constructor with Factory Method

**Resolves:** `UNI-05` Hard Dependencies / `new` Everywhere; Switch Statements, where construction
branches on a type code at every call site; Long Parameter List on constructors; and the
construction half of Primitive Obsession — a parse function *is* a factory. Applied without cause
it *creates* `UNI-10` Factory Overkill.

**Where the pattern lives.** The class-hierarchy form — an overridable `createX()` on an abstract
creator — is the **Factory Method** pattern, documented in `../../patterns/factory-method.md`,
including why a flat registry usually beats the subclass form in TypeScript, and `UNI-10` as its
failure mode. This entry covers only the **refactoring**: moving existing call sites off `new`. Do
not introduce a hierarchy here, and do not re-derive that decision — read that file and
`../../selection.md`'s threshold first.

**Force.** `new X(...)` fixes the concrete type at the call site and cannot do four things. **Name
which one you need before starting** — if none applies, stop.

| Capability a constructor lacks | What a factory function gives you |
|---|---|
| choose the concrete type or arguments from data | one entry point that dispatches over a discriminant, exhaustively |
| return an existing instance | identity control — interning, caching (`../../patterns/flyweight.md`) |
| fail without throwing | a declared failure in the **return type**; a constructor's only failure channel is `throw` |
| carry a name | `fromRow`, `parse`, `forChannel` — several constructions with different meanings and identical parameter types |

**Preconditions**

- One row above applies and you can say which.
- No framework constructs the type reflectively — deserializers, some DI containers, ORM hydration.
- No consumer depends on `instanceof X` in a way a widened return type would break.
- Every construction site is reachable for edit. Note that until the constructor becomes `private`,
  **`tsc` enumerates nothing here** — `new X(...)` stays legal, and enumerating `new X(` textually
  misses subclass constructors, `Reflect.construct` and deserialization. The migration is driven by
  Find All References, and only step 5 makes it exhaustive.

**Mechanics**

1. State the capability. If none, this is `UNI-10`; stop.
2. Add the factory, named for **what it returns**, not for the act of construction. Prefer a
   **module-level function** over a `static` member in TypeScript: it needs no receiver, it
   tree-shakes, and it can return a union the class cannot.
3. Redirect call sites, one per test run.
4. Move construction-time validation into the factory, so the failure appears in its return type
   rather than as an undeclared throw.
5. **Mark the constructor `private`.** This is the step that converts the change from silent to
   compiler-enumerated: skip it and every remaining `new X(...)` compiles happily and bypasses
   whatever invariant the factory was created to enforce. `tsc` now reports each one as
   **`TS2673 Constructor of class 'Sender' is private and only accessible within the class
   declaration`**.
6. Only now widen the factory's return type if it needs to — to a supertype, a union member, or
   `T | undefined`. Widening before step 5 mixes two changes in one diff.
7. If the factory dispatches over a discriminant, close the `switch` with `assertNever` (`TS-07`),
   and keep it in **one** module. The Switch Statements smell returns the moment a second module
   switches on the same discriminant.

**Before**

```ts
class Sender {
  constructor(
    readonly channel: Channel,
    readonly endpoint: string,
    readonly token: string,
  ) {}
}

// every call site repeats the channel → endpoint/token mapping:
const s = new Sender("webhook", cfg.webhookUrl, cfg.webhookSecret);
```

**After**

```ts
class Sender {
  private constructor(
    readonly channel: Channel,
    readonly endpoint: string,
    readonly token: string,
  ) {}

  static forChannel(channel: Channel, cfg: Config): Sender | undefined {
    switch (channel) {
      case "email":   return new Sender(channel, cfg.smtpUrl,  cfg.smtpToken);
      case "slack":   return new Sender(channel, cfg.slackUrl, cfg.slackToken);
      case "webhook": return cfg.webhookUrl
        ? new Sender(channel, cfg.webhookUrl, cfg.webhookSecret)
        : undefined;
      default:        return assertNever(channel);
    }
  }
}
```

Three of the four capabilities are exercised: the arguments are selected from data, the name states
the selection rule, and the `webhook` case **fails by returning `undefined`**, which a constructor
cannot do. The mapping that was spread across every call site now exists once, and a fifth
`Channel` variant is a compile error at `assertNever` instead of a grep.

`private constructor` is the load-bearing keyword. Without it, `forChannel` is a suggestion: any
module can still write `new Sender("webhook", "", "")` and produce an instance that violates every
check the factory performs, with a clean compile.

**The name is also a capability, and it is the one most often left on the table.** Two entry points
with identical parameter types — `Sender.forChannel(channel, cfg)` for configuration and a
`Sender.trusted(row)` for values already validated at write time — cannot be expressed as
constructor overloads at all, because overloads are distinguished by type and these are
distinguished by *provenance*.

**Postcondition.** `new X(` appears only inside `X`, so `tsc` proves every construction goes through
a factory and construction-time invariants hold for every instance in the program. Every
construction path has a name. Construction failure has a declared type instead of an undeclared
throw. The type→arguments mapping exists once and is exhaustive over the discriminant.

| Gain | Cost |
|---|---|
| Construction can fail in the return type, be cached, dispatch on data, and carry a name — none available to `new` | One more symbol and a hop; if the factory only forwards to `new`, that is all you bought (`UNI-10`) |
| The construction rule stops being duplicated at call sites, and a new variant is a compile error | The migration is not compiler-driven until `private constructor` lands — the step people skip |
| `private constructor` makes "all construction goes through here" an invariant the compiler enforces | It blocks subclassing **and** test doubles built with `new` — use `protected` if a subclass must construct. Reflective frameworks break outright |

**When NOT to use this**

- **None of the four capabilities is needed.** A factory wrapping `new` is `UNI-10`: an extra
  symbol, an extra hop, and two declarations that can drift.
- **One concrete type and no plausible second** — the second-occurrence gate fails.
- **The class is a plain data carrier.** Use a `type` and an object literal, or a branded type plus
  one parse function (`organizing-data.md`); then there is no constructor to replace.
- **A framework constructs it reflectively.**
- **The motive is "many optional parameters"** → 9, or a builder.
- **The motive is varying behaviour per subclass** → that is the pattern, not the refactoring. Read
  `../../patterns/factory-method.md` and apply `../../selection.md`'s threshold first.

---

## 13. Replace Error Code with Exception

**Resolves:** `UNI-20` Inconsistent Error Codes, `SLOP-06` Inconsistent Error Handling, `UNI-41`
Magic Numbers (the sentinel is one), and the Duplicate Code of the same sentinel check at every
call site. `GO-14` Sentinel Error Misuse is the cross-language shape.

**Paradigm note, before the mechanics — this technique is largely already done for you.** Fowler's
version targets a language where a function returns an `int` status that callers compare against
constants. TypeScript has no checked exceptions and no idiomatic error-code return, so the
transformation as literally stated rarely applies. What survives is a live and harder question:
**which of four shapes should the failure take?**

| Return shape | Type records the failure | Caller forced to handle | Fits |
|---|---|---|---|
| in-band sentinel (`-1`, `""`, `0`) | **no** — indistinguishable from a valid value | no | nothing. This is what the technique removes |
| `T \| undefined` / `T \| null` | yes, under `strictNullChecks` | yes — narrowing is required before use | one failure mode, no detail worth carrying |
| `Result<T, E>` discriminated union | yes, **with the error's type** | yes, and **exhaustively** — a new failure kind breaks every `switch` that does not handle it (`TS-07`, `TS-10`) | several failure modes a caller acts on differently |
| `throw` | **no.** TypeScript has no checked exceptions; the signature says nothing about it, and `catch` is `unknown` | no | failures no intermediate frame handles, routed to one boundary |

**Choose by the operational/programmer distinction, not by taste.** An **operational** failure is
one you anticipated and wrote the failure path for: bad input, a 404, an upstream 503. A
**programmer** error is a violated invariant, after which process state is unknown. They need
opposite handling — answer the caller and keep serving, versus log with the stack and let the
process die and restart. That distinction is argued in the `bunjs` plugin's errors skill
(`plugins/bunjs/skills/errors/SKILL.md`, "The one distinction: operational vs programmer"), which is
the authority for the choice and for the boundary handler that consumes the throws. **What this
technique removes is the in-band sentinel.** Where the failure lands is that skill's decision, not
this file's; presenting `throw` as the unexamined answer is the mistake this section exists to
prevent, and so is treating `Result` as the fashionable one.

**Blast radius — the sharpest in this group, and it runs the wrong way.** Replacing a sentinel
with `T` plus a throw **narrows** the return type, and **a narrowed type is assignable everywhere
the wider one was**. So every existing call site still compiles. Verified against `--strict`: with
the return type back down to `number`, `m === null`, `m ?? 0`, `m?.toFixed(2)` and `!m` all compile
with zero diagnostics. Sites that checked the sentinel keep a branch that can no longer be taken;
sites that never checked now propagate a throw through frames with no handler. `TS2367` does **not**
rescue you here — it exempts `null` and `undefined` from the no-overlap check.

**And it reaches less far than "every call site still compiles" suggests: narrowing enumerates
*uses*, not *relays*.** A dead guard at a consuming site is at least visible to whoever reads that
site. An intermediate that only forwards the value is not, because nothing edited its declaration:

```ts
// Untouched by the change, and still advertising `| null` to its own callers.
function nextRunForRow(r: Recipient, now: number): number | null {
  return minutesUntilNextRun(r, now);          // now returns `number`, and throws
}
```

Verified: zero diagnostics. `number` is assignable to `number | null`, so the relay keeps
compiling, keeps publishing a nullable type its source can no longer produce, and passes the new
throw through a frame whose signature reads as though it handles failure. Assignment into a
pre-declared `let slot: number | null` behaves the same way. Find All References on the callee
gives you the direct sites; each relay's own callers are a second generation the compiler never
mentions, and you enumerate those by hand.

**Prefer the widening direction whenever you have the choice.** Changing `T` to a discriminated
union breaks every call site at compile time, and that is the property you want: the compiler hands
you the list instead of you reconstructing it.

**Preconditions**

- The failure is signalled by a value **inside the success type's domain**, so the type cannot
  distinguish success from failure. If the return is already `T | undefined` under
  `strictNullChecks`, the compiler already forces the check and this technique is done.
- Every sentinel value is enumerated, together with the sites that test for it. Find All References
  on the callee is the complete list; `grep -rn '=== -1'` and friends are a start. Sentinels are
  precisely what callers skip: assume some sites do not check, and expect to find bugs that predate
  your change.
- The failure is classified operational or programmer, per the skill above.
- **If throwing:** a boundary exists that catches — a `Bun.serve` `error()` hook, a job runner's
  wrapper, a top-level handler. A throw with no boundary is a sentinel with a stack trace and a
  crash.
- **If returning a typed failure:** the union is discriminated (`TS-10`) and consumed by an
  exhaustive `switch` (`TS-07`). Without both, you have rebuilt the sentinel with more syntax.

**Mechanics**

1. Enumerate call sites; classify each as checking the sentinel or ignoring it. Record the ones
   that do not check — those are pre-existing defects, and fixing them is a behaviour change.
2. Choose the channel from the operational/programmer classification. Write the decision in the
   commit message.
3. **Change the return type first**, to a union, **before** touching the body — introduce it
   alongside the old signature if the migration is large. `tsc --noEmit` now enumerates every call
   site, because the type genuinely changed. **This step converts a silent transformation into an
   enumerated one; skipping it is how this technique causes incidents.**
4. Migrate sites one at a time, deleting each now-dead sentinel check. Test between. A site that
   previously ignored the sentinel now has to decide, which is a behaviour change and belongs in
   its own commit with its own tests.
5. If **every** site propagates and a boundary handler exists, only then convert the return to `T`
   and `throw` a typed error at the source. If sites differ, **stop at the union** — it is the
   correct answer for that module, and this step would not be an improvement.
6. Delete the sentinel constant so it cannot return. Run tests, including one asserting the failure
   path — which the sentinel version almost certainly lacked. If throwing, confirm the boundary
   handles the new type; if returning a union, confirm that adding a variant fails to compile at
   the consuming `switch`.

**Before**

```ts
// -1 means "no schedule"; the type says number, so nothing enforces the check
function minutesUntilNextRun(r: Recipient, now: number): number {
  const next = scheduleFor(r.id);
  if (!next) return -1;
  return Math.round((next - now) / 60_000);
}

const m = minutesUntilNextRun(to, now);
if (m !== -1) show(`${m} min`);                       // one caller checks

show(`${minutesUntilNextRun(to, now)} min`);          // this one renders "-1 min"
```

Both compile. The disagreement between them is the defect, and it exists because the failure is a
`number`.

**After — the operational form, typed**

```ts
type NextRun =
  | { readonly kind: "scheduled"; readonly minutes: number }
  | { readonly kind: "none" };

function nextRun(r: Recipient, now: number): NextRun {
  const next = scheduleFor(r.id);
  if (!next) return { kind: "none" };
  return { kind: "scheduled", minutes: Math.round((next - now) / 60_000) };
}
```

The unchecked caller cannot be ported mechanically: `nextRun(to, now).minutes` is **`TS2339
Property 'minutes' does not exist on type 'NextRun'`**, because `minutes` is absent on the `none`
variant, so reaching it requires narrowing on `kind`. **The type change enumerated the callers —
discipline did not.** One hole worth knowing, and verified: `` `${nextRun(to, now)} min` `` still
compiles and prints `[object Object]`, because template interpolation accepts any type. The
compiler catches property access, not stringification; read the diff as well as the error list.

**And the programmer-error case, which is the other channel**

```ts
if (!KNOWN_CHANNELS.has(r.channel)) throw new Bug(`unreachable channel ${r.channel}`);
```

A violated invariant, caught by the boundary, ending in a restart — exactly what the skill's table
prescribes, and exactly what a returned `Result` would get wrong by carrying an unknown-state
process forward.

**Postcondition.** No failure is representable inside a success type, so `-1 > qty` cannot happen.
Each failure is either a discriminated variant the compiler forces a caller to handle, or a throw a
named boundary catches. One module does not use both channels for one class of failure (`SLOP-06`).

| Gain | Cost |
|---|---|
| The failure leaves the success type's domain, so it cannot be rendered or arithmetic'd by accident, and it carries a type and a reason instead of a magic number (`UNI-41`) | A typed failure propagates: every frame in the chain narrows or forwards, which is real syntax at each one |
| Under a union the check cannot be forgotten — the compiler requires the discrimination, and `assertNever` makes a new failure mode a compile error | Under `throw`, the compiler requires nothing: the failure leaves the type system entirely |
| One boundary handler decides status code, log level and body once, ending the three-styles-per-file pattern (`UNI-20`, `SLOP-06`) | A `throw` crossing an `await` lands in a different frame than a synchronous one, and a floating promise (`TS-05`) swallows it entirely |
| Widening the return type is fully compiler-enumerated | The narrowing direction is enumerated by **nothing** — dead `=== null`, `??` and `?.` compile forever. Sweep with `@typescript-eslint/no-unnecessary-condition` |

**When NOT to use this**

- **The sentinel is not in-band.** `T | undefined` under `strictNullChecks` is already a checked
  signal; it needs narrowing, not an exception.
- **The sentinel is the platform's own convention** and callers already handle it: `indexOf`
  returning `-1`, `Map.get` and `find` returning `undefined`. Wrapping the standard library to
  satisfy a rule adds a layer and removes nothing.
- **The failure is expected and every caller must handle it.** Make it a return value; a throw turns
  the normal path into control flow, which is 14 — and it converts a compile-time obligation into a
  runtime one.
- **There is no boundary handler.** Build that first, then do this.
- **You are converting a programmer error into a returned failure.** That pushes an unknown-state
  process forward. Let it throw.
- **The module already has one consistent channel** and this would give it two (`SLOP-06`). Convert
  the module, or leave it alone.
- **The failure is frequent and the path is benchmarked.** Stack-trace capture happens at `Error`
  construction, per iteration. Measure (`UNI-42`), but the allocation is real; `CSHARP-15`
  Exceptions for Control Flow is the shape to avoid.

---

## 14. Replace Exception with Test

**Resolves:** exceptions used for control flow — `CSHARP-15` is the registry's cross-language entry
for exactly this shape — and `SLOP-06` Inconsistent Error Handling. `JAVA-03`/`PY-02` (empty and
bare catches) are the degenerate case.

**Force.** A `try/catch` wrapped around a condition the caller could test cheaply and
deterministically. Three checkable costs, in increasing order of importance. The happy path runs
through the exception mechanism, whose expense is the stack-trace capture at `Error` construction,
not the unwind. The reader must simulate a non-local jump, and the code no longer says what the
predictable condition *was* — it must be inferred from what the `catch` returns. And the real one:
**the `catch` is wider than the condition it was written for.** Any error thrown anywhere inside the
`try` is caught, including a programmer error that should have terminated the process. A handler
written for "missing key" ends up swallowing "undefined is not a function", and the service
continues serving from a state nobody reasoned about.

**The catch is also invisible to the type system.** Under `useUnknownInCatchVariables` — on by
default under `strict` since TypeScript 4.4 — the caught value is `unknown`; verified, reading
`e.message` is `TS18046 'e' is of type 'unknown'`. Nothing tells you which throw you caught.

A **predictable condition** is one the caller can evaluate before the call, purely, with no race
between the test and the operation.

**Preconditions**

- The condition is testable **before** the operation, with no **TOCTOU** (time-of-check to
  time-of-use) window: nothing between the test and the use can change the answer. This holds for
  in-memory data in synchronous single-tick JavaScript. It does **not** hold across `await`, across
  processes, or for the filesystem and network — there, this technique introduces a defect.
- The check is cheap relative to the call.
- **The `try` block contains only the operation that raises the tested condition**, and the `catch`
  currently handles exactly **one** condition. If it spans more, the over-wide `try` is the finding
  — fix that first. You must be able to **state** the exact condition the `catch` absorbs; if you
  cannot, the `catch` is a blanket and you are not ready.
- The condition's absence has a well-defined answer: a default, a skip, or an early return.
- The failure is operational and expected. A programmer error must keep propagating.

**Mechanics**

1. Name the single condition the `catch` handles. If you cannot name exactly one, stop.
2. Confirm it is testable in advance, purely, with no TOCTOU window.
3. Write the test in front of the operation, **keeping the `try/catch` for now**, and preferring
   the operator that already encodes the condition:

| Condition | Operator, not `try/catch` |
|---|---|
| property of a possibly-absent object | `?.` |
| absent value with a fallback | `??` — note `\|\|` also fires on `0`, `""` and `false`, a different predicate |
| missing key | `map.has(k)`, `k in obj`, or `map.get(k) ?? fallback` |
| which union member | narrow on the discriminant; `switch` + `assertNever` (`TS-07`) |
| parseable URL | `URL.canParse(s)` — the platform absorbing exactly this technique |
| numeric conversion | `Number.isFinite(Number(s))`; there is no throw to catch |

4. Run the suite. The `catch` should now be unreachable for that condition — confirm by
   instrumenting it, or by running the test that used to exercise it.
5. Delete the `try/catch` only if step 4 shows nothing else reaches it. If something does, keep it
   and narrow it to that. **Do not leave it "just in case"** — a catch with no named condition is
   the empty-catch shape, and it will swallow the next unrelated bug.
6. If the transformation also **narrows** what is caught, say so in the commit message: previously
   swallowed failures will now escape. That is an improvement and it is behaviour-visible.
7. Enable `noUncheckedIndexedAccess` so indexed access yields `T | undefined` and the compiler
   **forces** the test instead of leaving it optional. Verified: it turns `lanes[k].toUpperCase()`
   into `TS2532 Object is possibly 'undefined'`.
8. Run tests, including one for the absent case. It is a normal branch now, so branch coverage
   reports it.

**Before**

```ts
function localeFor(to: Recipient, overrides: Map<string, string>): string {
  try {
    return overrides.get(to.id)!.toLowerCase();
  } catch {
    return to.locale;                    // also swallows every other TypeError in the block
  }
}
```

The `!` asserts a value the map may not hold (`TS-03`). When it does not, `.toLowerCase()` throws a
`TypeError`, and the `catch` reinterprets that as "no override" — as it would for any other
`TypeError` originating anywhere in the block, including a genuine bug. Rename a field the block
reads and this function returns the default forever instead of failing a test: a silent wrong
answer produced by the error handling itself.

**After**

```ts
const localeFor = (to: Recipient, overrides: Map<string, string>): string =>
  overrides.get(to.id)?.toLowerCase() ?? to.locale;
```

The condition — "no override for this recipient" — is now stated in the code, and any other
`TypeError` propagates to the boundary instead of being silently relabelled. The `!` went with it.
**`??` and not `||`, deliberately:** an override of `""` is kept by `??` and replaced by `||`. They
are different predicates, and choosing between them by habit is a defect.

**The narrowing form, where the condition is a possibly-absent value**

```ts
// before: try/catch used as the branch
let sender: Sender;
try {
  sender = requireSender(to.channel, cfg);        // throws when the channel is unconfigured
} catch {
  return queueForLater(report, to);
}
return sender.send(report, to);

// after: a total query plus a test
const sender = Sender.forChannel(to.channel, cfg);   // Sender | undefined
if (!sender) return queueForLater(report, to);
return sender.send(report, to);                      // narrowed to Sender here
```

Note what happened: the fix was not really at the call site. It was replacing a **throwing**
`requireSender` with a **total** `Sender.forChannel` that returns `Sender | undefined`. That total
query is this technique's real product, and it is the inverse move of technique 13 — which is why
the two are adjacent, and why a module should decide once, not per function.

**Where the test does not exist**, the exception is correct and stays:

```ts
// No predicate decides this. A schema parse fails only by parsing, and any hand-written
// "looks like a report" test is a second, worse parser that will eventually disagree.
function parseReport(raw: string): Report | undefined {
  try {
    return ReportSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
```

**Postcondition.** The predictable path contains no `throw` or `catch`; control flow is visible in
the source rather than in the runtime's unwinding, and the previously hidden branch is an ordinary
branch, visible in branch-coverage output and assertable in a test. Every surviving `catch` handles
a condition that cannot be tested in advance, so a programmer error is no longer absorbed by a
handler written for a missing key. Under `strictNullChecks`, the compiler enforces the test rather
than trusting it.

| Gain | Cost |
|---|---|
| The condition is named in the code and appears in coverage, instead of being implied by a `catch` | The caller performs a check it previously delegated. Duplicated across N callers, that check wants extraction — or a total query returning `T \| undefined` |
| The `catch` stops swallowing unrelated failures, programmer errors included, so a later mistake fails loudly | Removing it can surface latent failures immediately. Desirable, and it must be flagged in review as behaviour-visible |
| Stack-trace construction leaves the normal path, which is where the cost of exceptions actually lives | If the condition is genuinely rare, the check runs on every call to avoid a cost you were never paying (`UNI-42`) |
| The change is legible: the test is a value the type system narrows | **Deleting a `catch` is invisible to `tsc`** — this technique is the least enumerated in the group, and the test can drift from the operation it guards with nothing checking that they still agree |

**When NOT to use this**

- **The check and the use can race.** An existence probe then a read, a shared mutable map under
  concurrency, anything another process can change between the test and the use. Check-then-act is
  a TOCTOU defect; the `try` is the correct mechanism, because the state is not yours.
- **The condition is detectable only by attempting the operation** — `JSON.parse`,
  `decodeURIComponent`, a schema validator. Where the platform has added a test (`URL.canParse`,
  `Number.isFinite`), use it; where it has not, keep the `try` and wrap it once in a total function.
- **The test costs what the operation costs.** If deciding is as expensive as doing, catch.
- **The condition is rare and the test is expensive.** An existence probe on every call to avoid a
  daily exception is a cost inversion.
- **The `catch` handles more than one condition.** Splitting it changes behaviour and needs its own
  commit and its own tests — the whole point of step 5.
- **The exception carries information the boolean does not** — which field failed, which constraint.
  A typed failure with a payload (13) beats both a bare test and a bare throw.
- **The failure is a programmer error, or the `catch` is the boundary handler.** This technique
  removes exceptions used as *branches*, not error handling.

---

## Group failure modes

| Failure | Detection | Correction |
|---|---|---|
| **The silent default** | an Add Parameter commit whose diff touches only the declaration, with a non-trivial default; no call site named | revert; re-apply required (2, step 2), read the compile-error list, then default in a second commit if still warranted. If the default is not behaviour-identical everywhere, this was a behaviour change wearing a refactoring's commit message |
| **The one-step error-code swap** | a commit replacing `return -1` with `throw` in which no call site was edited | revert; widen the return type first (13, step 3) so `tsc` enumerates, then decide per site. Narrowing compiles everywhere and tells you nothing |
| **"Narrowed and done"** | 13 applied, the compile is clean, and a function between the source and its consumers still declares `\| null` in its own return type | narrowing enumerates *uses*, not *relays*. Walk the pass-through graph: each relay republishes a nullable type the source stopped producing, and forwards the new throw through a frame that reads as a handler (13) |
| **The public constructor left behind** | a factory exists and Find All References still shows `new X(` outside it | make the constructor `private` (12, step 5). Until that keyword lands, the factory guarantees nothing |
| **Half-finished split** | 6 applied, and the original flag function still has references | `tsc` never enforced the migration, because the old function still compiles. Drive Find All References to zero, or revert — two ways to do one thing is worse than one bad way |
| **Silently dropped effect** | 4 applied, and a write stopped happening at a call site that ignored the return value | count the command's call sites before and after. The compiler flagged only the value-consuming ones (4, step 6) |
| **Dropped argument expression** | 3 applied, and an audit record, metric or log stopped appearing | the deleted argument carried an effect. Read every argument expression before deleting it (3, step 5) |
| **Signature churn** | `git log -p` shows one signature edited in three commits this month, each touching every call site | decide the destination signature once. Batch 3, 8 and 7 (they shrink the list), then 9 once (it stabilises it). The blast radius is paid per commit, not per parameter |
| **Arity ratchet** | every signature in a module grew by one parameter over six months and never shrank | 8, 7, 9 in that order. Arity only falls when someone applies them deliberately |
| **Options bag** | a parameter object whose field count exceeds the arity it replaced; fields never set together; a name like `Config`/`Params` with no domain noun | the clump was not a concept. Split it by co-variation, or extract the real domain type (`organizing-data.md`) |
| **Duals oscillating** | 5 ⇄ 6, or 13 ⇄ 14, applied to the same code in successive quarters | apply the tie-breaker table above and record the reason **in the code**, not the PR: "these values differ in degree" or "these values select paths". `../../refactoring.md` names this class of dual as a hard stop |
| **Encapsulation theatre** | 11 or 12 applied with no pending edit — hidden members nobody called, factories that only forward to `new` (`UNI-10`) | the gates in `../../refactoring.md`. Reducing a blast radius of zero returns zero |
| **Two error channels** | one module both throws and returns a typed failure for the same class of failure (`SLOP-06`) | choose per boundary using the operational/programmer classification. Land 13 one module at a time |
| **Rename churn** | the same symbol renamed twice in a month, or a repo-wide diff whose new names are synonyms | state the postcondition in one sentence before renaming. If you cannot, the function is the problem — `composing-methods.md`. Rename to correct a false statement, never to satisfy a preference |
| **Rename buried in a feature PR** | a 400-file diff with one behaviour change inside it; the reviewer approves the rename and never sees the change | rename in its own commit. It is mechanical, and mechanical is only reviewable when it is alone |

## Relations

- **This group runs last in `../../refactoring.md`'s ladder for one measurable reason:** every
  technique here changes a signature, so its cost is proportional to the call-site count. Running
  `composing`, `moving` and `data` first reduces that count — an extracted, moved, correctly-typed
  function has fewer callers than the one it came from, so the same signature change is cheaper
  afterwards. Introducing a parameter object for a function that is about to move pays the N-edit
  cost twice.
- **Renaming is the ladder's stated exception, and technique 1 is why.** A tsserver rename is total
  and mechanical over the symbol graph, so it needs no pending edit to justify it and every later
  step inherits the corrected name.
- **`composing-methods.md` hands work here directly.** An Extract Method with arity ≥3 is a Data
  Clump made visible by its parameter list; 7 and 9 are what take it from there. Conversely,
  technique 4 here is a precondition for that file's Replace Temp with Query, which cannot
  substitute a call for a temp when the call also mutates. Its Inline Method is step 5 of this
  file's technique 5.
- **`organizing-data.md` owns what 9 cannot fix.** A parameter object makes same-typed fields
  legible; branded types make transposing them a compile error, and an invariant spanning two
  fields needs a parse boundary rather than a bare record. Primitive Obsession lives there.
- **`moving-features.md` picks up two hand-offs.** A member you were about to hide (11) that reads
  no instance state is a Move, not an access-modifier change; and a callee that reads most of the
  object you just passed it (7) is Feature Envy.
- **`simplifying-conditionals.md` overlaps 6 and 14.** Both 6 and Decompose Conditional remove a
  branch — this group removes it by splitting the function when the branch is the *caller's*
  policy, that one names the arms when the branch is the *callee's* logic. Choose by whose decision
  it is. Technique 14's output is a guard clause.
- **`dealing-with-generalization.md` consumes 1 and extends 5.** Alternative Classes with Different
  Interfaces is a rename away from substitutable; and where 5's siblings differ by behaviour rather
  than by a value, Form Template Method is the same move one altitude up.
- **12 stops at the refactoring.** The pattern — an overridable creator per subclass, and the flat
  registry that usually beats it in TypeScript — is `../../patterns/factory-method.md`. Check
  `../../selection.md`'s threshold before adopting either, and note that a factory with no decision
  inside it is `UNI-10`.
- **13 and 14 defer to the errors skill in the `bunjs` plugin**
  (`plugins/bunjs/skills/errors/SKILL.md`) for the throw-versus-typed-failure decision and the
  operational-versus-programmer classification it rests on. This file removes the in-band sentinel
  and states when the **signature** changes; that skill states what the failure **means**, and the
  second question decides the first.
- **`dev:code-roast`'s `sin-registry.md` detects; this file remediates.** `UNI-19` → 6 or 9 (this
  group's own smell, with two correct fixes: 9 when the flags are orthogonal configuration, 6 when
  they select a behaviour); `UNI-20` and `SLOP-06` → 13; `UNI-10` → the "when NOT" of 12; `UNI-28`
  → the clock-injection carve-out in 8; `TS-07` and `TS-10` → the exhaustiveness preconditions of
  6, 12 and 13.
- Technique names are Fowler's (*Refactoring*, 2nd ed.); all text and code here is original to this
  repository, and every TypeScript diagnostic code cited was confirmed by compiling a probe.
