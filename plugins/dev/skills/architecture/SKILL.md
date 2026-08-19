---
name: architecture
description: Router for architecture knowledge — 7 architectural styles (layered, hexagonal, clean, modular monolith, microservices, event-driven, CQRS) and the 22 GoF design patterns. Names which file to read; loads none of them.
disable-model-invocation: true
---

# Architecture index

You are holding the **index**, not the content. Its job is to name the one or two files
that answer the question in front of you, so a question about Observer does not drag in
Visitor, Memento, and eight others.

**Read only what the task calls for.** The full tree is ~30 files. Two is normal. Five
means the task is really several tasks and should be split.

Paths resolve against **this skill's own directory** — the tree this file was loaded from.

## Step 1: pick the altitude

The single most common mistake is answering at the wrong altitude. Both tiers use the word
"pattern" and they are not the same thing.

| The question is about | Altitude | Go to |
|---|---|---|
| how a whole system or service is *shaped*: what depends on what, where the boundaries sit, how services talk | **Style** | `references/styles/` — Step 2 |
| how a handful of classes *collaborate*: how to construct this, how to vary that behaviour, how to decouple these two | **Design pattern** | `references/` category leaf — Step 3 |
| **changing existing code without changing what it does** — it is hard to edit, hard to test, or the same edit keeps recurring | **Refactoring** | `references/refactoring.md` — Step 4 |
| which of the two you even need | either | `references/selection.md` first |

A test that resolves it fast: **if the answer changes your directory layout or your deploy
unit, it is a style. If it changes one module's class graph, it is a design pattern.**
"Should the database be swappable" is a style question. "How do I swap the hashing
algorithm at runtime" is Strategy.

## Step 2: architectural styles

Read `references/styles/<file>.md`. These are mutually comparable, so read at most two and
compare them; reading all seven is a survey, not a decision.

| Read | When the pressure is |
|---|---|
| `references/styles/layered.md` | default separation of concerns; the team wants structure and has no exotic constraint |
| `references/styles/hexagonal.md` | the domain must not know about the database, HTTP, or the queue; you want to test business logic with no infrastructure running |
| `references/styles/clean.md` | hexagonal plus an opinionated inner ring of entities and use cases; larger teams wanting one prescribed layout |
| `references/styles/modular-monolith.md` | you want service-shaped boundaries without service-shaped operations; the usual correct answer before microservices |
| `references/styles/microservices.md` | independent deploy and independent scaling are worth a distributed system's cost; you can already name the boundaries |
| `references/styles/event-driven.md` | producers must not know consumers; work is asynchronous; you need to add reactions without editing the producer |
| `references/styles/cqrs-event-sourcing.md` | reads and writes have genuinely different shapes or loads; you need history and audit as a first-class fact |

## Step 3: design patterns (GoF, 22)

Read the **category leaf** first. It carries the shared framing for its family and points
at the per-pattern file. Do not open a per-pattern file cold: the leaf is what tells you
whether you picked the right pattern in the first place.

| Read | Covers | The family's question |
|---|---|---|
| `references/creational.md` | Factory Method, Abstract Factory, Builder, Prototype, Singleton | **who decides what concrete thing gets made, and when** |
| `references/structural.md` | Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy | **how objects compose into bigger objects without rigid inheritance** |
| `references/behavioral.md` | Chain of Responsibility, Command, Iterator, Mediator, Memento, Observer, State, Strategy, Template Method, Visitor | **how responsibility and control flow are divided between objects** |

Per-pattern deep dives live in `references/patterns/<kebab-name>.md`. One file per pattern,
named exactly as the pattern is: `references/patterns/factory-method.md`,
`references/patterns/chain-of-responsibility.md`, `references/patterns/template-method.md`.

## Routing by symptom

Match on **the force in the code**, not the word the user used. Nobody arrives saying
"I need a Strategy".

| What is said | What it usually is |
|---|---|
| "this `if/else` on type keeps growing" | Strategy, or State if the branches also decide what happens next |
| "the constructor takes nine arguments" | Builder |
| "I need to swap the database for tests" | `references/styles/hexagonal.md`, not a pattern |
| "this third-party API has the wrong shape" | Adapter |
| "add logging/caching/retry without touching the class" | Decorator, or Proxy if access control is the point |
| "notify these things when that changes" | Observer, or `references/styles/event-driven.md` if it crosses a process |
| "undo" | Command, plus Memento to hold the snapshot |
| "tree of things where leaves and branches act alike" | Composite |
| "this subsystem is painful to call" | Facade |
| "one shared instance" | Singleton, and read its file before agreeing to it |
| "every new node type means editing every class" | Visitor |
| "these objects all talk to each other, N-to-N" | Mediator |

## Two rules that come from the content

**In TypeScript, the language often already has the pattern.** Several GoF patterns exist
to work around what C++ and Java lacked in 1994. Iterator is `Symbol.iterator`. Strategy
is frequently just a function parameter. Command is often a closure. Singleton is usually a
module-level `const`. Each per-pattern file has a **"Does TypeScript already do this"**
section, and it is the section most worth reading, because the most expensive pattern
mistake is implementing a class hierarchy for something the language gives you free.

**A pattern is a response to a force that is already present.** Applying one to code that
does not yet feel the force adds indirection and buys nothing. `references/selection.md`
covers the overuse smells and the standard criticism of pattern-driven design.

## Step 4: refactoring existing code

Read `references/refactoring.md`. It is smell-first: you arrive with a symptom ("this
function is 400 lines", "this change touched nine files"), not a technique name. It indexes
all **22 code smells** against checkable signals, and routes to a technique group.

**It is not a to-do list.** Refactoring preserves observable behaviour by definition, so it
requires mutation-sensitive tests over the range *first*, and it earns its cost only against
a named pending edit. That file carries the gates and the hard stops; apply them.

Coverage: **complete.** All 22 smells indexed; all **66 techniques** written — composing (9),
moving (8), conditionals (8), data (15), calls (14), generalization (12). Every technique and
pattern has a verified real-world citation in `references/real-world-examples.md`.

## Copyable, tested code

Three patterns ship as working TypeScript with **25 passing tests** (`bun test`,
`tsc --noEmit` clean, Bun 1.3.10). Copy these rather than retyping from the reference
files — the subtle parts are the ones that get dropped.

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/architecture}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool — paste it
mkdir -p src; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/patterns" src/patterns
else echo "SKILL is still the placeholder — paste the real dir above and re-run"; fi
```

| File | Pattern | The part worth not retyping |
|---|---|---|
| `strategy.ts` | Strategy | registry that **throws** on an unknown key instead of falling back to a default, plus `assertNever` for the closed-set case |
| `middleware.ts` | Decorator, Chain of Responsibility, Proxy | `compose` ordering via `reduceRight`; the cache stores **bytes and a promise**, which is what prevents both a stampede and an empty second body |
| `state-machine.ts` | State | typed transition table that **throws** on an illegal transition rather than silently no-opping |

Run `./check-index.sh` after editing this tree; it fails on a promised-but-missing file.

## Scope

Worked examples are TypeScript, verified on Bun. The styles tier is language-agnostic; the
pattern tier's *intent* is language-agnostic but its *code* is not.

For Bun-specific implementation once the shape is decided, the `bunjs` plugin's
`/bunjs:bun` index routes to setup, HTTP, errors, testing, security, production, and
performance. This skill decides *what to build*; that one covers *how to build it on Bun*.
