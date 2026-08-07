/**
 * Strategy, in the form TypeScript actually wants: a function type plus a registry.
 *
 * See references/patterns/strategy.md. The class-with-one-method form is not here on
 * purpose -- it buys nothing over a function unless the strategy needs its own state,
 * in which case use `KeyedStrategy` below.
 */

/** A strategy with one operation IS a function. Do not wrap this in a class. */
export type Strategy<In, Out> = (input: In) => Out;

/**
 * A strategy that needs more than one operation, or metadata. THIS is when an object
 * is justified: `name` records which strategy ran, `verify` is a second operation.
 */
export interface KeyedStrategy<In, Out> {
  readonly name: string;
  execute(input: In): Out;
}

export class UnknownStrategyError extends Error {
  constructor(
    readonly requested: string,
    readonly available: readonly string[],
  ) {
    super(`unknown strategy "${requested}"; available: ${available.join(", ") || "(none)"}`);
    this.name = "UnknownStrategyError";
  }
}

/**
 * A closed registry. The point of Strategy is that adding a case does not edit
 * existing code -- so `register` exists, and `get` never falls back to a default.
 *
 * Silent fallback is the bug this class is designed to prevent: routing an unknown
 * key to a "default" strategy turns a typo into wrong behaviour that still returns 200.
 */
export class StrategyRegistry<In, Out> {
  readonly #entries = new Map<string, Strategy<In, Out>>();

  constructor(initial: Readonly<Record<string, Strategy<In, Out>>> = {}) {
    for (const [key, fn] of Object.entries(initial)) this.#entries.set(key, fn);
  }

  register(key: string, fn: Strategy<In, Out>): this {
    this.#entries.set(key, fn);
    return this;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  /** Throws on an unknown key. Never guesses. */
  get(key: string): Strategy<In, Out> {
    const fn = this.#entries.get(key);
    if (!fn) throw new UnknownStrategyError(key, this.keys());
    return fn;
  }

  run(key: string, input: In): Out {
    return this.get(key)(input);
  }

  keys(): readonly string[] {
    return [...this.#entries.keys()].sort();
  }
}

/**
 * Exhaustiveness helper for the CLOSED-set case, where a switch beats a registry.
 * Adding a variant becomes a COMPILE error at every switch, which no registry can do.
 *
 * See references/selection.md: 1-2 stable branches -> switch; 5+ or open -> registry.
 */
export function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}
