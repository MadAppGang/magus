# Factory Method

**Intent:** define an interface for creating an object, but let subclasses decide which
class to instantiate.

## The force

A class must create a collaborator, but does not know which concrete one. Written directly,
the decision hard-codes into a class that has no business making it:

```ts
class LogisticsPlanner {
  plan() {
    const transport = new Truck();   // now this class is road-only, forever
    return transport.deliver();
  }
}
```

Adding sea freight means editing `LogisticsPlanner`, and every future mode edits it again.

## Structure

Move the `new` into an overridable method. The base class uses the product through its
interface and never learns the concrete type.

```ts
interface Transport { deliver(): string }
class Truck implements Transport { deliver() { return "by road" } }
class Ship  implements Transport { deliver() { return "by sea" } }

abstract class Logistics {
  protected abstract createTransport(): Transport;   // the factory method

  planDelivery(): string {                            // shared logic, written once
    return `Delivering ${this.createTransport().deliver()}`;
  }
}

class RoadLogistics extends Logistics { protected createTransport() { return new Truck() } }
class SeaLogistics  extends Logistics { protected createTransport() { return new Ship()  } }
```

The point is not the `new`. It is that `planDelivery` is written once and works for every
transport that will ever exist.

## Does TypeScript already do this

**Usually you want a registry or a function, not a subclass.** The subclass form is worth it
only when the creator has other behaviour that also varies.

```ts
// Flat form: no inheritance, open for extension, one line to add a mode.
const transports: Record<string, () => Transport> = {
  road: () => new Truck(),
  sea:  () => new Ship(),
};

function planDelivery(mode: keyof typeof transports): string {
  const make = transports[mode];
  if (!make) throw new Error(`unknown transport: ${mode}`);
  return `Delivering ${make().deliver()}`;
}
```

Choose the class form when subclasses vary **more than construction**. Choose the registry
when construction is the only thing that differs, which is the common case.

## Trade-offs

| Gain | Cost |
|---|---|
| Creator decoupled from concrete products; new products need no edit to existing logic | A parallel class hierarchy: one creator subclass per product |
| Shared creation logic lives in one place | Indirection: "where does this get built" needs a hop |
| Single Responsibility: construction is isolated | Easy to add before any second product exists |

## When NOT to use this

- **There is one concrete product and no plausible second.** This is `UNI-10` Factory
  Overkill in `dev:code-roast`'s `sin-registry.md`: a factory that wraps `new` with no
  decision in it.
- **The choice is a simple runtime value.** A `Record` lookup is clearer than a hierarchy.
- **Construction needs many optional parameters.** That is `builder.md`, a different force.

## Relations

- **Abstract Factory** (`abstract-factory.md`) is often implemented as a set of Factory
  Methods, one per product in the family.
- **Template Method** (`template-method.md`) is the same mechanism applied to an algorithm
  instead of construction; Factory Method is frequently a step inside one.
- **Prototype** (`prototype.md`) is the alternative when you can copy a configured instance
  instead of subclassing to build a new one.
