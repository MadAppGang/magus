/**
 * Component-test harness — start the REAL server on an ephemeral port, drive it over
 * real HTTP, shut it down deterministically.
 *
 * Why this instead of calling handlers directly: a handler invoked as a function skips
 * routing, method matching, body parsing, header handling, the `error()` hook and the
 * status your framework actually produces. Every one of those has shipped a bug. A
 * component test that speaks HTTP catches all of them and still runs in milliseconds
 * (MEASURED: a full start/request/stop cycle is well under 50 ms in Bun 1.3.10).
 *
 * Port 0 means the OS assigns a free port, so suites can run in parallel without
 * the "address already in use" flake that a hardcoded port guarantees under --shard.
 */

export interface TestServer {
  /** Origin including the assigned port, e.g. http://localhost:53211 */
  readonly url: string;
  readonly port: number;
  /** fetch() bound to this server — pass a path, not a full URL. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Convenience: fetch + parse JSON, returning status alongside so you assert both. */
  json<T = unknown>(path: string, init?: RequestInit): Promise<{ status: number; body: T; headers: Headers }>;
  /** Graceful stop; awaits in-flight requests. Safe to call twice. */
  close(): Promise<void>;
}

type ServeOptions = Parameters<typeof Bun.serve>[0];

/**
 * Wrap a Bun.serve config for tests. Pass the SAME object your production entrypoint
 * passes — if the test builds a different config, it is testing a different server.
 * Export a `makeServerOptions()` from your app and feed it to both.
 */
export function startTestServer(options: ServeOptions): TestServer {
  // `port: 0` must win over whatever the app config says, or parallel files collide.
  const server = Bun.serve({ ...options, port: 0 } as ServeOptions);

  // `Server.port` is optional in the types (a unix-socket server has none). For a TCP
  // test server it is always assigned — fail loudly rather than build `localhost:undefined`,
  // which would otherwise surface as an opaque connection error in every test.
  const port = server.port;
  if (typeof port !== "number") {
    throw new Error("startTestServer: server has no TCP port (unix socket?); cannot build a base URL");
  }
  const url = `http://localhost:${port}`;
  let closed = false;

  return {
    url,
    port,
    fetch: (path, init) => fetch(new URL(path, url), init),
    async json<T>(path: string, init?: RequestInit) {
      const res = await fetch(new URL(path, url), init);
      const text = await res.text();
      let body: T;
      try {
        body = (text === "" ? undefined : JSON.parse(text)) as T;
      } catch {
        // Surface the real payload — "Unexpected token <" tells you nothing about
        // which HTML error page the server actually returned.
        throw new Error(`Expected JSON from ${path}, got ${res.status}: ${text.slice(0, 200)}`);
      }
      return { status: res.status, body, headers: res.headers };
    },
    async close() {
      if (closed) return; // afterEach + afterAll both calling close() must not throw
      closed = true;
      await server.stop();
    },
  };
}

/**
 * A controllable fake upstream. Use this instead of mocking your own HTTP client:
 * mocking the client tests your mock, while this tests your real client against real
 * sockets, real status codes and real timeouts.
 */
export interface FakeUpstream extends TestServer {
  /** Every request received, in order — assert on what you SENT, not only what you got back. */
  readonly requests: ReadonlyArray<{ method: string; path: string; headers: Headers; body: string }>;
  /** Queue one response. Consumed in FIFO order; when empty, `fallback` is used. */
  enqueue(response: Response | (() => Response | Promise<Response>)): void;
  /** Fail the next `count` requests with `status`. Shorthand for retry/breaker tests. */
  failNext(count: number, status?: number): void;
  /** Hang the next request for `ms` — for exercising timeouts. */
  hangNext(ms: number): void;
  reset(): void;
}

/**
 * `Response.prototype.clone()` is declared by undici-types and returns undici's `Response`,
 * while the global `Response` is Bun's (which adds `headers.toJSON/count/getAll`). They are
 * the same object at runtime; only the declarations disagree. One narrow cast here beats
 * `as any` sprinkled through every enqueue call site.
 */
const cloneResponse = (r: Response): Response => r.clone() as unknown as Response;

export function startFakeUpstream(fallback: () => Response | Promise<Response> = () => Response.json({ ok: true })): FakeUpstream {
  const requests: { method: string; path: string; headers: Headers; body: string }[] = [];
  const queue: Array<() => Response | Promise<Response>> = [];

  const base = startTestServer({
    async fetch(req) {
      // Read the body BEFORE responding; a consumed stream cannot be replayed.
      const body = await req.text();
      requests.push({ method: req.method, path: new URL(req.url).pathname, headers: req.headers, body });
      const next = queue.shift();
      return next ? next() : fallback();
    },
  });

  return {
    ...base,
    requests,
    enqueue(response) {
      // clone() per serve, so the same Response object can be queued twice without
      // hitting "Body already used" on the second read.
      queue.push(typeof response === "function" ? response : () => cloneResponse(response));
    },
    failNext(count, status = 500) {
      for (let i = 0; i < count; i++) queue.push(() => new Response("upstream error", { status }));
    },
    hangNext(ms) {
      queue.push(async () => {
        await Bun.sleep(ms);
        return new Response("late", { status: 200 });
      });
    },
    reset() {
      requests.length = 0;
      queue.length = 0;
    },
  };
}

/**
 * Deterministic clock. Time-dependent tests that use the real clock are the single
 * largest source of flakes, because they pass on your laptop and fail on a loaded
 * CI runner. Inject this instead.
 *
 * `bun:test` also has `setSystemTime()` for freezing `Date` globally (MEASURED to work
 * in 1.3.10). Prefer THIS where the code under test accepts an injected clock — global
 * time travel leaks across tests in the same file and interacts badly with timers.
 */
export function fakeClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  const sleeps: number[] = [];
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    /** Drop-in for an injected `sleep`: records the delay, advances, never waits. */
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    /** Every delay requested, in order — assert backoff policy without waiting for it. */
    get sleeps(): readonly number[] {
      return sleeps;
    },
  };
}

/**
 * Deny every outgoing HTTP request that is not explicitly allowed.
 *
 * A component test is only isolated if it *cannot* reach the world. Without this, a
 * forgotten call silently hits a real API: the suite becomes slow, nondeterministic and
 * dependent on someone else's uptime — and, the part that actually hurts, it can write to
 * a real system from CI.
 *
 * The usual approach — stub each dependency as you discover it — fails OPEN: the call you
 * forgot is precisely the one nobody stubbed. This fails CLOSED. Anything not on the
 * allow-list throws with the offending URL named, so an unexpected dependency surfaces the
 * first time it appears rather than as a flake months later.
 *
 * Pair with `startFakeUpstream()` and allow only that server's origin.
 */
export interface DenyOutgoingOptions {
  /** Origins or URL patterns that may still be called — typically your fake upstream. */
  allow?: ReadonlyArray<string | RegExp>;
  /** Called instead of throwing, for tests that assert on the attempt itself. */
  onDenied?: (url: string) => void;
}

export function denyOutgoing(options: DenyOutgoingOptions = {}): () => void {
  const { allow = [], onDenied } = options;
  const original = globalThis.fetch;

  const permitted = (url: string): boolean =>
    allow.some((rule) => (typeof rule === "string" ? url.startsWith(rule) : rule.test(url)));

  const guarded = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    // `input` may be a string, URL or Request. Normalise before matching, or a Request
    // object slips past the allow-list entirely.
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

    if (!permitted(url)) {
      onDenied?.(url);
      throw new Error(
        `denyOutgoing: blocked ${url}\n` +
          `  This test tried to reach the network. Point it at a fake upstream, or add the ` +
          `origin to denyOutgoing({ allow: [...] }) if the call is genuinely intended.`,
      );
    }
    return original(input, init);
  }) as typeof fetch;

  globalThis.fetch = guarded;

  // Restore the ORIGINAL rather than whatever is current: nested installs must unwind
  // cleanly, and a test that throws midway must not leave the guard installed for the
  // rest of the file.
  return () => {
    globalThis.fetch = original;
  };
}
