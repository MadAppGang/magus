# Chain of Responsibility

**Intent:** pass a request along a chain of handlers; each decides either to process it or
to pass it on.

## The force

Several possible handlers for a request, and the sender should not know which one will take
it, or how many exist.

```ts
// The sender is now coupled to every handler and their order.
if (cache.has(req))        return cache.get(req);
else if (auth.rejects(req)) return unauthorized();
else if (limiter.exceeded(req)) return tooManyRequests();
else return handle(req);
```

## Structure

```ts
abstract class Handler {
  #next?: Handler;

  setNext(h: Handler): Handler { this.#next = h; return h }   // returns h, so chaining reads well

  handle(req: Request): Response | null {
    return this.#next ? this.#next.handle(req) : null;        // default: pass it on
  }
}

class AuthHandler extends Handler {
  handle(req: Request): Response | null {
    if (!req.headers.get("authorization")) return new Response("unauthorized", { status: 401 });
    return super.handle(req);                                 // not mine: continue
  }
}

const chain = new AuthHandler();
chain.setNext(new RateLimitHandler()).setNext(new CacheHandler());
```

**Every handler has two exits: handle it, or delegate.** A handler that always delegates is
a Decorator; a handler that may terminate the chain is what makes this pattern distinct.

## Does TypeScript already do this

**This is middleware**, and the function form is the one you will actually meet:

```ts
type Middleware = (req: Request, next: () => Promise<Response>) => Promise<Response>;

const auth: Middleware = async (req, next) =>
  req.headers.get("authorization") ? next() : new Response("unauthorized", { status: 401 });

function chain(mws: Middleware[], final: Handler): Handler {
  return mws.reduceRight<Handler>((next, mw) => (req) => mw(req, () => next(req)), final);
}
```

Prefer this. It composes, it is testable per middleware, and it needs no base class. Every
Bun and Express server is built this way.

**Middleware is arguably its own pattern, not this one.** *Node.js Design Patterns* files it
here — behavioral, beside Chain of Responsibility — and says its Node form "has become such a
standard that it can be considered a pattern of its own"; elsewhere it calls it "the Node.js
incarnation of the **Intercepting Filter** pattern and the Chain of Responsibility pattern."
The lineage is servlet filters → Rack → Connect → Express. GoF's own Chain chapter never
mentions Decorator; that contrast was added to Wikipedia by an editor in 2017, uncited.
For non-middleware examples that self-identify, see `../real-world-examples.md`.

## Trade-offs

| Gain | Cost |
|---|---|
| Sender is decoupled from the set and order of handlers | Order is significant and invisible at the call site |
| Handlers are added, removed, reordered at runtime | A request can fall off the end unhandled |
| Each handler is small and independently testable | Debugging means stepping through the chain to find who stopped it |

## When NOT to use this

- **Exactly one handler can process the request.** Call it.
- **The handler is known from the request's type.** Use a lookup: `Record<Type, Handler>` is
  O(1) and explicit, where a chain is O(n) and implicit.
- **Every handler must run.** That is `decorator.md`, and saying so makes the guarantee clear.
- **Falling off the end must be impossible.** Then either add a terminal handler that always
  handles, or use a mechanism the compiler can check.

## Relations

- **Decorator** (`decorator.md`) has the same shape; decorators always delegate, chain
  handlers may stop. `withAuth` short-circuiting a middleware stack is a chain link, not a
  decorator — `decorator.md` says the same, and access control also overlaps Proxy.
  **The two most-read references do not conflict here, contrary to a common claim.**
  Wikipedia states the strict "exactly one handler" test and then concedes *"many
  implementations (such as loggers, or UI event handling, or servlet filters in Java) allow
  several elements in the chain to take responsibility"*; refactoring.guru states the loose
  "may halt the flow" test and concedes the strict reading is *"a bit more canonical"*. Same
  position from opposite ends.
- **Composite** (`composite.md`) trees often use a chain to bubble a request from a leaf up
  through its parents.
- **Command** (`command.md`) is frequently what travels along the chain.
