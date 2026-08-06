import { describe, test, expect } from "bun:test";
import { bench, benchAsync, compare, formatNs, measureLoopBlocking } from "./bench";

describe("bench", () => {
  test("resolves work far below clock granularity by calibrating iterations", () => {
    // MEASURED: Bun.nanoseconds() has ~42ns granularity. A naive one-iteration timer
    // reports 0 or 42 for a function like this; calibration is what makes it measurable.
    const result = bench("tiny", () => 1 + 1, { samples: 5 });
    expect(result.iterationsPerSample).toBeGreaterThan(1000);
    expect(result.median).toBeGreaterThan(0);
    expect(Number.isFinite(result.opsPerSecond)).toBe(true);
  });

  test("reports median, min and p95 in a consistent order", () => {
    const result = bench("ordered", () => Math.sqrt(1234), { samples: 15 });
    expect(result.min).toBeLessThanOrEqual(result.median);
    expect(result.median).toBeLessThanOrEqual(result.p95);
    expect(result.mad).toBeGreaterThanOrEqual(0);
  });

  test("collects the requested number of samples", () => {
    expect(bench("n", () => 1, { samples: 12 }).samples).toBe(12);
  });

  test("an explicit iteration count is honoured, skipping calibration", () => {
    expect(bench("fixed", () => 1, { samples: 3, iterations: 77 }).iterationsPerSample).toBe(77);
  });

  test("actually runs the function — a harness that measures nothing is the real hazard", () => {
    let calls = 0;
    const result = bench("counted", () => { calls++; }, { samples: 4, iterations: 100, warmup: 10 });
    expect(calls).toBe(10 + 4 * 100);
    expect(result.samples).toBe(4);
  });

  test("distinguishes work that is genuinely ~10x apart", () => {
    const cheap = bench("cheap", () => 1 + 1, { samples: 20 });
    const costly = bench("costly", () => {
      let acc = 0;
      for (let i = 0; i < 2000; i++) acc += Math.sqrt(i);
      return acc;
    }, { samples: 20 });

    expect(costly.median).toBeGreaterThan(cheap.median * 10);
  });
});

describe("benchAsync", () => {
  test("measures async work and reports a plausible duration", async () => {
    const result = await benchAsync("sleep-1ms", () => Bun.sleep(1), { samples: 3, iterations: 3, warmup: 1 });
    // Each op sleeps ~1ms; allow generous headroom for scheduler noise.
    expect(result.median / 1e6).toBeGreaterThan(0.5);
    expect(result.median / 1e6).toBeLessThan(50);
  });

  test("awaits the function the expected number of times", async () => {
    let calls = 0;
    await benchAsync("counted", async () => { calls++; }, { samples: 2, iterations: 5, warmup: 3 });
    expect(calls).toBe(3 + 2 * 5);
  });
});

describe("compare", () => {
  const fake = (name: string, median: number, mad = 0) => ({
    name, median, min: median, p95: median, mad, samples: 10, iterationsPerSample: 100,
    opsPerSecond: 1e9 / median,
  });

  test("labels the first result as the baseline", () => {
    expect(compare([fake("a", 100), fake("b", 200)])).toContain("baseline");
  });

  test("reports a clear win when the gap exceeds the noise", () => {
    const out = compare([fake("slow", 1000, 10), fake("fast", 250, 5)]);
    expect(out).toContain("4.00x faster");
  });

  test("reports a clear loss", () => {
    expect(compare([fake("fast", 250, 5), fake("slow", 1000, 10)])).toContain("4.00x slower");
  });

  test("refuses to call a small difference a win when the spread is large", () => {
    // 5% apart with 15% MAD — presenting this as a win is how no-op optimisations merge.
    const out = compare([fake("a", 1000, 150), fake("b", 1050, 150)]);
    expect(out).toContain("~same (within noise)");
  });

  test("a tiny difference with a tight spread is still called noise below 5%", () => {
    expect(compare([fake("a", 1000, 1), fake("b", 1020, 1)])).toContain("~same (within noise)");
  });

  test("handles an empty list without throwing", () => {
    expect(compare([])).toBe("(no results)");
  });
});

describe("formatNs", () => {
  test("picks a readable unit at each scale", () => {
    expect(formatNs(42)).toBe("42.0 ns");
    expect(formatNs(1_500)).toBe("1.50 µs");
    expect(formatNs(2_500_000)).toBe("2.50 ms");
    expect(formatNs(3_000_000_000)).toBe("3.00 s");
  });
});

describe("measureLoopBlocking", () => {
  test("a synchronous block starves the event loop", async () => {
    const { wallMs, ticksObserved } = await measureLoopBlocking(() => {
      const until = Bun.nanoseconds() + 60e6; // busy-wait ~60ms
      while (Bun.nanoseconds() < until) {
        /* spin */
      }
    });

    expect(wallMs).toBeGreaterThan(40);
    // A 1ms timer could have fired ~60 times; blocked, it fires almost never.
    expect(ticksObserved).toBeLessThan(5);
  });

  test("yielding restores responsiveness — the trade the SKILL documents", async () => {
    const { ticksObserved } = await measureLoopBlocking(async () => {
      for (let chunk = 0; chunk < 20; chunk++) {
        const until = Bun.nanoseconds() + 3e6; // ~3ms of work
        while (Bun.nanoseconds() < until) {
          /* spin */
        }
        await Bun.sleep(0); // yield
      }
    });

    // Same total work as above, but the loop got to run between chunks.
    expect(ticksObserved).toBeGreaterThan(5);
  });

  test("reports a wall time for trivial work without hanging", async () => {
    const { wallMs } = await measureLoopBlocking(() => 1 + 1);
    expect(wallMs).toBeGreaterThanOrEqual(0);
    expect(wallMs).toBeLessThan(100);
  });
});
