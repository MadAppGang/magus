/**
 * Timeout, retry and circuit breaking — the three things every network call needs
 * and that no fetch wrapper gives you for free.
 *
 * The ordering matters and is the part people get wrong: the timeout goes INSIDE
 * the retry, per attempt. A retry wrapped in one outer timeout gives you a budget
 * that the first slow attempt consumes entirely, so the retries never happen.
 */
import { Timeout, UpstreamFailure } from "./catalog";
import { AppError } from "./app-error";

/**
 * Run `fn` with a deadline. The AbortSignal is passed IN so the underlying work
 * can actually stop — a timeout that only stops *waiting* still leaves the socket
 * open and the upstream doing work you no longer want. `fetch` honours this.
 */
export async function withTimeout<T>(
  operation: string,
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (err) {
    // Distinguish "we gave up" from "the callee failed" — they page differently.
    if (controller.signal.aborted) throw new Timeout(operation, ms, { cause: err });
    throw err;
  } finally {
    clearTimeout(timer); // without this the timer pins the loop open for `ms`
  }
}

export interface RetryOptions {
  attempts?: number;
  /** Delay before attempt 2. Each subsequent delay doubles. Default 100ms. */
  baseDelayMs?: number;
  /** Ceiling for a single delay. Default 5s. */
  maxDelayMs?: number;
  /**
   * Decides whether a failure is worth retrying. Default: retry anything that is
   * NOT a 4xx AppError — retrying a 400 just sends the same bad request again.
   */
  isRetryable?: (err: unknown) => boolean;
  /** Injectable for tests so a retry suite does not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. Must return [0,1). */
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
}

export function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof AppError) {
    if (err.status === 429) return true; // explicitly "come back later"
    return err.status >= 500; // 5xx and transport failures
  }
  return true; // unknown transport error — worth one more go
}

/**
 * Retry with exponential backoff and FULL JITTER.
 *
 * Jitter is not a nicety. Without it, every client that failed during an outage
 * retries at the same instants, and the upstream is re-flattened the moment it
 * recovers — the thundering herd. Full jitter (`random() * cappedDelay`) spreads
 * them uniformly and is what AWS's own backoff guidance recommends.
 */
export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 100,
    maxDelayMs = 5000,
    isRetryable = defaultIsRetryable,
    sleep = (ms: number) => Bun.sleep(ms),
    random = Math.random,
    onRetry,
  } = options;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.floor(random() * capped);
      onRetry?.({ attempt, delayMs, err });
      await sleep(delayMs);
    }
  }
  throw lastErr; // unreachable while attempts >= 1; keeps the type honest
}

type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  /** Consecutive failures before the breaker opens. Default 5. */
  threshold?: number;
  /** How long to stay open before probing. Default 10s. */
  resetMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * A circuit breaker stops you from queueing 10,000 requests against a service
 * that is already down. Retry alone makes an outage WORSE — it multiplies load
 * on the thing that is failing. The breaker is what makes retry safe at scale.
 *
 * closed    → calls pass through, failures counted
 * open      → calls rejected immediately, no load on the upstream
 * half-open → one probe allowed; success closes, failure re-opens
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: BreakerState = "closed";
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;

  constructor(
    private readonly service: string,
    options: BreakerOptions = {},
  ) {
    this.threshold = options.threshold ?? 5;
    this.resetMs = options.resetMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  get currentState(): BreakerState {
    return this.state;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (this.now() - this.openedAt < this.resetMs) {
        throw new UpstreamFailure(this.service, { context: { breaker: "open" } });
      }
      this.state = "half-open"; // deadline passed — allow exactly one probe
    }

    try {
      const out = await fn();
      this.failures = 0;
      this.state = "closed";
      return out;
    } catch (err) {
      this.failures++;
      if (this.state === "half-open" || this.failures >= this.threshold) {
        this.state = "open";
        this.openedAt = this.now();
      }
      throw err;
    }
  }
}
