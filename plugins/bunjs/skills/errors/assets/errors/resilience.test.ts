import { describe, test, expect, mock } from "bun:test";
import { withTimeout, retry, defaultIsRetryable, CircuitBreaker } from "./resilience";
import { BadRequest, RateLimited, Timeout, UpstreamFailure } from "./catalog";
import { AppError } from "./app-error";

/** Deterministic fakes: a retry suite that really sleeps is a slow, flaky suite. */
const noSleep = async (_ms: number) => {};
const fixedRandom = () => 0.5;

describe("withTimeout", () => {
  test("returns the value when the work finishes in time", async () => {
    expect(await withTimeout("fast", 1000, async () => "ok")).toBe("ok");
  });

  test("throws a Timeout carrying the operation name and budget", async () => {
    const err = await withTimeout("slow-op", 20, async (signal) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (signal.aborted) throw new Error("aborted");
      return "never";
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Timeout);
    expect((err as Timeout).message).toBe("slow-op timed out after 20ms");
    expect((err as Timeout).context).toEqual({ operation: "slow-op", timeoutMs: 20 });
  });

  test("passes a signal that actually aborts, so the work can stop", async () => {
    let observedAbort = false;
    await withTimeout("abortable", 20, async (signal) => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }).catch(() => {});
    expect(observedAbort).toBe(true);
  });

  test("a real failure is re-thrown as itself, NOT relabelled as a timeout", async () => {
    const err = await withTimeout("op", 1000, async () => {
      throw new BadRequest("bad input");
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequest);
  });

  test("clears its timer — a leaked timer keeps the loop alive for the full budget", async () => {
    const t0 = Bun.nanoseconds();
    await withTimeout("quick", 5000, async () => "done");
    // If the timer leaked, the test file itself would hang for 5s at exit.
    expect((Bun.nanoseconds() - t0) / 1e6).toBeLessThan(200);
  });
});

describe("defaultIsRetryable", () => {
  test("4xx is not retried — the same bad request will fail again", () => {
    expect(defaultIsRetryable(new BadRequest("nope"))).toBe(false);
  });

  test("429 IS retried — the server explicitly said 'later'", () => {
    expect(defaultIsRetryable(new RateLimited(1))).toBe(true);
  });

  test("5xx and unknown transport errors are retried", () => {
    expect(defaultIsRetryable(new UpstreamFailure("stripe"))).toBe(true);
    expect(defaultIsRetryable(new Error("ECONNRESET"))).toBe(true);
  });
});

describe("retry", () => {
  test("returns the first success without sleeping", async () => {
    const sleep = mock(noSleep);
    const out = await retry(async () => "ok", { sleep, random: fixedRandom });
    expect(out).toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });

  test("retries up to `attempts` and then throws the last error", async () => {
    const fn = mock(async () => {
      throw new UpstreamFailure("db");
    });
    const err = await retry(fn, { attempts: 3, sleep: noSleep, random: fixedRandom }).catch((e) => e);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(UpstreamFailure);
  });

  test("stops immediately on a non-retryable error — no wasted round trips", async () => {
    const fn = mock(async () => {
      throw new BadRequest("malformed");
    });
    await retry(fn, { attempts: 5, sleep: noSleep, random: fixedRandom }).catch(() => {});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("succeeds on a later attempt and reports the attempt number", async () => {
    let calls = 0;
    const out = await retry(
      async (attempt) => {
        calls++;
        if (attempt < 3) throw new UpstreamFailure("flaky");
        return `ok-on-${attempt}`;
      },
      { attempts: 5, sleep: noSleep, random: fixedRandom },
    );
    expect(out).toBe("ok-on-3");
    expect(calls).toBe(3);
  });

  test("backoff doubles and is capped by maxDelayMs", async () => {
    const delays: number[] = [];
    await retry(
      async () => {
        throw new UpstreamFailure("db");
      },
      {
        attempts: 6,
        baseDelayMs: 100,
        maxDelayMs: 500,
        random: () => 1, // full jitter at its maximum isolates the cap
        sleep: async (ms) => void delays.push(ms),
      },
    ).catch(() => {});
    // 100, 200, 400, then capped at 500, 500
    expect(delays).toEqual([100, 200, 400, 500, 500]);
  });

  test("jitter spreads retries — identical clients must not stampede together", async () => {
    const seen = new Set<number>();
    for (const r of [0.01, 0.3, 0.77, 0.99]) {
      await retry(
        async () => {
          throw new UpstreamFailure("db");
        },
        { attempts: 2, baseDelayMs: 1000, random: () => r, sleep: async (ms) => void seen.add(ms) },
      ).catch(() => {});
    }
    expect(seen.size).toBe(4); // four clients, four different delays
  });

  test("onRetry observes each retry for logging", async () => {
    const events: number[] = [];
    await retry(
      async () => {
        throw new UpstreamFailure("db");
      },
      {
        attempts: 3,
        sleep: noSleep,
        random: fixedRandom,
        onRetry: ({ attempt }) => void events.push(attempt),
      },
    ).catch(() => {});
    expect(events).toEqual([1, 2]); // fired between attempts, not after the last
  });
});

describe("CircuitBreaker", () => {
  const failing = async () => {
    throw new UpstreamFailure("payments");
  };

  test("stays closed while calls succeed", async () => {
    const cb = new CircuitBreaker("payments", { threshold: 3 });
    expect(await cb.run(async () => "ok")).toBe("ok");
    expect(cb.currentState).toBe("closed");
  });

  test("opens after `threshold` consecutive failures", async () => {
    const cb = new CircuitBreaker("payments", { threshold: 3 });
    for (let i = 0; i < 3; i++) await cb.run(failing).catch(() => {});
    expect(cb.currentState).toBe("open");
  });

  test("while open it rejects WITHOUT calling through — that is the whole point", async () => {
    const cb = new CircuitBreaker("payments", { threshold: 2, resetMs: 10_000, now: () => 1000 });
    for (let i = 0; i < 2; i++) await cb.run(failing).catch(() => {});

    const inner = mock(async () => "should not run");
    const err = await cb.run(inner).catch((e) => e);
    expect(inner).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(UpstreamFailure);
    expect((err as AppError).context).toMatchObject({ breaker: "open" });
  });

  test("a success counter resets on success, so intermittent blips never open it", async () => {
    const cb = new CircuitBreaker("payments", { threshold: 3 });
    await cb.run(failing).catch(() => {});
    await cb.run(failing).catch(() => {});
    await cb.run(async () => "ok");
    await cb.run(failing).catch(() => {});
    expect(cb.currentState).toBe("closed");
  });

  test("after resetMs it half-opens and a success closes it", async () => {
    let now = 1000;
    const cb = new CircuitBreaker("payments", { threshold: 1, resetMs: 500, now: () => now });
    await cb.run(failing).catch(() => {});
    expect(cb.currentState).toBe("open");

    now += 600; // deadline passed
    expect(await cb.run(async () => "recovered")).toBe("recovered");
    expect(cb.currentState).toBe("closed");
  });

  test("a failed probe re-opens immediately, without waiting for the threshold again", async () => {
    let now = 1000;
    const cb = new CircuitBreaker("payments", { threshold: 5, resetMs: 500, now: () => now });
    for (let i = 0; i < 5; i++) await cb.run(failing).catch(() => {});
    expect(cb.currentState).toBe("open");

    now += 600;
    await cb.run(failing).catch(() => {}); // the single probe fails
    expect(cb.currentState).toBe("open");
  });
});

describe("composition: timeout inside retry", () => {
  test("each attempt gets its OWN deadline, so retries actually happen", async () => {
    const starts: number[] = [];
    let attempt = 0;

    const out = await retry(
      () =>
        withTimeout("upstream", 30, async (signal) => {
          starts.push(++attempt);
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 100)); // blows the per-attempt budget
            if (signal.aborted) throw new Error("aborted");
          }
          return "ok";
        }),
      { attempts: 4, sleep: noSleep, random: fixedRandom },
    );

    expect(out).toBe("ok");
    expect(starts).toEqual([1, 2, 3]); // two timeouts, then success
  });
});
