# Moving Features between Objects

**The group's question: does each unit hold the data it uses, and is the boundary between two
units narrower than either unit?**

Eight techniques in four shapes. **Two are primitives** — Move Method and Move Field are the only
entries that relocate a single definition. **Two are named sequences of those primitives** —
Extract Class is Move Field repeated into a new type followed by Move Method, and Inline Class is
that sequence run backwards. **Two are exact inverses of each other** and will trade the code back
and forth forever unless you hold the criterion in this file. **Two operate on code you cannot
edit.**

## The force

`composing-methods.md` made units small. This group decides **where they live**, and the
quantity it moves is not lines — it is edges in the import graph.

Two terms, defined once and used throughout:

- **Import graph.** The directed graph whose nodes are modules and whose edges are `import`
  statements. Print it with `madge --json --extensions ts src`. Every technique here adds or
  removes edges; a "move" that leaves the edge set identical changed file layout, not coupling.
- **Blast radius.** The set of files one conceptual change can force you to edit. Measure it
  after the fact with `git log --name-only` co-change sets, and before the fact by counting
  which modules name the symbol you are about to change.

**Coupling** is the count of edges into and out of a module; **cohesion** is the degree to
which one module's functions read the same fields. The group's whole content is: raise cohesion
by moving a definition to the data it reads, and lower coupling by deleting the edge that move
makes unnecessary. Both numbers are machine-countable, which is why every precondition below is
stated as a condition you can check rather than a judgement you can rehearse.

Renaming and extraction leave both numbers unchanged. Moving is the only remedy that alters them,
and it pays for that with the widest diffs in the catalogue: `composing-methods.md` rearranges
statements inside one file, this group edits the import graph. **Review cost scales with edges
changed, not with lines changed** — which is why a two-line move across a package boundary can
take longer to land than a 200-line extraction inside one module.

| # | Technique | Transformation | Inverse |
|---|---|---|---|
| 1 | **Move Method** | a function → the module owning the data it reads | Move Method, back |
| 2 | **Move Field** | a property → the type whose functions read it | Move Field, back |
| 3 | **Extract Class** | one type with two disjoint field partitions → two types | Inline Class |
| 4 | **Inline Class** | a type with one owner and no enforced invariant → its owner's fields | Extract Class |
| 5 | **Hide Delegate** | a chain `a.b.c` at the call site → one function on `a` | Remove Middle Man |
| 6 | **Remove Middle Man** | forwarders that add nothing → the chain, back at the call site | Hide Delegate |
| 7 | **Introduce Foreign Method** | an operation missing from a type you cannot edit → a function in your module | delete it when upstream ships the member |
| 8 | **Introduce Local Extension** | ≥4 foreign methods, or foreign object + local state → a wrapper type converted at one boundary | back to 7 |

**The canonical group is complete — nothing is missing from this list.** Fowler's 1st edition
(1999) chapter *Moving Features Between Objects* contains exactly these eight, in this order.
The 2nd edition (2018) redistributed them: Move Method became **Move Function** and kept a
chapter of its own; Extract Class, Inline Class, Hide Delegate and Remove Middle Man moved into
the *Encapsulation* chapter; Introduce Foreign Method and Introduce Local Extension were dropped
from the catalogue entirely. They remain the correct answer to Incomplete Library Class, so they
are documented here — but that deletion is a signal, not an accident. See entries 7 and 8.

### The dual: Hide Delegate ⇄ Remove Middle Man

These two are inverses. Applying one produces exactly the smell the other resolves: Hide
Delegate removes a Message Chain and creates a forwarder; enough forwarders is a Middle Man;
Remove Middle Man deletes the forwarders and restores the chain. `../../refactoring.md` lists
Middle Man ⇄ Message Chains as a hard stop for this reason: with no stated criterion the code
oscillates, one refactor per direction, each locally justified and each citing this file.

**Judge by the module boundary. Never by chain length, and never by forwarder count.** Ask these
four questions of the forwarder, in order, and stop at the first `yes`.

| Ask, in order — stop at the first `yes` | Side | Why |
|---|---|---|
| **1. Does the forwarder cross a boundary a dependency rule already declares** — a layer, a package, a driven port, a published entry point? Read the `dependency-cruiser` or `eslint-plugin-boundaries` config, not your intuition. | **Hide Delegate.** Keep it; add the ones that are missing | the boundary is the product. A port's thinness is its design, not its defect |
| **2. Does it change the type, enforce a precondition, map an error, or supply a default?** | **Hide Delegate.** It is not a forwarder | it is a translation. Technique 6 does not apply to it at all |
| **3. Does a test substitute it, or is it the indirection that breaks an import cycle?** | **Hide Delegate.** It is a seam | deleting it deletes the isolation, or reintroduces the cycle |
| **4. Would deleting it create an import edge the caller does not already have?** Checkable: delete the caller's import of the intermediate type and run `tsc --noEmit`. If every resulting error sits on a chain line, the edge exists only for the chain. | **Hide Delegate** | the caller's blast radius loses a type it never needed to know — the only durable gain this technique offers |
| Otherwise | **Remove Middle Man** | the forwarder adds a member and hides nothing. Owner and delegate are vocabulary the caller already speaks, or they sit in the same module and the "boundary" is imaginary |

**Which criterion is authoritative, and when.** Questions 1 and 4 measure the same property at
different times, and both are sound:

- **Question 1 reads a rule that already exists.** It is decidable *before* you touch code, it is
  enforced in CI, and it survives the reviewer who disagrees. It is available only where somebody
  wrote the rule file.
- **Question 4 measures the actual import graph.** It is always available, needs no configuration,
  and is the operative question when no rule file exists — but it can only be *verified* after the
  change, so it falsifies rather than decides.

Use 1 where a rule exists; use 4 where none does, and then promote your answer into a rule so the
next reader meets question 1 instead. A criterion that lives only in someone's memory loses to the
next reviewer's taste, and the function moves back.

**The falsifiable test for question 4.** Run the transformation, then diff the edge set:

```bash
madge --json --extensions ts src > /tmp/before.json
# apply the technique
madge --json --extensions ts src > /tmp/after.json
diff <(jq -S . /tmp/before.json) <(jq -S . /tmp/after.json)
```

An empty diff means the refactoring changed no coupling. Revert it. When the diff is non-empty
and in the direction you intended, **write the decision into a rule** — a `dependency-cruiser`
`forbidden` entry pinning "no module under `ui/` may import `store/internal/*`" — so the next
person meets a failing check rather than an invitation to refactor it back.

**Forwarder ratio is a diagnostic, not the criterion.** Define it as *pure forwarders ÷ exported
operations over that delegate* on the owner's module. Above 0.5, run the four questions on each
forwarder **individually** — they do not share a fate, and technique 6 is never "delete them all".
A module that is 90% forwarders is correct when it is a port; a single forwarder is wrong when
both sides sit in the same layer. The ratio tells you when to look, never which side to pick.

## Order within the group

```
   composing-methods.md            ← prerequisite. A move is only a small diff if the
                                     unit is small. Extract Method, then move.
2  Move Field                     ─┐  the two primitives. Data first: the reference count
1  Move Method                    ─┘  that justifies 1 is computed over fields
3  Extract Class                   ← = name a target type, then repeat 2 and 1 into it
4  Inline Class                    ← = 3 run backwards, once the target proves to hold
                                     no invariant
5  Hide Delegate ⇄ 6 Remove Middle Man
                                   ← LAST, and only with the four questions above
7  Introduce Foreign Method        ← independent axis: types you do not own
8  Introduce Local Extension       ← only when 7 passed ~4 members or needs adjacent state
```

**The feedback signal is the reference count across the boundary.** For a function you intend
to move, tally property accesses in its body by receiver. If the foreign count is high and the
own count is 0-1, it moves cleanly. If the two counts are comparable, the function is
*coordination* — it exists to relate two types — and moving it just relocates the problem: the
imbalance reappears the same size in the other direction. Send it to the module that already owns
both, or leave it.

## Does TypeScript already do this

| Technique | Automated by | What remains yours |
|---|---|---|
| **Move Method** | tsserver *Move to file* (TS 5.4+) and *Move to a new file* (earlier): moves the declaration and rewrites imports on both sides | choosing the destination, counting references, and checking that the move introduces no cycle — `tsc` compiles cycles silently |
| **Move Field** | nothing. Deleting the property makes `tsc --noEmit` enumerate every read and most construction sites — the step Java needed "find all usages" for | the cardinality and lifetime analysis, the wire-boundary judgement, and the sites `tsc` cannot see |
| **Extract Class** | nothing — no editor performs "extract this field partition and the functions over it". The field↔function incidence is a `grep` or a call-graph query | computing the partition and naming its invariant, which *is* the decision |
| **Inline Class** | `knip` reports unused exports and single-consumer files; `tsc --noUnusedLocals` confirms the deletion | distinguishing a Lazy Class from a parsed type that enforces an invariant |
| **Hide Delegate** / **Remove Middle Man** | nothing detects a chain or a pure forwarder. `madge`, `dependency-cruiser` and `eslint-plugin-boundaries` *measure* the effect and **pin** the rule once you decide it; they do not pick a side | the boundary judgement — the four questions above |
| **Introduce Foreign Method** | **the language.** A module-level function whose first parameter is the foreign type is ordinary TypeScript. ESLint `no-extend-native` bans patching **built-in** prototypes — and only those | verifying the member is genuinely absent, and the discipline the linter does not cover: patching a *library* class prototype is unlinted |
| **Introduce Local Extension** | nothing | usually, deciding not to. See the entry |

**Paradigm honesty — the catalogue assumes mutable objects with methods.** Under `readonly`
records and modules the translation is mechanical and 1-6 survive it intact:

| Fowler's term | TypeScript |
|---|---|
| class | a type, plus the module of functions over it |
| method | an exported function whose first parameter is that type |
| field | a property |
| "move a method to another class" | move the function to another module, and drop or keep the parameter |

With that mapping the six structural techniques are unchanged, and they remain about the import
graph rather than about objects. **Resist the reflex to create a class to receive a moved
function.** The destination is a module; introducing a class to hold it is `UNI-10` with extra
steps.

**Two of the eight are artifacts of Java 1999.** Introduce Foreign Method exists because Java
had no free functions — every operation had to be a member of *some* class, so putting one on
your own class and passing the foreign object was a named workaround. In TypeScript that shape is
how you write an ordinary function, so the transformation itself is nothing and the whole
technique is the discipline around it: where the file goes, what marks it for deletion, and why
you never touch a prototype. Introduce Local Extension exists because Java had `final` classes,
nominal typing (a type is compatible only if it declares the relationship) and no extension
methods. TypeScript is **structurally typed** (a type is compatible if its shape matches, no
declaration needed), so a function taking the foreign type already applies to every value of that
shape, with no subtype relationship and no construction site to intercept — which is most of the
subclass form's motivation, gone. Both entries are kept because their *preconditions* still teach
something — mainly about boundaries and identity — not because you will reach for them often.

**Two further paradigm calls the Java framing hides:**

- **Move Field is type surgery, not a runtime relocation.** Over mutable objects, moving a field
  changes live storage, and the catalogue's two-phase move (add there, populate, redirect, delete
  here) exists to keep the program runnable throughout. Over `readonly` records the same move is
  an edit to a type declaration that `tsc` then propagates for you — so the intermediate state
  Java needs is the one state you must think hardest about here, because it is two storage
  locations holding one value. Entry 2 gives the condition that decides between one step and two.
- **Extract Class is not a primitive.** It is Move Field repeated into a new type, then Move
  Method repeated after it, plus one decision the primitives never make: the name and the
  invariant. Everything mechanical about entry 3 is entries 2 and 1; everything hard about it is
  the partition. Inline Class is that same sequence run backwards.

**`tsc` does not verify any of these transforms.** It will happily accept a Move Field that
aliased shared state, a Move Method that created an import cycle or reordered two side effects, a
hidden delegate whose function now evaluates eagerly where a property read was total, and an
Inline Class that deleted the only validation point in the program. Types are not a preservation
proof — the tests are, and only if they are mutation-sensitive (`UNI-22`, `UNI-23`). Assume a
green `bun test path/to/file.test.ts --watch` between every numbered step below.

## Example types

Every example uses these, in five modules. **The file each type lives in is part of the example:**
half of this group's postconditions are statements about which module imports which. Entries are
cumulative — where an entry adds a property or a helper type it says so, and later entries use the
post-move shape.

```ts
// ci/repository.ts
export type Repository = {
  readonly slug: string;                          // "acme/api"
  readonly defaultBranch: string;
  readonly visibility: "public" | "private";
};

// ci/pipeline.ts   imports repository.ts
export type Pipeline = {
  readonly id: string;
  readonly repository: Repository;
  readonly maxConcurrency: number;
};

// ci/job.ts        imports pipeline.ts
export type Job = {
  readonly id: string;
  readonly pipeline: Pipeline;
  readonly step: string;
  readonly priority: "normal" | "high";
  readonly status: "queued" | "running" | "passed" | "failed";
};

// ci/runner.ts     imports nothing
export type Runner = {
  readonly id: string;
  readonly cpuCount: number;
  readonly memoryMb: number;
  readonly labels: readonly string[];
  readonly warmupMs: number;
  readonly averageJobMs: number;
  readonly queueDepth: number;
  readonly deferredCount: number;
};

// ci/scheduler.ts  imports job.ts and runner.ts — it exists to relate them
```

---

## 1. Move Method

**Resolves:** Feature Envy, Shotgun Surgery, Inappropriate Intimacy, Divergent Change. The Feature
Envy signal and the Shotgun Surgery signal are one fact seen from two directions.

**Force.** A function reads another module's fields far more often than its own scope's. Every
one of those reads is a coupling point: rename a field on the foreign type and this file changes
too, for a reason that has nothing to do with what this file is about. The function is stored
where it is by history, not by data dependency.

**Preconditions**

- **Reference imbalance.** Count property accesses in the body by receiver. Move when
  `foreign ≥ 2 × own` and `own ≤ 1`. At `3:2` the function is coordination, not envy — see
  *When NOT*.
- **Every member the function reads is already on the origin's exported surface,** or becomes a
  parameter. If the move forces you to widen the origin's exports so the destination can reach
  something, that is a contract change, not a relocation.
- **No cycle after the move.** The destination must not already import the origin. Check with
  `madge --circular --extensions ts src`, which must be empty **after** the move. `tsc` will not
  tell you: TypeScript compiles import cycles. A `import type` cycle is erased at emit and is
  harmless; a value cycle can throw `ReferenceError: Cannot access 'X' before initialization`
  during module evaluation, and only at runtime, only on some entry orders (`TS-13`).
- **Not polymorphic.** Not a member of an interface with a second implementor, not overridden,
  not reached through `super`.
- **Not exported past the package surface**, or a `@deprecated` re-export for one release is
  acceptable. Moving a public export is an API change, not a refactoring.
- **The function's location is not itself an API.** File-based routing, framework-scanned
  decorators and glob-registered handlers pin behaviour to a path. Moving one of those changes
  what the program does while every test that constructs the function directly stays green.
- **`this` is not load-bearing.** If you are converting a class method to a module function, the
  body must use `this` only as the receiver you are turning into a parameter, and the method must
  not be passed as an unbound value (`items.map(obj.method)` breaks; grep for the method name
  without a following `(`).

**Mechanics**

1. Tally the receiver counts. **Write both numbers into the commit message** — they are the
   justification, and they are the thing you check again after step 6.
2. Check the import direction. If the destination already imports the origin, stop: the move
   creates a cycle. Extract the shared piece to a third module instead.
3. **Give the destination its parameter types locally.** Whatever origin-owned data the body still
   needs becomes a parameter whose type is declared **at the destination** — a primitive, or a
   minimal structural type spelled out in the destination module. Importing the origin's type to
   annotate that parameter is the shortest route and the one that recreates the cycle you just
   avoided; structural typing means the destination never needs the origin's name. An indexed
   access type is not an escape hatch: `Job["priority"]` still imports `Job`.
4. If the tally shows a small residue of own-type references, extract that residue first
   (`composing-methods.md`, technique 1) so the part you move references one type only.
5. Copy the function into the destination. Do not delete the original: change its body to call
   the new one. Run tests. Green here proves the copy is faithful, separately from the call-site
   edits. **You are now holding a deliberate, temporary Middle Man** — decide its fate with the
   four questions in *The dual* rather than deleting it reflexively. On a boundary it stays and
   the move is finished; off one, continue.
6. Redirect call sites, running tests between batches.
7. Delete the origin function once `tsc --noEmit` reports no references, then delete the imports
   the origin no longer needs. **That deletion is the measurable result.** Re-run `madge` and
   confirm the intended edge actually disappeared.

**Before**

```ts
// ci/job.ts — a domain type module reaching sideways into another domain type
import type { Runner } from "./runner";

export function estimatedStartDelayMs(job: Job, runner: Runner): number {
  const slots = Math.max(1, Math.floor(runner.cpuCount / 2));
  const perSlotMs = runner.warmupMs + runner.averageJobMs;
  const queued = runner.queueDepth + runner.deferredCount;
  const ahead = job.priority === "high" ? 0 : queued;
  return Math.ceil(ahead / slots) * perSlotMs;
}
```

`runner`: five member reads. `job`: one. The tally is 5:1.

**After**

```ts
// ci/runner.ts — the math now sits with the fields it reads
export const backlogOf = (r: Runner): number => r.queueDepth + r.deferredCount;

export const startDelayMs = (r: Runner, jobsAhead: number): number => {
  const slots = Math.max(1, Math.floor(r.cpuCount / 2));
  const perSlotMs = r.warmupMs + r.averageJobMs;
  return Math.ceil(jobsAhead / slots) * perSlotMs;
};
```

```ts
// ci/job.ts — no longer imports ./runner at all
export const skipsQueue = (job: Job): boolean => job.priority === "high";
```

```ts
// ci/scheduler.ts — already imported both; coordination belongs here
import { skipsQueue, type Job } from "./job";
import { backlogOf, startDelayMs, type Runner } from "./runner";

export const estimatedStartDelayMs = (job: Job, runner: Runner): number =>
  startDelayMs(runner, skipsQueue(job) ? 0 : backlogOf(runner));
```

`jobsAhead: number` is step 3 in its cheapest form — the destination states what it needs without
naming `Job`. Had the moved code needed three job-owned values instead of one, the answer would
be a three-property `readonly` type declared in `runner.ts`, not an import of `Job`.

The residual two-type function did not vanish and should not have: it relates a `Job` to a
`Runner`, which is the scheduler's entire purpose. What moved is the part with a 5:0 tally.

**Postcondition.** `job.ts` no longer imports `runner.ts` — one edge removed from the import
graph, verifiable with `madge`. `grep -c 'runner\.' ci/job.ts` returns 0. Renaming
`Runner.warmupMs` now touches `runner.ts` only; before, it touched `job.ts` as well.
`startDelayMs` is callable from a test with a `Runner` literal and a number, with no `Job` and
therefore no `Pipeline` and no `Repository` constructed.

| Gain | Cost |
|---|---|
| Removes cross-module member references, which are exactly the points a foreign rename propagates through | The move rewrites `git blame` for the range and conflicts hard with any in-flight branch touching either file |
| The destination's tests stop needing the origin's fixtures — measurable as the size of the object literal a test must build | If the destination is chosen by "where it feels like it goes" rather than by the tally, you have moved the coupling, not removed it |
| Often collapses a Shotgun Surgery co-change set: the `git log --name-only` pair stops appearing together | Moving an exported symbol is a breaking change for consumers and needs a deprecation window |
| Repeated moves make the destination's cohesion visible, which is the input technique 3 needs | Coverage attribution moves with the code: the destination's numbers rise and the origin's fall, and any report gating on a per-file threshold will flag a diff with no behaviour change |

**When NOT to use this**

- **The counts are comparable** (3:2, 4:3). The function coordinates two types. Move it to the
  module that owns both, or leave it. Coordination code referencing several modules is what a
  scheduler, controller or use-case module is *for* — that is not Feature Envy.
- **The move creates a cycle.** Extract the shared definition into a third module both import,
  or invert the dependency with an interface declared by the consumer (`TS-13`).
- **The destination is in another deployable unit.** Moving a function across a service boundary
  turns a call into a network call with a timeout, a retry policy and a partial-failure mode. That
  is a design change with `UNI-11` and `UNI-12` as its failure modes, not a refactoring.
- **The origin is a framework entry point** whose path is its registration.
- **The destination is a class you would have to invent** to receive the function. Put it in a
  module (`UNI-10`).
- **The function is envious of a type you do not own.** That is technique 7, not this one.
- **The function grows a parameter to keep two callers happy.** A `boolean` added during a move
  is `UNI-19` and a sign the two callers wanted two functions.
- **No pending edit needs it.** A pure-motion diff across N files, with `git blame` churn and no
  behaviour delta, is the structural form of `UNI-42`.

---

## 2. Move Field

**Resolves:** Shotgun Surgery, Inappropriate Intimacy, Divergent Change, Temporary Field.

**Force.** A property is declared on one type and read only by functions over another. Every
constructor of the first type has to supply a value it does not understand; the invariant relating
those values across instances is maintained by convention rather than by structure; and the type
that could state which values are legal is not the type that holds them.

**Preconditions**

- **Reads and writes from the destination's module exceed those from the origin's,** counted over
  the whole repository rather than over the file you happen to have open.
- **Every read and write is enumerable.** For a `readonly` record property, delete it and let
  `tsc --noEmit` list the sites. For a class field, make it `private` first so the compiler
  bounds the search. `grep` does not enumerate: computed access (`obj[key]`), spreads and
  serialization round-trips escape it.
- **A reference path already exists** from every reader to the destination. In the example
  below, every reader already holds a `Job` and `Job` already holds a `Pipeline`, so the move
  adds no import edge. If no path exists, the move converts a field read into a lookup — a
  different change with different failure modes.
- **Cardinality and lifetime are compatible.** State the relation between origin and destination at
  every read point, and check the corresponding row. *Lifetime* matters independently of
  cardinality: a value whose validity ends when the origin instance ends cannot live on a
  destination that outlives it.

| Direction | Storage effect | Behaviour-preserving iff |
|---|---|---|
| many → one (`Job` → `Pipeline`) | N copies collapse to one | the N values are equal at every read **and** nothing writes after construction. Otherwise the move introduces **aliasing** — two names for one storage location, so a write through one owner becomes observable through every other owner sharing the destination |
| one → many (`Pipeline` → `Job`) | one value duplicates to N | every construction site copies the current value **and** nothing writes after. Otherwise the copies drift and two reads of "the same" value disagree |
| 1:1 | unchanged | the reference path exists in the direction of the move, and the two types share a lifetime |

- **No serialization boundary crosses the property.** Concretely: check whether the type appears in
  a response body, an ORM model or migration, a `zod`/`valibot` schema, or the target of a
  `JSON.parse(...) as T`. If it does, moving the property changes the wire shape. That is a schema
  migration with its own rollout and compatibility window (`UNI-16` territory), in its own commit.
- **`readonly` is not the aliasing guard you may think it is.** It is erased at emit, and
  TypeScript lets a `{ a: number }` flow into a `{ readonly a: number }` position, so a mutable
  alias to the same object can legally coexist. `Object.freeze` is the runtime guarantee. If the
  cardinality argument above depends on immutability, the immutability must be enforced at
  runtime or proven by inspection of every construction site.

**Mechanics — one step or two, and the condition that decides**

The catalogue's move is two-phase: add the property to the destination, populate it everywhere,
redirect readers one at a time, then delete the origin's copy. That keeps the suite green at every
commit and pays for it with an interval in which one value has two storage locations. Because
`tsc` enumerates the reads here, the one-step move is available and is usually the correct one.

| Condition | Shape | Why |
|---|---|---|
| the property is written after construction | **one step, always** | the two-phase interval is two locations that can disagree, which is precisely the aliasing bug this technique is most often blamed for — and it is invisible in a single-instance test |
| write-once, and `tsc --noEmit` reports an error set one commit can review | **one step** | the compiler is the "find all usages" pass Java needed a tool for |
| write-once, and the error set spans more modules than one commit should | **two phase** | copies of a write-once value cannot drift, so the interval is safe; split it so each commit stays reviewable |

1. Count reads and writes per module. Establish cardinality and lifetime.
2. Apply the shape the table selects. In the two-phase shape, populate the destination at every
   construction site before redirecting any reader.
3. Work `tsc`'s error list to zero. It reports every read and every fresh object literal that
   supplied the property.
4. **Close the gap `tsc` leaves.** Excess-property checking fires on **fresh object literals**
   assigned to an annotated target; a value routed through a variable of a wider type, produced by
   a spread, or passed through a cast is silent. Grep for casts of this type and for
   `as unknown as` (`TS-09`) before believing the error list was complete.
5. Move the functions whose reads are now all local (technique 1).
6. Delete the now-dead parameters from the origin's constructors and the imports its module no
   longer needs. Migration of persisted data, if any, is a separate commit.

**Before**

```ts
// ci/job.ts — Job carries a retry budget that no job-level function reads
type Job = {
  readonly id: string;
  readonly pipeline: Pipeline;
  readonly step: string;
  readonly priority: "normal" | "high";
  readonly status: "queued" | "running" | "passed" | "failed";
  readonly retryBudget: number;
};

export const enqueue = (
  pipeline: Pipeline, id: string, step: string, retryBudget: number,
): Job => ({ id, pipeline, step, priority: "normal", status: "queued", retryBudget });
```

```ts
// ci/retry.ts — the only reader
export const mayRetry = (job: Job, attempt: number): boolean => attempt < job.retryBudget;
```

Two construction paths exist and they pass different literals, so two jobs of one pipeline can
disagree about a policy that is defined per pipeline. Nothing detects that.

**After**

```ts
// ci/pipeline.ts
export type Pipeline = {
  readonly id: string;
  readonly repository: Repository;
  readonly maxConcurrency: number;
  readonly retryBudget: number;
};
```

```ts
// ci/job.ts — one parameter fewer, and no policy value to get wrong
export const enqueue = (pipeline: Pipeline, id: string, step: string): Job =>
  ({ id, pipeline, step, priority: "normal", status: "queued" });
```

```ts
// ci/retry.ts — resolves through the reference path that already existed
export const mayRetry = (job: Job, attempt: number): boolean =>
  attempt < job.pipeline.retryBudget;
```

The direction is many → one, and it is legal here because `retryBudget` is written once at
pipeline construction and never after. Had jobs been allowed to decrement it, the move would
have aliased one counter across every job in the pipeline — a bug that passes in a single-job
test and fails under a full suite.

**Postcondition.** The state "two jobs of the same pipeline with different retry budgets" is no
longer representable — the invariant is enforced by the type rather than by every caller.
`enqueue`'s arity drops by one. No import edge is added: `retry.ts` already imported `Job`, and
`Job` already referenced `Pipeline`.

There is a second, sharper postcondition. Partition `Job`'s properties by which functions read
them: before the move, `retryBudget` formed a component of its own that no `Job` function
touched; after, the partition is connected. **That is the same computation technique 3 runs**,
which is why 2 is its primitive — a Move Field is one step of an Extract Class you have not
committed to yet.

| Gain | Cost |
|---|---|
| An illegal state stops being constructible, so a class of bug is removed rather than tested for | The reader now traverses `job.pipeline.retryBudget` — a chain, which is the entry point to the dual in 5 and 6 |
| Construction sites stop supplying values they do not own | A persisted record needs a migration, and rollback needs a plan for rows written in both shapes |
| The origin type becomes cohesive by a checkable definition: one component in the property↔function partition | Every construction site changes, and in a repository with shared fixtures that is a wide diff |
| Functions over the destination stop needing an origin instance to be built for tests | `tsc`'s enumeration is not total — casts and widened variables hide construction sites, and many → one moves are silently wrong under mutation |

**When NOT to use this**

- **The cardinality or lifetime check fails and the property is written after construction.** The
  move creates aliasing. This is the failure mode that a single-instance test cannot see.
- **The property is part of a persisted or transmitted shape** and you are not also doing the
  migration. Half of this change is worse than none. Reshape at the parse boundary instead: leave
  the payload type as the protocol dictates and map into the internal type once, where validation
  already happens.
- **The destination is reachable only by lookup** (`pipelines.get(job.pipelineId)`). Then the
  move trades a field read for a fallible lookup and introduces an `undefined` path.
- **One property would move and no function follows it.** A relocated property with no behaviour
  attached is churn; wait until a function moves with it.
- **The property is the discriminant of a union.** Moving it destroys the narrowing every consumer
  depends on (`TS-10`), and the repair is usually a cast (`TS-09`) — worse than the original
  placement.

---

## 3. Extract Class

**Resolves:** Large Class (`UNI-01`), Divergent Change, Data Clumps, Temporary Field, Shotgun
Surgery.

**Force.** One type's properties partition into groups by which functions read them, and no
function reads across the partition. The groups have different reasons to change and often
different sources — one is static configuration, the other live telemetry — so the file appears in
unrelated pull requests, `git log` shows two histories interleaved, and every reader must hold
both concepts at once. This is `UNI-01` at the data level.

**Preconditions**

- **Build the property↔function incidence and compute its connected components.** Nodes are
  properties and functions; an edge joins a function to each property it reads. Extract Class
  applies when there are **≥2 components, each with ≥2 properties**, and zero (or a small number
  of one-directional) cross-component reads. One component with a single property is technique 2,
  not this. This is the checkable form of low cohesion; do not proceed on an impression.
- **Exclude identity properties from the partition.** An `id` that everything reads joins every
  component and hides the split. Identity belongs to the aggregate, not to either half.
- **`git log --name-only -- <file>` shows ≥2 unrelated change reasons.** Absent that, the
  partition may be real and still not worth a diff (the pending-change gate in
  `../../refactoring.md`), and you are shaping the type to a guess.
- **You can state each candidate component's invariant in one sentence, without referring to the
  other.** "Three positive lengths in the same unit" qualifies; "the other properties" does not.
  If the only thing the properties share is that they were adjacent, you are creating a Data Clump
  holder, not a type — a parameter object (`simplifying-method-calls.md`, technique 9) is the
  cheaper answer.
- **No back-reference is required.** The new type must not need to point at the original. A
  bidirectional pair is `TS-13` waiting to happen and converts one type into two that cannot be
  understood apart.
- **The type does not cross a wire boundary,** or you accept a mapping layer at that boundary.

**Mechanics** — every step but 1 and 5 is technique 2 or technique 1 repeated:

1. Write the incidence and its components. **Name each component after its invariant, not after
   the properties it collects** — `RunnerCapacity`, not `RunnerDetails`. If a component has no
   name, stop.
2. Declare the new type and module. Move the properties one at a time with technique 2, tests
   green between each; keep a property on the original holding the new record — composition, one
   direction only.
3. Move the functions whose reads are now entirely inside the new type (technique 1), one at a
   time.
4. Fix reads at call sites; `tsc` enumerates them.
5. **Put the validation where the new type is constructed.** That is what makes it a type rather
   than a grouping, and it is the one step neither primitive performs.
6. Re-run the incidence. Cross-component reads must be zero, or the partition was wrong.
7. Decide the exposure. If callers now write `runner.queue.depth`, you have created a chain —
   run the four questions in *The dual* and choose a side deliberately, once, rather than
   drifting.

**Before**

```ts
// ci/runner.ts — eight properties, two unrelated lifecycles
export type Runner = {
  readonly id: string;
  readonly cpuCount: number;      // provisioning: changes when the fleet template changes
  readonly memoryMb: number;      // provisioning
  readonly labels: readonly string[]; // provisioning
  readonly warmupMs: number;      // telemetry: rewritten every scrape
  readonly averageJobMs: number;  // telemetry
  readonly queueDepth: number;    // telemetry
  readonly deferredCount: number; // telemetry
};

export const fits = (r: Runner, need: { cpu: number; memMb: number; label: string }): boolean =>
  r.cpuCount >= need.cpu && r.memoryMb >= need.memMb && r.labels.includes(need.label);

export const backlogOf = (r: Runner): number => r.queueDepth + r.deferredCount;

export const startDelayMs = (r: Runner, jobsAhead: number): number =>
  Math.ceil(jobsAhead / Math.max(1, Math.floor(r.cpuCount / 2)))
  * (r.warmupMs + r.averageJobMs);
```

With `id` excluded as identity, the components are `{cpuCount, memoryMb, labels}` read by `fits`
and `{warmupMs, averageJobMs, queueDepth, deferredCount}` read by `backlogOf`. Both have ≥2
properties. There is exactly one cross-component read: `startDelayMs` uses `cpuCount`
(provisioning) alongside the telemetry properties. That single cell is what step 6 exists to
catch — and had `id` been left in the partition, it would have joined the two components and the
split would have looked impossible.

**After**

```ts
// ci/runner-capacity.ts
export type RunnerCapacity = {
  readonly cpuCount: number;
  readonly memoryMb: number;
  readonly labels: readonly string[];
};

export const fits = (
  c: RunnerCapacity, need: { cpu: number; memMb: number; label: string },
): boolean => c.cpuCount >= need.cpu && c.memoryMb >= need.memMb && c.labels.includes(need.label);

export const parallelSlots = (c: RunnerCapacity): number =>
  Math.max(1, Math.floor(c.cpuCount / 2));
```

```ts
// ci/runner-queue.ts
export type RunnerQueue = {
  readonly warmupMs: number;
  readonly averageJobMs: number;
  readonly depth: number;
  readonly deferred: number;
};

export const backlogOf = (q: RunnerQueue): number => q.depth + q.deferred;

export const startDelayMs = (q: RunnerQueue, jobsAhead: number, slots: number): number =>
  Math.ceil(jobsAhead / slots) * (q.warmupMs + q.averageJobMs);
```

```ts
// ci/runner.ts
import { parallelSlots, type RunnerCapacity } from "./runner-capacity";
import { startDelayMs as queueDelayMs, type RunnerQueue } from "./runner-queue";

export type Runner = {
  readonly id: string;
  readonly capacity: RunnerCapacity;
  readonly queue: RunnerQueue;
};

export const startDelayMs = (r: Runner, jobsAhead: number): number =>
  queueDelayMs(r.queue, jobsAhead, parallelSlots(r.capacity));
```

The cross-component read was resolved by **passing the value in** rather than by letting
`runner-queue.ts` import `runner-capacity.ts`. That keeps the two extracted modules independent
of each other; the only module that knows both is `runner.ts`, which is where the composition
lives. Had the queue module imported the capacity module, the extraction would have produced two
types with one dependency edge instead of one type with none — a strictly worse graph. `id` stays
on the composed type, which is what "identity belongs to the aggregate" looks like in the result.

**Postcondition.** Zero cross-component reads in the incidence. A test for delay arithmetic
constructs a `RunnerQueue` (four properties) and a number, not a `Runner` (eight). The telemetry
writer's blast radius is `runner-queue.ts`; the provisioning parser's is `runner-capacity.ts`;
neither can force the other to change, and `git log` on each new file carries one change reason.

| Gain | Cost |
|---|---|
| Each concept changes for one reason, so the co-change set in `git log` splits — the Divergent Change signal is removed at its source | Three modules where there was one, and a chain (`r.queue.depth`) at every former property read |
| Each component gets a construction-time invariant it could not state while sharing a type | Every construction site and every serializer changes at once — the largest single diff in this group |
| Test fixtures shrink to the component under test, which is the practical measure of cohesion | A nested shape breaks JSON compatibility with any stored or transmitted copy of the old flat shape |
| The composed type becomes the natural place for coordination, and the concrete types this produces are what `dealing-with-generalization.md` needs as input | An extraction with no invariant is a renamed Data Clump: cost paid, nothing bought. Done before `composing-methods.md`, you are moving 200-line ranges whose boundaries are not yet visible |

**When NOT to use this**

- **The incidence has one component.** Every function reads across the whole type; it is cohesive
  and long, which is a different smell with a different remedy.
- **The incidence shows cross-component reads you cannot resolve by passing a value.** The
  partition is not real; you would be splitting a cohesive type and adding an edge.
- **The extracted group has no invariant** — it is three parameters that travel together. That is
  Introduce Parameter Object (`simplifying-method-calls.md`, technique 9), not a domain type.
- **The new type would need a reference back to the original.** Redesign until it does not, or
  do not extract.
- **The split leaves a property valid only "sometimes".** That is a discriminated union, not two
  types — the Temporary Field analogue in `../../refactoring.md`'s paradigm table.
- **The type is a DTO at a boundary.** Its shape is dictated by the protocol; map it inward once
  and split the internal type.
- **The type is a `readonly` record with no behaviour and one reader.** "Data Class" is usually
  the target state in TypeScript, not a smell — see the paradigm table in `../../refactoring.md`.
- **Fewer than three concrete cases exist** and the extraction is anticipatory. That is
  Speculative Generality being manufactured deliberately.

---

## 4. Inline Class

**Resolves:** Lazy Class, Speculative Generality, Middle Man at the type level.

**Force.** A type has one owner, no enforced invariant, and members that only forward. It costs
a file, a name, an import edge, a hop on every read and — if it is a class — an allocation per
use, and it returns none of the three things a type buys: a constrained value set, a place to
enforce a rule, or a boundary.

**Preconditions**

- **Exactly one module imports it** (or all importers belong to one owner). Check with `knip`,
  or delete the export and read what `tsc --noEmit` reports.
- **No enforced invariant.** Concretely: there is no code path on which construction fails, no
  private state, no member with a documented precondition — values of the type can be produced by
  a plain object literal or a bare `new`, without passing through any function that validates.
  **If a `parseX` or a brand exists, stop** — inlining deletes the program's only enforcement
  point, which is a behaviour change and not a refactoring. A **branded type** here means a
  nominal marker (`type JobId = string & { readonly __brand: "JobId" }`) whose values can only be
  produced by a parse function; the brand is erased at runtime and exists purely to make unparsed
  values fail to compile.
- **It is not a seam.** No test substitutes it, no adapter boundary is defined in terms of it,
  it is not named in a published barrel (`TS-01`), and it is not the indirection breaking a cycle.
- **It is not exported from the package's public surface.** Inlining an export is an API change
  with an API change's review.
- **Inlining adds no import.** If folding the properties into the owner forces the owner to import
  something it currently does not, the type was doing boundary work.

**Mechanics**

1. Confirm single ownership and absence of validation.
2. Move the properties into the owner; keep the old type as an alias for one green run if the diff
   is large.
3. Redirect reads; `tsc` enumerates the misses.
4. Delete the type and its module. Run `knip` and `tsc --noUnusedLocals` to confirm nothing else
   referenced it and nothing dangles.
5. Re-run `madge`: the edge should be gone. If it is not, something still imports the module and
   precondition 1 was wrong.
6. If the owner is now too large, apply technique 3 at a boundary that does have an invariant.

**Before**

```ts
// ci/queue-depth.ts — one field, two forwarding members, one call site
export class QueueDepth {
  constructor(private readonly n: number) {}
  value(): number { return this.n; }
  isBacklogged(): boolean { return this.n > 50; }
}
```

```ts
// ci/runner-queue.ts
import { QueueDepth } from "./queue-depth";

export type RunnerQueue = {
  readonly warmupMs: number;
  readonly averageJobMs: number;
  readonly depth: QueueDepth;
  readonly deferred: number;
};

export const backlogOf = (q: RunnerQueue): number => q.depth.value() + q.deferred;
```

The constructor accepts `-4` and `NaN`. The class enforces nothing, so it is a name wrapped
around a `number`.

**After**

```ts
// ci/runner-queue.ts — queue-depth.ts deleted
const BACKLOG_THRESHOLD = 50;

export type RunnerQueue = {
  readonly warmupMs: number;
  readonly averageJobMs: number;
  readonly depth: number;
  readonly deferred: number;
};

export const backlogOf = (q: RunnerQueue): number => q.depth + q.deferred;
export const isBacklogged = (q: RunnerQueue): boolean => q.depth > BACKLOG_THRESHOLD;
```

**A class whose fields are all `readonly` and whose methods are all pure is a namespace with an
allocation.** Inlining removes the allocation, the constructor call, the file and the forwarder in
one step — `value()` was a Middle Man the class was carrying. The threshold moved to a named
constant rather than an inline literal (`UNI-41`); the predicate survives as a function because it
names a rule the comparison does not.

**Contrast — the version that must not be inlined:**

```ts
// ci/job-id.ts — this one carries an invariant and is a boundary
export type JobId = string & { readonly __brand: "JobId" };

export const parseJobId = (raw: string): JobId => {
  if (!/^job_[0-9a-f]{16}$/.test(raw)) throw new TypeError(`not a job id: ${raw}`);
  return raw as JobId;
};
```

Structurally this is also "one field and one function". The difference is that `parseJobId` is
the single point where an unvalidated string can become a `JobId`, and the brand makes `tsc`
reject every other route. Inlining it to `string` deletes the check and silently widens every
signature that named it. **The precondition, not the shape, decides.**

**Postcondition.** One module, one type and one import edge removed. Every former `.value()` hop
is a direct property read. `knip` reports no orphaned export.

| Gain | Cost |
|---|---|
| Removes a name that had to be maintained, tested and documented while enforcing nothing | If the type was one refactor away from carrying an invariant, you have removed the place to put it |
| One less hop per read, one less file per concept, and one less allocation per use | Inlining a type other packages import is a breaking change, and deleting a file rewrites `git blame` for code that did not change |
| Reveals whether the owner is now too large — which is the honest signal Extract Class needed | Done to a parsed or branded type, it deletes a runtime check that no test may cover |
| If a second implementation ever appears you re-extract, and then with two concrete cases rather than a guess | A type that existed only for compile-time distinctness loses that distinctness silently |

**When NOT to use this**

- **A parse function or brand exists.** That is the invariant; inlining removes it.
- **The type existed to make two same-shaped values non-interchangeable.** TypeScript is
  structural, so deleting the wrapper makes a runner id assignable wherever a job id belongs, with
  no error anywhere. The answer is a branded type plus one parse at the boundary, which costs
  nothing at runtime — `organizing-data.md` owns that.
- **It is a test seam or an adapter boundary.** Deleting it puts a concrete implementation type
  into a caller's import graph — the `UNI-05` direction, and the exact case
  `../../refactoring.md`'s paradigm table protects.
- **More than one module owns it.** Inlining then copies the same declaration into each of them,
  which is duplication performed by hand; it is shared vocabulary, not a Lazy Class.
- **It exists to break a cycle.** Some small types are there so two modules can both import a
  third. `madge --circular` after inlining will tell you; check before deleting, not after.

---

## 5. Hide Delegate

**Resolves:** Message Chains, Inappropriate Intimacy.

**Force.** A caller writes `a.b.c`. Its blast radius now includes `b` — rename or restructure the
intermediate type and this caller changes, even though it only ever wanted `c`. The caller
imports a type it has no business knowing and has never had an opinion about.

**Run the four questions in *The dual* before writing the forwarder, not after.** Applied without
them, this technique manufactures the Middle Man that technique 6 exists to remove. Question 1 (is
there a declared boundary here?) or question 4 (would the caller otherwise gain an edge?) must
return `yes`, or you are on the wrong side of the dual.

**Preconditions**

- **Depth ≥3 counted in types, not property accesses.** Count the distinct types the caller must
  import or know the shape of in order to complete the expression.
  `job.pipeline.repository.defaultBranch` is three property accesses and three types — `Job`,
  `Pipeline`, `Repository`. The type count is what the caller pays; the access count is cosmetic.
- **≥2 call sites** outside the owner's module. A single site fails the second-occurrence gate in
  `../../refactoring.md`.
- **The caller imports the intermediate types for no other reason** — question 4, in its checkable
  form: delete the import and run `tsc --noEmit`. If every reported error is on a chain line, the
  condition holds. If other lines fail, hiding removes no edge and you should stop; that is a
  Remove Middle Man situation.
- **The owner's module already imports the delegate's module**, so the new function creates no
  edge of its own. If it does not, you are moving the edge rather than deleting it.
- **Hiding must not change evaluation.** A chain of property reads is total and cheap; a function
  that computes, fetches or throws is not the same thing wearing a shorter name. If the forwarder
  would do work the chain did not, it is technique 1's problem, not this one's.
- **The forwarder adds a name, a narrowing, or a default that the path does not state.** A
  forwarder named for its path (`getPipelineRepositoryDefaultBranch`) restates the traversal the
  way a narrative comment restates the statement below it — `SLOP-04` in structural form. It is
  the Middle Man you will delete in 6.
- **The owner currently has ≤2 pure forwarders over that delegate.** Above that, adding one
  crosses into Middle Man; apply 6 or Extract Class first.

**Mechanics**

1. Count type hops per call site and list the intermediate types the caller imports. Run the
   import-deletion check.
2. Add one function to the owner's module, named for the **question**, not the path.
3. Redirect call sites; `tsc --noEmit` between batches.
4. Delete the intermediate type's import from the caller. **If the import will not go, the hide
   bought nothing — revert.** This is the step that makes the technique falsifiable. Verify
   against the caller's import list, not by reading the diff.
5. Diff the import graph. Confirm the edge caller→intermediate is gone.
6. Compute the owner's forwarder ratio. Above 0.5 you have produced Middle Man; run the four
   questions again before adding another.
7. Record the boundary as a `dependency-cruiser` rule so the edge cannot come back by accident.

**Before**

```ts
// ci/notify.ts
import type { Job } from "./job";
import type { Repository } from "./repository";   // imported only to type the chain results

export const branchLabel = (job: Job): string => job.pipeline.repository.defaultBranch;
export const isOpenSource = (job: Job): boolean =>
  job.pipeline.repository.visibility === "public";

export const badge = (job: Job): string =>
  `${job.pipeline.repository.slug}@${job.pipeline.repository.defaultBranch}`;
```

Three types deep, three sites, and `notify.ts` names `Repository` for no other reason.

**After**

```ts
// ci/job.ts
export const defaultBranchOf = (job: Job): string => job.pipeline.repository.defaultBranch;
export const isOpenSource = (job: Job): boolean =>
  job.pipeline.repository.visibility === "public";
export const repoSlugOf = (job: Job): string => job.pipeline.repository.slug;
```

```ts
// ci/notify.ts — the ./repository import is gone
import { defaultBranchOf, isOpenSource, repoSlugOf, type Job } from "./job";

export const branchLabel = defaultBranchOf;
export { isOpenSource };
export const badge = (job: Job): string => `${repoSlugOf(job)}@${defaultBranchOf(job)}`;
```

`isOpenSource` earns its place: it names a rule (`visibility === "public"`) that the path does
not state. `defaultBranchOf` and `repoSlugOf` are pure forwarders and are on probation — they are
justified here only by the removed edge, and if that edge ever returns for another reason, 6
applies to them.

**A barrel file is not this technique.** Re-exporting `Repository` from an `index.ts` that
`notify.ts` imports leaves the caller depending on the same shape, adds a module the bundler must
resolve, and is a cycle risk (`TS-01`). Hiding a delegate means the caller **can no longer name**
the intermediate type — a re-export means it can, more conveniently.

**Postcondition.** `notify.ts` no longer imports `repository.ts`; the edge is absent from
`madge --json`, and the caller's out-degree drops by one. Renaming `Repository.defaultBranch`
touches `job.ts` alone, where before it touched every consumer that traversed the chain.

| Gain | Cost |
|---|---|
| The caller's blast radius loses the intermediate type — the only durable gain, and it is measurable as a removed edge | Every forwarder is a member the owner must keep, name and test. Three of them and you are one refactor from Middle Man, and the ratio grows silently |
| The forwarder is a place to put a default, a narrowing, or a `null` policy that would otherwise be repeated at each chain site | Applied without the import-deletion check, it adds members and removes nothing |
| The owner's module becomes a stated surface rather than an accidental one, and the boundary can be pinned by a lint rule so it stops eroding | The owner's module grows knowledge of the delegate's shape, concentrating it rather than removing it |

**When NOT to use this**

- **The import-deletion check fails.** The caller needs the intermediate anyway. Hiding is pure
  cost — this is the Remove Middle Man side.
- **Owner and delegate live in the same module.** There is no boundary to hide across and no edge
  to remove; a chain inside one module is cheaper than a member.
- **The chain is depth 2** (`job.pipeline`). Two types is one relationship, and relationships are
  the point of a record.
- **You would name the forwarder after the path.** Then it carries no information the chain did
  not.
- **The intermediate type is stable published vocabulary** the caller legitimately speaks — a
  platform type is the clearest case, since `URL` is not going to rename `searchParams`. Hiding
  vocabulary makes the code harder to read, not easier.
- **The caller is a mapper, serializer or fixture builder** whose job is to know the full shape.
  Hiding structure from the code responsible for structure inverts the design.
- **Forwarders already exceed half the owner's exported operations.** Adding another is
  technique 6's input, not this technique's output.

---

## 6. Remove Middle Man

**Resolves:** Middle Man, Lazy Class, Speculative Generality, `UNI-04` Fat Interface when the
width is all forwarding.

**Force.** More than half a module's exported operations over a type do nothing but pass the call
through. Each is a member to name, document and test; none adds a precondition, a postcondition,
a default or a narrowing; and every change to the delegate's surface propagates through them
anyway, so they do not even isolate. You are paying twice for one capability.

**This is the inverse of 5. Do not apply it without the four questions in *The dual*, or you are
one refactor into an oscillation.** The condition for deleting a forwarder is that **all four
questions return `no`** for that forwarder specifically.

**Preconditions**

- **Count pure forwarders.** A forwarder is *pure* when its body is exactly a forward — a single
  member access, or a single call passing the same arguments — adding no default, no narrowing,
  no validation, no error mapping, no type change and no name absent from the path. Apply when
  pure forwarders are ≥3 **and** the forwarder ratio exceeds 0.5.
- **Deleting them adds no edge across a declared boundary.** Read the `dependency-cruiser` or
  `eslint-plugin-boundaries` rule file — this is question 1. A forwarder from a domain module to a
  vendor SDK is a port (`../../styles/hexagonal.md`), and deleting it puts the SDK in the domain's
  import graph. Absent an explicit rule, fall back to question 4: "does a leaf module gain an
  import from a package it does not already depend on".
- **Callers already speak the delegate's vocabulary.** At ≥ half the affected sites the caller
  already imports the delegate type for other work — so the removal genuinely deletes members
  rather than relocating knowledge.
- **No test substitutes a forwarder as a seam,** no interface declares it, and none of them is the
  indirection breaking a cycle.

**Mechanics**

1. Classify every member over the delegate: pure forwarder, or adds something. Compute
   forwarders ÷ exported operations and record it. Keep the second group — this technique is never
   "delete them all".
2. **Run the four questions on each forwarder independently. They do not share a fate**, and a set
   of five will usually split.
3. Ensure the delegate is reachable from callers (an accessor or a public property).
4. Redirect call sites of one forwarder at a time, tests between; inline each at its call sites
   with `composing-methods.md` technique 2.
5. Delete each forwarder when `tsc --noEmit` reports zero references.
6. Re-run the dependency rule check and diff the import graph. New edges must be intra-layer only;
   a new violation means that forwarder was a boundary — restore it, and **record why**, so the
   next reviewer does not repeat the move.
7. If the module is now empty, that is Inline Class (4), not a separate decision.

**Before**

```ts
// ci/job.ts — four releases later, everything about Repository forwards through Job
export const defaultBranchOf = (job: Job): string => job.pipeline.repository.defaultBranch;
export const repoSlugOf = (job: Job): string => job.pipeline.repository.slug;
export const visibilityOf = (job: Job): Repository["visibility"] =>
  job.pipeline.repository.visibility;
export const repoUrlOf = (job: Job): string => `https://git.example.com/${job.pipeline.repository.slug}`;
export const isOpenSource = (job: Job): boolean =>
  job.pipeline.repository.visibility === "public";
```

```ts
// ci/notify.ts — already imports Repository for its own formatting
import type { Repository } from "./repository";
import { defaultBranchOf, repoSlugOf, type Job } from "./job";

export const repoBadge = (repo: Repository): string => `[${repo.slug}]`;
export const badge = (job: Job): string => `${repoSlugOf(job)}@${defaultBranchOf(job)}`;
```

Question 4 no longer returns `yes`: `notify.ts` imports `Repository` for `repoBadge`, so the
forwarders remove no edge. Questions 1, 2 and 3 return `no` for three of the five members —
`job.ts` is not a declared boundary, they add nothing to the path, and nothing substitutes them.

**After**

```ts
// ci/job.ts — one member survives, because it is the only one that adds a name
export const isOpenSource = (job: Job): boolean =>
  job.pipeline.repository.visibility === "public";
```

```ts
// ci/notify.ts
import type { Repository } from "./repository";
import type { Job } from "./job";

export const repoBadge = (repo: Repository): string => `[${repo.slug}]`;
export const badge = (job: Job): string => {
  const repo = job.pipeline.repository;
  return `${repo.slug}@${repo.defaultBranch}`;
};
```

Two things to read off the diff. `repoUrlOf` was *not* a pure forwarder — it composes a URL — and
belongs in `repository.ts` by technique 1, not in `job.ts` and not at the call site; classify
before deleting. And `badge` now binds the whole `Repository` once instead of taking two pieces of
one through two forwarders: that is **Preserve Whole Object**
(`simplifying-method-calls.md`, technique 8), and it is why a fourth `Repository` property would
otherwise have demanded a fourth forwarder. Property-by-property forwarding is usually that smell
seen from the callee's side.

**Postcondition.** `job.ts` exports one member over `Repository` instead of five; its forwarder
ratio over that delegate drops from 0.8 to 0. The import graph gains no edge, because every
affected caller already imported `repository.ts`, and the dependency rule check still passes.
Adding a `Repository` property no longer requires an edit in `job.ts`.

| Gain | Cost |
|---|---|
| Four members stop existing: no names to maintain, no tests, no drift between forwarder and delegate | Callers now name the delegate type, so a change to it reaches them directly |
| Adding a delegate property stops requiring an edit in the owner — the Shotgun Surgery this created is removed | Applied across a real boundary, it puts an implementation type into a caller's import graph (`UNI-05`) |
| Deleting property-by-property forwarders exposes the callers that wanted the whole object | A real import edge appears where an indirection stood; acceptable only if the rule file says so |
| The surviving members all have bodies, so "what does this module do" has an answer | Without a recorded criterion, the next reader sees Message Chains and applies 5 again |

**When NOT to use this**

- **The owner is a published boundary** — a port, an adapter, a package entry point. Then the
  forwarders *are* the product and their thinness is the design.
- **The removal adds an edge that crosses a layer.** That forwarder is load-bearing; keep it and
  say so in a `dependency-cruiser` rule.
- **The delegate is a vendor SDK.** Direct imports of it scattered across modules make the next
  upgrade a repository-wide diff — that is exactly what the hop was buying, and technique 8 is the
  more thorough version of the same purchase.
- **It maps errors, applies a default or changes the type.** Then it is not forwarding, whatever
  it looks like.
- **A test substitutes the forwarder.** Deleting it deletes the seam and the test's ability to
  isolate.
- **Fewer than three pure forwarders.** One or two are not a Middle Man; they are a small
  interface.
- **The ratio is high but each forwarder passes question 1.** A facade is supposed to look like
  this — `../../patterns/facade.md`, with `../../selection.md`'s threshold applied first.
- **You have no recorded criterion.** Without one, this change and technique 5 will alternate
  across releases and each will look justified in isolation.

---

## 7. Introduce Foreign Method

**Resolves:** Incomplete Library Class, in its small form.

**Force.** You need an operation on a type you cannot edit — a dependency, a generated client, a
platform type. The operation gets re-derived inline at each call site, so the rule it encodes has
no name, no single place to fix, and the copies drift out of agreement with each other.

**This technique is nearly vacuous in TypeScript, and knowing that is the point.** In Java it was
a named workaround for a language with no free functions. Here, "a function whose first parameter
is the foreign type, in a module you own" is just how you write a function. What survives is the
part that is still a real decision: **where to put it, how to verify the member is really absent,
what marks it for deletion, and what never to do instead.**

**Preconditions**

- **The type is genuinely not editable**: it comes from `node_modules`, from a codegen step that
  would overwrite the edit, or from the runtime.
- **The member is genuinely absent from the installed version.** Verify by reading the shipped
  `.d.ts` — `bun pm ls <pkg>` for the resolved version, then
  `rg "<memberName>" node_modules/<pkg>/**/*.d.ts`. Do not verify from memory: assuming an API
  exists is `SLOP-01`/`SLOP-05`, and this is precisely the situation that produces both.
- **The operation needs only the public surface.** If it needs internals, the honest options are
  an upstream change or a fork, not a foreign method reaching through `as unknown as`
  (`TS-09`).
- **It is a pure function of the value** and carries no state of its own. State is technique 8's
  precondition, not this one's.
- **≥2 call sites**, or the operation encodes a rule worth naming once.
- **You are not one `npm install` from the same thing.** Adding a dependency to obtain a
  three-line function is `UNI-35`; writing the three lines is the correct trade at this size, and
  the inverse trade at 300 lines.

**Mechanics**

1. Verify absence against the resolved version and record it.
2. Put the function in a module named for the **foreign type**, not for the consumer —
   `lib/runner-lease.ts`, not `features/dashboard/helpers.ts`. Consumer-local helpers is how the
   same foreign method ends up written four times.
3. Take the foreign type as the first parameter. Never augment the prototype and never use
   `declare module` interface merging to add a member (see below).
4. Annotate with the package and version you checked, and the upstream issue if you filed one.
   **That annotation is the deletion trigger, and it is the one comment in this group that is not
   `SLOP-04`** — it states something the code cannot.
5. Delete it when upstream ships the member; the version bump is the trigger, the annotation is
   what makes that possible, and `tsc` enumerates the call sites.

**Before**

```ts
// features/lease-banner.ts and features/lease-table.ts both contain this expression
import type { RunnerLease } from "@vendor/runner-sdk";
//   type RunnerLease = { readonly id: string; readonly expiresAtMs: number }
//   the SDK exposes no expiry predicate — verified against @vendor/runner-sdk@2.4.1

const soon = lease.expiresAtMs - Date.now() < 5 * 60_000;
```

**After**

```ts
// lib/runner-lease.ts
import type { RunnerLease } from "@vendor/runner-sdk";

/** Foreign method: @vendor/runner-sdk@2.4.1 exposes no expiry predicate (upstream #412). */
export const expiresWithinMs = (lease: RunnerLease, windowMs: number, nowMs: number): boolean =>
  lease.expiresAtMs - nowMs < windowMs;

export const RENEWAL_WINDOW_MS = 5 * 60_000;
```

```ts
// features/lease-banner.ts
import { expiresWithinMs, RENEWAL_WINDOW_MS } from "../lib/runner-lease";

export const needsRenewal = (lease: RunnerLease, nowMs: number): boolean =>
  expiresWithinMs(lease, RENEWAL_WINDOW_MS, nowMs);
```

`nowMs` is a parameter, not a `Date.now()` call inside the function: the foreign method stays
pure and therefore testable without freezing the clock (`UNI-28`).

**Never do this instead:**

```ts
// DO NOT — module augmentation plus a prototype patch
declare module "@vendor/runner-sdk" {
  interface RunnerLease { expiresWithin(ms: number): boolean; }
}
(RunnerLease.prototype as any).expiresWithin = function (ms: number) { /* ... */ };
```

Three distinct failures, all mechanical. **The type-level augmentation is global**: it applies to
every consumer of that module in the whole compilation, including other packages in the workspace
and code written by people who never saw your file, and it cannot be scoped. **The runtime patch
is a process-global mutation**, so its effect depends on module load order and collides with any
other package doing the same thing. **And the patch is invisible to the import graph**: a module
that calls the added member compiles without importing the patching module, then throws at
runtime in whichever entry point happened to load things in a different order. The type system
will actively assure you the call is safe. ESLint's `no-extend-native` catches this shape for
built-in prototypes and **nothing catches it for library classes** — that discipline is yours.

**Postcondition.** The rule has one definition and one name; call sites reference it rather than
re-deriving it, and the drift between the copies is resolved instead of preserved. The function is
testable with an object literal — no SDK client, no network. A `grep` for the version annotation
enumerates every foreign method you owe upstream.

| Gain | Cost |
|---|---|
| The operation is named once, testable in isolation, and deletable in one edit when upstream ships it — `tsc` finds every caller | A helper module per foreign type; without the naming convention these disperse into consumer folders and duplicate |
| Nothing global changes, so module load order and other packages are unaffected | An operation that looks like it belongs to the library but is not covered by the library's tests, and may diverge from a member upstream later adds under the same name |
| No dependency added for a small operation (`UNI-35`), and no prototype mutated | The helper must be imported at each site, unlike a real member — that friction is the honest signal that it is not one |
| Keeps the foreign type's public surface as the only contract you rely on | Past roughly four such functions the module is really an unnamed type — go to 8 |

**When NOT to use this**

- **The member exists.** Read the `.d.ts` of the resolved version, not the version you remember.
  This is the single most common failure here.
- **You can edit the type.** Then edit it; a foreign method beside an editable type is a detour.
- **It needs internals.** Then it is an upstream change or a fork; a foreign method reaching past
  the public surface breaks on a patch release.
- **One call site and no rule worth naming.** Inline it.
- **You are about to augment the prototype or merge an interface.** Neither is this technique;
  both are the failure described above.
- **You have accumulated ≥4 of them over one type,** or need to carry state alongside the foreign
  object. That is 8 — read its preconditions before assuming it applies.

---

## 8. Introduce Local Extension

**Resolves:** Incomplete Library Class, once foreign methods have accumulated past the point
where they read as a coherent type, or once one of them needs state.

**Force.** Several foreign methods over one type, and possibly state you need to carry beside
each foreign instance (when you acquired it, how many times you have renewed it). Threading a
parallel `Map<ForeignX, LocalState>` through the call graph is worse than giving the pair a name.

**Paradigm honesty — this is the most Java-shaped technique in the group, and in TypeScript the
default answer is "do not".** Fowler gives two forms:

| Form | Status in TypeScript |
|---|---|
| **Subclass** | Usually inapplicable. Most library types are `interface`s or plain records with nothing to extend, and where a class does exist, **the library's own factory returns the base type** — so instances you receive are never your subclass. Values arriving from a factory, from deserialization or from the runtime make `instanceof` narrowing fail at runtime while the types look entirely correct. Checkable precondition: *you control every construction site.* If instances arrive from the library, this form is out, full stop. Structural typing also removes most of the motivation: a richer object is already assignable where the base type is expected, with no declared relationship |
| **Wrapper** | Works, and breaks reference identity. `wrapper !== original`, so anything keyed on the instance — a library-internal `Map` or `WeakMap`, a `===` check, an `instanceof` test in library code — stops matching. This is the real cost and it fails silently |

**The wrapper's second decision is aliasing versus snapshotting, and you must make it explicitly.**
Holding the original **aliases** it: if the library mutates the object, a write through either
handle is observable through the other. Copying its properties **snapshots** it: the copy and the
original diverge, and nothing at the type level shows it. Hold, and write down that you did —
`readonly` on the holding property documents your side of the contract but does not constrain the
library's.

The modern answer is usually neither form: **stop at technique 7** unless one of the two
conditions below holds. Fowler's 2nd edition dropping this technique from the catalogue is
consistent with that.

**Preconditions**

- **Either** ≥4 foreign methods over the same type, **or** you must carry state alongside each
  foreign instance across more than one function. Below both thresholds, 7 is the answer.
- **You can enumerate every entry point** where a foreign instance arrives in your code, and
  convert at all of them. Checkable: after the change, exactly one module imports `ForeignX`. If
  two shapes circulate, every downstream function needs to handle both and the wrapper has made
  things worse.
- **Nothing downstream depends on the foreign object's reference identity.** Enumerate before you
  start: search the library for `WeakMap`, `Map<`, `instanceof` and `===` over its own types, and
  search your code for the foreign object used as a `Map`/`Set`/`WeakMap` key.
- **The library does not serialize the object after you wrap it** — a wrapper handed back where
  the raw type is expected is a type error at best and a silently wrong payload at worst.
- **Subclass form only:** you construct every instance yourself, and the base is a class you can
  extend (not `interface`, not a frozen literal type).

**Mechanics (wrapper form — the one that applies)**

1. **Try the module form first.** A single `lib/<foreign-type>.ts` holding technique 7's functions
   solves most cases at zero identity cost, and it is the answer whenever the trigger was method
   count rather than state.
2. Enumerate the entry points. If there is more than one module, wrap at the adapter, not at each
   use site.
3. Declare a type that **holds** the original under one named property rather than copying its
   fields. Never spread the foreign value into the wrapper: a spread makes a snapshot, and it also
   drops the prototype and any accessors, so methods and getters vanish while the type still
   claims they are there.
4. Move each existing foreign method (7) to take the wrapper.
5. Convert at the boundary. Nothing past the boundary sees `ForeignX`, and no library call ever
   receives a wrapper.
6. Fix every identity comparison you enumerated, tests between each.
7. Confirm the postcondition: `rg "from \"@vendor/runner-sdk\"" src` returns exactly the boundary
   module.

**Before**

```ts
// lib/runner-lease.ts — five foreign methods, and the renewal count lives in a side Map
import type { RunnerLease } from "@vendor/runner-sdk";

export const expiresWithinMs = (l: RunnerLease, w: number, now: number) =>
  l.expiresAtMs - now < w;
export const remainingMs = (l: RunnerLease, now: number) => Math.max(0, l.expiresAtMs - now);
export const isExpired = (l: RunnerLease, now: number) => l.expiresAtMs <= now;
export const shortId = (l: RunnerLease) => l.id.slice(0, 8);
export const describe = (l: RunnerLease, now: number) =>
  `${shortId(l)} (${Math.round(remainingMs(l, now) / 1000)}s left)`;

// and, in three other modules:
const renewals = new WeakMap<RunnerLease, number>();
```

**After**

```ts
// lib/managed-lease.ts — the single boundary module
import type { RunnerLease } from "@vendor/runner-sdk";

export type ManagedLease = {
  readonly raw: RunnerLease;      // held, not copied: the SDK may mutate it
  readonly acquiredAtMs: number;
  readonly renewals: number;
};

export const adopt = (raw: RunnerLease, nowMs: number): ManagedLease =>
  ({ raw, acquiredAtMs: nowMs, renewals: 0 });

export const renewed = (l: ManagedLease, raw: RunnerLease): ManagedLease =>
  ({ ...l, raw, renewals: l.renewals + 1 });

export const remainingMs = (l: ManagedLease, nowMs: number): number =>
  Math.max(0, l.raw.expiresAtMs - nowMs);
export const isExpired = (l: ManagedLease, nowMs: number): boolean => remainingMs(l, nowMs) === 0;
export const shortId = (l: ManagedLease): string => l.raw.id.slice(0, 8);
export const describe = (l: ManagedLease, nowMs: number): string =>
  `${shortId(l)} (${Math.round(remainingMs(l, nowMs) / 1000)}s left, ${l.renewals} renewals)`;

/** The only legitimate unwrap: passing the lease back to the SDK. */
export const toSdk = (l: ManagedLease): RunnerLease => l.raw;
```

The `WeakMap` disappears: the state that needed keying on identity is now a property, which is the
concrete reason this technique earned its place here. Note the spread in `renewed` copies the
*wrapper*, never the foreign object — `raw` is replaced by another reference the SDK produced, so
the aliasing decision made above still holds and no snapshot is taken.

**Postcondition.** Exactly one module imports `@vendor/runner-sdk`; `tsc` enforces the boundary,
because no other module can name `RunnerLease`. Replacing the SDK is bounded to that module plus
`adopt`/`toSdk`. The parallel `WeakMap` is gone, so lease state cannot be lost by a key that
failed to match. Identity comparisons on `RunnerLease` itself are unaffected, because the wrapper
wraps the lease and is never handed to the library.

| Gain | Cost |
|---|---|
| The vendor type is confined to one module, which is the largest reduction in blast radius available in this group | Every operation you need must be forwarded or re-exposed; the wrapper is a surface you now maintain, and a second vocabulary for one concept |
| State that needed a side `Map` becomes a property, removing a class of "the key didn't match" bug | `wrapper !== raw`: any library behaviour keyed on identity breaks, and every `===`, `instanceof` and keyed lookup is a site you must find by hand |
| The unwrap point is one function, so calls back into the library are enumerable by `grep` | If entry points were not fully enumerated, both shapes circulate and every function needs to handle two types |
| One documented conversion boundary instead of ad-hoc SDK access scattered through the code | It outlives the upstream fix: a type with tests looks like a design decision rather than a workaround |

**When NOT to use this**

- **You only need functions.** Stop at 7. This is the default and it is right most of the time.
  Wanting a *name* rather than behaviour is not a reason to introduce a type — a module already
  gives you the name, and reaching for a class here is `UNI-10` with a different label.
- **Instances arrive from the library at several points you cannot funnel.** Fix the boundary
  first; wrapping before that produces a leak, not an extension.
- **The library keys on identity** — a `WeakMap` cache, an `instanceof` check, an internal
  registry — or any caller of yours uses the foreign value as a `Map`/`Set` key. Wrapping breaks
  it with no compile error and often no test failure.
- **Subclass form, when the base is an `interface`, a type alias, or produced by a library
  factory.** There is nothing to subclass, or your subclass is never instantiated.
- **The wrapper would carry mutable state shared across requests.** That is a singleton with extra
  steps (`UNI-06`); the state belongs in the request scope that owns it.
- **The dependency is scheduled for replacement.** Then the work is the adapter for the
  replacement; do that, and do not build a wrapper you will delete.
- **You would reach for `as unknown as` to make the wrapper fit a library signature** (`TS-09`).
  That is the type system reporting that the boundary is in the wrong place.

---

## Group failure modes

| Failure | Detection | Correction |
|---|---|---|
| **Delegate oscillation** | the same forwarder is added and deleted across two commits in `git log -S`, or `git log -p --follow` shows one function crossing the same boundary in both directions across releases — both citing this file | run the four questions in *The dual*, then encode the answer as a `dependency-cruiser` rule so the next reader meets a failing check, not an invitation |
| **Forwarder accretion** | after a run of technique 5, forwarders ÷ exported operations exceeds 0.5 on the owner's module | apply 6 to the ones for which all four questions return `no`, **individually** — they do not share a fate |
| **Cycle introduced by a move** | `madge --circular --extensions ts src` non-empty while `tsc` is green — cycles compile | move the shared definition to a third module both import, or invert with an interface owned by the consumer. A value cycle throws at runtime on some entry orders only |
| **Cardinality laundering** | a test passes alone and fails in the suite; a write through one owner is observed through another; or a value that existed once per instance now lives on a record shared by many | the move aliased shared state, which is a behaviour change and not a refactoring. Revert: the property belonged on the many-side, and the model change needs its own design |
| **Move across a serialization boundary** | the moved type appears in a schema, a response body, an ORM model, or the target of a cast from `JSON.parse` | this is a migration with a compatibility window and a rollback plan, not a structural change. Land it as its own commit |
| **Extraction without an invariant** | the new type has no parse function and no function reads more than one of its properties | that was a Data Clump rename. Prefer Introduce Parameter Object (`simplifying-method-calls.md`) or revert |
| **Class invented to receive a move** | a new `class` with no state, no invariant, and one static-shaped member | the destination for a moved function is a module (`UNI-10`) |
| **Tests left behind** | the test file for module A imports module B after the move | move the tests in the same commit. A test that no longer sits beside its subject stops being run by whoever next touches that subject |
| **Prototype patch filed as a foreign method** | `rg -n '\.prototype\.\w+\s*=' src`, or any `declare module` / `declare global` block adding a member to a library type | rewrite as technique 7's function form. The patch's failure mode is load-order dependent and will not reproduce locally |
| **Wrapper leak** | both `ForeignX` and `LocalX` appear in the same module's imports; helper overloads accepting either | entry points were not enumerated. Fix the boundary before wrapping, or revert to 7 |
| **Motion with no pending edit** | a large `git blame` rewrite across N files, empty behaviour diff, no named edit whose cost it reduces | the gates in `../../refactoring.md`. Moves conflict violently with in-flight branches, so their speculative cost is higher than any other group's |

## Relations

- **This group depends on `composing-methods.md`.** Extract Method before Move Method: Feature
  Envy's remedy is both, in that order. Moving a 200-line function relocates the problem at
  maximum diff size.
- **`organizing-data.md` follows.** Move Field and Extract Class reveal the real types; a weak
  Extract Class should have been Introduce Parameter Object, and the wrapper you inlined in 4 is
  usually asking to come back as a branded type with one parse at the boundary.
- **`simplifying-method-calls.md` is last, and owns two things this group produces.** Preserve
  Whole Object (technique 8) is the property-by-property forwarders that technique 6 deletes, seen
  from the callee's side; Introduce Parameter Object (technique 9) is where a failed Extract Class
  belongs. Hide Delegate and Remove Middle Man also change what callers name — batch those
  signature changes rather than dribbling them.
- **`dealing-with-generalization.md` operates on what this group produces.** Extract Superclass
  and Collapse Hierarchy need concrete types to generalise over — and three concrete cases before
  either is warranted. Replace Inheritance with Delegation is the remedy when technique 8's
  subclass form turned out to be inapplicable.
- **`simplifying-conditionals.md` interacts with technique 1.** Moving a function that switches
  on a discriminant into the module owning the union frequently removes the sprawl (`UNI-02`)
  without introducing polymorphism. Check `../../selection.md`'s threshold first.
- **`../../styles/hexagonal.md` supplies the declared boundary rule that question 1 reads.**
  Without a stated port list the dual has no tiebreaker, question 4 is doing all the work, and the
  code oscillates until someone writes the rule down.
- **Patterns.** Facade is Hide Delegate applied at a package boundary and given a name; Adapter
  is Introduce Local Extension (wrapper form) given a name. `../../patterns/facade.md` and
  `../../patterns/adapter.md` describe them as designs; this file describes the transformations
  that arrive at them. A forwarder is not a pattern because it resembles one — reaching a pattern
  by refactoring is not a reason to keep it, so run `../../selection.md`'s threshold either way.
- Technique names are Fowler's (*Refactoring*, 1st ed. 1999, ch. *Moving Features Between
  Objects*; Move Method is Move Function in the 2nd ed.); all text and code here is original to
  this repository.
