# Adapter

**Intent:** convert the interface of a class into another interface clients expect, letting
classes work together that otherwise could not.

## The force

Two pieces of code must cooperate and their shapes do not match. Crucially, **you cannot
change either one**: one is third-party, one is legacy, or both are used elsewhere.

```ts
// Your app speaks this. It is the shape your domain wants.
interface PaymentGateway { charge(amountCents: number, token: string): Promise<string> }

// The vendor SDK speaks this. Different names, different units, different return.
class StripeSdk {
  createPaymentIntent(opts: { amount: number; currency: string; source: string }):
    Promise<{ id: string; status: string }> { /* … */ }
}
```

## Structure

The adapter implements *your* interface and delegates to *theirs*, translating both ways.

```ts
class StripeAdapter implements PaymentGateway {
  constructor(private sdk: StripeSdk) {}

  async charge(amountCents: number, token: string): Promise<string> {
    const intent = await this.sdk.createPaymentIntent({
      amount: amountCents,          // translate the vocabulary
      currency: "usd",
      source: token,
    });
    if (intent.status !== "succeeded") throw new UpstreamFailure("stripe declined");
    return intent.id;               // translate the result back
  }
}
```

**The direction matters.** The adapter is owned by your side and implements your interface.
Writing the interface to match the vendor and calling that an adapter inverts the benefit:
the vendor's vocabulary spreads into your domain, and swapping vendors changes everything.

This is the class-level form of the same idea as a driven adapter in
`../styles/hexagonal.md`. The port is your interface; this is one implementation of it.

## Does TypeScript already do this

When the adaptee is a single call, a **function** is the whole pattern:

```ts
const stripeGateway: PaymentGateway = {
  charge: (cents, token) => sdk.createPaymentIntent({ amount: cents, currency: "usd", source: token })
                               .then(i => i.id),
};
```

Structural typing means anything with a matching `charge` satisfies `PaymentGateway`. No
`implements`, no class, no inheritance. Use a class when the adapter needs its own state
(a connection, a cache, a retry counter).

## Trade-offs

| Gain | Cost |
|---|---|
| Third-party vocabulary is confined to one file | One more indirection per integration |
| Swapping vendors touches one class | Adapters accumulate logic and quietly become a second domain layer |
| Your domain stays expressed in your own terms | Impedance mismatches (units, error models, nulls) still have to be decided somewhere |

**Where the real work lives:** unit conversion, error translation (vendor errors become your
error types), and null/absent semantics. That translation is the adapter's actual job. An
adapter that only renames methods is usually not needed.

## When NOT to use this

- **You control both sides.** Fix the interface instead of papering over the mismatch.
- **There is exactly one call and no translation.** Call it directly.
- **The mismatch is in the domain model, not the interface.** No adapter fixes a
  disagreement about what an "order" is; that needs a real translation layer.

## Relations

- **Decorator** (`decorator.md`) keeps the same interface and adds behaviour; Adapter
  changes the interface and adds none. Same code shape, different intent.
- **Facade** (`facade.md`) defines a new simpler interface over many objects; Adapter
  converts one existing interface into one existing other.
- **Bridge** (`bridge.md`) is designed in up front to let two hierarchies vary; Adapter is
  applied afterwards to code you did not design together.
