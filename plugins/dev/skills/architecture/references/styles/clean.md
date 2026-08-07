# Clean architecture

Robert Martin's synthesis of hexagonal, onion, and DCI. Read `hexagonal.md` first: clean
architecture is that idea plus a prescribed interior and one named rule.

## The Dependency Rule

**Source code dependencies point only inward.** Nothing in an inner circle knows the name
of anything in an outer circle: not a class, not a function, not a variable, and above all
not a data format.

```
        ┌────────────────────────────────────┐
        │  Frameworks & Drivers              │  Bun.serve, Postgres driver, React
        │  ┌──────────────────────────────┐  │
        │  │  Interface Adapters          │  │  controllers, presenters, repositories
        │  │  ┌────────────────────────┐  │  │
        │  │  │  Use Cases             │  │  │  application-specific business rules
        │  │  │  ┌──────────────────┐  │  │  │
        │  │  │  │  Entities        │  │  │  │  enterprise-wide business rules
        │  │  │  └──────────────────┘  │  │  │
        │  │  └────────────────────────┘  │  │
        │  └──────────────────────────────┘  │
        └────────────────────────────────────┘
                   dependencies ────▶ inward only
```

## The four rings

| Ring | Holds | Changes when |
|---|---|---|
| **Entities** | rules true regardless of application: `Order.total()`, `Money` arithmetic, invariants | the business itself changes |
| **Use cases** | one class or function per application action: `PlaceOrder`, `CancelSubscription` | what the app *does* changes |
| **Interface adapters** | controllers, presenters, gateways, repository implementations; format conversion | a delivery or storage format changes |
| **Frameworks & drivers** | Bun, the SQL driver, the HTTP client; glue you did not write | you upgrade or replace a vendor |

The distinction people get wrong is **entities vs use cases**. An entity rule holds even if
this application did not exist ("an order's total is the sum of its lines"). A use-case rule
exists because this application does a thing ("placing an order emails a receipt").

## Crossing a boundary inward

The awkward part, and the part that carries the whole design. A use case must return data
to a controller without depending on it. So the use case defines *both* sides of its
conversation:

```ts
// use-cases/place-order.ts — the inner ring owns these shapes.
export interface PlaceOrderInput  { customerId: string; lines: OrderLine[] }
export interface PlaceOrderOutput { orderId: string; total: number; currency: string }

export interface OrderGateway { save(order: Order): Promise<void> }   // port, owned here

export function makePlaceOrder(orders: OrderGateway) {
  return async (input: PlaceOrderInput): Promise<PlaceOrderOutput> => {
    const order = Order.place(input.customerId, input.lines);  // entity enforces invariants
    await orders.save(order);
    return { orderId: order.id, total: order.total().amount, currency: order.total().currency };
  };
}
```

`PlaceOrderOutput` is a plain data structure defined in the inner ring. The controller maps
it to JSON; the use case never learns that JSON exists. **Never pass an entity across the
boundary** and never pass a database row inward: both couple the rings to a format.

## Trade-offs

| Gain | Cost |
|---|---|
| Business rules survive framework and database replacement | A lot of files and DTO mapping per use case |
| Use cases read as an inventory of what the system does | Two structurally similar types (input DTO, entity) tempt people to merge them, which breaks the rule |
| Teams get one prescribed layout, so debates stop | The prescription is heavy for small apps and is frequently cargo-culted |

## The failure mode to watch for

**The shared model.** One `User` type used as the ORM row, the entity, the use-case DTO, and
the JSON response. It removes all the mapping code and all the benefit at once, because now
a column rename propagates to the API contract. If you are going to share the model, you do
not need clean architecture; use `layered.md` honestly instead of clean architecture
dishonestly.

**Ring inflation.** Four rings are a suggestion, not a law. Martin says as much. Teams that
add rings to be safe get import rules nobody can recite.

## When NOT to use this

- **CRUD with thin rules.** If use cases are "validate, save, return", the ceremony is pure
  overhead. Use `layered.md`.
- **Small teams shipping fast on an unproven product.** The layout's value is durability;
  you pay upfront and collect years later, and most products do not get there.
- **When you only need infrastructure swappability.** Plain `hexagonal.md` gives you that
  with fewer prescriptions.

## Relation to other styles

Clean, hexagonal, and onion are one family: dependency inversion at the application
boundary. They differ in how much interior layout they mandate (hexagonal: none; onion:
some; clean: most). Pick by how much prescription your team wants, not by which diagram is
prettiest.
