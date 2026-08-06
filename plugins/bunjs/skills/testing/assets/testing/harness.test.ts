import { describe, test, expect, afterEach } from "bun:test";
import { startTestServer, startFakeUpstream, fakeClock, type TestServer } from "./harness";

const open: TestServer[] = [];
const track = <T extends TestServer>(s: T): T => (open.push(s), s);
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

describe("startTestServer", () => {
  test("assigns an ephemeral port, so parallel files never collide", () => {
    const a = track(startTestServer({ fetch: () => new Response("a") }));
    const b = track(startTestServer({ fetch: () => new Response("b") }));
    expect(a.port).toBeGreaterThan(0);
    expect(b.port).toBeGreaterThan(0);
    expect(a.port).not.toBe(b.port);
  });

  test("port: 0 overrides an app config's hardcoded port", () => {
    // Passing the production config must not bind 3000 in tests.
    const s = track(startTestServer({ port: 3000, fetch: () => new Response("ok") }));
    expect(s.port).not.toBe(3000);
  });

  test("drives the real routing table, not the handler function", async () => {
    const s = track(
      startTestServer({
        routes: {
          "/users/:id": (req) => Response.json({ id: req.params.id }),
          "/methods": { GET: () => new Response("got") },
        },
        fetch: () => new Response("fallback", { status: 404 }),
      }),
    );

    const { status, body } = await s.json<{ id: string }>("/users/77");
    expect(status).toBe(200);
    expect(body.id).toBe("77");

    // MEASURED: an unlisted method falls through to fetch(), it does NOT auto-405.
    expect((await s.fetch("/methods", { method: "PUT" })).status).toBe(404);
  });

  test("json() surfaces the real payload when the response is not JSON", async () => {
    const s = track(startTestServer({ fetch: () => new Response("<html>gateway timeout</html>", { status: 504 }) }));
    await expect(s.json("/anything")).rejects.toThrow(/got 504: <html>/);
  });

  test("close() is idempotent — afterEach and afterAll may both call it", async () => {
    const s = startTestServer({ fetch: () => new Response("ok") });
    await s.close();
    await s.close();
    expect(true).toBe(true);
  });

  test("a full start/request/stop cycle is fast enough to use per test", async () => {
    const t0 = Bun.nanoseconds();
    const s = startTestServer({ fetch: () => new Response("ok") });
    await s.fetch("/");
    await s.close();
    expect((Bun.nanoseconds() - t0) / 1e6).toBeLessThan(500);
  });
});

describe("startFakeUpstream", () => {
  test("records what you SENT, not only what came back", async () => {
    const up = track(startFakeUpstream());
    await up.fetch("/charges", {
      method: "POST",
      headers: { "idempotency-key": "key_1" },
      body: JSON.stringify({ amount: 500 }),
    });

    expect(up.requests).toHaveLength(1);
    expect(up.requests[0]?.method).toBe("POST");
    expect(up.requests[0]?.path).toBe("/charges");
    expect(up.requests[0]?.headers.get("idempotency-key")).toBe("key_1");
    expect(JSON.parse(up.requests[0]!.body)).toEqual({ amount: 500 });
  });

  test("failNext drives a retry test against a real socket", async () => {
    const up = track(startFakeUpstream());
    up.failNext(2, 503);

    const statuses = [
      (await up.fetch("/x")).status,
      (await up.fetch("/x")).status,
      (await up.fetch("/x")).status,
    ];
    expect(statuses).toEqual([503, 503, 200]);
    expect(up.requests).toHaveLength(3);
  });

  test("enqueue consumes responses in FIFO order, then falls back", async () => {
    const up = track(startFakeUpstream(() => new Response("fallback")));
    up.enqueue(Response.json({ n: 1 }));
    up.enqueue(new Response("second"));

    expect(await (await up.fetch("/")).json()).toEqual({ n: 1 });
    expect(await (await up.fetch("/")).text()).toBe("second");
    expect(await (await up.fetch("/")).text()).toBe("fallback");
  });

  test("an enqueued Response can be served twice without a consumed-body error", async () => {
    const up = track(startFakeUpstream());
    const shared = Response.json({ shared: true });
    up.enqueue(shared);
    up.enqueue(shared); // same object — clone() inside enqueue is what makes this safe
    expect(await (await up.fetch("/")).json()).toEqual({ shared: true });
    expect(await (await up.fetch("/")).json()).toEqual({ shared: true });
  });

  test("hangNext exercises a client timeout against a real slow socket", async () => {
    const up = track(startFakeUpstream());
    up.hangNext(5000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40);
    const err = await up.fetch("/slow", { signal: controller.signal }).catch((e) => e);
    clearTimeout(timer);

    expect(err).toBeInstanceOf(Error);
    expect(controller.signal.aborted).toBe(true);
  });

  test("reset clears both the queue and the recorded requests", async () => {
    const up = track(startFakeUpstream());
    up.failNext(1);
    await up.fetch("/");
    up.reset();
    expect(up.requests).toHaveLength(0);
    expect((await up.fetch("/")).status).toBe(200); // queue was cleared, fallback applies
  });
});

describe("fakeClock", () => {
  test("advances without waiting", () => {
    const clock = fakeClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
  });

  test("sleep records the delay and moves time, so backoff is asserted not awaited", async () => {
    const clock = fakeClock(0);
    const t0 = Bun.nanoseconds();
    await clock.sleep(1000);
    await clock.sleep(2000);
    const realElapsedMs = (Bun.nanoseconds() - t0) / 1e6;

    expect(clock.sleeps).toEqual([1000, 2000]);
    expect(clock.now()).toBe(3000);
    expect(realElapsedMs).toBeLessThan(50); // 3 simulated seconds, no wall-clock cost
  });
});
