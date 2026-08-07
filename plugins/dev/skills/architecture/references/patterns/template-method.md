# Template Method

**Intent:** define the skeleton of an algorithm in a base class, letting subclasses override
specific steps without changing the structure.

## The force

Several variants share a sequence but differ in a few steps. Copy-pasting the sequence means
a fix to the shared part has to be applied N times, and one copy always gets missed.

```ts
// Three importers. The order is identical; only two steps differ.
// open → parse → validate → transform → save → close
```

## Structure

```ts
abstract class DataImporter {
  // The template method. FINAL by intent: the order is the invariant being protected.
  async import(path: string): Promise<Result> {
    const raw = await this.open(path);
    const rows = this.parse(raw);            // varies
    this.validate(rows);                     // shared
    const out = this.transform(rows);        // varies
    await this.save(out);                    // shared
    this.onFinished();                       // hook: optional, default does nothing
    return { count: out.length };
  }

  protected abstract parse(raw: string): Row[];        // subclasses MUST supply
  protected abstract transform(rows: Row[]): Row[];

  protected onFinished(): void {}                      // subclasses MAY supply
  private validate(rows: Row[]): void { /* shared, not overridable */ }
}

class CsvImporter extends DataImporter {
  protected parse(raw: string) { return raw.split("\n").map(splitCsvLine) }
  protected transform(rows: Row[]) { return rows.filter(r => r.length > 0) }
}
```

Three kinds of step, and choosing correctly is the design work:

| Kind | Access | Meaning |
|---|---|---|
| **Abstract** | `protected abstract` | every subclass must supply it |
| **Hook** | `protected` with empty default | optional extension point |
| **Fixed** | `private` | part of the invariant; not overridable |

Making everything overridable defeats the purpose. The value is the steps that **cannot** be
changed.

## Does TypeScript already do this

**Prefer the function form.** Pass the varying steps as arguments instead of subclassing:

```ts
type ImportSteps = {
  parse: (raw: string) => Row[];
  transform: (rows: Row[]) => Row[];
  onFinished?: () => void;
};

async function importData(path: string, steps: ImportSteps): Promise<Result> {
  const rows = steps.parse(await open(path));
  validate(rows);
  const out = steps.transform(rows);
  await save(out);
  steps.onFinished?.();
  return { count: out.length };
}

await importData("data.csv", { parse: splitCsv, transform: dropEmpty });
```

**Why this is better:** no inheritance, so one importer can be composed from steps taken
from several sources; steps are individually testable; and there is no protected/private
ceremony. This is Template Method converted into `strategy.md`, which is the standard advice
whenever the two compete.

Keep the class form when subclasses share substantial **state** as well as steps.

## Trade-offs

| Gain | Cost |
|---|---|
| The algorithm's shape is written once and enforced | Inheritance: one parent only, fixed at compile time |
| Subclasses cannot accidentally reorder steps | Callers must read the base class to understand a subclass |
| Common code genuinely shared, not copied | Inverted control is disorienting: the base calls you |

**Watch for the Liskov violation.** A subclass that overrides a step in a way the skeleton
does not expect (returning nothing, throwing where the base assumes success) breaks the
algorithm for every caller. That is `UNI-03` Abstract Pretender in `dev:code-roast`'s
`sin-registry.md`.

## When NOT to use this

- **Only one or two steps vary and there is no shared state.** Use functions, as above.
- **Subclasses need to change the order.** The fixed order is the entire pattern; if it must
  vary, you want `chain-of-responsibility.md` or an explicit pipeline.
- **The hierarchy exists only to share the skeleton.** Composition is cheaper.
- **You are tempted to add a fifth hook.** The skeleton is not stable, so it should not be a
  skeleton.

## Relations

- **Strategy** (`strategy.md`) solves the same problem by composition rather than
  inheritance, at runtime rather than compile time. **Prefer Strategy**: a class can hold
  many strategies but can only have one parent.
- **Factory Method** (`factory-method.md`) is often a step *within* a template method.
- The base class holds the invariant, which makes this the class-level analogue of the
  dependency direction rule in `../styles/layered.md`.
