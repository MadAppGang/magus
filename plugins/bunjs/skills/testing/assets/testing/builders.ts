/**
 * Test-data builders.
 *
 * The problem they solve: a test that constructs a full 20-field object buries the ONE
 * field the test is about. Six months later nobody can tell which fields matter, so
 * nobody dares change any of them, and the suite calcifies.
 *
 * A builder inverts that — a complete valid object by default, and the test states only
 * its deviation. `aUser({ age: -1 })` says "this test is about a negative age" in a way
 * a 20-line literal never can.
 */

/** Deep-ish merge: nested objects merge, arrays and primitives replace. */
type DeepPartial<T> = T extends ReadonlyArray<unknown> ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function merge<T>(base: T, patch: DeepPartial<T>): T {
  if (patch === undefined) return base;
  if (base === null || typeof base !== "object" || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const prev = out[k];
    out[k] =
      v !== null && typeof v === "object" && !Array.isArray(v) && prev !== null && typeof prev === "object" && !Array.isArray(prev)
        ? merge(prev, v as DeepPartial<unknown>)
        : v;
  }
  return out as T;
}

/**
 * Build a builder. `defaults` is a FUNCTION so each call gets fresh objects — a shared
 * default object would let one test's mutation leak into the next, which is the exact
 * cross-test coupling builders are supposed to eliminate.
 *
 * The `seq` argument makes unique values trivial: ids and emails that never collide,
 * without pulling in a random-data library whose output you then cannot reproduce.
 */
export function builderFor<T>(defaults: (seq: number) => T) {
  let counter = 0;
  const build = (overrides: DeepPartial<T> = {} as DeepPartial<T>): T => merge(defaults(++counter), overrides);
  /** N distinct instances; the callback can vary each one by index. */
  build.many = (n: number, vary: (i: number) => DeepPartial<T> = () => ({}) as DeepPartial<T>): T[] =>
    Array.from({ length: n }, (_, i) => build(vary(i)));
  /** Reset the sequence so a suite can assert on exact ids. */
  build.reset = () => {
    counter = 0;
  };
  return build;
}

/**
 * Deterministic pseudo-random source.
 *
 * `Math.random()` in tests produces a suite that fails once a week and passes on rerun,
 * which trains everyone to rerun instead of investigate. Seed it, and a failure is
 * reproducible from the seed alone. Print the seed on failure.
 */
export function seededRandom(seed = 42) {
  // mulberry32 — small, fast, good enough for test data, fully reproducible.
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    /** Fisher–Yates on a copy — never mutate the caller's array. */
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}

/**
 * Wait for a condition instead of sleeping a guessed duration.
 *
 * `await Bun.sleep(500)` is the other great flake generator: too short on a loaded CI
 * runner, and wasted wall-clock everywhere else. Polling turns "probably long enough"
 * into "as soon as it is true, and fail loudly if it never is".
 */
export async function waitFor<T>(
  condition: () => T | Promise<T>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<NonNullable<T>> {
  const { timeoutMs = 2000, intervalMs = 10, message = "condition" } = options;
  const deadline = Bun.nanoseconds() + timeoutMs * 1e6;
  let last: unknown;
  while (Bun.nanoseconds() < deadline) {
    try {
      const value = await condition();
      if (value) return value as NonNullable<T>;
      last = value;
    } catch (err) {
      last = err; // keep polling; the resource may not exist yet
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`waitFor(${message}) timed out after ${timeoutMs}ms; last value: ${Bun.inspect(last)}`);
}
