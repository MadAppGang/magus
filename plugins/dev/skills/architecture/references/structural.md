# Structural patterns

**The family's question: how do objects compose into larger objects without rigid
inheritance?**

Inheritance fixes relationships at compile time and gives you one axis of variation.
Structural patterns all replace some of that with composition, which you can change at
runtime and combine freely.

| Pattern | Composes to | Read |
|---|---|---|
| **Adapter** | make an incompatible interface fit the one you need | `patterns/adapter.md` |
| **Bridge** | split one hierarchy into two that vary independently | `patterns/bridge.md` |
| **Composite** | treat a tree of objects exactly like a single object | `patterns/composite.md` |
| **Decorator** | add behaviour by wrapping, stackably, at runtime | `patterns/decorator.md` |
| **Facade** | give a painful subsystem one simple front door | `patterns/facade.md` |
| **Flyweight** | share the common part of many objects to save memory | `patterns/flyweight.md` |
| **Proxy** | stand in for an object to control access to it | `patterns/proxy.md` |

## The four that look identical, and the question that separates them

Adapter, Decorator, Proxy, and Facade **all wrap something**. Their code can be nearly the
same. Their *intent* differs, and intent is what you are choosing:

| Wrapper | Interface vs wrapped | Why it exists |
|---|---|---|
| **Adapter** | **different** | the interfaces do not match and you cannot change either |
| **Decorator** | **same** | add responsibility, and stack several |
| **Proxy** | **same** | control *access*: lazy load, cache, permission check, remote call |
| **Facade** | **new, simpler** | the subsystem is many objects and calling it is hard |

The distinguishing test: **Decorator adds behaviour to the operation; Proxy decides whether
and when the operation runs at all.** A cache is a Proxy (it may skip the call). A logger is
a Decorator (the call always happens, plus logging).

## Choosing inside the family

```
Two things that must talk but have mismatched shapes?      → Adapter
A subsystem that is painful to call correctly?             → Facade
Need to add behaviour, possibly several, at runtime?       → Decorator
Need to intercept or defer access to an object?            → Proxy
Two dimensions multiplying into a class explosion?         → Bridge
A part/whole tree where leaves and branches act alike?     → Composite
Millions of similar objects eating memory?                 → Flyweight
```

**Bridge deserves a note**, because it is the one people miss. The signal is class names
that multiply: `WindowsButton`, `MacButton`, `WindowsCheckbox`, `MacCheckbox`. Two
dimensions (control type × platform) crossed into one hierarchy gives you M×N classes.
Bridge separates them into M + N.

## Does TypeScript already do this

| Instead of | TypeScript often gives you |
|---|---|
| Proxy class | the built-in `Proxy` object, for interception without writing a wrapper class |
| Decorator class hierarchy | a higher-order function: `withRetry(withLogging(handler))` |
| Adapter class | a plain mapping function, when the adaptee is one call |
| Facade class | a module. A module with three exported functions over a messy subsystem *is* a Facade |

**Middleware is the decorator pattern**, and it is how the Bun and Express ecosystems
already express it. If a request pipeline is what you are building, you want composed
functions, not a `Decorator` base class:

```ts
type Handler = (req: Request) => Promise<Response>;
const withLogging = (next: Handler): Handler => async (req) => {
  const started = performance.now();
  const res = await next(req);
  log.info({ path: new URL(req.url).pathname, ms: performance.now() - started });
  return res;
};
const app = withLogging(withAuth(routes));   // stacking, at runtime, no classes
```

## The family's characteristic failure

**Wrapper depth.** Each layer is individually reasonable; five layers make a stack trace
unreadable and no single file describes what actually happens. Tracked as `UNI-08`
Decorator Hell in `dev:code-roast`'s `sin-registry.md` (5+ layers).

The second failure is **Facade as a dumping ground**: it starts as a simple front door and
accretes methods until it is a God Object (`UNI-01`) that merely delegates. A Facade should
expose the common paths, not every path.

## Relations to the other families

- Composite and Decorator share a structure (both are recursive compositions), which is why
  they combine well: a Decorator can wrap a Composite node.
- Composite trees are traversed by **Iterator** and operated on by **Visitor**
  (`patterns/visitor.md`); that trio is the standard combination.
- Flyweight's shared instances are usually handed out by a factory (`creational.md`), which
  is where the sharing is enforced.
- A Facade over a subsystem often sits at the boundary of a module in
  `styles/modular-monolith.md` — the module's `index.ts` is a Facade by another name.
