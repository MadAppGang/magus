# Bridge

**Intent:** split a large class or a set of closely related classes into two separate
hierarchies, abstraction and implementation, which can vary independently.

## The force

**Class explosion from crossing two dimensions in one hierarchy.** The signal is names that
multiply:

```
Shape
├── Circle            →   CircleRedRenderer, CircleVectorRenderer, CircleRasterRenderer
├── Square                SquareRedRenderer, SquareVectorRenderer, SquareRasterRenderer
└── Triangle              TriangleVector…, TriangleRaster…               (M × N classes)
```

Three shapes × three renderers is nine classes. Add a shape: three more. Add a renderer:
three more. The growth is multiplicative because two independent reasons to change were put
in one inheritance tree.

## Structure

Make one dimension a field instead of a subclass. M × N becomes M + N.

```ts
// Implementation hierarchy — varies on its own.
interface Renderer { drawCircle(r: number): string }
class VectorRenderer implements Renderer { drawCircle(r: number) { return `vector circle r=${r}` } }
class RasterRenderer implements Renderer { drawCircle(r: number) { return `pixels for r=${r}` } }

// Abstraction hierarchy — varies on its own, HOLDS a renderer rather than inheriting one.
abstract class Shape {
  constructor(protected renderer: Renderer) {}   // <- the bridge
  abstract draw(): string;
}
class Circle extends Shape {
  constructor(renderer: Renderer, private radius: number) { super(renderer) }
  draw() { return this.renderer.drawCircle(this.radius) }
}

new Circle(new VectorRenderer(), 5).draw();
new Circle(new RasterRenderer(), 5).draw();   // same shape, different implementation
```

Now three shapes and three renderers is six classes, and either side grows by one at a time.

**The distinguishing feature versus Strategy:** both hold an interface as a field. Bridge is
a *structural* decision made when designing the hierarchy, and both sides are expected to
grow into hierarchies of their own. Strategy is a *behavioural* choice about one algorithm.
If both dimensions have subclasses, it is a Bridge.

## Does TypeScript already do this

The composition is the pattern; there is no lighter native form. But the abstraction side
often does not need to be a class hierarchy at all:

```ts
type Renderer = { drawCircle(r: number): string };
const circle = (renderer: Renderer, radius: number) => ({ draw: () => renderer.drawCircle(radius) });
```

Keep classes when the abstraction side genuinely has several variants with shared state.

## Trade-offs

| Gain | Cost |
|---|---|
| M + N classes instead of M × N; each dimension evolves alone | Indirection, and the design must be seen up front to be cheap |
| Implementation is swappable at runtime, not fixed at compile time | Over-applied to a single dimension, it is pure overhead |
| Platform details stay out of the abstraction | The interface between the two halves is hard to get right early |

## When NOT to use this

- **There is only one dimension of variation.** You want plain inheritance or Strategy.
- **The second dimension has exactly one implementation** and no second is coming.
- **The dimensions are not independent.** If certain shape/renderer combinations are invalid,
  the split is fighting the domain, and `abstract-factory.md` may be the better fit.

## Relations

- **Abstract Factory** (`abstract-factory.md`) can create and pair matched bridge halves.
- **Adapter** (`adapter.md`) achieves interoperability *after the fact*; Bridge is planned
  before either hierarchy exists.
- **Strategy** (`strategy.md`) is the same composition with a narrower purpose: one
  swappable algorithm rather than a whole implementation hierarchy.
