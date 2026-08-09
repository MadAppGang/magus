# Dealing with Generalization

**The group's question: is each member declared at the level that uses it — and should the
hierarchy exist at all?**

Twelve techniques. Every one of them moves a member up, down, or sideways through an
inheritance chain, or deletes a level of the chain outright. The technique that deletes a
hierarchy and keeps its data — **Replace Subclass with Fields** — is the one a TypeScript
codebase reaches for most, and it is not here: it produces a lookup table rather than a
hierarchy, so it belongs to `organizing-data.md` (technique 10 there). Go there for it.

## The force

A member sits at the wrong level, and the level is wrong in one of two directions.

**Too high.** The supertype declares something a subtype cannot honour, so that subtype
overrides it to throw or to return a sentinel. Every client holding the supertype's type is
promised a member that some instances refuse. That is a **Liskov substitution** violation —
the rule that an instance of a subtype must be usable anywhere the supertype is expected,
without the caller learning which one it got. `UNI-03` names the code shape.

**Too low.** Each sibling holds its own copy, so a fix lands N times and one copy gets missed.
That is Duplicate Code with a class boundary in front of it.

Both are real. Neither justifies building a hierarchy that does not already exist, and that is
the third force in this group: **`extends` is a slot spent once.** A class has exactly one
parent, chosen at declaration time and never changed. A module can import any number of
functions. So a supertype introduced to share one method has spent the class's only inheritance
slot on an axis of variation that may not be the one that matters next year.

| # | Technique | Transformation | Inverse |
|---|---|---|---|
| 1 | **Pull Up Field** | the same field in every sibling → one field on the supertype | Push Down Field |
| 2 | **Pull Up Method** | the same body in every sibling → one method on the supertype | Push Down Method |
| 3 | **Pull Up Constructor Body** | a duplicated constructor prologue → the supertype constructor | — |
| 4 | **Push Down Field** | a field one subtype uses → that subtype | Pull Up Field |
| 5 | **Push Down Method** | a method one subtype implements → that subtype | Pull Up Method |
| 6 | **Extract Subclass** | features valid only under a condition → a subtype (or a union variant) | Collapse Hierarchy |
| 7 | **Extract Superclass** | features shared by two unrelated types → a supertype | Collapse Hierarchy |
| 8 | **Extract Interface** | the members one client uses → a named role type | delete the alias |
| 9 | **Collapse Hierarchy** | a level carrying no member → one type | Extract Subclass / Superclass |
| 10 | **Form Template Method** | siblings with identical step order → a skeleton + varying steps | pass the steps as parameters |
| 11 | **Replace Inheritance with Delegation** | `extends` → a field plus explicit forwarding | Replace Delegation with Inheritance |
| 12 | **Replace Delegation with Inheritance** | a field plus total forwarding → `extends` | Replace Inheritance with Delegation |

## Order within the group

`../../refactoring.md` puts this group at **step 5 of six**, gated on having three concrete
cases in hand. Below three, the abstraction gets shaped to a single example and the second
example does not fit it.

```
11 Replace Inheritance with Delegation  ← ask first: should this hierarchy exist?
 9 Collapse Hierarchy                   ← delete levels that carry no member
 4 Push Down Field                     ─┐ relocate members to the level that uses them.
 5 Push Down Method                     │ Push down BEFORE pulling up: it shrinks the
 1 Pull Up Field                        │ supertype you then have to reason about
 2 Pull Up Method                       │
 3 Pull Up Constructor Body            ─┘
 6 Extract Subclass                    ─┐ create levels only once the members are sorted
 7 Extract Superclass                  ─┘
10 Form Template Method                 ← the last shape change inside the hierarchy
 8 Extract Interface                    ← free at any point; costs one type alias
12 Replace Delegation with Inheritance  ← almost never. Read the entry before using it
```

**The feedback signal is the refusal count.** After any pull-up, count the siblings that
override the pulled-up member to throw, to return `undefined`, or to no-op. Zero is the only
acceptable number. One or more means the member does not belong at that level — push it back
down (4, 5) or split the role (8).

**The second signal is the empty subtype.** If a technique leaves a class body with no members,
that level is now carrying nothing, and 9 applies. Techniques 3 and 12 both produce empty
subtypes routinely; stopping there leaves scaffolding in the tree.

## Does TypeScript already do this

TypeScript's type system is **structural**: a type describes a shape, and any value with that
shape is assignable to it, whether or not the two declarations know about each other. Nominal
systems (Java, C#) relate types only through declared `extends`/`implements` edges. That single
difference re-prices this entire group.

| Technique | Automated by | What remains yours |
|---|---|---|
| **1, 2 Pull Up Field / Method** | no tsserver refactor; WebStorm exposes *Pull Members Up* | proving the bodies are alpha-equivalent, and widening visibility correctly |
| **3 Pull Up Constructor Body** | nothing; parameter properties absorb most of the result | the initialization-order check below |
| **4, 5 Push Down Field / Method** | no refactor. Delete the supertype declaration and compile — `tsc` enumerates every call site that depended on it | deciding whether the caller narrows or takes the subtype |
| **6 Extract Subclass** | nothing | choosing the union form over the subclass form |
| **7 Extract Superclass** | nothing | deciding whether a supertype is warranted at all |
| **8 Extract Interface** | tsserver's *Extract to interface* works on an inline object type literal, not on a class; WebStorm has a class-aware version | naming the role and choosing its member subset |
| **9 Collapse Hierarchy** | nothing detects it; the signal is a class body with no members | checking for `instanceof` and `catch` filters first |
| **10 Form Template Method** | nothing | choosing between the skeleton and parameters — see `../../patterns/template-method.md` |
| **11, 12 the delegation pair** | nothing. Removing `extends` makes `tsc` list every externally-called inherited member | forwarding versus re-typing the call site |

**8 is nearly free, and that changes the default.** Declaring `type Billable = { serial:
string; tariff: Tariff }` makes every object with those members assignable to it. No
`implements` clause, no edit to any implementor, no import from implementor to interface. In a
nominal language, extracting an interface means editing every implementing class; here it means
editing none. Adding `implements Billable` to a class changes no assignability whatsoever — it
only relocates the error from the call site to the class declaration when the class drifts.

**A shared function beats a shared supertype.** Techniques 2 and 7 both answer "two types do the
same thing" with a base class. TypeScript has a cheaper answer: export the function, import it
twice. Nothing is declared related, no slot is spent, and the function takes a literal in a test
instead of an instance.

**11 is the direction; 12 is the regression.** Delegation wins in TypeScript for three checkable
reasons: it does not spend the single parent slot, it does not import the base's full public
surface into your contract (which is what produces `UNI-03`), and structural typing already
gives you the "is-a" relationship a caller's parameter type actually needs. 12 reverses all
three. It is in this file for completeness, with preconditions strict enough that they rarely
hold.

**10 competes with parameters and usually loses.** `../../patterns/template-method.md` makes
that argument with the code; it is not repeated here.

| Status in TypeScript | Techniques |
|---|---|
| **Live, and cheap** | 8 Extract Interface · 11 Replace Inheritance with Delegation · 9 Collapse Hierarchy |
| **Conditional** — apply only inside a hierarchy you keep for another reason | 1, 2, 4, 5, 6, 7, 10 |
| **Artifact of 1999** | 3 Pull Up Constructor Body — parameter properties and field initializers absorb it |
| **Artifact, and usually a regression** | 12 Replace Delegation with Inheritance |

**`tsc` enumerates; it does not verify.** Deleting a declaration and compiling is a reliable way
to list dependents, and that is the mechanism several techniques below rely on. It is not a
correctness proof. TypeScript checks method parameters **bivariantly** — a member declared with
method syntax accepts an override whose parameter type is narrower, even under
`strictFunctionTypes`, which only tightens function-typed properties. Verified against
`--strict`: a `charge(r: PowerRental): number` satisfying a `charge(r: Rental): number` member
compiles with **zero** diagnostics, while the identical narrowing written as a function-typed
property — `charge: (r: Rental) => number` — is `TS2322`. So a Liskov violation introduced by a
pull-up compiles, and declaring the member as a property rather than with method shorthand is
the cheap way to make the compiler check it at all. The tests are the contract; run them between
numbered steps.

## Example types

Every example below is drawn from a bike-share fleet and uses these:

```ts
type Coord  = { readonly lat: number; readonly lon: number };
type Tariff = { readonly unlockCents: number; readonly perMinuteCents: number };
type Rental = { readonly id: string; readonly minutes: number; readonly endedAt: Coord };

const SERIAL = /^BK-\d{6}$/;
class BadSerial extends Error {}
```

---

## 1. Pull Up Field

**Resolves:** Duplicate Code across siblings. Clears the precondition for 2, which cannot lift a
body that reads a member the supertype does not declare.

**Force.** The same field is declared once per sibling. Each declaration is an independent site
for type, mutability and default to drift, and no supertype method can read it — so shared
behaviour over that field has to be duplicated alongside it.

**Preconditions**

- Every sibling declares the field with the **same name, same type, and same mutability**. Same
  name with different types is coincidence, not commonality; unify the types first or stop.
- The field's visibility can be widened. A field declared `private` in a sibling becomes
  `protected` on the supertype, which is a wider surface. An ECMAScript `#private` field cannot
  be read by a subclass at all, so it must be converted before it can move.
- Initialization can be expressed once — either a constant default, or a constructor parameter
  every sibling already receives.
- The supertype is editable. Not `node_modules`, not generated.

**Mechanics**

1. Confirm name, type and mutability match across every sibling.
2. Declare the field on the supertype at the narrowest visibility that works — `protected`
   before `public`.
3. Give the supertype a constructor parameter for it, or a default initializer.
4. Delete the declaration and its assignment from **one** sibling. Compile, run tests.
5. Repeat per sibling, one test run each.
6. If a sibling's body is now empty, note it for 9.

**Before**

```ts
abstract class Vehicle {
  abstract unlockAt(where: Coord): void;
}

class PedalBike extends Vehicle {
  private readonly serial: string;
  private readonly tariff: Tariff;
  constructor(serial: string, tariff: Tariff) {
    super();
    this.serial = serial;
    this.tariff = tariff;
  }
  override unlockAt(where: Coord) { releaseLock(this.serial, where); }
}

class Ebike extends Vehicle {
  private readonly serial: string;
  private readonly tariff: Tariff;
  private chargePct = 100;
  constructor(serial: string, tariff: Tariff) {
    super();
    this.serial = serial;
    this.tariff = tariff;
  }
  override unlockAt(where: Coord) { releaseLock(this.serial, where); armMotor(this.serial); }
}
```

**After**

```ts
abstract class Vehicle {
  constructor(
    protected readonly serial: string,
    protected readonly tariff: Tariff,
  ) {}
  abstract unlockAt(where: Coord): void;
}

class PedalBike extends Vehicle {
  override unlockAt(where: Coord) { releaseLock(this.serial, where); }
}

class Ebike extends Vehicle {
  private chargePct = 100;
  override unlockAt(where: Coord) { releaseLock(this.serial, where); armMotor(this.serial); }
}
```

Both subclasses now inherit the constructor, so neither declares one. `tariff` moved even though
nothing on `Vehicle` reads it yet — that is the point: 2 becomes legal on the next step.

**Postcondition.** One declaration site per field. `tsc` checks the type once. Supertype methods
can read the field, so a pull-up of any method that uses it is now possible. Visibility is
`protected`, which is wider than the starting state and is the price paid.

| Gain | Cost |
|---|---|
| One declaration to keep correct instead of N; a type change lands once | Visibility widens to `protected`, so every present and future subtype can read it |
| Supertype methods can read the field, which is what 2 requires | The supertype now knows about state that only some of its behaviour uses |
| Constructor duplication usually disappears with it (see 3) | The field is in the base's shape, so anything reflecting over the base sees it |

**When NOT to use this**

- **The siblings are not siblings.** No shared supertype exists, and creating one to hold a field
  spends the inheritance slot. Put the field in a shared `type` and intersect (`A & Timestamps`),
  or pass it to a shared function.
- **The types differ.** `serial: string` and `serial: number` are two fields with one name.
- **Only some siblings declare it.** That is 6, or leave it alone.
- **The "siblings" are variants of a discriminated union.** Move the property into the union's
  common prefix instead; every member then carries it and `tsc` narrows without a class.

---

## 2. Pull Up Method

**Resolves:** Duplicate Code across siblings. With Rename Method first, also Alternative Classes
with Different Interfaces.

**Force.** Two or more siblings hold structurally identical bodies. A defect fixed in one is
still live in the others, and nothing in the type system relates the copies.

**Preconditions**

- The bodies are **alpha-equivalent**: identical after renaming local variables and parameters.
  Near-identical is not this technique — that is 10, or parameterize.
- Every member the body references is declared on the supertype. If it reads a subtype-only
  field, run 1 on that field first or the pull-up will not compile.
- The signatures match exactly, including parameter types and return type. A sibling with a
  narrower parameter type compiles because of method bivariance and is still a Liskov violation;
  check by reading, not by compiling.
- No sibling outside the set overrides the name with different behaviour. If one does, the
  pull-up silently changes which body that sibling runs.

**Mechanics**

1. Diff the bodies. Rename locals until they are textually identical or abandon the technique.
2. Apply 1 to any member the body reads that the supertype does not declare.
3. Declare the method on the supertype with the shared signature.
4. Delete it from **one** sibling. Compile, run tests.
5. Repeat per sibling. After the last one, confirm no sibling still declares the name.
6. Count refusals: any sibling that would need to override this to throw means step 3 was wrong.

**Before**

```ts
class PedalBike extends Vehicle {
  costCents(rental: Rental): number {
    return this.tariff.unlockCents + rental.minutes * this.tariff.perMinuteCents;
  }
}

class Ebike extends Vehicle {
  costCents(r: Rental): number {
    return this.tariff.unlockCents + r.minutes * this.tariff.perMinuteCents;
  }
}
```

**After**

```ts
abstract class Vehicle {
  constructor(
    protected readonly serial: string,
    protected readonly tariff: Tariff,
  ) {}
  costCents(rental: Rental): number {
    return this.tariff.unlockCents + rental.minutes * this.tariff.perMinuteCents;
  }
}
```

**The TypeScript form, which is usually the better destination:**

```ts
export const rentalCostCents = (tariff: Tariff, rental: Rental): number =>
  tariff.unlockCents + rental.minutes * tariff.perMinuteCents;

// rentalCostCents({ unlockCents: 100, perMinuteCents: 18 }, { id: "r-8812", minutes: 14, endedAt: dock })
// → 352
```

Both classes call it. No supertype is required, the parent slot stays free, and a test supplies
a `Tariff` literal instead of constructing a vehicle.

**Postcondition.** One body. Every sibling's behaviour for this operation is defined at one
site, and no sibling overrides it. The supertype's public surface grew by one member that every
subtype honours.

| Gain | Cost |
|---|---|
| A fix lands once; the copies cannot drift, because they no longer exist | The supertype now has behaviour, so a future subtype inherits it whether or not it should |
| The method can be tested through any subtype, and against the supertype's contract | Callers must read one level up to find the body |
| Removes the Duplicate Code that made the siblings look interchangeable when they were not | If the bodies were only *nearly* identical, unifying them changed behaviour — that is not a refactoring |

**When NOT to use this**

- **The bodies differ.** Even by one call. Either parameterize the difference and pull up the
  parameterized version, or use 10.
- **The two types have no other relationship.** Creating a supertype to host one shared method is
  Speculative Generality; `UNI-09` and `UNI-10` are the same mistake with patterns. Export a
  function.
- **A third subtype exists that must refuse the method.** Pull-up makes the refusal mandatory
  (`UNI-03`). Keep the copies or split the role with 8.
- **The method reads mutable subtype state.** It is not the same method; it is two methods that
  happen to type-check the same.

---

## 3. Pull Up Constructor Body

**Resolves:** Duplicate Code in constructors. Largely an artifact — TypeScript's parameter
properties remove the assignments the technique exists to deduplicate.

**Force.** Every subtype constructor opens with the same validation and the same field
assignments. Adding a field means editing N constructors, and a validation fix applied to one is
missing from the rest.

**The construction order, which is what every precondition below follows from.** For `new
Scooter(...)` where `Scooter extends Vehicle`, four phases run in this fixed order — verified by
instrumenting each one:

1. `Vehicle`'s field initializers
2. `Vehicle`'s constructor body — **including any method it calls, override or not**
3. `Scooter`'s field initializers
4. `Scooter`'s constructor body, resuming after its `super(...)` call returns

A statement pulled up into phase 2 that reads a field initialized in phase 3 reads `undefined`,
and `tsc --noEmit` reports nothing, because the field's declared type is `string` and never
`string | undefined`. Every precondition below is a way of checking that you have not done that.

**Preconditions**

- Every subtype constructor begins with the same statement sequence, and that prefix reads only
  its own parameters and supertype members.
- Moving the prefix earlier is a no-op. In a derived constructor `super(...)` must run before any
  `this` access, so the pulled-up prefix necessarily executes **before** the derived class's own
  field initializers. Check that nothing in the prefix depends on a derived field.
- **The supertype constructor does not call an overridable method.** Derived field declarations
  are evaluated after `super()` returns, so any override the base constructor calls observes
  those fields as `undefined`. This is the precondition that fails most often, and it fails
  silently.
- With `useDefineForClassFields` (default at `target: ES2022` and above), a derived field
  declaration *defines* the property after `super()`, overwriting whatever the base constructor
  assigned under that name. Check for name collisions between base assignments and derived
  declarations.

**Mechanics**

1. Identify the longest common prefix across the subtype constructors.
2. Declare the supertype constructor with the parameters that prefix needs, as parameter
   properties where the value is stored unchanged.
3. Move the prefix into it verbatim.
4. In **one** subtype, replace the prefix with `super(...)`. Compile, run tests.
5. Repeat per subtype.
6. A subtype whose constructor is now only `super(...)` with an identical parameter list does not
   need a constructor at all — delete it. If the whole body is then empty, 9 applies.

**Before**

```ts
abstract class Vehicle {
  protected serial!: string;
  protected tariff!: Tariff;
}

class PedalBike extends Vehicle {
  constructor(serial: string, tariff: Tariff) {
    super();
    if (!SERIAL.test(serial)) throw new BadSerial(serial);
    this.serial = serial;
    this.tariff = tariff;
  }
}

class Scooter extends Vehicle {
  readonly maxSpeedKph: number;
  constructor(serial: string, tariff: Tariff, maxSpeedKph: number) {
    super();
    if (!SERIAL.test(serial)) throw new BadSerial(serial);
    this.serial = serial;
    this.tariff = tariff;
    this.maxSpeedKph = maxSpeedKph;
  }
}
```

**After**

```ts
abstract class Vehicle {
  constructor(
    protected readonly serial: string,
    protected readonly tariff: Tariff,
  ) {
    if (!SERIAL.test(serial)) throw new BadSerial(serial);
  }
}

class PedalBike extends Vehicle {}

class Scooter extends Vehicle {
  constructor(serial: string, tariff: Tariff, readonly maxSpeedKph: number) {
    super(serial, tariff);
  }
}
```

The definite-assignment assertions (`serial!`) are gone, because the fields are now assigned in
the constructor that declares them. `PedalBike` is empty — 9 is the next question, not a
finished state.

**The trap this technique creates**, worth checking before step 3:

```ts
abstract class Vehicle {
  constructor(protected readonly serial: string) {
    this.register();                       // calls the override
  }
  protected register(): void {}
}

class Scooter extends Vehicle {
  private readonly fleet = "eu-west";      // defined AFTER super() returns
  override register(): void { registry.add(this.serial, this.fleet); }
}

new Scooter("BK-000101");
// registry receives fleet === undefined. tsc reports nothing: the type says string.
```

**Postcondition.** Validation and shared assignment exist once. Every subtype constructor is
either absent or reduces to `super(...)` plus its own fields. No field carries a
definite-assignment assertion for a value the base now supplies.

| Gain | Cost |
|---|---|
| The invariant enforced at construction is enforced once, for every present and future subtype | The base constructor is now on the critical path of every subtype's construction |
| Adding a shared field means editing one signature | Initialization order becomes load-bearing and is not checked by `tsc` |
| Parameter properties collapse declaration and assignment into the signature | A subtype that needs a *different* validation now has to fight the base |

**When NOT to use this**

- **The base constructor would call an overridable method.** Use a static factory that constructs
  and then calls, so every field exists before the call.
- **The prefixes only look alike.** Two validations with the same shape and different regexes are
  not a common prefix.
- **There is no constructor body.** A class whose constructor is a parameter-property list has
  nothing to pull up. Most TypeScript classes are in this state already.
- **The "constructor" is a factory function over a record.** Then this is Extract Function in
  `composing-methods.md`, at a fraction of the cost.

---

## 4. Push Down Field

**Resolves:** Refused Bequest (`UNI-03`), Speculative Generality, Large Class (`UNI-01`).

**Force.** A field on the supertype is meaningful for one subtype. Every other instance carries
it as `undefined` or as a default that means nothing, and every reader of the supertype's type
has to decide what an absent value implies.

**Preconditions**

- Exactly one subtype references the field. Verify with find-all-references or by deleting the
  declaration and compiling — `grep` misses re-exports and computed access. Zero references means
  it is Dead Code: delete it. Two or more means 6, or leave it.
- Nothing outside the hierarchy reads it through the supertype's type.
- No decorator-driven machinery is attached to the declaring class. Property placement is
  per-instance in JavaScript, so the move is a runtime no-op — but `class-transformer`, TypeORM
  and similar libraries register metadata **per declaring class**, and that metadata moves with
  the declaration.

**Mechanics**

1. Find every reference. Confirm exactly one subtype.
2. Declare the field on that subtype with the same type and initializer.
3. Delete it from the supertype. Compile.
4. Fix any call site `tsc` reports by narrowing to the subtype, or by taking the subtype as a
   parameter type.
5. Run tests.

**Before**

```ts
abstract class Vehicle {
  protected chargePct = 100;               // meaningless on a pedal bike
  constructor(protected readonly serial: string) {}
  abstract unlockAt(where: Coord): void;
}

class PedalBike extends Vehicle {
  override unlockAt(where: Coord) { releaseLock(this.serial, where); }
}

class Ebike extends Vehicle {
  override unlockAt(where: Coord) { releaseLock(this.serial, where); armMotor(this.serial); }
  needsCharge(): boolean { return this.chargePct < 20; }
}
```

**After**

```ts
abstract class Vehicle {
  constructor(protected readonly serial: string) {}
  abstract unlockAt(where: Coord): void;
}

class PedalBike extends Vehicle {
  override unlockAt(where: Coord) { releaseLock(this.serial, where); }
}

class Ebike extends Vehicle {
  private chargePct = 100;
  override unlockAt(where: Coord) { releaseLock(this.serial, where); armMotor(this.serial); }
  needsCharge(): boolean { return this.chargePct < 20; }
}
```

Visibility narrowed from `protected` to `private` on the way down, which is the reverse of what 1
costs. A fleet report that serialises vehicles no longer emits `chargePct: 100` for pedal bikes.

**Postcondition.** The supertype's shape contains only members every instance meaningfully
carries. No caller reads a value whose absence it has to interpret. The field's visibility is at
its narrowest.

| Gain | Cost |
|---|---|
| The base type stops promising state that some instances do not have | One more member on a subtype that may later gain a sibling needing it |
| Visibility narrows, so the field's blast radius — the set of code a change to it can break — shrinks to one class | If a second subtype needs it later, you run 1 and undo this |
| Serialisation, logging and reflection over the base stop emitting a meaningless value | Any decorator metadata attached to the base declaration moves and must be re-checked |

**When NOT to use this**

- **Two or more subtypes use it.** That is 6 — extract the subtype that owns the pair.
- **The base's own methods read it.** Then it is base state, however rarely it varies.
- **The hierarchy is a discriminated union.** The analogue is moving the property into the one
  variant that has it, which `tsc` then enforces through narrowing rather than convention.
- **An ORM or serializer keys off the declaring class.** Move it, then verify the mapping; do not
  assume the runtime no-op extends to the framework.

---

## 5. Push Down Method

**Resolves:** Refused Bequest (`UNI-03`), Fat Interface (`UNI-04`).

**Force.** The supertype declares an operation one subtype implements and the others refuse. The
refusal is written as `throw new Error("unsupported")` or as a silent no-op, so a caller holding
the supertype's type gets a runtime failure where the type said success.

**Preconditions**

- Exactly one subtype has a real implementation. The rest throw, no-op, or return a sentinel.
- No call site needs to invoke it through the supertype's type. Verify by deleting the supertype
  declaration and compiling; `tsc` lists every site that depended on it.
- The refusing implementations have no callers that depend on the throw as behaviour — a caller
  with `try { v.swapBattery(id) } catch { /* not a powered vehicle */ }` is using the exception
  as a type test, and that call site changes with this technique.

**Mechanics**

1. Delete the supertype's declaration and compile. Read the error list — that is the call-site
   inventory.
2. Keep the real implementation on its subtype.
3. Delete each refusing override.
4. For each reported call site, either change the parameter/field type to the subtype, or narrow
   with `instanceof` before the call. Prefer changing the type — narrowing pushes the problem to
   the next caller.
5. Run tests, including any that asserted the "unsupported" throw. Those tests describe behaviour
   that no longer exists; delete them in the same commit.

**Before**

```ts
abstract class Vehicle {
  constructor(protected readonly serial: string) {}
  abstract swapBattery(packId: string): void;
}

class Ebike extends Vehicle {
  override swapBattery(packId: string): void { fitPack(this.serial, packId); }
}

class PedalBike extends Vehicle {
  override swapBattery(_packId: string): void {
    throw new Error("unsupported: PedalBike has no battery");   // UNI-03
  }
}

function serviceVisit(v: Vehicle, packId: string) {
  v.swapBattery(packId);        // compiles for every Vehicle; throws for half of them
}
```

**After**

```ts
abstract class Vehicle {
  constructor(protected readonly serial: string) {}
}

class Ebike extends Vehicle {
  swapBattery(packId: string): void { fitPack(this.serial, packId); }
}

class PedalBike extends Vehicle {}

function serviceVisit(v: Ebike, packId: string) {
  v.swapBattery(packId);        // the type now says what the call requires
}
// serviceVisit(new PedalBike("BK-000101"), "PK-77")
// → error TS2345: Argument of type 'PedalBike' is not assignable to parameter of type 'Ebike'.
```

The failure moved from runtime to compile time. That is the whole return on this technique.

**Postcondition.** Every member the supertype declares is honoured by every subtype, so the
supertype is substitutable in the Liskov sense. No `throw new Error("unsupported")` branch
remains. `PedalBike` is now empty and 9 applies.

| Gain | Cost |
|---|---|
| Narrows the supertype's interface so every implementor satisfies every member, removing the refusal branch `UNI-03` names | Call sites that were polymorphic now name a concrete type, so they know more than they did |
| A wrong call is a `tsc` error rather than a production exception | If a second subtype gains the operation later, you run 2 to lift it back |
| The refusing subtypes usually collapse to empty, exposing hierarchy that was never carrying weight | Tests asserting the "unsupported" throw are deleted, and reviewers must accept that as intentional |

**When NOT to use this**

- **Callers genuinely dispatch polymorphically over the whole set.** Then the operation belongs to
  every subtype and the refusal is the bug — implement it, or split the role with 8.
- **Two subtypes implement it.** Extract the level that owns both (6/7), or split the role.
- **The base is a framework class you do not own.** You cannot delete its declaration; wrap
  instead (11).
- **The exception is load-bearing at a boundary** — an HTTP layer maps it to `409`. Changing it is
  a contract change, not a refactoring.

---

## 6. Extract Subclass

**Resolves:** Large Class (`UNI-01`), Temporary Field, conditionals over an optional field.

**Force.** A class carries features that are meaningful only when some other feature is present.
The invariant "`chargePct` means something only if this is a powered vehicle" lives in comments
and in every reader's head, and `tsc` checks none of it.

**Preconditions**

- You can state the invariant as a sentence: *these members are meaningful exactly when C holds.*
  If you cannot, there is no subtype here.
- The conditional members form a set — a lone optional field is not a subtype.
- Every construction site is enumerable and can be routed to the correct constructor or factory.
- No code mixes the sets on one instance. If some object is temporarily half-powered, that is a
  lifecycle problem, not a taxonomy problem.

**Mechanics**

1. Name the invariant. That name is the subtype's name, or the variant's discriminant value.
2. Declare the subtype extending the original; move the conditional fields and the methods that
   read them.
3. Route each `new` site to the right constructor. Compile.
4. Delete the now-dead conditionals in the base (`if (this.chargePct !== undefined)`).
5. Run tests.
6. **Stop and reconsider the target form.** In TypeScript the union below is checked; the subclass
   is not.

**Before**

```ts
class Vehicle {
  constructor(
    readonly serial: string,
    readonly tariff: Tariff,
    readonly chargePct?: number,       // powered only
    readonly motorWatts?: number,      // powered only
  ) {}
  needsCharge(): boolean {
    return this.chargePct !== undefined && this.chargePct < 20;
  }
}
```

**After — the technique as catalogued**

```ts
class Vehicle {
  constructor(readonly serial: string, readonly tariff: Tariff) {}
}

class PoweredVehicle extends Vehicle {
  constructor(
    serial: string,
    tariff: Tariff,
    readonly chargePct: number,
    readonly motorWatts: number,
  ) { super(serial, tariff); }

  needsCharge(): boolean { return this.chargePct < 20; }
}
```

**After — the TypeScript destination**

```ts
type Vehicle =
  | { readonly kind: "pedal";   readonly serial: string; readonly tariff: Tariff }
  | { readonly kind: "powered"; readonly serial: string; readonly tariff: Tariff;
      readonly chargePct: number; readonly motorWatts: number };

const needsCharge = (v: Vehicle): boolean => v.kind === "powered" && v.chargePct < 20;

// const v: Vehicle = { kind: "pedal", serial: "BK-000101", tariff };
// v.chargePct
// → error TS2339: Property 'chargePct' does not exist on type '{ kind: "pedal"; ... }'.
```

The union form makes the invariant a compile error rather than a convention. It also closes the
set, so a `switch` over `kind` with an `assertNever` default turns "someone added a variant" into
a build failure — the guarantee `TS-07` exists to enforce.

**Postcondition.** No member is optional-for-taxonomy reasons. Reading a conditional member
without establishing the condition does not compile. The base has no branch on the presence of a
field.

| Gain | Cost |
|---|---|
| The invariant moves from comment to type, so `tsc` enforces what a reader previously had to remember | One more type in the module, and every construction site names its variant |
| Optional fields disappear, and with them the `!== undefined` branches | The union form is closed by design: an open plugin-supplied set needs a different shape |
| Cohesion improves — each type's members are all read by the same code | Migrating persisted data to carry a discriminant is a real, separate task |

**When NOT to use this**

- **The condition is a lifecycle stage, not a kind.** An object that is "unpaid then paid" wants a
  state machine or two records, not a subtype (`../../patterns/state.md`).
- **One optional field.** The subtype costs more than the field.
- **You cannot enumerate the construction sites.** Deserialisation from a store with no
  discriminant column blocks this until the data carries one.
- **The variant set is open** — third parties register kinds. A closed union cannot express that;
  see `../../patterns/strategy.md`.

---

## 7. Extract Superclass

**Resolves:** Duplicate Code across unrelated types; Alternative Classes with Different
Interfaces, after Rename Method has aligned the names.

**Force.** Two types independently grew the same members. The duplication is real, and the fix
that first suggests itself — a common parent — is the most expensive one available in TypeScript.

**Preconditions**

- **Neither type already extends anything.** Each has one parent slot; this spends it.
- The shared members have identical signatures and identical semantics. Same shape and different
  meaning is coincidence.
- The shared members do not read state specific to either type. If they do, apply 1 first or
  abandon.
- Both types are editable, and both change for the same reason. A supertype couples them: from
  then on, a change for one type's sake lands in the other's inheritance chain.
- Three concrete cases exist, per `../../refactoring.md`'s gate. Two is not enough to identify the
  axis of variation.

**Mechanics**

1. List the members that are genuinely shared, with signatures.
2. Try the two cheaper forms first — a shared function, and a shared shape type (8). If both
   suffice, stop; the technique is not needed.
3. If shared **mutable state plus behaviour over it** remains, declare the supertype with that
   state and those methods.
4. Add `extends` to one type, delete its copies. Compile, run tests.
5. Repeat for the second type.
6. Check the refusal count. Any member one type must override away means the supertype is too
   wide.

**Before**

```ts
class Vehicle {
  lastHeartbeatAt = 0;
  constructor(readonly serial: string) {}
  recordHeartbeat(now: number) { this.lastHeartbeatAt = now; }
  isStale(now: number) { return now - this.lastHeartbeatAt > 15 * 60_000; }
}

class DockingStation {
  lastHeartbeatAt = 0;
  constructor(readonly stationId: string, readonly slots: number) {}
  recordHeartbeat(now: number) { this.lastHeartbeatAt = now; }
  isStale(now: number) { return now - this.lastHeartbeatAt > 15 * 60_000; }
}
```

**After — the technique as catalogued**

```ts
abstract class FleetAsset {
  lastHeartbeatAt = 0;
  recordHeartbeat(now: number) { this.lastHeartbeatAt = now; }
  isStale(now: number) { return now - this.lastHeartbeatAt > 15 * 60_000; }
}

class Vehicle extends FleetAsset {
  constructor(readonly serial: string) { super(); }
}

class DockingStation extends FleetAsset {
  constructor(readonly stationId: string, readonly slots: number) { super(); }
}
```

**After — the TypeScript destination**

```ts
type Heartbeating = { lastHeartbeatAt: number };

const recordHeartbeat = (a: Heartbeating, now: number) => { a.lastHeartbeatAt = now; };
const isStale = (a: Heartbeating, now: number) => now - a.lastHeartbeatAt > 15 * 60_000;

class Vehicle { lastHeartbeatAt = 0; constructor(readonly serial: string) {} }
class DockingStation {
  lastHeartbeatAt = 0;
  constructor(readonly stationId: string, readonly slots: number) {}
}

// isStale(new Vehicle("BK-000101"), Date.now())  → true — assignable structurally, no `implements`
```

Neither class declares a relationship. Both satisfy `Heartbeating` by shape, both keep their
parent slot, and `isStale` takes an object literal in a test.

**Postcondition.** One definition of the shared behaviour. In the union-free form, the two types
remain independent: a change to `Vehicle` cannot reach `DockingStation` except through the shared
function's signature.

| Gain | Cost |
|---|---|
| Duplication collapses to one definition, and the two types stop drifting | The class form converts duplication into coupling — the two now change together whether or not they should |
| Shared state and its invariant live in one place | Both parent slots are spent, permanently, on this axis |
| Rename Method beforehand often reveals more commonality than expected | A third type that shares only *some* members forces either a refusal or a second level |

**When NOT to use this**

- **You have two cases, not three.** The supertype gets shaped to one of them.
- **Either type already extends something.** The slot is gone; use functions.
- **The commonality is coincidental.** Same members, different reasons to change: the supertype
  turns Duplicate Code into Divergent Change on the base.
- **The shared part is stateless.** Then it is a function, and a base class is a namespace wearing
  a class keyword.

---

## 8. Extract Interface

**Resolves:** Inappropriate Intimacy, Fat Interface (`UNI-04`), hard-to-substitute dependencies
(`UNI-05`).

**Force.** A function takes a concrete type and uses four of its thirty members. Its blast radius
— the set of changes that can break it — is the whole class, and a test must construct the whole
class to call it.

**Preconditions**

- You can name the **role** the client needs, in terms of the client's vocabulary. `Billable`,
  not `IVehicle`.
- Every intended implementor already satisfies the member subset. Verify with an assignment:
  `const _check: Billable = someVehicle;` compiles or it does not. That is a compile-time check
  with no runtime cost.
- The members you need are **public**, and the rule here is narrower than "a `private` member
  makes the class nominal". Verified against `--strict`: a class carrying a `private` **or**
  `#private` member *is* assignable to a role naming only its public members — the extra member
  is not part of that comparison. What `private` blocks is **class-to-class** identity: two
  classes each declaring `private token` give `TS2322 Types have separate declarations of a
  private property 'token'`. The case that actually fails this precondition is a member you need
  that is declared `protected`: `TS2322 Property 'serial' is protected in type 'Cargo' but public
  in type 'Billable'`.
- No member of the proposed role is refused by an intended implementor. If one is, split the role
  rather than widening it (`UNI-04`).

**Mechanics**

1. Open the client. List every member it calls on the dependency.
2. Declare a `type` (or `interface`) with exactly those members, named for the role.
3. Change the client's parameter or field type to the role. Compile — no implementor is edited.
4. Optionally add `implements Role` to a concrete class. This changes no assignability; it makes
   `tsc` report drift at the class declaration instead of at the call site. That is its only
   effect.
5. Where one implementor needs a member the others refuse, declare a second role. Two narrow roles
   beat one role with a refusal.

**Before**

```ts
function settleRide(vehicle: Vehicle, rental: Rental): number {
  const cents = vehicle.tariff.unlockCents + rental.minutes * vehicle.tariff.perMinuteCents;
  ledger.post(vehicle.serial, rental.id, cents);
  return cents;
}
```

**After**

```ts
type Billable = { readonly serial: string; readonly tariff: Tariff };

function settleRide(vehicle: Billable, rental: Rental): number {
  const cents = vehicle.tariff.unlockCents + rental.minutes * vehicle.tariff.perMinuteCents;
  ledger.post(vehicle.serial, rental.id, cents);
  return cents;
}

// The test double is an object literal. No library, no subclass, no `implements`.
// settleRide(
//   { serial: "BK-000101", tariff: { unlockCents: 100, perMinuteCents: 18 } },
//   { id: "r-8812", minutes: 14, endedAt: dock },
// )
// → 352
```

`Vehicle` was not edited. Neither was any subclass. In a nominal language this same change
requires an `implements` clause on every implementor and a new import edge from each of them to
the interface.

**Postcondition.** The client's blast radius is the role's members, not the concrete type's. Any
object with those members — including a literal in a test — is a valid argument. The dependency
edge points from the client to a type it owns, not to a class it does not.

| Gain | Cost |
|---|---|
| The signature states exactly what the function needs, so a reader stops guessing | One more named type per role, and roles multiply if you extract one per call site |
| Test doubles are object literals; no mocking library and no subclass | A role that drifts from its implementors is only caught where they meet, unless `implements` is added |
| Breaks import cycles (`TS-13`): the client imports the role, not the implementation | Over-narrow roles fragment the vocabulary — three names for one concept |

**When NOT to use this**

- **One implementor and no test needs a double.** That is Speculative Generality; `UNI-09` is the
  same instinct applied to patterns.
- **The role would restate the whole class.** A role is a subset. If it is not, you have renamed
  the class.
- **The members you need are `protected`.** They do not satisfy a public role member, and the
  compiler names the mismatch rather than ignoring it — `TS2322 Property 'serial' is protected in
  type 'Cargo' but public in type 'Billable'`. Widen deliberately, or pick different members.
- **You are about to prefix it with `I`.** Name the role for what the client needs; the `I` prefix
  encodes a nominal-language habit into a structural type system.

---

## 9. Collapse Hierarchy

**Resolves:** Lazy Class, Speculative Generality (`UNI-09`, `UNI-10`).

**Force.** A level in the chain carries nothing. The subtype adds no member and overrides none,
so every reader who follows the `extends` edge learns nothing and returns.

**Preconditions**

- The subtype's body declares no member and overrides nothing, **or** the supertype has exactly
  one subtype and nothing else names the supertype's type.
- Nothing distinguishes the two nominally: no `instanceof` check, no `catch` filter, no
  serialisation tag, no dependency-injection token, no `constructor.name` read.
- Both types are in your repo. A framework base class is not collapsible.
- No public API exports both names. Deleting an exported symbol is a contract change.

**Mechanics**

1. Grep for the doomed name: `extends X`, `instanceof X`, `: X`, `new X`, and any string literal
   matching it (DI tokens, discriminators).
2. Choose the survivor — usually the one with the better name.
3. Move any members from the doomed type into the survivor.
4. Replace every reference. Compile.
5. Delete the doomed declaration. Run tests.

**Before**

```ts
abstract class Vehicle {
  constructor(protected readonly serial: string, protected readonly tariff: Tariff) {}
  costCents(r: Rental) { return this.tariff.unlockCents + r.minutes * this.tariff.perMinuteCents; }
}

class PedalBike extends Vehicle {}          // adds nothing, overrides nothing
```

**After**

```ts
class PedalBike {
  constructor(private readonly serial: string, private readonly tariff: Tariff) {}
  costCents(r: Rental) { return this.tariff.unlockCents + r.minutes * this.tariff.perMinuteCents; }
}
```

Visibility narrowed from `protected` to `private` on the way, because there is no longer a
subclass that needs to read the fields.

**The counterexample, and it is common.** An empty subclass is load-bearing when its *nominal
identity* is the payload:

```ts
class FleetError extends Error {}
class VehicleOffline extends FleetError {}      // empty — and required

try { await unlock(serial); }
catch (e) { if (e instanceof VehicleOffline) return retryLater(serial); throw e; }
```

Here the class body is empty by design: the type name is the information, and `instanceof`
consumes it. Collapsing this is a behaviour change.

**Postcondition.** Every remaining level in the chain declares at least one member or is
distinguished by an `instanceof`/`catch` site. Reading the type answers a question rather than
forwarding it.

| Gain | Cost |
|---|---|
| One fewer level to read, and one fewer file to open | If the level returns later, you re-derive it — usually cheap, occasionally not |
| Visibility narrows on the way down, shrinking each member's blast radius | An exported name disappears, which is a contract change if it crossed a package boundary |
| Removes the strongest signal of Speculative Generality in a hierarchy | Error taxonomies and DI tokens look identical to dead levels until you grep |

**When NOT to use this**

- **`instanceof`, a `catch` filter, or a DI token names the type.** Empty and load-bearing.
- **The name is exported.** Deprecate before deleting.
- **The base is abstract and has a second subtype in flight** on another branch. Check before you
  conflict with it.
- **The level exists to satisfy a framework** — an ORM entity base, a `React.Component` — which
  you do not control.

---

## 10. Form Template Method

**Resolves:** Duplicate Code across siblings whose step order is identical.

**Force.** Two siblings run the same sequence and differ in two of its steps. Copying the
sequence means a fix to the shared part lands N times, and the order — which is the actual
invariant — is written down nowhere.

`../../patterns/template-method.md` covers the pattern's structure, its three step kinds, and its
argument for the function form. Read it before applying this; the mechanics below produce the
class form, and that file explains when to keep it.

**Preconditions**

- Two or more siblings execute the same steps in the same order.
- **The order is the invariant you intend to protect.** If any sibling must reorder, this
  technique is wrong — you want a pipeline or `../../patterns/chain-of-responsibility.md`.
- After applying 1 and 2, the varying steps have compatible signatures across siblings.
- Each varying step is referenced only by the skeleton. A step called from outside is not a step;
  it is public API.
- The fixed steps are genuinely fixed. A step some sibling needs to skip is a hook with a default,
  not a fixed step — and a fourth hook means the skeleton is not stable.

**Mechanics**

1. Align the sequences: same steps, same order, extracted into methods (technique 1 of
   `composing-methods.md`) so the diff is step-level.
2. Declare the skeleton on the supertype. Call the steps in order; add nothing else.
3. Mark each step: `protected abstract` (must supply), `protected` with a default (hook), or
   `private` (fixed, not overridable).
4. Delete the sequence from one sibling, leaving its varying steps. Compile, run tests.
5. Repeat per sibling.
6. Count the hooks. Past three, reconsider — and compare against the parameterized form below.

**Before**

```ts
class PedalBike extends Vehicle {
  endRide(r: Rental): Receipt {
    meter.stop(r.id);
    const charge = this.tariff.unlockCents + r.minutes * this.tariff.perMinuteCents;
    capture(r.id, charge);
    return { rentalId: r.id, charge, penalty: 0 };
  }
}

class Scooter extends Vehicle {
  endRide(r: Rental): Receipt {
    meter.stop(r.id);
    const charge = this.tariff.unlockCents + r.minutes * this.tariff.perMinuteCents;
    const penalty = outsideServiceArea(r.endedAt) ? 500 : 0;
    capture(r.id, charge + penalty);
    return { rentalId: r.id, charge, penalty };
  }
}
```

**After — the class form**

```ts
abstract class Vehicle {
  constructor(protected readonly serial: string, protected readonly tariff: Tariff) {}

  endRide(r: Rental): Receipt {          // the template method: the order is the invariant
    this.stopMeter(r);                   // fixed
    const charge = this.chargeCents(r);  // varies
    const penalty = this.penaltyCents(r);// hook
    capture(r.id, charge + penalty);     // fixed
    return { rentalId: r.id, charge, penalty };
  }

  protected abstract chargeCents(r: Rental): number;
  protected penaltyCents(_r: Rental): number { return 0; }
  private stopMeter(r: Rental): void { meter.stop(r.id); }
}

class Scooter extends Vehicle {
  protected chargeCents(r: Rental) {
    return this.tariff.unlockCents + r.minutes * this.tariff.perMinuteCents;
  }
  protected override penaltyCents(r: Rental) {
    return outsideServiceArea(r.endedAt) ? 500 : 0;
  }
}
```

**After — the parameterized form, which usually wins**

```ts
type RidePricing = {
  chargeCents: (r: Rental) => number;
  penaltyCents?: (r: Rental) => number;
};

function endRide(r: Rental, pricing: RidePricing): Receipt {
  meter.stop(r.id);
  const charge = pricing.chargeCents(r);
  const penalty = pricing.penaltyCents?.(r) ?? 0;
  capture(r.id, charge + penalty);
  return { rentalId: r.id, charge, penalty };
}

// endRide(rental, { chargeCents: byTariff(scooterTariff), penaltyCents: serviceAreaPenalty })
// → { rentalId: "r-8812", charge: 352, penalty: 500 }
```

The parameterized form composes steps from different sources, tests each step alone, and spends
no parent slot. `../../patterns/template-method.md` states the one condition under which the
class form still wins: siblings that share substantial **state**, not only steps.

**Postcondition.** The step order exists once and no subtype can reorder it. Every varying step
is `protected` and named. A new sibling supplies steps and inherits the order for free.

| Gain | Cost |
|---|---|
| The order — the real invariant — is written once and enforced by the base | Inverted control: the base calls you, and a reader must open two files to follow one operation |
| Adding a sibling means supplying steps, not copying a sequence | A subtype that overrides a step in a way the skeleton does not expect breaks every caller — `UNI-03` |
| Hooks make optional behaviour explicit instead of conditional | Spends the parent slot on this axis; the parameterized form does not |

**When NOT to use this**

- **One or two steps vary and there is no shared state.** Pass the steps. See the linked pattern
  file.
- **A sibling must reorder or skip a fixed step.** The order is not an invariant, so there is no
  skeleton to protect.
- **You are adding a fourth hook.** The skeleton is still moving; freeze it before enshrining it.
- **The siblings exist only to host the varying steps.** Then the classes are a delivery mechanism
  for two functions.

---

## 11. Replace Inheritance with Delegation

**Resolves:** Refused Bequest (`UNI-03`), Inappropriate Intimacy, an inherited Fat Interface
(`UNI-04`).

**Force.** A class extends another to reuse a few members and inherits all of them. Every public
member of the base joins the subtype's contract, including the ones it must refuse. The parent
slot is spent, and the caller-visible surface is not the one anyone designed.

**This is the direction TypeScript hierarchies should travel**, for three checkable reasons: the
parent slot stays free, the public surface stops including refusals, and structural typing
already supplies the "is-a" relationship a caller's parameter type needs (technique 8) without
`extends`.

**Preconditions**

- The subtype uses a proper subset of the base's members, or overrides one to refuse it.
- No caller depends on the subtype's **nominal** identity: no `instanceof Base`, no `catch`
  filter, no framework that requires the base (`Error`, an ORM entity base, a legacy
  `React.Component`).
- Every externally-called inherited member is enumerable. Remove `extends` and compile; `tsc`
  lists them.
- The base is constructible independently — no protected constructor, no abstract members the
  subtype was supplying.

**Mechanics**

1. Add a field holding an instance of the former base; construct it in the constructor.
2. Replace internal uses of inherited members with `this.<field>.member`. Compile with `extends`
   still present; nothing external breaks yet.
3. Remove `extends`. Compile — `tsc` now lists every external call site that relied on
   inheritance.
4. For each, either add a one-line forwarding method, or re-type the call site to a role from 8.
   Prefer re-typing; forwarders accumulate.
5. Delete any override that existed only to refuse an inherited member.
6. Count the forwarders. If more than half the members forward with no added pre- or
   postcondition, you have Middle Man — see `../../refactoring.md` before adding more.

**Before**

```ts
class TelemetryBuffer {
  private readonly points: Coord[] = [];
  push(p: Coord): void { this.points.push(p); }
  flush(): Coord[] { const out = [...this.points]; this.points.length = 0; return out; }
  size(): number { return this.points.length; }
  clear(): void { this.points.length = 0; }
}

class Scooter extends TelemetryBuffer {
  constructor(readonly serial: string) { super(); }

  ping(at: Coord): void {
    this.push(at);
    if (this.size() >= 60) upload(this.serial, this.flush());
  }

  override clear(): void {
    throw new Error("unsupported: telemetry is retained for audit");   // UNI-03
  }
}

// Every caller can also do this, and nobody meant them to:
// scooter.flush();  scooter.push({ lat: 0, lon: 0 });
```

**After**

```ts
class Scooter {
  private readonly telemetry = new TelemetryBuffer();
  constructor(readonly serial: string) {}

  ping(at: Coord): void {
    this.telemetry.push(at);
    if (this.telemetry.size() >= 60) upload(this.serial, this.telemetry.flush());
  }
}

// scooter.flush()
// → error TS2339: Property 'flush' does not exist on type 'Scooter'.
```

**Postcondition.** The type's public surface contains `serial` and `ping` — the members it
implements, and nothing else. No member throws "unsupported". The parent slot is free. The
buffer can be swapped for a fake in a test by widening the field's type to a role (8).

| Gain | Cost |
|---|---|
| Narrows the public surface to the members the type implements, removing the refusal branch `UNI-03` names | Members the outside world legitimately used now need explicit forwarders |
| The parent slot is free for an axis that matters more later | One more object per instance, and one more indirection when reading |
| The delegate is replaceable — a role type at the field makes it a test seam | Total forwarding is Middle Man, which the catalog treats as its own smell |

**When NOT to use this**

- **The subtype uses the whole base and callers rely on substitutability.** Then inheritance is
  honest and delegation adds forwarders for nothing.
- **A framework requires the base class.** `class VehicleOffline extends Error {}` is correct;
  delegating to an `Error` breaks `instanceof` and stack capture.
- **The base is abstract and the subtype supplies its abstract members.** There is no independent
  instance to delegate to until you restructure the base.
- **You would end up forwarding everything.** Consider Remove Middle Man instead: let callers hold
  the delegate directly, typed by a role.

---

## 12. Replace Delegation with Inheritance

**Resolves:** Middle Man — but rarely in the way you want. **Nearly always the wrong direction in
TypeScript.** It is here for completeness, and the preconditions are strict because they should
be.

**Force.** A class holds a delegate and forwards every one of its members unchanged. Each new
member on the delegate means a new forwarder, and the forwarding file is pure overhead.

**Preconditions — all of them, not most**

- The delegator forwards **every** public member of the delegate, unchanged, adding no
  precondition and no postcondition. One forwarder that validates its argument fails this.
- The delegator has no other parent and will never need one.
- Callers need substitutability by **nominal** identity — an `instanceof` site or a framework base
  class requires it. Structural assignability does not count; that is already free.
- The delegate is never shared between two delegators, and is never swapped at runtime. Both are
  possible with a field and impossible with `extends`.
- **You want every member the delegate gains in future to become part of your contract
  automatically.** This is the load-bearing condition and it is usually false — inheritance
  imports tomorrow's members without review.

**Mechanics**

1. Verify total forwarding, member by member. Any asymmetry ends the technique.
2. Replace the field with `extends`, delete the forwarders, and remove the constructor's
   delegate construction.
3. Compile. Every call site keeps working, because the members are now inherited.
4. Run tests.
5. **Check what is left.** If the class body is now empty, the class was Middle Man and the
   technique has produced a Lazy Class — go to 9.

**Before**

```ts
class DockLedger {
  record(dockId: string, event: string): void { /* … */ }
  entries(dockId: string): LedgerEntry[] { /* … */ return []; }
  purgeBefore(ts: number): number { /* … */ return 0; }
}

class AuditedDock {
  private readonly ledger = new DockLedger();
  record(dockId: string, event: string) { return this.ledger.record(dockId, event); }
  entries(dockId: string) { return this.ledger.entries(dockId); }
  purgeBefore(ts: number) { return this.ledger.purgeBefore(ts); }
}
```

**After — the technique**

```ts
class AuditedDock extends DockLedger {}
```

**After — what the code is actually telling you**

```ts
// AuditedDock added nothing. Delete it; callers hold the ledger, typed by the role they need.
type DockAuditLog = { record(dockId: string, event: string): void };

function closeDock(dockId: string, log: DockAuditLog) {
  log.record(dockId, "closed");
}

// closeDock("DK-204", new DockLedger())   → structurally assignable, no `implements`
```

**Postcondition.** No member forwards. Either the delegator inherits (and is usually empty, so 9
follows), or it is gone and callers hold the collaborator behind a role type.

| Gain | Cost |
|---|---|
| N forwarders disappear, and a member added to the base needs no edit here | A member added to the base joins your public contract with no review — the same mechanism, read as a risk |
| The nominal relationship becomes real, which matters if `instanceof` consumes it | The parent slot is spent on a relationship that structural typing was already providing |
| The Middle Man smell is gone | The usual result is an empty class, which is the Lazy Class smell — you traded one for another |

**When NOT to use this**

- **Any forwarder adds a check, a log line, or a translated error.** That is an adapter, and it is
  doing work. Keep it.
- **Only some members forward.** Inheritance would import the rest.
- **The delegate is shared, pooled, or swapped.** Inheritance makes it per-instance and permanent.
- **Nothing reads the nominal type.** Then the relationship buys nothing that a role type (8) does
  not already give you, and Remove Middle Man is the better move.
- **The pair oscillates.** 11 and 12 are duals; `../../refactoring.md` lists applying a technique
  whose inverse is also in the catalog as a hard stop unless you can state which side you prefer
  and why. In TypeScript, prefer 11 and record the reason.

---

## Group failure modes

| Failure | Detection | Correction |
|---|---|---|
| **Hierarchy built at n=2** | one abstraction, two concrete cases; the base's shape matches exactly one of them | the gate is three, per `../../refactoring.md`'s order of application. Revert and wait |
| **Pull-up that forces a refusal** | after 1 or 2, some sibling overrides the member to throw, no-op, or return a sentinel | `UNI-03`. Push it back down (4, 5) or split the role (8). The refusal count must be zero |
| **Inheritance used for reuse** | the subtype uses under half the base's members; no caller depends on substitutability | 11. This is the single most common shape in this group |
| **Interface with one implementor and no double** | a role type named once, satisfied once, faked nowhere | Speculative Generality (`UNI-09`). Inline the type; the concrete type was the answer |
| **Oscillation across 11/12** | successive commits flip the same pair between `extends` and a field | duals hard-stop in `../../refactoring.md`. State the preferred side — delegation — and record why |
| **Scaffolding left behind** | 3 and 12 both produce empty subtypes; the tree still has them | 9. An empty level that no `instanceof` reads is not a level |
| **Base class as a namespace** | `protected` helpers pulled up that no polymorphism dispatches over | module-level functions. A base class holding only helpers is an import statement with extra syntax |
| **Parallel hierarchies grown by pulling up** | every new subtype of A forces a matching subtype of B | collapse one side by moving members — `moving-features.md` |

## Relations

- **The gate belongs to `../../refactoring.md`.** This is step 5 of six in its ladder, and it
  reads "only with three concrete cases in hand". Applying any technique here at n=2 shapes the
  abstraction to one example.
- **`moving-features.md` runs first.** Extract Class and Move Method sort which type owns which
  member; pulling up over unsorted members lifts the wrong things and does it with a wide diff.
- **`composing-methods.md` is a precondition for 2 and 10.** Bodies must be step-level before you
  can tell whether two siblings share a sequence or merely a length.
- **10 lands on `../../patterns/template-method.md`**, which argues for the function form and
  states the one case where the class form still wins. 10 and 11 both usually end at
  `../../patterns/strategy.md`.
- **6 lands on a discriminated union**, which makes `TS-07` — an exhaustiveness check with
  `assertNever` — the thing that replaces polymorphic dispatch. `../../selection.md` carries the
  threshold.
- **`organizing-data.md` owns the exit from this group.** Its Replace Subclass with Fields
  (technique 10 there) is the inverse of its own Replace Type Code with Subclasses, and it is
  where a hierarchy whose subtypes differ only by constants should end up. If that file and this
  one are both open, you are oscillating; pick a side and write down why.
- **Rename Method in `simplifying-method-calls.md` precedes 7.** Alternative Classes with
  Different Interfaces hides commonality behind mismatched names, and 7 cannot see it until the
  names align.
- Technique names are Fowler's (*Refactoring*, 2nd ed.); all text and code here is original to
  this repository.
