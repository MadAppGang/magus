# Flyweight

**Intent:** share the common parts of many similar objects to fit more of them in memory.

**This is a memory optimization, not a design improvement.** Apply it after measuring, never
before. It is the narrowest pattern in the catalog.

## The force

Millions of objects, each duplicating identical data:

```ts
// 1,000,000 particles × a sprite buffer each. The sprite is the same 50 KB every time.
class Particle {
  constructor(
    public x: number, public y: number, public vx: number, public vy: number,
    public sprite: ArrayBuffer,   // identical across all particles of a type
    public color: string,         // identical
  ) {}
}
```

## Structure

Split state in two:

- **Intrinsic** — shared, immutable, identical across instances (the sprite, the color).
- **Extrinsic** — unique per instance, passed in at call time (position, velocity).

```ts
// Intrinsic: created once per distinct type, shared by every particle of that type.
class ParticleType {
  constructor(readonly sprite: ArrayBuffer, readonly color: string) {}
  draw(ctx: Ctx, x: number, y: number) { ctx.blit(this.sprite, x, y, this.color) }
}

// The factory is what enforces sharing. Without it there is no flyweight.
const types = new Map<string, ParticleType>();
function particleType(name: string): ParticleType {
  let t = types.get(name);
  if (!t) types.set(name, (t = new ParticleType(loadSprite(name), colorFor(name))));
  return t;
}

// Extrinsic: small, per-instance.
class Particle {
  constructor(public x: number, public y: number, private type: ParticleType) {}
  draw(ctx: Ctx) { this.type.draw(ctx, this.x, this.y) }
}
```

One million particles now hold one pointer each instead of one 50 KB buffer each.

**Intrinsic state must be immutable.** It is shared, so a mutation is visible to every
object using it. Freeze it, or treat immutability as an invariant you enforce in review.

## Does TypeScript already do this

Partly, and often enough to make the pattern unnecessary:

- **String interning.** JavaScript engines already share identical string literals.
- **Prototypes.** Methods live on the prototype, not per instance, so behaviour is already
  shared. Flyweight is only about *data*.
- **Module-level constants.** A shared config object imported everywhere is already one
  instance.

Which is why the honest use case is narrow: large numbers of small objects with large
duplicated payloads. Games, particle systems, tile maps, text editors with per-character
formatting.

## Trade-offs

| Gain | Cost |
|---|---|
| Memory drops sharply when duplication is real | Code becomes harder to read: state is split across two objects |
| Fewer allocations means less GC pressure | Extrinsic state must be threaded through every call |
| | The factory must be the only construction path, or sharing silently fails |
| | Shared mutable intrinsic state is a whole class of bug |

## When NOT to use this

- **You have not measured.** This is premature optimization in its most literal form. Take a
  heap snapshot first; the duplication is often not where you think.
- **Object counts are in the thousands, not millions.** Modern runtimes handle that fine.
- **The "shared" state is not truly identical**, or needs to vary later.
- **The objects are short-lived.** The GC already handles that better than you will.

## Relations

- The factory that hands out shared instances is a **Factory Method**
  (`factory-method.md`), and is often exposed as a **Singleton** (`singleton.md`) — a module
  `const` is the better form.
- **Composite** (`composite.md`) leaves are a common place to apply this, since a tree may
  hold huge numbers of similar leaves.
- **Proxy** (`proxy.md`) also reduces cost, but by deferring creation rather than sharing it.
