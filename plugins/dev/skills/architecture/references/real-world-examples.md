# Real-world examples

Every pattern and refactoring in this tree, mapped to **code someone else has publicly
identified as that thing**. Use these instead of the invented before/after pairs where a
reader would recognise the codebase.

## The bar these had to clear

An entry qualifies only if a source **other than this repository** names the pattern or
performs the refactoring, in public, at a URL that resolves. Every one was verified by
opening the artifact: merge status read from the API, diff read, licence **decoded from the
actual file**. Nothing here rests on a search summary.

**Licences are read at the merge ref, not at HEAD.** GitHub's licence field was wrong on 4 of
11 repositories checked, and two projects relicensed *after* the commit cited here. A repo
reporting `NOASSERTION` is often plainly Apache-2.0 or BSD on inspection; a repo reporting a
permissive licence today may not have shipped under it in 2020.

**Copy only from permissive entries.** Marked ⚠️ = cite and link, do not reproduce.

---

## Design patterns

### Creational

| Pattern | Example | Who says so | Licence |
|---|---|---|---|
| **Factory Method** | `bpmn-visualization-js`, `BpmnGraph.ts` @ v0.48.0 | its own source comment: *"mxGraph uses the factory method pattern for initialization"* | Apache-2.0 |
| **Abstract Factory** | Apache Calcite, `RelDataTypeFactory.java` @ calcite-1.40.0 | javadoc links `Glossary#ABSTRACT_FACTORY_PATTERN`, a constant declaring GoF's intent sentence — a **machine-checkable** claim | Apache-2.0 |
| **Builder** | NestJS `@nestjs/swagger`, `lib/document-builder.ts` @ 11.4.6 | chainable `setTitle(): this` plus terminal `build(): Omit<OpenAPIObject,'paths'>` — returns a *different type*, which is what separates Builder from a fluent interface | MIT |
| **Prototype** | `thoughtbot/fishery` | patterns.dev: *"JavaScript turns the pattern on its head"* — GoF Prototype is **cloning**, JS `[[Prototype]]` is **delegation** | MIT |
| **Singleton** | Angular, `packages/core/src/di/r3_injector.ts` @ v22.1.1 | Angular's own docs: *"**Singleton Instance:** Creates a single, shared instance for the entire application"* | MIT |

**Abstract Factory, the recognisable one:** Apple documents class clusters under a heading
literally reading **Abstract Factory**, in a chapter stating *"Only patterns that Cocoa
implements are listed."* ⚠️ Apple docs.

**Builder — the correction worth carrying.** A 149-score Stack Overflow answer distinguishes
them: fluent interfaces are *"semantic facades… about readability"*; a builder is *"about
validation and delegation."* Its counterexample: `SomeObject.setFoo(1).setBar(2)` *"does not
express anything about SomeObject."* **Fowler does not make this distinction** — do not
attribute it to him. ⚠️ CC BY-SA, attribute the author.

**Prototype — do not repeat one clause.** patterns.dev cites "Vitest's `createBuilder`". No
such symbol exists in Vitest. The delegation/cloning framing is sound; that example is not.

### Structural

| Pattern | Example | Who says so | Licence |
|---|---|---|---|
| **Adapter** | axios, `lib/adapters/adapters.js` @ v1.19.0 | **the project names them in code** — `{http, xhr, fetch}` behind one config, each tagged `adapterName` | MIT |
| **Bridge** | QuantLib, `ql/time/calendar.hpp` @ v1.43 | source *and* published docs: *"The Bridge pattern is used to provide the base behavior of the calendar"* | BSD-3 |
| **Composite** | the DOM | refactoring.guru: *"**The HTML DOM tree is an example of such a structure.**"* ⚠️ proprietary | — |
| **Decorator** | Java `java.io.FilterInputStream` @ jdk-21+35 | javadoc: *"wraps some other input stream… possibly transforming the data along the way"* | ⚠️ GPL+Classpath — **describe, never paste** |
| **Facade** | jQuery, `src/ajax.js` @ 3.7.1 | Osmani names the exact functions: *"The following are facades for jQuery's `$.ajax()`: `$.get(…)`, `$.post(…)`"* ⚠️ CC BY-NC-ND | jQuery MIT |
| **Flyweight** | three.js `InstancedMesh.js` @ r170 — one geometry + one material, `count × 16` transforms | patterns.dev, which also names **Tailwind**: `p-4` exists once, millions of elements point at it | MIT |
| **Proxy** | Vue 3, `packages/reactivity/src/baseHandlers.ts` @ v3.5.13 | classes named `…ReactiveHandler implements ProxyHandler<T>`, feeding a literal `new Proxy(…)` | MIT |

**Bridge — the finding behind the finding.** The most-cited catalogue of GoF patterns in
Java's core libraries says *"None comes to mind yet"* and invents a fictitious example. It was
wrong: **Java AWT's `Component`/`ComponentPeer` is Bridge**, listed under Known Uses in
Douglas Schmidt's GoF overview, with `XComponentPeer`/`WComponentPeer`/`LWComponentPeer` as
implementations. The reason nobody found it: **`"Bridge pattern"` appears zero times in all of
OpenJDK.** The Javadoc describes the structure — *"the 'glue' that joins the platform-independent
classes in `java.awt` with their counterparts in `java.awt.peer`"* — and never names it.
A label-recall search cannot find an unlabelled instance. Also self-identified: `aima-java`
(Russell & Norvig's companion code, MIT).

**Bridge — do not use PIMPL.** Wikipedia calls it Bridge; **Herb Sutter says it is not**:
*"that's a different pattern with a different motivation than Pimpl."* Prefer the
two-hierarchy cases above.

**Composite traps.** React's `ReactCompositeComponent` is a **naming coincidence** — "composite"
there means user-defined vs host component. The WHATWG DOM Standard, MDN and Wikipedia's DOM
article contain **zero** occurrences of "composite". Apple's Cocoa docs do say the view
hierarchy *"adapts the Composite pattern"* — official, but not web.

### Behavioral

| Pattern | Example | Who says so | Licence |
|---|---|---|---|
| **Chain of Responsibility** | `fin-hypergrid/core`, `src/features/Feature.js` @ v3.3.2 | source: *"connected to one another to make a chain of responsibility for handling all the input"*, with a real `setNext` | MIT |
| **Command** | Meta's Lexical, `AGENTS.md` | *"**Command Pattern** — Commands are the primary communication mechanism"*, added by a co-creator | MIT |
| **Iterator** | *Node.js Design Patterns* companion repo, `09-behavioral-design-patterns/05-iterator-iterable-matrix/` | the authors state the GoF framing on their own site; **the directory names are the attribution** | MIT |
| **Mediator** | `@foblex/mediator` | README: *"implements the mediator pattern, providing a centralized way to handle requests"* | MIT |
| **Memento** | Spring Web Flow, `StateManageableMessageContext.java` | *"State management employs the GOF Memento pattern"* — and names the **caretaker** role | Apache-2.0 |
| **Observer** | RxJS | reactivex.io: *"It extends the observer pattern…"*, *"…the **Gang of Four's** Observer pattern"* | **Apache-2.0**, not MIT |
| **State** | three.js, `src/animation/PropertyBinding.js` @ r185 | *"This class uses a State pattern on a per-method basis"* | MIT |
| **Strategy** | `Array.prototype.sort(comparator)` | via Java's `Comparator#compare`, the canonical citation ⚠️ CC BY-SA | — |
| **Template Method** | *Node.js Design Patterns* repo, `03-template-multiformat-config` | the authors identify it; `_serialize()`/`_deserialize()` throw until implemented | MIT |
| **Visitor** | ESLint rules — `{ DebuggerStatement(node){} }` | ESLint's own repo: *"Rules use the visitor pattern to analyze JavaScript AST nodes"* — **authored by Nicholas Zakas**, ESLint's creator | MIT |

**Chain of Responsibility, non-middleware and permissive:** `18F/analytics-reporter` (behind
analytics.usa.gov) — *"Parent class for actions in a chain of responsibility pattern."*
**US Government public domain + CC0** — the most permissive source in this file.

**State — the finding is the shape, not the citation.** three.js has *no state classes*. It
swaps **method references** on the instance. That is Norvig's first-class-functions absorption
visible in production. Corroborating negative: **zero** npm packages claim GoF State, patterns.dev
has **no State page**, and nine major JS repos have zero hits. `appifi` documents *rejecting* it:
*"Standard State Pattern in GoF book. We don't use this pattern either for it has two layers of objects."*

**Memento — the trade-off, stated by a developer:** `pdfarranger` (⚠️ GPL-3.0):
*"The memento pattern is **simpler than the command pattern**. Here the memory cost of memento is
affordable because we only store snapshots of the GtkListStore object, not of the whole PDF files."*
Snapshots win when the snapshot is small — which is why everyone else stores inverse operations.
A game engine documents the opposite call: *"Implementing a global undo and redo with Memento
pattern proved too difficult, so I implemented it with this pattern instead."*
JS example that does store snapshots: `fin-hypergrid` `setState`, `@see [Memento pattern]`, MIT.

**Template Method — do NOT cite Node streams.** The full 867 KB of `nodejs.org/api/stream.html`
contains **zero** occurrences of "template". The mechanics are textbook; the name is never used.

**Visitor — the honest caveat.** **Not one** JS/TS "visitor" does double dispatch; they are all
keyed-callback traversal with no `accept`. So the claim is "maintainers call it Visitor", not
"this is GoF Visitor". Bob Nystrom attacks the confusion directly: *"Many think the pattern has
to do with traversing trees, which isn't the case at all."* ⚠️ CC BY-NC-ND prose. Microsoft's own
wiki says `forEachChild` *"**subsumes** the visitor pattern"* — subsumes, not is.

---

## Refactoring techniques

Diff sizes are `+added/−removed`. All merged, all human-authored (every PR predates 2023 or
was verified by author account), all licences decoded.

### Composing Methods

| # | Technique | PR | Diff | Licence |
|---|---|---|---|---|
| 1 | Extract Method | `microsoft/TypeScript#25518` | +23/−34, 1f | Apache-2.0 |
| 2 | Inline Method | `solana-labs/solana#29305` | +2/−15, 1f | Apache-2.0 |
| 3 | Extract Variable | `aws/aws-cdk#23173` | +3/−2, 1f | Apache-2.0 |
| 4 | Inline Temp | `vuejs/core#401` | +1/−2, 1f | MIT |
| 5 | Replace Temp with Query | `docker/cli#3764` | +5/−6, 1f | Apache-2.0 |
| 6 | Split Temporary Variable | `Kong/deck#290` | +23/−14, 3f | Apache-2.0 |
| 7 | Remove Assignments to Parameters | `ReactiveX/rxjs#5234` | +25/−3, 2f | Apache-2.0 |
| 8 | Replace Method with Method Object | `swiftlang/swift#22610` | +766/−723, 2f | Apache-2.0 |
| 9 | Substitute Algorithm | `manifoldmarkets/manifold#1294` | +13/−13, 10f | MIT |

**Best for teaching:** `#25518` does **three techniques in one 30-line diff** — extracts a
25-line switch into a named predicate, collapses a nested `if`, and renames a variable.

**Three of these are bug fixes, not tidying** — which is why they were hard to find:
- Extract Variable: a test evaluated the same expression twice and **flaked on a 1 ms drift**.
- Split Temporary Variable: one set of package vars backed two commands; the CLI framework
  overwrote whichever ran last.
- Remove Assignments to Parameters: `fromFetch` reassigned a **closed-over** parameter, so a
  second subscriber got a pre-aborted signal. Title: *"fix: don't reassign closed-over parameter"*.

`swift#22610` states the contract outright: *"It also turned out to clean up several kinds of ad
hoc local state. **No functionality change.**"*

### Moving Features Between Objects

| # | Technique | PR / source | Diff | Licence |
|---|---|---|---|---|
| 1 | Move Method | `ripple/explorer#326` — verified **relocated**, not new | +20/−19, 3f | MIT |
| 2 | Move Field | `elastic/elasticsearch#28341` | +64/−71, 10f | Apache-2.0 *at merge* |
| 3 | Extract Class | `symfony/symfony#45553` — show the donor file only | +408/−65 (donor +8/−54) | MIT |
| 4 | Inline Class | `googleapis/google-cloud-java#5511` | +51/−75, 2f | Apache-2.0 |
| 5 | Hide Delegate | `rails/rails#10142` | +16/−9, 2f | MIT |
| 6 | Remove Middle Man | `gradle/gradle#3369` | +357/−699, 30f | Apache-2.0 |
| 7 | Introduce Foreign Method | **`date-fns`** | — | MIT |
| 8 | Introduce Local Extension | Vue `ComponentCustomProperties` @ v3.5.41 | 26 lines | MIT |

**Introduce Foreign Method is the most satisfying entry in this file.** Fowler's own 1999
example is a free function that adds a day to a `Date`. That is `date-fns`' `addDays`, exactly
— and date-fns states it as a design principle: *"**Native dates**: Uses existing native type.
It doesn't extend core objects for safety's sake."* Moment.js then retired itself and pointed
users there. Meanwhile TypeScript declared the ergonomic version out of scope — *"compiling to
simple JS simply makes it impossible"* — and the TC39 proposals that would fix it sit at
stages 2, 1 and 0, the last presented in 2015. **The technique became so universal nobody
names it.**

**Extract Class has 4,296 merged PRs named after it and not one fits on a page.** Every real
instance runs 200+ lines, because a new class means a new file, constructor, imports and tests.

### Simplifying Conditional Expressions

| # | Technique | PR | Diff | Licence |
|---|---|---|---|---|
| 1 | Decompose Conditional | `snyk/kubernetes-monitor#469` | +24/−11, 2f | Apache-2.0 |
| 2 | Consolidate Conditional Expression | `microsoft/TypeScript#25518` | see above | Apache-2.0 |
| 3 | Consolidate Duplicate Conditional Fragments | `ZcashFoundation/zebra#2013` | +2/−5, 1f | MIT/Apache-2.0 |
| 4 | Replace Nested Conditional with Guard Clauses | `actions/cache#1013` | +26/−27, 3f | MIT |
| 5 | Replace Conditional with Polymorphism | `mapbox/mapbox-gl-native#2730` | +648/−535, 40f | BSD-2 |
| 6 | Remove Control Flag | `bitcoin/bitcoin#22789` | +6/−6, 1f | MIT |
| 7 | Introduce Null Object | `ember-cli/ember-cli#503` | +11/−2, 3f | MIT |
| 8 | Introduce Assertion | `facebook/lexical#3399` | +38/−15, 5f | MIT |

**Guard clauses — the author wrote the rule before applying it:** *"Return early is the way of
writing functions so that the expected positive result is returned at the end of the function
and the rest of the code terminates the execution when conditions are not met."*

**Remove Control Flag — Bitcoin's body names Fowler's exact force without citing him:**
*"breaking out of a nested loop is simply not possible — at least not without adding ugly
constructs like gotos or **extra state variables**. This PR fixes this by using `std::any_of`."*
Also available: a PR literally titled *"Remove loop flag in favour of break statement"*, +2/−4
— the smallest diff in this file. ⚠️ OSL-3.0, copyleft.

⚠️ **The dominant real-world failure mode:** developers add a `break` and **leave the flag
declared**. That outnumbers true Remove Control Flag ~10:1. Read the diff every time.

**Consolidate Duplicate Conditional Fragments** shows *both* directions in one hunk — common
prefix hoisted above the `if`, common suffix dropped below. And a linter does detect it:
*"clippy nightly has a new lint that finds identical prefixes and suffixes in if-else blocks."*

**Replace Conditional with Polymorphism** — body: *"replacing `switch` or `template`
polymorphism with good old type polymorphism."* Six new subclasses, tagged-union typedef
deleted, a 9-line `switch` replaced by virtual overrides. A lookup-table variant also exists
(`appsmithorg/appsmith#11228`, Apache-2.0): *"we are simply returning or using cases for
one-to-one mapping. This PR brings that 1-1 mapping to a lookup table."*

### Organizing Data

| # | Technique | PR / source | Diff | Licence |
|---|---|---|---|---|
| 1 | Replace Magic Number with Symbolic Constant | `microsoft/vscode#233562` | +4/−3, 1f | MIT |
| 2 | Self Encapsulate Field | **obsolete** — see below | — | — |
| 3 | Encapsulate Field | **obsolete** — see below | — | — |
| 4 | Encapsulate Collection | `apollographql/apollo-client#9339` | +34/−25, 7f | MIT |
| 5 | Replace Data Value with Object | `trpc/trpc#1920` | +4/−1, 1f | MIT |
| 6 | Replace Array with Object | TypeScript Handbook, Tuple Types | — | ⚠️ CC BY-4.0 |
| 7 | Replace Type Code with Class | `trpc/trpc#1920` | see above | MIT |
| 8 | Replace Type Code with Subclasses | `mapbox/mapbox-gl-native#2730` | see above | BSD-2 |
| 9 | Replace Type Code with State/Strategy | `JsonMapper/JsonMapper#119` | +404/−49, 19f | MIT |
| 10 | Replace Subclass with Fields | `pantsbuild/pants#5648` | +61/−98, 16f | Apache-2.0 |
| 11 | Change Value to Reference | `thanos-io/thanos#5926` | +83/−32, 9f | Apache-2.0 |
| 12 | Change Reference to Value | `kyverno/kyverno#5523` | +538/−470, 30f | Apache-2.0 |
| 13 | Change Unidirectional → Bidirectional | TypeORM relations docs | ~30 lines | MIT |
| 14 | Change Bidirectional → Unidirectional | MDN "cyclic object value" | — | ⚠️ CC BY-SA |
| 15 | Duplicate Observed Data | **obsolete** — see below | — | — |

**Three of these are obsolete in TypeScript, with hard citations:**
- **Self Encapsulate / Encapsulate Field** — Google's TypeScript Style Guide makes the output a
  **must-not**: *"At least one accessor for a property must be non-trivial: **do not define
  pass-through accessors only for the purpose of hiding a property**."* Replaced by `readonly`,
  `private`, and constructor parameter properties. Nuance: Fowler himself never endorsed
  getter-eradication — *"the point of encapsulation isn't really about hiding the data, but in
  hiding design decisions."*
- **Duplicate Observed Data** — React's docs mark the result `// 🔴 Avoid: redundant state and
  unnecessary Effect`. One-way reactive rendering dissolved the premise.

**Replace Subclass with Fields is the textbook shape** — two subclasses differing only in the
data they carried are deleted, the base gains one field, and every `type(x) is …` dispatch chain
collapses to a line. Body: *"the split is no longer necessary… merge the two subclasses."*

**Change Value to Reference surfaces as "interning"** — many equal copies collapsing to one
shared instance. Nobody calls it by the catalogue name.

**Change Bidirectional → Unidirectional: the premise moved.** The memory-leak motivation is
**dead** (modern GC handles cycles). The **serialization** motivation is alive — MDN's cyclic-object
error page describes this exact refactoring, unnamed, as the remedy. And **Prisma forbids it
outright** (every relation needs both ends), defusing the cost instead: relation fields *"do not
exist in the database."* Designed away rather than refactored away.

### Simplifying Method Calls

| # | Technique | PR / source | Diff | Licence |
|---|---|---|---|---|
| 1 | Rename Method | React `UNSAFE_` lifecycle rename + codemod | 3-phase | MIT |
| 2 | Add Parameter | `DataDog/browser-sdk#1079` | +40/−8, 6f | Apache-2.0 |
| 3 | Remove Parameter | `mantinedev/mantine#2416` | +7/−8, 3f | MIT |
| 4 | Separate Query from Modifier | TC39 change-array-by-copy (ES2023) | — | — |
| 5 | Parameterize Method | `carbon-language/carbon-lang#1290` | +7/−52, 1f | Apache-2.0 + LLVM |
| 6 | Replace Parameter with Explicit Methods | `godotengine/godot#44514` | +221/−190, 28f | MIT |
| 7 | Preserve Whole Object | `icflorescu/trpc-sveltekit#13` | +3/−2, 2f | ISC |
| 8 | Replace Parameter with Method Call | `streamlit/streamlit#5484` | +14/−18, 3f | Apache-2.0 |
| 9 | Introduce Parameter Object | DOM `addEventListener` options | — | — |
| 10 | Remove Setting Method | `open-telemetry/opentelemetry-python#1536` | +2/−5, 2f | Apache-2.0 |
| 11 | Hide Method | `cs3org/reva#3204` | +15/−3, 2f | Apache-2.0 |
| 12 | Replace Constructor with Factory Method | Node `Buffer()` → `Buffer.from()` | — | MIT |
| 13 | Replace Error Code with Exception | `tediousjs/tedious#1230` | +159/−138, 31f | MIT |
| 14 | Replace Exception with Test | **counterexample** — see below | — | — |

**Separate Query from Modifier is a language feature.** `Array.prototype.sort` both mutates and
returns; `toSorted` is the pure query. Shipped ES2023. Every reader has hit this.

**Introduce Parameter Object — the detail that makes it.** `addEventListener`'s third argument
went from a bare boolean to an options object, and `once`, `passive` and `signal` **could not
have been expressed positionally at all.** The refactoring didn't tidy a signature, it unlocked
capabilities.

**Replace Constructor with Factory, three motives:** Node's `Buffer()` → `Buffer.from()` was
driven by **security** (*"API usability issues that can lead to accidental security issues"*);
React 18's `createRoot`; and Vue 3's `createApp`, with the clearest reason — *"Every root
instance created from the same Vue constructor **shares the same global configuration**."*

**Hide Method — in Go it is a capital letter.** `FlockFile` → `flockFile`, with the reason:
*"This function should rather be private to not be 'misused' from outside the module."* The
changelog entry is better still: *"Having that function exported is tempting people to use the
func… That is wrong."*

**Replace Parameter with Method Call — the phrasing runs the other way.** The title is *"Use
`get_running_loop` instead of passing in the eventloop as an arg."* Callers don't stop needing
the value; the callee starts deriving it. The test diff shows the cost — a plain constructor
argument becomes a patched global.

**Replace Exception with Test — the catalogue is wrong here, and Node says so.** Its `fs` docs
ship a block labelled **"NOT RECOMMENDED"**: *"Do not use `fs.access()` to check for the
accessibility of a file before calling `fs.open()`… Doing so introduces a race condition."*
A verified counterexample beats another supporting one: the technique has a hard precondition
(no TOCTOU window).

**Replace Error Code with Exception — the payoff is visible in the types.** Playwright's version
(`microsoft/playwright#10451`, Apache-2.0) changes a return type from `{result?, error?}` to just
the result, and at the call site the non-null assertion `result.response!` **disappears too**.
The refactoring removed a lie the type system had been tolerating.

### Dealing with Generalization

| # | Technique | PR / source | Diff | Licence |
|---|---|---|---|---|
| 1 | Pull Up Field | `cakephp/cakephp#16298` | +19/−40, 5f | MIT |
| 2 | Pull Up Method | `django/django#9174` | +83/−24, 9f | BSD-3 |
| 3 | Pull Up Constructor Body | `plantuml/plantuml#665` | +20/−32, 4f | ⚠️ LGPL-3.0 |
| 4 | Push Down Field | `aspnetboilerplate#4678` | +18/−20, 4f | MIT |
| 5 | Push Down Method | `sequelize/sequelize#12217` | +4152/−3446, 55f | MIT |
| 6 | Extract Subclass | `batfish/batfish#8199` — `new file mode` verified | +463/−511, 26f | Apache-2.0 |
| 7 | Extract Superclass | `flutter/flutter#5889` — `new file mode` verified | +46/−13, 8f | BSD-3 |
| 8 | Extract Interface | OpenTelemetry JS, `api/src/trace/tracer.ts` | ~30 lines | Apache-2.0 |
| 9 | Collapse Hierarchy | `mozilla/pdf.js#15414` — `deleted file mode` | +2266/−2270, 8f | Apache-2.0 |
| 10 | Form Template Method | `apache/hudi#4417` | +226/−268, 6f | Apache-2.0 |
| 11 | Replace Inheritance with Delegation | Abramov, *Mixins Considered Harmful* + Node `Duplex` | — | MIT |
| 12 | **Replace Delegation with Inheritance** | `hibernate/hibernate-tools#3771` — **a revert** | +15/−106, 2f | Apache-2.0 |

**`django#9174` shows Pull Up Field, Method and Constructor Body in one readable diff.** Best
single teaching example in the group.

**Entry 12 is the most interesting in this file.** Fowler **deleted** this technique while
keeping *and renaming* its inverse, then **added a second** delegation-ward refactoring. Both
major Java IDEs ship the delegation direction; neither ships this one. Kotlin (`by`), Go
embedding, Rust `delegate!` and Lombok all solved the forwarding-boilerplate problem with *more*
delegation. TypeScript declined to build it — issue closed *"Out of Scope."*

Across ~430 title matches, exactly one real instance exists, and **it is a revert**: the same
project applied *Replace Inheritance with Delegation*, then eleven PRs later the same author
undid it. The delegation version's damage is visible downstream — clients forced into reflection
to unwrap the field. **That is the oscillation warning in `refactoring.md`, documented in the
wild, in the one technique everyone assumed was dead.**

**Extract Interface is alive in TypeScript even though Fowler dropped it** — he dropped it
because JavaScript has no interfaces. OpenTelemetry runs it at package scale: `@opentelemetry/api`
declares, the SDK implements, with `NoopTracer`/`ProxyTracer` beside it.

---

## Method notes — how these were found, and how to find more

**Search the code shape *after* the change, never the catalogue name.** This is the whole
technique. Nobody titles a PR "Inline Temp". Four agents searching catalogue names concluded most
of these were unfindable; the same targets fell immediately to effect-search. Every winning query
described the result — *"split into two methods"*, *"make X private"*, *"behind a getter"*.

**Sharper form, for the hardest cases: search the construct that absorbed the pattern.** Nobody
removes a control flag by adding `break` any more — they delete the loop in favour of `any_of` /
`some` / `Any`. Querying `"use std::any_of"` returned five results, two of them the technique.

**Filters that work:** `in:title` only (full-text is polluted — one library's changelog flooded
results with dependency bumps); `created:<2023-01-01` (guarantees human authorship — ~96% of
recent matches on these terms are agent-generated PRs in zero-star repos).

**Eight refactoring names have had their vocabulary captured by other domains.** Searching them
returns noise, not absence:

| Word | Now owned by |
|---|---|
| flag | command-line arguments |
| push down | database query optimisation |
| enrich / enrichment | observability pipelines |
| derived fields | Grafana, ORM computed columns |
| hydrate | server-side rendering |
| computed | Vue properties, Terraform schema flags |
| field instead of | ORM / search-index field selection |
| method object | JavaScript `Object` methods |

**Tooling that lies, all encountered here:**
- `gh search prs` **silently mangles** `in:title "quoted phrase"`. Use `gh api -X GET search/issues --field q=…`.
- Malformed GitHub queries return **empty sets, not errors** — an empty result proves nothing
  unless a control query returned non-zero.
- Summarizing fetches **fabricated citations three times**, once inventing a Wikipedia sentence
  that does not exist. Fetch raw and grep.
- Some archives return **HTTP 200 with a bot-challenge page**. The 200 is a trap.
- GitHub's licence field: wrong on 4 of 11 repos checked.

**"Verified absent" is a claim that kept failing.** Seven techniques were declared absent by
agents that had genuinely searched — Bridge, Abstract Factory, Memento, Hide Method, Replace
Parameter with Query, Remove Control Flag, Replace Delegation with Inheritance. **All seven were
later found.** Treat an absence verdict as a hypothesis about vocabulary, not about the world.

**One belief with no source.** "Discriminated unions replaced class hierarchies in TypeScript" is
universally held and **stated by nobody**. All 133 TypeScript doc files were grepped; the only
union-vs-hierarchy sentence sits on a **deprecated** page and is about `string | number`.
Microsoft says it for **F#**, hedged. Wadler's expression problem and Fowler's own catalogue —
which runs the transformation **both ways** — frame it as a symmetric trade-off. The one page
stating it plainly is an unbylined marketing page, and search engines quote it back as consensus.
