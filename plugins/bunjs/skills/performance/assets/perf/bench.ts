/**
 * A micro-benchmark harness that reports honestly.
 *
 * Most hand-rolled benchmarks are wrong in the same three ways, and each one produces a
 * number that is confidently misleading:
 *
 *   1. No warmup. JavaScriptCore interprets first and optimises after a function gets hot,
 *      so the first iterations measure the interpreter, not your code.
 *   2. A single sample reported as "the" number. Scheduler noise, GC and CPU frequency
 *      scaling move results by tens of percent between runs.
 *   3. A mean. One GC pause makes the mean useless; the median and the spread are what
 *      you can actually reason about.
 *
 * MEASURED: `Bun.nanoseconds()` has ~42 ns granularity (consecutive-call deltas were
 * 42, 0, 42, 0, 0). Anything faster than roughly a microsecond MUST be measured in a
 * loop — a single call cannot resolve it, and a benchmark that ignores this reports 0.
 */

export interface BenchResult {
  name: string;
  /** Nanoseconds per operation. */
  median: number;
  min: number;
  p95: number;
  /** Median absolute deviation — robust spread, unlike stddev which one GC pause wrecks. */
  mad: number;
  samples: number;
  opsPerSecond: number;
  iterationsPerSample: number;
}

export interface BenchOptions {
  /** Iterations discarded before measuring. Default 100. */
  warmup?: number;
  /** Number of timed samples. Default 30. */
  samples?: number;
  /**
   * Iterations per sample. Leave undefined to calibrate automatically so each sample
   * spans well past the clock's resolution.
   */
  iterations?: number;
  /** Target duration per sample when calibrating, in ms. Default 10. */
  targetSampleMs?: number;
}

const median = (sorted: readonly number[]): number => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
};

const quantile = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;

/**
 * Find an iteration count whose total time is comfortably above clock resolution.
 * Without this, a 20 ns function measured one iteration at a time reports either 0 or 42.
 */
function calibrate(fn: () => unknown, targetMs: number): number {
  let iterations = 1;
  for (let attempt = 0; attempt < 30; attempt++) {
    const started = Bun.nanoseconds();
    for (let i = 0; i < iterations; i++) fn();
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;
    if (elapsedMs >= targetMs) return iterations;
    // Grow geometrically, but never less than 2x, so calibration terminates quickly.
    const growth = elapsedMs > 0 ? Math.max(2, Math.ceil(targetMs / elapsedMs)) : 8;
    iterations *= growth;
  }
  return iterations;
}

/** Benchmark a synchronous function. */
export function bench(name: string, fn: () => unknown, options: BenchOptions = {}): BenchResult {
  const { warmup = 100, samples = 30, targetSampleMs = 10 } = options;

  for (let i = 0; i < warmup; i++) fn(); // let the JIT optimise before we start timing
  const iterations = options.iterations ?? calibrate(fn, targetSampleMs);

  const perOp: number[] = [];
  for (let s = 0; s < samples; s++) {
    const started = Bun.nanoseconds();
    for (let i = 0; i < iterations; i++) fn();
    perOp.push((Bun.nanoseconds() - started) / iterations);
  }

  return summarize(name, perOp, iterations);
}

/** Benchmark an async function. Awaiting per iteration adds overhead — compare like with like. */
export async function benchAsync(name: string, fn: () => Promise<unknown>, options: BenchOptions = {}): Promise<BenchResult> {
  const { warmup = 20, samples = 20, iterations = 50 } = options;

  for (let i = 0; i < warmup; i++) await fn();

  const perOp: number[] = [];
  for (let s = 0; s < samples; s++) {
    const started = Bun.nanoseconds();
    for (let i = 0; i < iterations; i++) await fn();
    perOp.push((Bun.nanoseconds() - started) / iterations);
  }

  return summarize(name, perOp, iterations);
}

function summarize(name: string, perOp: number[], iterationsPerSample: number): BenchResult {
  const sorted = [...perOp].sort((a, b) => a - b);
  const med = median(sorted);
  const deviations = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);

  return {
    name,
    median: med,
    min: sorted[0] ?? 0,
    p95: quantile(sorted, 0.95),
    mad: median(deviations),
    samples: perOp.length,
    iterationsPerSample,
    opsPerSecond: med > 0 ? 1e9 / med : Infinity,
  };
}

/** Human-readable duration; picks a unit that keeps 3 significant figures. */
export function formatNs(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(1)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

/**
 * Compare results against the first as a baseline.
 *
 * The ratio is reported alongside the spread on purpose: a 5% difference with a MAD of
 * 15% is noise, and presenting it as a win is how micro-optimisations get merged that
 * do nothing. `significant` encodes that judgement instead of leaving it to the reader.
 */
export function compare(results: readonly BenchResult[]): string {
  if (results.length === 0) return "(no results)";
  const baseline = results[0]!;
  const lines = [
    `${"name".padEnd(28)} ${"median".padStart(12)} ${"ops/sec".padStart(14)} ${"±MAD".padStart(10)}  vs baseline`,
    "-".repeat(84),
  ];

  for (const r of results) {
    const ratio = baseline.median > 0 ? r.median / baseline.median : 1;
    const relativeSpread = r.median > 0 ? r.mad / r.median : 0;
    const significant = Math.abs(ratio - 1) > Math.max(0.05, relativeSpread * 2);
    const verdict =
      r === baseline ? "baseline" : !significant ? "~same (within noise)" : ratio < 1 ? `${(1 / ratio).toFixed(2)}x faster` : `${ratio.toFixed(2)}x slower`;

    lines.push(
      `${r.name.padEnd(28)} ${formatNs(r.median).padStart(12)} ${Math.round(r.opsPerSecond).toLocaleString().padStart(14)} ${`${(relativeSpread * 100).toFixed(1)}%`.padStart(10)}  ${verdict}`,
    );
  }
  return lines.join("\n");
}

/**
 * Measure how long a synchronous block blocks the event loop.
 *
 * This is the number that matters for a server, and it is not the same as throughput:
 * MEASURED, chunking a 30 ms computation with `await Bun.sleep(0)` between chunks kept a
 * 1 ms timer firing 40 times instead of 1 — but made the total **6x slower** (30 ms → 181 ms).
 * Responsiveness and throughput trade against each other; measure both before choosing.
 */
export async function measureLoopBlocking(fn: () => unknown | Promise<unknown>): Promise<{ wallMs: number; ticksObserved: number }> {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
  }, 1);

  await Bun.sleep(5); // let the interval settle before measuring
  ticks = 0;

  const started = Bun.nanoseconds();
  await fn();
  const wallMs = (Bun.nanoseconds() - started) / 1e6;

  clearInterval(timer);
  return { wallMs, ticksObserved: ticks };
}
