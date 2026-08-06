import { describe, test, expect, afterEach } from "bun:test";
import {
  chain,
  withRequestId,
  accessLog,
  allowMethods,
  timeout,
  currentRequestId,
  currentContext,
  type AccessLogLine,
  type Handler,
  type Middleware,
} from "./middleware";

const servers: Bun.Server<never>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop(true)));
});

/** Start a one-route server wrapped in the middleware under test. */
function serve(handler: Handler, ...mw: Middleware[]) {
  const server = Bun.serve({
    port: 0,
    routes: { "/*": chain(...mw)(handler) },
    fetch: () => new Response("fallback", { status: 404 }),
  });
  servers.push(server);
  return {
    server,
    fetch: (path: string, init?: RequestInit) => fetch(`http://localhost:${server.port}${path}`, init),
  };
}

describe("chain ordering", () => {
  test("runs middleware left-to-right, matching reading order", async () => {
    const order: string[] = [];
    const tag =
      (name: string): Middleware =>
      (next) =>
      async (req, server) => {
        order.push(`${name}:in`);
        const res = await next(req, server);
        order.push(`${name}:out`);
        return res;
      };

    const app = serve(() => {
      order.push("handler");
      return new Response("ok");
    }, tag("a"), tag("b"));

    await app.fetch("/");
    // If chain used reduce instead of reduceRight, this would read b:in, a:in.
    expect(order).toEqual(["a:in", "b:in", "handler", "b:out", "a:out"]);
  });

  test("chain() with no middleware returns the handler untouched", async () => {
    const app = serve(() => new Response("bare"));
    expect(await (await app.fetch("/")).text()).toBe("bare");
  });
});

describe("withRequestId", () => {
  test("generates an id and echoes it on the response", async () => {
    const app = serve(() => new Response("ok"), withRequestId());
    const res = await app.fetch("/");
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("honours an inbound id so a trace survives across services", async () => {
    const app = serve(() => new Response("ok"), withRequestId());
    const res = await app.fetch("/", { headers: { "x-request-id": "trace-from-gateway" } });
    expect(res.headers.get("x-request-id")).toBe("trace-from-gateway");
  });

  test("rejects an absurdly long inbound id — it lands in logs", async () => {
    const app = serve(() => new Response("ok"), withRequestId());
    const res = await app.fetch("/", { headers: { "x-request-id": "x".repeat(5000) } });
    const id = res.headers.get("x-request-id");
    expect(id).not.toBe("x".repeat(5000));
    expect(id!.length).toBeLessThanOrEqual(36);
  });

  test("the id is readable from anywhere in the call stack, without threading a parameter", async () => {
    let seen: string | undefined;
    const deeplyNested = async () => {
      await Bun.sleep(1);
      seen = currentRequestId(); // survives the await — this is why AsyncLocalStorage
    };
    const app = serve(async () => {
      await deeplyNested();
      return new Response("ok");
    }, withRequestId());

    const res = await app.fetch("/", { headers: { "x-request-id": "abc-123" } });
    expect(res.headers.get("x-request-id")).toBe("abc-123");
    expect(seen).toBe("abc-123");
  });

  test("concurrent requests do not share context — the bug a module-level variable causes", async () => {
    const observed: Array<{ sent: string; seen: string | undefined }> = [];
    const app = serve(async (req) => {
      const sent = req.headers.get("x-request-id")!;
      // Interleave deliberately: a plain `let current = id` would be clobbered here.
      await Bun.sleep(Number(sent.split("-")[1]) % 7);
      observed.push({ sent, seen: currentRequestId() });
      return new Response("ok");
    }, withRequestId());

    await Promise.all(
      Array.from({ length: 24 }, (_, i) => app.fetch("/", { headers: { "x-request-id": `req-${i}` } })),
    );

    expect(observed).toHaveLength(24);
    for (const { sent, seen } of observed) expect(seen).toBe(sent);
  });

  test("currentContext is undefined outside a request", () => {
    expect(currentContext()).toBeUndefined();
  });
});

describe("accessLog", () => {
  test("logs method, path, status and duration", async () => {
    const lines: AccessLogLine[] = [];
    const app = serve(() => new Response("ok"), accessLog((l) => lines.push(l)));
    await app.fetch("/things?secret=shhh");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "request", method: "GET", path: "/things", status: 200 });
    expect(lines[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("omits the query string — it carries tokens, emails and search terms", async () => {
    const lines: AccessLogLine[] = [];
    const app = serve(() => new Response("ok"), accessLog((l) => lines.push(l)));
    await app.fetch("/search?token=sk_live_abc123&q=user@example.com");

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("sk_live_abc123");
    expect(serialized).not.toContain("user@example.com");
    expect(lines[0]!.path).toBe("/search");
  });

  test("still logs when the handler throws — an outage must not look like a traffic drop", async () => {
    const lines: AccessLogLine[] = [];
    const server = Bun.serve({
      port: 0,
      routes: {
        "/*": chain(accessLog((l) => lines.push(l)))(() => {
          throw new Error("handler exploded");
        }),
      },
      fetch: () => new Response("fb", { status: 404 }),
      error: () => new Response("500", { status: 500 }),
    });
    servers.push(server);

    await fetch(`http://localhost:${server.port}/boom`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ path: "/boom", status: 500 });
  });

  test("carries the request id when composed under withRequestId", async () => {
    const lines: AccessLogLine[] = [];
    const app = serve(() => new Response("ok"), withRequestId(), accessLog((l) => lines.push(l)));
    await app.fetch("/", { headers: { "x-request-id": "rid-9" } });
    expect(lines[0]!.requestId).toBe("rid-9");
  });
});

describe("allowMethods", () => {
  test("returns 405 with an Allow header, not the 404 Bun would give", async () => {
    const app = serve(() => new Response("ok"), allowMethods("GET", "POST"));
    const res = await app.fetch("/", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
  });

  test("permits listed methods, case-insensitively", async () => {
    const app = serve(() => new Response("ok"), allowMethods("get"));
    expect((await app.fetch("/")).status).toBe(200);
  });

  test("405 has no body", async () => {
    const app = serve(() => new Response("ok"), allowMethods("GET"));
    expect(await (await app.fetch("/", { method: "PATCH" })).text()).toBe("");
  });
});

describe("timeout", () => {
  test("returns 504 when the handler outlives its budget", async () => {
    const app = serve(async () => {
      await Bun.sleep(5000);
      return new Response("too late");
    }, timeout(40));

    const t0 = Bun.nanoseconds();
    const res = await app.fetch("/");
    expect(res.status).toBe(504);
    expect((Bun.nanoseconds() - t0) / 1e6).toBeLessThan(1000);
  });

  test("passes a fast response through untouched", async () => {
    const app = serve(() => Response.json({ fast: true }), timeout(1000));
    const res = await app.fetch("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fast: true });
  });

  test("clears its timer, so a short handler does not hold the loop for the budget", async () => {
    const app = serve(() => new Response("ok"), timeout(5000));
    const t0 = Bun.nanoseconds();
    await app.fetch("/");
    expect((Bun.nanoseconds() - t0) / 1e6).toBeLessThan(500);
  });
});
