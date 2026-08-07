# Abstract Factory

**Intent:** create families of related objects without specifying their concrete classes,
and guarantee the products used together are compatible.

## The force

Factory Method varies one product. Abstract Factory exists for the case where **several
products must match each other** and mixing them is a bug.

```ts
// The failure this prevents: a Mac-styled button next to a Windows-styled checkbox,
// or a Postgres connection paired with a SQLite migration runner.
const button = new MacButton();
const checkbox = new WindowsCheckbox();   // compiles, runs, and is wrong
```

The invariant is *consistency across a family*. One factory instance produces one coherent
set, so the mismatch becomes unrepresentable.

## Structure

```ts
interface Button   { render(): string }
interface Checkbox { render(): string }

interface UIFactory {                       // the family contract
  createButton(): Button;
  createCheckbox(): Checkbox;
}

class MacFactory implements UIFactory {
  createButton()   { return new MacButton() }
  createCheckbox() { return new MacCheckbox() }
}
class WindowsFactory implements UIFactory {
  createButton()   { return new WindowsButton() }
  createCheckbox() { return new WindowsCheckbox() }
}

// The app is written once against the interface and never names a platform.
function renderForm(ui: UIFactory): string {
  return ui.createButton().render() + ui.createCheckbox().render();
}
```

The concrete factory is chosen **once**, at startup, in the composition root. Everything
downstream is platform-agnostic by construction.

## Does TypeScript already do this

An object literal of factory functions is the same guarantee with less ceremony:

```ts
type UIFactory = { button: () => Button; checkbox: () => Checkbox };

const mac: UIFactory     = { button: () => new MacButton(),     checkbox: () => new MacCheckbox() };
const windows: UIFactory = { button: () => new WindowsButton(), checkbox: () => new WindowsCheckbox() };

const ui = process.platform === "darwin" ? mac : windows;   // chosen once
```

The structural typing means the object literal satisfies `UIFactory` with no `implements`
and no class. Prefer this unless a factory needs its own state.

## Trade-offs

| Gain | Cost |
|---|---|
| Mismatched products become impossible, not merely discouraged | Adding a *product type* means editing the interface and every concrete factory |
| Concrete classes appear in exactly one place | The most ceremonious creational pattern; many classes for a small idea |
| Swapping the whole family is a one-line change at the root | Over-applied to families that will only ever have one member |

**The asymmetry is the thing to understand before choosing it:** adding a new *family*
(a third platform) is cheap, one new factory. Adding a new *product* (a third widget type)
is expensive, it edits every factory. Pick this pattern when families grow and products are
stable, not the reverse.

## When NOT to use this

- **Only one family exists** and no second is planned. You have written an indirection with
  a single implementation.
- **Products do not actually need to match.** If a Mac button next to a Windows checkbox is
  merely odd rather than broken, plain factories are enough.
- **Product types churn more than families do.** The asymmetry above works against you.

## Relations

- Built from **Factory Method** (`factory-method.md`) methods, one per product.
- The concrete factory is often a **Singleton** (`singleton.md`); in TypeScript it should be
  a module-level `const` instead.
- The chosen factory is passed in at composition time, which is the same move as a port in
  `../styles/hexagonal.md`: choose the implementation once, at the edge.
