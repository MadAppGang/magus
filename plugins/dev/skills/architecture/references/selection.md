# Choosing a pattern, and when not to

The catalog's failure mode is not ignorance of patterns. It is applying them to code that
does not need them. This file is the counterweight to the other 32.

## The one rule

**A pattern is a response to a force that is already present in the code.**

You do not apply a pattern because the code might change one day. You apply it because it
is changing now, repeatedly, in a way the current shape resists. Patterns bought
speculatively cost indirection immediately and pay out only if you guessed the axis of
change correctly, which is rare.

The honest sequence:

```
1. Write the simple thing.               if/else, a function, a plain class.
2. Feel the pain, twice.                 the same edit in the same shape, again.
3. THEN name the force.                  "adding a payment provider edits 4 files"
4. THEN pick the pattern that absorbs it.
```

Step 2 is not optional and the count is not one. **The first duplication is data; the
second is a pattern.** Refactoring on the first occurrence is how you get abstractions
shaped around a single example.

## The threshold that the sin registry leaves unstated

`dev:code-roast`'s `sin-registry.md` contains two entries that read as a contradiction:

| ID | Says | Fix hint |
|---|---|---|
| `UNI-02` Type Switch Sprawl | a switch with 5+ type checks is a CRIME | "use polymorphism or strategy pattern" |
| `UNI-09` Strategy Overkill | Strategy with 1-2 impls is a PARKING TICKET | "use a simple if/switch for 1-2 cases" |

Both are correct. Neither states where the line is. **It is here:**

| Branches | Do this | Why |
|---|---|---|
| 1-2, stable | `if` / `switch` | the indirection costs more than it saves; both branches are visible at once |
| 3-4 | judgement: extract if they are still being added, keep if the set is closed | the cost and benefit are close |
| 5+ | extract (Strategy, State, or polymorphism) | `UNI-02` territory: the switch is now a maintenance site |
| any count, **extended by other teams or plugins** | extract immediately | the count is not the force; *who edits it* is |

**The count is a proxy. The real question is "does adding the next case require editing
existing code?"** If yes, and it will happen again, extract regardless of count. If the set
is genuinely closed (the four suits in a deck), a switch is correct at any size, and
TypeScript's exhaustiveness checking makes it safer than polymorphism.

```ts
// A closed set. A switch is RIGHT here, and `assertNever` makes the compiler enforce it.
function label(s: Suit): string {
  switch (s) {
    case "hearts":   return "♥";
    case "diamonds": return "♦";
    case "clubs":    return "♣";
    case "spades":   return "♠";
    default: return assertNever(s);   // adding a suit becomes a COMPILE error, not a bug
  }
}
```

## Choose by force, not by name

Work from the symptom in the code. The pattern's name is the last thing you should decide.

| The force you actually feel | Look at |
|---|---|
| "adding a case means editing a switch in 4 files" | Strategy, or State if cases determine transitions |
| "this constructor has 9 parameters" | Builder, or just an options object |
| "I cannot test this without a database" | `styles/hexagonal.md` — a style problem, not a pattern |
| "the third-party client has the wrong shape" | Adapter |
| "I need logging/caching/retry on 6 handlers" | Decorator, as composed functions |
| "when X changes, 5 things must react, and the list grows" | Observer; across processes, `styles/event-driven.md` |
| "the user needs undo" | Command + Memento |
| "leaves and containers need identical treatment" | Composite |
| "adding a node type means touching 9 classes" | Visitor |
| "these 6 objects all reference each other" | Mediator |
| "calling this subsystem correctly takes 40 lines" | Facade |
| "one feature's change keeps breaking another's" | `styles/modular-monolith.md` — a boundary problem |

## In TypeScript, check the language first

Several GoF patterns are workarounds for what C++ and Java lacked in 1994. Implementing
them literally in TypeScript adds classes and buys nothing:

| Pattern | The TypeScript answer, most of the time |
|---|---|
| Iterator | `Symbol.iterator`, generators, `for...of` |
| Strategy | a function parameter |
| Command | a closure |
| Singleton | a module-level `const` (ES modules are cached) |
| Prototype | `structuredClone()` |
| Decorator | higher-order functions / middleware composition |
| Proxy | the built-in `Proxy` |
| Template Method | a function taking callbacks for the varying steps |
| Abstract Factory | an object literal of factory functions |

**Use the class form when the pattern needs identity, several related methods, or its own
state.** Use the function form otherwise. Each `patterns/*.md` file has a "Does TypeScript
already do this" section with the specific call.

## Overuse smells

You have over-applied when any of these are true:

- **The indirection has one implementation and always will.** An interface with a single
  implementor, forever, is a rename with extra steps.
- **You cannot answer "what force does this absorb?"** in one sentence.
- **Following one request means opening five files** and none of them contains a decision.
- **The pattern name is in the class name** (`UserServiceFactoryStrategyImpl`) and it still
  is not clear what it does. Names should describe the domain; the pattern is how, not what.
- **The test needs more setup than the code under test.**
- **Layers only delegate.** See the anaemic-layer note in `styles/layered.md`.

## The standard criticism, which is worth taking seriously

Patterns are frequently attacked on three grounds, and each is partly right:

1. **They are workarounds for missing language features.** Peter Norvig showed that 16 of
   the 23 are simplified or invisible in dynamic languages. In TypeScript, act on this: see
   the table above before writing a class hierarchy.
2. **They encourage inefficient designs.** Applied by rote, they add indirection where a
   direct call was correct. The countermeasure is the force rule at the top of this file.
3. **They become a vocabulary for justifying complexity.** "It is a Strategy" is not a
   defence of a design; it is a description of one. The design still has to earn its cost.

None of this makes the catalog useless. Its durable value is **shared vocabulary**: saying
"this is a Decorator" transfers a structure, a set of trade-offs, and a known failure mode
in three words. Use it to communicate, not to justify.

## Before you finish an architecture task

- [ ] Every named style or pattern came from a file you read, not memory
- [ ] Each recommendation carries its trade-off **and** its "when NOT to use"
- [ ] You checked whether TypeScript already provides it
- [ ] For a style: you can say why `styles/modular-monolith.md` is not sufficient before
      proposing `styles/microservices.md`
- [ ] For a pattern: you can name the force, and it is already present, not anticipated
- [ ] You checked the relevant `UNI-*` entries in `dev:code-roast`'s `sin-registry.md`
