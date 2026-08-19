# Mediator

**Intent:** encapsulate how a set of objects interact, so they refer to the mediator instead
of to each other.

## The force

N objects that each know several others. Connections grow toward N², and no component can be
reused or tested alone.

```
without mediator (6 couplings)        with mediator (4 couplings)
  A ──── B                              A ─┐
  │ ╲  ╱ │                                 ├─ Mediator ─┤
  │  ╲╱  │                              B ─┘            │
  │  ╱╲  │                              C ──────────────┤
  C ──── D                              D ──────────────┘
```

The classic example is a dialog: changing the country dropdown must filter the city
dropdown, enable a button, and clear a field. Wiring that between the widgets makes each
widget know the form it lives in, so none of them is reusable.

## Structure

```ts
interface Mediator { notify(sender: string, event: string): void }

class LoginForm implements Mediator {
  constructor(
    private email: TextField,
    private submit: Button,
    private remember: Checkbox,
  ) {
    [email, submit, remember].forEach(c => c.setMediator(this));
  }

  notify(sender: string, event: string): void {
    // All interaction logic lives HERE, in one readable place.
    if (sender === "email" && event === "change") {
      this.submit.enabled = this.email.value.includes("@");
    }
    if (sender === "submit" && event === "click") {
      if (this.remember.checked) storeEmail(this.email.value);
    }
  }
}
```

Each component knows only "something is listening". The form knows the rules. Components
become reusable because they carry no knowledge of each other.

## Does TypeScript already do this

An **event bus** is the loosely-coupled variant, where components publish and subscribe
rather than being registered with a named mediator:

```ts
const bus = new EventTarget();
emailField.addEventListener("change", () => bus.dispatchEvent(new CustomEvent("email:changed")));
bus.addEventListener("email:changed", updateSubmitState);
```

**The trade is discoverability for decoupling.** An explicit mediator has the rules in one
readable method; a bus scatters them across subscribers but removes the central class.

**On the popular "Redux/Zustand are mediators" claim: it is not supported.** Redux's own
documentation uses "middleware" 31 times and "mediator" zero. For Zustand there is no source
at all. The one public statement is patterns.dev, which names Redux *middleware* — not the
store — and hedges: *"mediator dressed up as a pipeline."* Its own discriminator is worth
keeping: **if the middle thing makes decisions it is a mediator; if it only routes messages
without inspecting them it is a bus.** By that test most event emitters are buses.

Mediator is the thinnest-evidenced pattern in this tree. Wikipedia's article names **no real
implementation** — only invented examples — where its Chain of Responsibility article names
Cocoa. The one library claiming it in its own words is `@foblex/mediator` (MIT):
*"implements the mediator pattern, providing a centralized way to handle requests."*
Norvig filed Mediator under "invisible or simpler in a dynamic language" in 1996.

## Trade-offs

| Gain | Cost |
|---|---|
| N² couplings become N | The mediator centralizes complexity and can grow into a God Object (`UNI-01`) |
| Components are reusable and testable in isolation | Behaviour moves out of components, so reading one tells you less |
| Interaction rules are in one place, readable | That one place becomes a change hotspot every feature touches |

**This is an explicit trade, not a free win:** you are choosing one complex, well-named
object over many tangled ones. That is usually better, but only while the mediator stays
comprehensible. When it stops, split it by feature rather than adding methods.

## When NOT to use this

- **Two or three components with simple, stable links.** Direct references are clearer.
- **Communication is one-to-many broadcast.** That is `observer.md`.
- **The mediator would just forward calls** without holding rules. Then it is a pass-through
  adding a hop.

## Relations

- **Observer** (`observer.md`) is one-to-many with an unaware publisher; Mediator is
  many-to-many with colleagues that know the mediator. They are often combined: the mediator
  uses Observer to receive notifications from colleagues.
- **Facade** (`facade.md`) also centralizes, but its subsystem does not know it exists and
  communication is one-way in.
- At system scale the mediator becomes a message broker or an orchestrating saga; see
  `../styles/event-driven.md`.
