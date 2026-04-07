# Sin Registry — Code Roasting Pattern Database

> 182 patterns across 8 languages + universal categories. Each entry: ID, Name, Severity, Detection method, Roast line, Fix hint.

## Severity Scale

| Severity | Analog | Impact | Priority |
|----------|--------|--------|----------|
| **CAPITAL** | System-destroying | Crash, data loss, security breach | P0 — fix NOW |
| **FELONY** | Silent corruption | Memory leaks, deadlocks, data corruption | P1 — fix today |
| **CRIME** | Correctness bug | Wrong results, severe perf, untestable | P2 — fix this sprint |
| **MISDEMEANOR** | Readability harm | Minor perf, style, maintainability | P3 — fix when touched |
| **PARKING TICKET** | Convention nit | Style violation, minor convention | P4 — note for later |
| **SLOP** | AI-generated tell | Hallucinations, narrative code, style drift | P2 — review and rewrite |

---

## Go (21 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| GO-01 | Ignored Error Return Values | FELONY | `errcheck -json ./...`; grep `, _)` on error-returning funcs | "Congratulations, you've invented Schrodinger's File -- it's both open and corrupted until production explodes." | Handle all error returns explicitly |
| GO-02 | Goroutine Leak via Abandoned Channel | FELONY | `goleak` in tests; `runtime.NumGoroutine()`; pprof goroutine profiles | "Your service has more ghost goroutines than a haunted house has ghosts. Memory goes in, nothing comes out." | Use context cancellation, WaitGroup, or done channels |
| GO-03 | Context Not Propagated | FELONY | `contextcheck` linter; grep for `context.Background()` inside functions that receive ctx | "You accepted a context.Context like a responsible adult, then immediately threw it in the trash like a context.Teenager." | Pass received ctx through the call chain |
| GO-04 | defer in Loop | CRIME | `revive` linter `defer-in-loop`; `gocritic` | "Nice loop. You've invented a file descriptor collection hobby. By iteration 1024 you'll get a free kernel panic." | Move defer outside loop or use explicit close inside |
| GO-05 | Naked Return in Long Function | MISDEMEANOR | `nakedret` linter (flags naked returns in functions over N lines) | "Named return values + naked returns: the passive-aggressive note of Go code. 'I'm returning something, figure out what.'" | Use explicit return values in functions >5 lines |
| GO-06 | Stuttering Package Names | PARKING TICKET | `golint` / `revive` stutter detection | "user.UserService: for when you want callers to know you've never read the Go spec, twice." | Remove package name from type name |
| GO-07 | init() for Side Effects | CRIME | `gochecknoinits` linter; grep for `^func init()` | "Your init() function does more work than most developers. Shame it can't handle errors or be tested." | Move initialization to explicit Setup() functions |
| GO-08 | Empty Interface as Parameter | CRIME | `gocritic` hugeParam/typeAssert; grep for `interface{}` / `any` in func signatures | "Congratulations, you've used Go's type system as a suggestion box. Enjoy your runtime panics." | Use concrete types or constrained generics |
| GO-09 | Mutex Copied by Value | CAPITAL | `go vet` copylock analyzer; `staticcheck` SA2001 | "You copied a mutex. You have discovered a new form of deadlock that only exists in parallel universes -- including yours." | Pass mutex by pointer; embed *sync.Mutex |
| GO-10 | String Concatenation in Loop | MISDEMEANOR | `gocritic` stringConcatSimplify; grep for `+=` on strings in loops | "Your string loop has O(n^2) complexity. Your computer called and said it needs a vacation." | Use strings.Builder |
| GO-11 | Returning Pointer to Local Unnecessarily | PARKING TICKET | `go build -gcflags='-m'` escape analysis | "You returned a pointer to a 3-field struct. The GC sends its regards... often." | Return value types for small structs |
| GO-12 | Panic in Library Code | FELONY | `revive` panic-in-library-code; grep for `panic(` in non-main packages | "Your library panics on bad input. That's not a library, that's a grenade with a JSON parser." | Return errors instead of panicking |
| GO-13 | Slice Append Without Pre-allocation | MISDEMEANOR | `prealloc` linter; review for-range loops with append | "You know the slice size ahead of time but let Go guess. Your RAM is donating to the GC charity." | Use make([]T, 0, knownLen) |
| GO-14 | Sentinel Error Misuse | CRIME | `errorlint` linter; grep for `err.Error() ==` patterns | "You're comparing errors by their string value. I hope your error messages never change. Spoiler: they will." | Use errors.Is() and sentinel error variables |
| GO-15 | Wrapping Errors Without %w | CRIME | `errorlint` errorf check; grep for `fmt.Errorf.*%v.*err` | "You used %v to wrap an error. Your error chain just became a dead end. Good luck with errors.Is()." | Use %w instead of %v in fmt.Errorf |
| GO-16 | Unbounded Goroutine Creation | FELONY | grep for `go ` in for loops; absence of `semaphore`, `errgroup` | "You spawn one goroutine per item. At 100k items, your server doesn't crash -- it transcends." | Use errgroup or semaphore to bound concurrency |
| GO-17 | interface{}/any in Struct Fields | CRIME | grep for `interface{}` / `any` in struct field definitions | "Your struct has an interface{} Payload field. That's not flexibility, that's a grab bag of future panics." | Use typed fields or generics |
| GO-18 | HTTP Response Body Not Drained | MISDEMEANOR | `bodyclose` linter | "You forgot to drain the response body. Your connection pool is now a connection cemetery." | io.Copy(io.Discard, resp.Body) before Close() |
| GO-19 | Global Variables for Configuration | CRIME | `gochecknoglobals` linter | "Global mutable variables: making your tests flaky since the dawn of Go." | Pass config as dependency injection |
| GO-20 | Type Assertion Without ok Check | CRIME | `go vet`; `gocritic` typeAssertChain | "You asserted the type without checking ok. Bold choice. Your panic handler will appreciate the business." | Use val, ok := x.(Type) pattern |
| GO-21 | WaitGroup.Add After Go | CAPITAL | `go vet` govet/waitgroup | "You called wg.Add inside the goroutine. Your WaitGroup has given up waiting. Honestly, relatable." | Call wg.Add BEFORE launching the goroutine |

**Primary tool**: `golangci-lint run ./... --out-format json`

---

## Java (22 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| JAVA-01 | Raw Types Usage | CRIME | `javac -Xlint:unchecked`; SpotBugs; Checkstyle | "Raw types in 2024. You're not writing Java, you're writing 2004 Java with extra steps." | Use parameterized generics |
| JAVA-02 | NullPointerException via Missing null Checks | FELONY | SpotBugs NP_*; NullAway; IntelliJ @Nullable | "Your NullPointerException is not a bug, it's a surprise party your code throws for your users." | Use Optional, @Nullable annotations, or null checks |
| JAVA-03 | Empty Catch Block | FELONY | Checkstyle EmptyCatchBlock; SpotBugs DE_MIGHT_IGNORE; PMD EmptyCatchBlock | "Empty catch block: where exceptions go to die quietly, and your career goes to follow them." | Log or rethrow; never swallow silently |
| JAVA-04 | equals() Without hashCode() | CAPITAL | SpotBugs HE_EQUALS_NO_HASHCODE; ErrorProne | "You overrode equals but not hashCode. Your HashMap now has the consistency of a coin toss." | Always override both together |
| JAVA-05 | Checked Exception Abuse | CRIME | PMD SignatureDeclareThrowsException | "Your method throws 4 checked exceptions. Your callers need a PhD in your implementation details just to call you." | Use unchecked exceptions or wrap in domain exception |
| JAVA-06 | Optional.get() Without isPresent() | CRIME | Checker Framework optional-checker; IntelliJ | "Optional: A class designed to prevent NPEs. You found a way to cause them anyway." | Use orElse(), orElseThrow(), or map() |
| JAVA-07 | String Concatenation in Loop | CRIME | PMD InefficientStringBuffering; Checkstyle | "String concatenation in a loop. Your JVM's GC called. It's filing for overtime." | Use StringBuilder |
| JAVA-08 | finalize() Override | FELONY | PMD EmptyFinalizer; SpotBugs FI_* | "You used finalize(). The JVM will get around to cleaning up your mess. Eventually. Maybe." | Use try-with-resources or Cleaner API |
| JAVA-09 | N+1 Query (Hibernate/JPA Lazy Loading) | CAPITAL | Hibernate Statistics; p6spy; Hypersistence Optimizer | "Your service executes 1001 queries to load 1000 orders. Your DBA just sent you a cease and desist." | Use JOIN FETCH, EntityGraph, or batch-size |
| JAVA-10 | Synchronizing on Non-Final Field | CAPITAL | SpotBugs DL_SYNCHRONIZATION_ON_UNSHARED_OBJECT; ErrorProne | "You synchronized on a mutable field. That's not a lock, that's a revolving door." | Synchronize on a private final field |
| JAVA-11 | Using == to Compare Strings | CRIME | SpotBugs ES_COMPARING_STRINGS_WITH_EQ; Checkstyle | "Using == for strings is like judging book identity by the shelf it's on. Works until you move a book." | Use .equals() or Objects.equals() |
| JAVA-12 | Stream.forEach() with External Mutation | CRIME | PMD ForLoopCanBeForeach; IntelliJ Stream inspection | "You used forEach to mutate a list. That's a for-loop in a tuxedo. Dress code violated." | Use collect(), reduce(), or a plain for-loop |
| JAVA-13 | Catching Exception or Throwable | FELONY | PMD AvoidCatchingGenericException; Checkstyle | "catch(Exception e): the programming equivalent of 'it's fine, everything is fine.'" | Catch specific exception types |
| JAVA-14 | Spring Circular Bean Dependencies | CRIME | Spring startup exception; ArchUnit cycle detection | "A depends on B. B depends on A. Your Spring context is now an infinite loop dressed as a service." | Refactor with events, lazy injection, or redesign |
| JAVA-15 | Resource Leak Without try-with-resources | FELONY | SpotBugs OBL_UNSATISFIED_OBLIGATION; PMD CloseResource | "Your database connection pool called. It's exhausted and considering early retirement." | Use try-with-resources for AutoCloseable |
| JAVA-16 | Mutable Public Fields in Data Classes | CRIME | Checkstyle VisibilityModifier; PMD DataClass | "Public mutable fields. Your class is less a data structure and more a suggestion." | Use records or private fields with accessors |
| JAVA-17 | instanceof Without Pattern Matching | MISDEMEANOR | IntelliJ 'Pattern variable can be used' inspection | "You wrote instanceof followed by a cast in Java 21. Your JDK is current but your knowledge isn't." | Use pattern matching: if (obj instanceof String s) |
| JAVA-18 | God Service / God Object | CRIME | PMD GodClass; Checkstyle ClassFanOutComplexity; ArchUnit | "Your UserService also processes payments and generates reports. It's not a service, it's a confession." | Extract focused services by domain responsibility |
| JAVA-19 | Premature Object Pooling | MISDEMEANOR | Code review; profiling | "You wrote an object pool for StringBuilder. The JVM handles 1GB/s of garbage. Your pool is not the hero here." | Trust the JVM GC; pool only proven bottlenecks |
| JAVA-20 | Using java.util.Date Instead of java.time | CRIME | grep for `import java.util.Date`; SpotBugs | "You used java.util.Date in 2024. Java.time was released in 2014. A decade ago." | Migrate to java.time (LocalDate, Instant, etc.) |
| JAVA-21 | Returning null from Collection Methods | CRIME | NullAway; Checker Framework; IntelliJ @NotNull | "You returned null from a method that should return a list. Every caller now inherits your NPE optimism." | Return Collections.emptyList() or Optional |
| JAVA-22 | Reflection in Hot Paths | CRIME | Profiler (JFR, YourKit); grep for `getClass().getMethod()` | "You used reflection in a hot path. Your CPU called. It said it misses compile-time dispatch." | Cache reflected methods or use code generation |

**Primary tool**: `spotbugs -textui -xml:withMessages -output report.xml classes/` or `mvn spotbugs:check`

---

## C# (22 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| CSHARP-01 | async void Methods | CAPITAL | Roslyn AsyncFixer; AsyncAnalyzer | "async void: where exceptions go to crash your app in ways you'll never reproduce in development." | Use async Task; reserve async void for event handlers only |
| CSHARP-02 | .Result or .Wait() on Tasks (Deadlock) | CAPITAL | AsyncifyAnalyzer; Roslyn VSTHRD002; ConfigureAwaitChecker | ".Result in an ASP.NET context. You've invented a self-defeating threading pattern. Deadlock incoming." | Use await; propagate async all the way up |
| CSHARP-03 | Missing ConfigureAwait(false) in Libraries | CRIME | ConfigureAwaitChecker.Analyzer; Roslyn CA2007 | "Missing ConfigureAwait(false) in library code. You've made your library compatible with all contexts except the ones people use." | Add ConfigureAwait(false) in library code |
| CSHARP-04 | IDisposable Not Disposed | FELONY | Roslyn CA2000; IDisposableAnalyzer | "You forgot to dispose your HttpClient. Your socket pool has filed for emancipation." | Use `using` statement or `using` declaration |
| CSHARP-05 | Multiple Enumeration of IEnumerable | CRIME | Roslyn PossibleMultipleEnumeration; ReSharper/Rider | "You enumerated an IEnumerable twice. Your database query just ran twice. Your DBA noticed." | Materialize to list/array first, or restructure |
| CSHARP-06 | Event Handler Memory Leaks | FELONY | Memory profilers (dotMemory); code review | "You subscribed to an event and never unsubscribed. Your forms now live forever. Not a feature." | Unsubscribe in Dispose or use weak events |
| CSHARP-07 | string + in Loop Instead of StringBuilder | CRIME | Roslyn CA1845; CA1844 | "String concatenation in a foreach. You've written an O(n^2) loop with extra style." | Use StringBuilder or string.Join() |
| CSHARP-08 | Not Passing CancellationToken | CRIME | Roslyn CA2016; AsyncAnalyzer | "No CancellationToken. Your async operation runs until it's done, regardless of whether anyone still cares." | Accept and propagate CancellationToken |
| CSHARP-09 | Mutable Struct Anti-Pattern | FELONY | Roslyn analyzer; CA1815; FxCop | "Mutable struct. You mutated a copy and wondered why the original didn't change. A classic." | Make structs readonly or use classes |
| CSHARP-10 | LINQ ToList() Inside Loop | CRIME | Code review; profiling; custom Roslyn analyzer | "LINQ .ToList() inside a loop. Your O(n^2) algorithm has a functional programming aesthetic now." | Materialize once outside the loop |
| CSHARP-11 | Dynamic Type Abuse | CRIME | Roslyn CS8358; custom analyzer for dynamic frequency | "You used dynamic in C#. You bought a statically typed language and returned the type system." | Use generics, interfaces, or concrete types |
| CSHARP-12 | Entity Framework N+1 (Lazy Loading) | CAPITAL | EF Core logging; MiniProfiler; Glimpse | "Lazy loading in a loop. With 1000 orders, you've written 1001 database queries. The DBA is preparing legal action." | Use Include()/ThenInclude() or explicit loading |
| CSHARP-13 | Unnecessary async State Machine | MISDEMEANOR | Roslyn AsyncifyAnalyzer; VSTHRD111 | "async/await for a single passthrough. You hired a state machine to open a door." | Return the Task directly without async/await |
| CSHARP-14 | Thread.Sleep in Async Code | FELONY | Roslyn VSTHRD101; AsyncFixer | "Thread.Sleep in async code. You've blocked a thread pool thread to wait. Async developers are crying." | Use await Task.Delay() |
| CSHARP-15 | Exceptions for Control Flow | CRIME | Code review; profiling for exception-heavy paths | "Using exceptions for control flow. Your happy path just tripped over your catch block." | Use TryParse, TryGet, or return types |
| CSHARP-16 | Null-Forgiving Operator (!) Overuse | CRIME | Count `!` occurrences; custom Roslyn analyzer | "You used ! 47 times to tell the compiler everything is fine. Your runtime disagrees." | Fix nullable annotations or handle nulls properly |
| CSHARP-17 | Closure Loop Variable Capture Bug | CAPITAL | Roslyn; ReSharper "Access to modified closure" | "You captured a loop variable in a lambda. Your output is: 5, 5, 5, 5, 5. I hope that's what you wanted." | Capture in a local variable inside the loop |
| CSHARP-18 | lock(this) or lock(typeof(T)) | FELONY | Roslyn CA2002 | "lock(this) -- you've made your object a mutex that anyone can acquire. What could go wrong." | Lock on a private readonly object field |
| CSHARP-19 | EF Core ToList() Before Filter | CRIME | EF Core query analysis; SQL profiling; MiniProfiler | "You called ToList() before Where(). Your database table is now in RAM. All of it." | Apply Where() before materializing |
| CSHARP-20 | new HttpClient() Per Request | FELONY | Custom Roslyn analyzer; netstat under load | "new HttpClient() per request. Your OS socket table is now a TCP TIME_WAIT graveyard." | Use IHttpClientFactory or a static instance |
| CSHARP-21 | String Comparison Without StringComparison | MISDEMEANOR | Roslyn CA1309; CA1307 | "String comparison without StringComparison. Works perfectly, until someone runs your code in Turkey." | Always pass StringComparison explicitly |
| CSHARP-22 | Public Fields Instead of Properties | MISDEMEANOR | Roslyn CA1051; StyleCop SA1401 | "Public fields. You'll have time to add validation later. Narrator: They did not have time." | Use properties with getters/setters |

**Primary tool**: `dotnet build /p:EnableNETAnalyzers=true /p:AnalysisMode=AllEnabledByDefault`

---

## TypeScript/JavaScript (15 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| TS-01 | Barrel File Explosion (index.ts) | CRIME | `eslint-plugin-import` no-cycle; TS `--traceResolution` | "Your barrel files re-export everything. Your bundler is working overtime and your circular dep graph looks like a Celtic knot." | Use direct imports; remove unnecessary barrels |
| TS-02 | any Type Used Pervasively | CRIME | `@typescript-eslint/no-explicit-any`; no-unsafe-* rules | "You typed everything as any. TypeScript accepted defeat. JavaScript has entered the chat." | Use unknown, generics, or proper types |
| TS-03 | Non-Null Assertion (!) Overuse | CRIME | `@typescript-eslint/no-non-null-assertion` | "Three consecutive ! operators. You've replaced TypeScript's type system with optimism." | Use optional chaining, narrowing, or null checks |
| TS-04 | Template Literal Types Over-Nesting | MISDEMEANOR | Code review; type complexity analysis | "Your template literal type has 6 levels of nesting. TypeScript errors now require a PhD to parse." | Simplify with intermediate types |
| TS-05 | Floating Promise (No Catch) | FELONY | `@typescript-eslint/no-floating-promises`; no-misused-promises | "Floating promise. Your async error went somewhere. You'll find out where in production." | Always await or void-annotate promises |
| TS-06 | TypeScript enum Instead of const Object | MISDEMEANOR | `@typescript-eslint/no-enum` | "TypeScript enum. It generates runtime code, has reverse mappings, and surprises await at every merge." | Use `as const` objects or union types |
| TS-07 | Discriminated Union Without Exhaustiveness | CRIME | `@typescript-eslint/switch-exhaustiveness-check` | "Discriminated union switch without exhaustiveness check. Add a third variant and watch the function silently return undefined." | Add exhaustive switch with never check |
| TS-08 | Spread Override Causing Type Widening | MISDEMEANOR | TypeScript strict mode; satisfies operator | "Spread override without explicit type. TypeScript inferred your config has every property known to man." | Use satisfies or explicit type annotations |
| TS-09 | as unknown as T (Type Gaslighting) | FELONY | Regex: `as unknown as \w+` | "You used as unknown as TargetType. TypeScript sighed and filed paperwork to have its own type system declared optional." | Fix the underlying type mismatch |
| TS-10 | Missing Discriminant in Union Types | MISDEMEANOR | Type narrowing analysis; TypeScript strict | "Your union type has no discriminant. TypeScript is playing a guessing game with your shapes." | Add a kind/type discriminant property |
| TS-11 | var in Modern ES6+ Code | MISDEMEANOR | ESLint no-var; Biome | "You used var in 2024. This isn't 2010. const and let exist." | Replace var with const or let |
| TS-12 | Mixed async/await and .then().catch() | MISDEMEANOR | ESLint @typescript-eslint/no-misused-promises | "This file handles promises in three different ways. It reads like three different AIs had a style fight." | Pick one style: async/await everywhere |
| TS-13 | Circular Import Dependencies | CRIME | `eslint-plugin-import/no-cycle`; `madge` | "Circular dependency A->B->C->A. Truly a self-sustaining ecosystem of pain." | Break cycles with dependency inversion |
| TS-14 | Unused Dependencies | MISDEMEANOR | `knip --reporter json`; `depcheck --json` | "Your package.json lists 47 dependencies. Your code imports 12 of them." | Run knip and remove unused packages |
| TS-15 | console.log Left in Production | MISDEMEANOR | ESLint no-console; Biome suspicious/noConsoleLog | "console.log in production: your users' devtools is now a debugging console for your feelings." | Use a proper logger; lint-gate console usage |

**Primary tool**: `eslint --format json src/` + `biome lint --reporter=json src/`

---

## Python (15 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| PY-01 | Mutable Default Arguments | CAPITAL | Pylint W0102; Flake8 B006 | "Mutable default argument. Your function has state and you didn't even sign up for OOP." | Use None default + create inside function |
| PY-02 | Bare except: Clause | FELONY | Pylint W0702; Flake8 E722 | "Bare except:. You're swallowing Ctrl+C. Your program is immortal now. Not in a good way." | Catch specific exceptions (at minimum Exception) |
| PY-03 | Missing Type Hints in New Code | MISDEMEANOR | `mypy --disallow-untyped-defs`; flake8-annotations | "No type hints. Your function accepts anything and returns something. IDEs give up." | Add type annotations to all public functions |
| PY-04 | Nested Walrus Operators | MISDEMEANOR | Pylint W0150; code complexity metrics | "Three walrus operators in one if statement. You are not clever. You are a bug report waiting to happen." | Extract to separate assignments |
| PY-05 | Django ORM N+1 (Lazy Loading) | CAPITAL | `django-debug-toolbar`; `silk`; `nplusone` | "Django ORM N+1 in a view. With 1000 orders, your debug toolbar looks like a stock ticker." | Use select_related() or prefetch_related() |
| PY-06 | global Keyword for State Management | CRIME | Pylint W0603 | "global keyword: making your function a side-effect machine since Python 2." | Pass state as parameters or use a class |
| PY-07 | async def With Synchronous Blocking Calls | FELONY | `flake8-async` (ASYNC100, ASYNC210) | "requests.get in async def. You've put a traffic jam on the event loop highway." | Use httpx, aiohttp, or run_in_executor |
| PY-08 | os.system Instead of subprocess | CRIME | Bandit B605, B607 | "os.system with user input. Congratulations on your shell injection vulnerability." | Use subprocess.run with list args |
| PY-09 | asyncio.run() Inside Running Event Loop | FELONY | Runtime error; framework detection | "That's like trying to start your car while you're already driving it." | Use await directly or asyncio.create_task() |
| PY-10 | datetime.now() Without Timezone | CRIME | ruff DTZ rules; grep for `datetime.now()` | "Your timestamp is timezone-naive. Your created_at is useless in any timezone other than wherever your server happens to be." | Use datetime.now(tz=UTC) or datetime.now(timezone.utc) |
| PY-11 | print() in Production Code | MISDEMEANOR | Ruff T20 series; Flake8 | "print statements alongside logging. Your logs are a choose-your-own-adventure of debug output." | Use the logging module |
| PY-12 | import * (Wildcard Import) | CRIME | Pylint W0401; Ruff F401 | "import * from three modules simultaneously. The namespace is now a mystery box." | Use explicit imports |
| PY-13 | Unreachable Code After Return | MISDEMEANOR | Ruff F811; Pylint | "Dead code after return. Your function is a hoarder." | Remove unreachable code |
| PY-14 | Mixed String Formatting Styles | MISDEMEANOR | Ruff; code review | "f-strings mixed with .format() mixed with % formatting in the same file. Pick one. Any one." | Standardize on f-strings |
| PY-15 | @property With Side Effects | MISDEMEANOR | Code review; mutation testing | "Your @property runs a database query. Getters should be boring. This one is an adventure." | Make it an explicit method instead |

**Primary tool**: `ruff check --output-format json .` + `pylint --output-format=json src/`

---

## React (10 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| REACT-01 | useEffect with Wrong/Missing Dependencies | FELONY | eslint-plugin-react-hooks exhaustive-deps | "useEffect with empty deps that uses props. Your component sees the world as it was on mount. Very nostalgic. Very wrong." | Add all used values to dependency array |
| REACT-02 | Prop Drilling Through 5+ Levels | CRIME | Code review; component prop count analysis | "Prop drilling through 5 components. Every component in the chain got dragged into this userId drama." | Use Context, Zustand, or composition |
| REACT-03 | Inline Objects/Arrays/Functions in JSX Props | CRIME | react-compiler (React 19); ESLint; React DevTools Profiler | "Inline objects in props. React.memo is now a very expensive no-op." | Extract to useMemo/useCallback or module-level constants |
| REACT-04 | Server Components Mixing Client State | FELONY | Next.js build errors; RSC boundary analysis | "useState in a Server Component. React Server Components don't have state. They don't even have a browser." | Add 'use client' directive or restructure |
| REACT-05 | key Prop Using Array Index | CRIME | eslint-plugin-react no-array-index-key | "key={index} on a dynamic list. Rearrange the items and watch your inputs swap values." | Use stable unique IDs from data |
| REACT-06 | Suspense Without ErrorBoundary | CRIME | Code review; React DevTools error tracking | "Suspense without ErrorBoundary. One failed fetch brings down the whole tree." | Wrap Suspense with an ErrorBoundary |
| REACT-07 | Derived State Stored in useState | CRIME | eslint-plugin-react-hooks; code review | "Three useState for what is one list and two Math operations. You've invented manual state synchronization." | Compute derived values during render |
| REACT-08 | Memoization Anti-Patterns | MISDEMEANOR | React DevTools Profiler; why-did-you-render | "You either memoize nothing and wonder why it's slow, or memoize everything and wonder why it's still slow." | Profile first, then memoize proven bottlenecks |
| REACT-09 | Missing Error Boundaries | CRIME | Code review; production crash reports | "No ErrorBoundary in the component tree. One render error takes down your whole app." | Add ErrorBoundary at route and feature boundaries |
| REACT-10 | Not Using React.memo on Expensive Components | MISDEMEANOR | React DevTools Profiler | "Your expensive DataTable re-renders on every keystroke in the parent. React.memo: one word, infinite comfort." | Wrap with React.memo after profiling confirms benefit |

**Primary tool**: `eslint --format json --ext .tsx,.jsx src/` (with react and react-hooks plugins)

---

## HTML/CSS (18 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| HTMLCSS-01 | !important Abuse | CRIME | Stylelint declaration-no-important; grep `!important` count | "17 !important declarations. Your CSS is not a cascade, it's a series of shouting matches." | Fix specificity; use BEM or CSS Modules |
| HTMLCSS-02 | Missing alt on Images | FELONY | axe-core; WAVE; htmlhint alt-require; Lighthouse | "img without alt. Screen readers will announce 'image' 47 times." | Add descriptive alt text to all images |
| HTMLCSS-03 | Z-Index Chaos | CRIME | Stylelint; grep `z-index:\s*[0-9]{4,}` | "z-index: 99999. You are not winning the z-index war. You are the z-index war." | Use a z-index scale system (tokens) |
| HTMLCSS-04 | Div Soup / Non-Semantic Markup | CRIME | Lighthouse; HTML validators; axe-core | "All divs, all the way down. Your HTML is a div convention with occasional text." | Use semantic HTML5 elements |
| HTMLCSS-05 | Inline Styles | MISDEMEANOR | Stylelint; CSP style-src | "Inline styles. You're writing CSS where it can do the least good and the most harm." | Move to CSS classes or CSS-in-JS |
| HTMLCSS-06 | Missing Viewport Meta Tag | FELONY | Lighthouse; htmlhint; W3C validator | "No viewport meta. On mobile, your site renders at 10% zoom." | Add `<meta name="viewport" content="width=device-width, initial-scale=1">` |
| HTMLCSS-07 | Tables for Layout | CRIME | Lighthouse; HTML linters | "Tables for layout. This architectural decision wants to live in 1999." | Use CSS Grid or Flexbox |
| HTMLCSS-08 | No CSS Custom Properties for Theme | MISDEMEANOR | Script counting repeated hex values | "Your brand color appears 47 times as a hex literal. Rebranding will take a week." | Use CSS custom properties (variables) |
| HTMLCSS-09 | Missing/Incorrect ARIA Roles | FELONY | axe-core; Lighthouse; WAVE | "A div with onclick but no ARIA role. Screen readers see a paragraph. Keyboard users see nothing." | Use semantic elements or add proper ARIA attributes |
| HTMLCSS-10 | CSS Specificity Wars | CRIME | Stylelint selector-max-specificity; selector-max-compound-selectors | "A 7-level CSS selector. The cascade called. It quit." | Use BEM methodology or CSS Modules |
| HTMLCSS-11 | Fixed Pixel Widths Breaking Responsive | CRIME | Lighthouse; DevTools responsive mode | "Fixed pixel widths. On mobile, your layout requires horizontal scrolling." | Use relative units (%, rem, vw) and max-width |
| HTMLCSS-12 | Render-Blocking Scripts in Head | CRIME | Lighthouse performance audit; WebPageTest | "Render-blocking scripts. Your Lighthouse score is a crime scene." | Add defer/async or move scripts to body end |
| HTMLCSS-13 | Missing focus-visible / Outline: None | FELONY | axe-core; Lighthouse; manual keyboard testing | "outline: none. You've made your app invisible to keyboard users." | Use :focus-visible or custom focus styles |
| HTMLCSS-14 | No Dark Mode Support | MISDEMEANOR | Lighthouse; manual OS dark mode test | "No dark mode support. Your site is a flashbang for night-mode users." | Add prefers-color-scheme media query |
| HTMLCSS-15 | Form Without label Elements | FELONY | axe-core label; Lighthouse; WAVE | "Input without label. Your form is an accessibility maze." | Associate every input with a <label> |
| HTMLCSS-16 | Float-Based Layout | PARKING TICKET | Code review; Stylelint float rules | "Float-based layout. Your CSS is solving 2024 problems with 2004 tools." | Migrate to Flexbox or Grid |
| HTMLCSS-17 | ID Selectors for Styling | MISDEMEANOR | Stylelint selector-max-id | "ID selectors for styling. You've set a specificity trap for your future self." | Use class selectors instead |
| HTMLCSS-18 | Images Without Width/Height (CLS) | MISDEMEANOR | Lighthouse CLS audit; aspect-ratio CSS | "No width/height on img. Your page layout shifts while loading. Your CLS score is a cry for help." | Add explicit width/height or aspect-ratio |

**Primary tool**: `stylelint "**/*.css" --formatter json` + `npx axe http://localhost:3000 --reporter json`

---

## SQL/Database (15 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| SQL-01 | SELECT * in Production Queries | CRIME | sqlfluff rules; query plan review | "SELECT *. You asked for everything. The database gave you everything. Including the 4MB JSON blob you didn't need." | List specific columns needed |
| SQL-02 | Function Calls on Indexed Columns in WHERE | CAPITAL | EXPLAIN/EXPLAIN ANALYZE; pg_stat_statements | "DATE() on an indexed timestamp column. Your index went on vacation. Full table scan for everyone." | Use sargable predicates; create functional index |
| SQL-03 | Implicit Type Coercion in WHERE | FELONY | EXPLAIN output; sqlfluff | "Implicit type coercion in WHERE. Your index laughed, then skipped. Full table scan it is." | Cast explicitly or match column types |
| SQL-04 | Window Function Without PARTITION BY | CRIME | Query review; result validation | "RANK() without PARTITION BY. Globally ranked when you wanted by category." | Add PARTITION BY for the intended grouping |
| SQL-05 | CTE Abuse for Simple Subqueries | PARKING TICKET | Code review; query complexity analysis | "A CTE for a 2-line subquery. You added boilerplate for zero readability gain." | Use a simple subquery or inline |
| SQL-06 | Missing Index on Foreign Key Columns | CAPITAL | pg_fkeys_without_index query; schema analysis | "No index on your foreign key. Every JOIN touches every row. Your EXPLAIN is a horror show." | CREATE INDEX on all foreign key columns |
| SQL-07 | Partition Pruning Failure | FELONY | EXPLAIN PARTITIONS; EXPLAIN with partition count | "You partitioned the table for performance, then wrote a query that ignores the partitions." | Match WHERE clause types with partition key types |
| SQL-08 | OFFSET Pagination on Large Datasets | CRIME | Query plan; slow query logs | "OFFSET pagination. Page 1000 scans 19,980 rows to show you 20." | Use keyset/cursor pagination |
| SQL-09 | SQL Injection via String Concatenation | CAPITAL | Bandit, gosec G201/G202, semgrep; all SAST tools | "Your database is open to anyone who can type a single quote. You have shipped a DELETE button labeled 'Login.'" | Use parameterized queries / prepared statements |
| SQL-10 | Storing CSV/JSON in VARCHAR (EAV) | CAPITAL | Schema analysis; grep for `LIKE '%...%'` patterns | "This is not a database schema -- it's a spreadsheet that's ashamed of itself." | Normalize into proper relational tables |
| SQL-11 | N+1 at Service Level (ORM Lazy in Loop) | CAPITAL | django-debug-toolbar; Hibernate stats; ORM profilers | "Your service executes 1001 queries for 1000 records. This is artisanal database abuse." | Use eager loading, batch queries, or DataLoader |
| SQL-12 | Correlated Subquery in SELECT Clause | FELONY | EXPLAIN plan; slow query log | "A correlated subquery in the SELECT clause. You're attempting a DoS attack on your own database." | Rewrite as JOIN or window function |
| SQL-13 | Missing EXPLAIN Plan Review | CRIME | Mandatory before production deployment | "No EXPLAIN plan check. Surprise full table scan in production." | Run EXPLAIN ANALYZE before deploying queries |
| SQL-14 | Deadlock-Prone Lock Order | CRIME | App monitoring; PostgreSQL pg_locks | "Tables locked in inconsistent order across transactions. You've built a dining philosophers problem." | Establish consistent lock ordering convention |
| SQL-15 | UUID as Primary Key Without Sequential Consideration | MISDEMEANOR | EXPLAIN; B-tree fragmentation analysis | "UUID as PK causes random index insertions. Your index is Swiss cheese." | Use UUIDv7 (time-ordered) or bigserial |

**Primary tool**: `sqlfluff lint --format json --dialect postgres queries/`

---

## Universal Anti-Patterns (44 patterns)

### SOLID Violations (5)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| UNI-01 | God Class / God Function (SRP) | FELONY | `wc -l`; PMD GodClass; `radon cc`; ESLint max-lines | "This class has more responsibilities than a middle manager who also does IT support, HR, and catering." | Extract focused classes by single responsibility |
| UNI-02 | Type Switch Sprawl (OCP) | CRIME | grep for switch/if-else chains with 5+ type checks | "Every time a new shape is added, an angel loses its wings and a developer loses their weekend." | Use polymorphism or strategy pattern |
| UNI-03 | Abstract Pretender / Refused Bequest (LSP) | FELONY | grep for `throw new UnsupportedOperationException`; `NotImplementedException` | "Your inheritance hierarchy is a family reunion where half the relatives refuse to do what the family business requires." | Redesign interface hierarchy; use composition |
| UNI-04 | Fat Interface (ISP) | CRIME | Count methods per interface; flag >10 with sparse usage | "This interface has the scope of a job description that requires '10 years of React and a culinary arts degree.'" | Split into focused interfaces |
| UNI-05 | Hard Dependencies / new Everywhere (DIP) | CRIME | grep for `new ConcreteClass()` in constructor bodies | "Your class is a clingy ex who can't function without its specific dependencies." | Use dependency injection |

### Design Pattern Misuse (5)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| UNI-06 | Singleton Abuse | FELONY | `getInstance()` + static fields + mutable business logic | "You've reinvented global variables but made them harder to grep for." | Use dependency injection container |
| UNI-07 | Observer Memory Leaks | CRIME | Subscription without unsubscription; missing cleanup | "Your event listeners are like ex-roommates -- they moved out but their stuff is still everywhere." | Always unsubscribe in cleanup/dispose |
| UNI-08 | Decorator Hell (5+ Layers) | MISDEMEANOR | Count decorator nesting depth; stack trace depth | "Your decorator stack has more layers than a company org chart." | Flatten or use middleware pipeline |
| UNI-09 | Strategy Overkill | PARKING TICKET | Strategy with 1-2 impls, no polymorphism benefit | "You brought the entire GoF book to a fork() call." | Use a simple if/switch for 1-2 cases |
| UNI-10 | Factory Overkill | MISDEMEANOR | Factory for simple construction, no polymorphism | "You've built a factory to instantiate a POJO. Like using a CNC machine to butter toast." | Construct directly; add factory when needed |

### Microservice Anti-Patterns (5)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| UNI-11 | Distributed Monolith | CAPITAL | Shared DB schema; synchronized deploys; 30+ inter-service calls | "You've taken a monolith, added network timeouts, and called it microservices." | Define service boundaries by domain; own your data |
| UNI-12 | Chatty Services (Nano-Service Hell) | FELONY | >10 sync calls per request; sequential service calls | "Your microservices have more conversations with each other than your team has in standups." | Batch calls; use async messaging; merge nano-services |
| UNI-13 | Shared Database Anti-Pattern | FELONY | Multiple services with direct DB access to same tables | "Your 'microservices' share a database like roommates sharing a single email inbox." | Each service owns its data; use events for sync |
| UNI-14 | No Health Checks | CRIME | Missing /health, /ready, /live endpoints | "Your service has no health check. Kubernetes manages it the same way a toddler manages a fish tank -- with hope." | Add liveness, readiness, and startup probes |
| UNI-15 | Nanoservice / Kitchen-Sink Endpoint | MISDEMEANOR | Single-endpoint-per-service or 45-param endpoint | "Less an API and more a fire hydrant aimed at your mobile clients." | Right-size services by bounded context |

### API Design Smells (5)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| UNI-16 | API Versioning Absent | FELONY | No /v1/ prefix; breaking changes unversioned | "Your API has no versioning. Every breaking change is a surprise birthday party nobody wanted." | Add /v1/ prefix; use semantic versioning |
| UNI-17 | No Pagination (Firehose API) | CRIME | Endpoints returning full collections without limit/cursor | "This endpoint returns all your data every time. It's less an API and more a fire hydrant." | Add cursor or offset pagination |
| UNI-18 | Missing Idempotency on POST | FELONY | POST creating resources without idempotency keys | "Network retry = duplicate order. Your shopping cart is now a slot machine." | Add Idempotency-Key header support |
| UNI-19 | Boolean Parameters / Flag Arguments | MISDEMEANOR | Functions with 2+ boolean parameters | "You've encoded a policy decision as an unnamed True. Callers pass True and False into the void." | Use enums or separate methods |
| UNI-20 | Inconsistent Error Codes | MISDEMEANOR | 500 for validation errors; no error schema | "500 for everything. Your clients can't tell a bug from a bad request." | Define error schema; use proper HTTP status codes |

### Testing Anti-Patterns (8)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| UNI-21 | Ice Cream Cone Testing | CRIME | E2E >> Integration >> Unit test ratio inverted | "Your test pyramid is upside down, impressive the same way a building constructed roof-first is impressive." | Invert to proper pyramid: unit > integration > E2E |
| UNI-22 | Flaky Tests | FELONY | --retryTimes > 0 in CI; setTimeout in tests; Date.now() without mock | "Your test suite passes 7 times out of 10. Less a safety net, more a suggestion." | Mock time, use deterministic data, avoid race conditions |
| UNI-23 | Assertion-Free Tests | FELONY | Tests with `assert result is not None` as sole assertion | "Your test checked that the function returned something. This isn't testing, it's a participation trophy." | Assert specific expected values and behaviors |
| UNI-24 | Snapshot Test Abuse | MISDEMEANOR | >500-line snapshots; blind `jest -u` updates | "200 snapshot tests and every PR updates all of them. You've automated shipping bugs with confidence." | Use targeted assertions; snapshot only stable output |
| UNI-25 | Test Data Coupling (Shared State) | CRIME | --runInBand required; tests must run in order | "Your tests have dependencies on each other. A soap opera where Test 47 needs Test 12's love triangle." | Isolate test data; each test sets up its own state |
| UNI-26 | Mocking Everything | MISDEMEANOR | Mocking stdlib; testing mock interactions | "You mocked addition. You wrote tests for your mocks." | Mock boundaries, not internals |
| UNI-27 | Test Naming Anti-Pattern | PARKING TICKET | test1, testFoo, testNew test names | "Your test is called test2. When it fails, future you will have no idea what it was testing." | Use descriptive names: should_X_when_Y |
| UNI-28 | Time-Dependent Tests | CRIME | new Date(), datetime.now() in expected values without mock | "This test only passes on certain days. You haven't written software, you've written a horoscope." | Mock or freeze time in tests |

### CI/CD & DevOps Smells (6)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| UNI-29 | Deployment Without Rollback | CAPITAL | No blue-green; no canary; no rollback script | "Your deployment strategy is a one-way door. The Hotel California of software operations." | Implement blue-green or canary deployments |
| UNI-30 | Slow Pipeline (45-Minute CI) | CRIME | Total pipeline time > 15 minutes; no parallelization | "CI takes 47 minutes. By the time it finishes, the developer has opened 4 tabs and is debating career changes." | Parallelize tests; cache dependencies; split stages |
| UNI-31 | YAML Sprawl (K8s Config Hell) | CRIME | Copy-pasted YAML; no Helm/Kustomize; secrets in ConfigMaps | "47 YAML files, none with health checks, one with the database password, and three called 'final.'" | Use Helm or Kustomize; externalize secrets |
| UNI-32 | No Resource Limits in Kubernetes | FELONY | Containers without CPU/memory requests/limits | "Your container has no limits. The digital equivalent of 'hold my beer.'" | Set CPU/memory requests and limits |
| UNI-33 | Privileged Containers | CAPITAL | securityContext.privileged: true; no security context | "Your container runs as root with full privileges. Bold." | Run as non-root; drop capabilities |
| UNI-34 | :latest Tag in Production | CRIME | image: app:latest in deployment manifests | "image:latest in production. Your deploy just installed whatever got pushed yesterday." | Pin specific image tags with SHA digests |

### Dependency Management (4)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| UNI-35 | Leftpad Syndrome (Dep Obesity) | CRIME | package.json with 847+ deps; single-function packages | "Your package has a dependency for checking if a number is odd. You imported someone else's if statement." | Inline trivial utils; audit dependency tree |
| UNI-36 | Unpinned Dependencies | FELONY | lodash: "*"; >=0.21.0; requirements without versions | "You have lodash: '*'. This is dependency roulette." | Pin exact versions; use lock files |
| UNI-37 | Phantom Dependencies (Undeclared) | FELONY | Using transitive deps not in package.json; knip detection | "You're borrowing sugar from your neighbor's pantry without asking. One day they'll move." | Declare all direct dependencies explicitly |
| UNI-38 | No Lock File in VCS | CRIME | Missing package-lock.json, go.sum, poetry.lock | "No lock file. CI installs whatever npm feels like today." | Commit lock files to version control |

### Concurrency & General (6)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| UNI-39 | Callback Hell / Pyramid of Doom | CRIME | Nesting depth > 5 in callback chains | "This is not a program, it's a geological core sample of bad decisions." | Use async/await or Promise chains |
| UNI-40 | Hardcoded Configuration (No 12-Factor) | FELONY | grep for postgresql://, sk_live_, api_key = in source | "Your production database password is in git history forever. It's immortal." | Use environment variables per 12-factor |
| UNI-41 | Magic Numbers / Strings | MISDEMEANOR | Raw literals without named constants | "This code contains secrets. You have written a riddle and left it in production." | Extract to named constants |
| UNI-42 | Premature Optimization | MISDEMEANOR | Bitwise hacks next to 800ms DB queries | "You replaced Math.max() with a bitwise hack to save nanoseconds. The DB query 3 lines below takes 800ms." | Profile first; optimize proven bottlenecks |
| UNI-43 | TODO Cemetery | MISDEMEANOR | grep for TODO.*20(16\|17\|18\|19) | "Your TODO comments are archaeological artifacts. The 2016 one has been deployed to millions of users." | Review and resolve or remove stale TODOs |
| UNI-44 | Hardcoded Secrets in Code | CAPITAL | gitleaks; detect-secrets; Trivy fs | "Your API key is in source control. Every contributor, fork, and mirror now has your credentials." | Use secrets manager; rotate exposed keys immediately |

---

## AI Slop Detection (10 patterns)

| ID | Name | Severity | Detection | Roast | Fix Hint |
|----|------|----------|-----------|-------|----------|
| SLOP-01 | Hallucinated Imports | SLOP | pip show, npm ls, go list build failures; ImportError | "Your AI wrote you an import that doesn't exist. It autocompleted your dependencies into the void." | Verify all imports compile/resolve |
| SLOP-02 | Deprecated API Usage | SLOP | eslint-plugin-react no-deprecated; framework linters | "Your AI confidently wrote 2019 React. It hasn't read the changelog since Obama was president." | Check framework migration guides |
| SLOP-03 | Over-Engineered One-Liners | SLOP | Cognitive complexity tools; code review | "Your AI solved max(numbers) with a sort and a negative key. A helicopter to cross the street." | Use the simplest correct solution |
| SLOP-04 | Narrative Comments | SLOP | Regex: comments starting with "This code", "We create", "This method" | "Your AI narrated the code like a GPS. The code already says this. We needed the backstory." | Remove comments that restate the code |
| SLOP-05 | Fake API Endpoint Patterns | SLOP | Compare against official API docs; TS SDK type stubs | "Your AI called an endpoint that doesn't exist. You've written a confident prayer to AWS." | Verify endpoints against official API docs |
| SLOP-06 | Inconsistent Error Handling | SLOP | grep for mixed patterns (returns, panics, ignores in same file) | "This file handles errors three ways -- returns, panics, and spiritual surrender." | Pick one error handling strategy per module |
| SLOP-07 | Unnecessary async/await Wrapping | SLOP | ESLint require-await; @typescript-eslint/require-await | "You awaited a multiplication. Your CPU needs permission to do arithmetic now." | Remove await from synchronous expressions |
| SLOP-08 | Copy-Paste Structural Tells | SLOP | Consistency checks; git blame showing large single-commit blocks | "Four naming conventions, two import styles, three null-handling strategies. Committee document." | Normalize naming and style throughout |
| SLOP-09 | Forbidden Comment Phrases | SLOP | Regex: don't touch, magic number, not sure why, trust me, somehow | "Your comment says 'don't touch this.' This is not documentation. You've shipped a cursed object." | Replace with explanatory comments or fix the code |
| SLOP-10 | Language-Specific AI Tells | SLOP | var in ES6+; mixed async styles; print+logging; raw types in modern Java | "This code reads like it was trained on Stack Overflow circa 2015 and hasn't learned anything since." | Update to modern language idioms |

---

## Quick Reference: Pattern Count by Severity

| Severity | Go | Java | C# | TS/JS | Python | React | HTML/CSS | SQL | Universal | Slop | **Total** |
|----------|-----|------|-----|-------|--------|-------|----------|-----|-----------|------|-----------|
| CAPITAL | 2 | 3 | 4 | 0 | 2 | 0 | 0 | 4 | 4 | 0 | **19** |
| FELONY | 4 | 5 | 5 | 2 | 3 | 2 | 5 | 3 | 8 | 0 | **37** |
| CRIME | 9 | 10 | 8 | 5 | 4 | 5 | 7 | 5 | 14 | 0 | **67** |
| MISDEMEANOR | 4 | 2 | 3 | 6 | 6 | 2 | 5 | 1 | 8 | 0 | **37** |
| PARKING TICKET | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 2 | 0 | **6** |
| SLOP | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | **10** |
| **Total** | **21** | **22** | **22** | **15** | **15** | **10** | **18** | **15** | **44** | **10** | **192** |
