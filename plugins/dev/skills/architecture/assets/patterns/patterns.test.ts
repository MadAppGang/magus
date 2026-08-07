import { describe, expect, test } from "bun:test";
import {
  StrategyRegistry,
  UnknownStrategyError,
  assertNever,
  type Strategy,
} from "./strategy";
import { compose, requireHeader, withCache, withTiming, type Handler } from "./middleware";
import { IllegalTransitionError, StateMachine, type Transitions } from "./state-machine";

// ---------------------------------------------------------------- Strategy

describe("StrategyRegistry", () => {
  const shipping = new StrategyRegistry<{ kg: number }, number>({
    standard: (o) => o.kg * 1.5,
    express: (o) => o.kg * 4 + 10,
  });

  test("dispatches to the registered strategy", () => {
    expect(shipping.run("standard", { kg: 10 })).toBe(15);
    expect(shipping.run("express", { kg: 10 })).toBe(50);
  });

  test("adding a strategy does not touch existing ones (open/closed)", () => {
    const r = new StrategyRegistry<{ kg: number }, number>({ standard: (o) => o.kg * 1.5 });
    r.register("freight", (o) => Math.max(80, o.kg * 0.8));
    expect(r.run("freight", { kg: 10 })).toBe(80);
    expect(r.run("standard", { kg: 10 })).toBe(15); // unchanged
  });

  test("THROWS on unknown key rather than falling back to a default", () => {
    // This is the whole point: a silent default turns a typo into a wrong-but-200 response.
    expect(() => shipping.run("expres", { kg: 1 })).toThrow(UnknownStrategyError);
  });

  test("the error names what was available, so the typo is obvious", () => {
    try {
      shipping.get("nope");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownStrategyError);
      expect((err as UnknownStrategyError).available).toEqual(["express", "standard"]);
      expect((err as Error).message).toContain("express");
    }
  });

  test("keys() is sorted, so output is stable across runs", () => {
    expect(shipping.keys()).toEqual(["express", "standard"]);
  });

  test("a bare function satisfies Strategy with no class needed", () => {
    const double: Strategy<number, number> = (n) => n * 2;
    expect(double(21)).toBe(42);
  });
});

describe("assertNever", () => {
  type Suit = "hearts" | "spades";
  const label = (s: Suit): string => {
    switch (s) {
      case "hearts":
        return "H";
      case "spades":
        return "S";
      default:
        return assertNever(s);
    }
  };

  test("handles the closed set", () => {
    expect(label("hearts")).toBe("H");
    expect(label("spades")).toBe("S");
  });

  test("throws loudly if an unexpected variant arrives at runtime", () => {
    expect(() => label("clubs" as Suit)).toThrow(/unhandled variant/);
  });
});

// ---------------------------------------------------------------- Middleware

const ok: Handler = async () => new Response("ok", { status: 200 });

describe("compose", () => {
  test("runs middleware outermost-first, matching reading order", async () => {
    const order: string[] = [];
    const trace =
      (name: string) =>
      async (_req: Request, next: () => Promise<Response>): Promise<Response> => {
        order.push(`>${name}`);
        const res = await next();
        order.push(`<${name}`);
        return res;
      };

    await compose([trace("a"), trace("b")], ok)(new Request("http://x/"));
    expect(order).toEqual([">a", ">b", "<b", "<a"]);
  });

  test("with no middleware it is just the terminal handler", async () => {
    const res = await compose([], ok)(new Request("http://x/"));
    expect(res.status).toBe(200);
  });
});

describe("Decorator vs Chain of Responsibility", () => {
  test("a Decorator always delegates", async () => {
    let inner = 0;
    const counted: Handler = async () => {
      inner++;
      return new Response("ok");
    };
    let observed = -1;
    const app = compose([withTiming((ms) => (observed = ms))], counted);

    await app(new Request("http://x/"));
    expect(inner).toBe(1); // the inner handler ran
    expect(observed).toBeGreaterThanOrEqual(0); // and timing was recorded
  });

  test("a Chain link may refuse to delegate, and the inner handler never runs", async () => {
    let inner = 0;
    const counted: Handler = async () => {
      inner++;
      return new Response("ok");
    };
    const app = compose([requireHeader("authorization")], counted);

    const res = await app(new Request("http://x/")); // no auth header
    expect(res.status).toBe(401);
    expect(inner).toBe(0); // short-circuited: this is what makes it NOT a Decorator
  });

  test("the chain link delegates when its condition is met", async () => {
    const app = compose([requireHeader("authorization")], ok);
    const res = await app(
      new Request("http://x/", { headers: { authorization: "Bearer t" } }),
    );
    expect(res.status).toBe(200);
  });
});

describe("withCache (Proxy)", () => {
  test("skips the inner call on a hit", async () => {
    let calls = 0;
    const counted: Handler = async () => {
      calls++;
      return new Response("payload");
    };
    const app = compose([withCache((req) => new URL(req.url).pathname)], counted);

    const a = await app(new Request("http://x/thing"));
    const b = await app(new Request("http://x/thing"));

    expect(calls).toBe(1); // second request never reached the handler
    expect(await a.text()).toBe("payload");
    expect(await b.text()).toBe("payload"); // and the clone is independently readable
  });

  test("collapses concurrent misses into ONE inner call (no cache stampede)", async () => {
    let calls = 0;
    const slow: Handler = async () => {
      calls++;
      await Bun.sleep(5);
      return new Response("payload");
    };
    const app = compose([withCache((req) => new URL(req.url).pathname)], slow);

    // Ten simultaneous misses. Caching the value (not the promise) would make this 10.
    await Promise.all(
      Array.from({ length: 10 }, () => app(new Request("http://x/hot"))),
    );
    expect(calls).toBe(1);
  });

  test("a null key bypasses the cache entirely", async () => {
    let calls = 0;
    const counted: Handler = async () => {
      calls++;
      return new Response("x");
    };
    const app = compose([withCache(() => null)], counted);
    await app(new Request("http://x/a"));
    await app(new Request("http://x/a"));
    expect(calls).toBe(2);
  });

  test("does not cache a failure", async () => {
    let calls = 0;
    const flaky: Handler = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return new Response("recovered");
    };
    const app = compose([withCache(() => "k")], flaky);

    await expect(app(new Request("http://x/"))).rejects.toThrow("boom");
    const res = await app(new Request("http://x/")); // retry must reach the handler
    expect(await res.text()).toBe("recovered");
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------- State

type Status = "draft" | "moderation" | "published" | "archived";
type Action = "publish" | "reject" | "archive";

const table: Transitions<Status, Action> = {
  draft: { publish: "moderation" },
  moderation: { publish: "published", reject: "draft" },
  published: { archive: "archived" },
  archived: {},
};

describe("StateMachine", () => {
  test("applies a legal transition", () => {
    const m = new StateMachine(table, "draft");
    expect(m.apply("publish")).toBe("moderation");
    expect(m.state).toBe("moderation");
  });

  test("THROWS on an illegal transition rather than silently ignoring it", () => {
    // The silent no-op is the bug: UI reports success, nothing published, nobody knows.
    const m = new StateMachine(table, "draft");
    expect(() => m.apply("archive")).toThrow(IllegalTransitionError);
    expect(m.state).toBe("draft"); // and state is unchanged
  });

  test("the error lists what WAS legal from here", () => {
    const m = new StateMachine(table, "moderation");
    try {
      m.apply("archive");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as IllegalTransitionError).allowed).toEqual(["publish", "reject"]);
    }
  });

  test("allowed() drives UI enablement", () => {
    expect(new StateMachine(table, "draft").allowed()).toEqual(["publish"]);
    expect(new StateMachine(table, "moderation").allowed()).toEqual(["publish", "reject"]);
    expect(new StateMachine(table, "archived").allowed()).toEqual([]);
  });

  test("can() probes without throwing", () => {
    const m = new StateMachine(table, "published");
    expect(m.can("archive")).toBe(true);
    expect(m.can("publish")).toBe(false);
  });

  test("tryApply reports failure as a value", () => {
    const m = new StateMachine(table, "draft");
    const bad = m.tryApply("archive");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain("cannot");

    const good = m.tryApply("publish");
    expect(good).toEqual({ ok: true, state: "moderation" });
  });

  test("rejects an initial state that is not in the table", () => {
    expect(() => new StateMachine(table, "nope" as Status)).toThrow(/not in the transition table/);
  });

  test("a full legal path runs end to end", () => {
    const m = new StateMachine(table, "draft");
    m.apply("publish");
    m.apply("reject");
    expect(m.state).toBe("draft");
    m.apply("publish");
    m.apply("publish");
    m.apply("archive");
    expect(m.state).toBe("archived");
    expect(m.allowed()).toEqual([]); // terminal
  });
});
