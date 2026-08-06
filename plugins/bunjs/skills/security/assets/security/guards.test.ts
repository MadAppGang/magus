import { describe, test, expect } from "bun:test";
import { RateLimiter, rateLimitHeaders, clientKey, securityHeaders, corsHeaders } from "./guards";

describe("RateLimiter", () => {
  test("allows up to the limit, then blocks", () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 1000, now: () => 0 });
    expect([rl.check("k"), rl.check("k"), rl.check("k")].map((r) => r.allowed)).toEqual([true, true, true]);
    expect(rl.check("k").allowed).toBe(false);
  });

  test("counts remaining down to zero and does not go negative", () => {
    const rl = new RateLimiter({ limit: 2, windowMs: 1000, now: () => 0 });
    expect(rl.check("k").remaining).toBe(1);
    expect(rl.check("k").remaining).toBe(0);
    expect(rl.check("k").remaining).toBe(0);
  });

  test("keys are independent — one abusive client cannot block another", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(rl.check("alice").allowed).toBe(true);
    expect(rl.check("alice").allowed).toBe(false);
    expect(rl.check("bob").allowed).toBe(true);
  });

  test("the window resets on the injected clock, without sleeping", () => {
    let now = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(false);
    now = 1001;
    expect(rl.check("k").allowed).toBe(true);
  });

  test("reports Retry-After in seconds, rounded up so clients never return early", () => {
    let now = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 5000, now: () => now });
    rl.check("k");
    now = 1500;
    expect(rl.check("k").retryAfterSeconds).toBe(4); // 3500ms remaining -> ceil to 4s
  });

  test("sweep bounds memory — without it the map is an attacker-driven leak", () => {
    let now = 0;
    const rl = new RateLimiter({ limit: 10, windowMs: 1000, now: () => now });
    for (let i = 0; i < 5000; i++) rl.check(`ip-${i}`);
    expect(rl.size).toBe(5000);

    now = 2000;
    expect(rl.sweep()).toBe(5000);
    expect(rl.size).toBe(0);
  });

  test("sweep keeps entries still inside their window", () => {
    let now = 0;
    const rl = new RateLimiter({ limit: 10, windowMs: 1000, now: () => now });
    rl.check("old");
    now = 900;
    rl.check("new");
    now = 1001; // "old" expired at 1000, "new" expires at 1900
    rl.sweep();
    expect(rl.size).toBe(1);
  });
});

describe("rateLimitHeaders", () => {
  test("advertises the budget so clients can self-regulate", () => {
    const rl = new RateLimiter({ limit: 5, windowMs: 1000, now: () => 0 });
    const headers = rateLimitHeaders(rl.check("k"));
    expect(headers["ratelimit-limit"]).toBe("5");
    expect(headers["ratelimit-remaining"]).toBe("4");
    expect(headers["retry-after"]).toBeUndefined();
  });

  test("adds Retry-After only when blocked", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 3000, now: () => 0 });
    rl.check("k");
    expect(rateLimitHeaders(rl.check("k"))["retry-after"]).toBe("3");
  });
});

describe("clientKey — the spoofing trap", () => {
  const reqWithXff = (xff: string) => new Request("http://x/", { headers: { "x-forwarded-for": xff } });

  test("ignores x-forwarded-for entirely when no proxy is trusted", () => {
    // The default MUST be to ignore the header: it is client-controlled, so trusting it
    // lets an attacker send a fresh forged IP per request and bypass the limiter.
    expect(clientKey(reqWithXff("1.2.3.4"), "10.0.0.1", 0)).toBe("10.0.0.1");
  });

  test("with one trusted hop, takes the entry our own proxy appended", () => {
    // client -> our LB. The LB appended the real client IP as the last entry.
    expect(clientKey(reqWithXff("203.0.113.9"), "10.0.0.1", 1)).toBe("203.0.113.9");
  });

  test("a forged prefix cannot displace the trusted entry", () => {
    // Attacker sent "x-forwarded-for: 9.9.9.9"; our LB appended their real IP.
    expect(clientKey(reqWithXff("9.9.9.9, 203.0.113.9"), "10.0.0.1", 1)).toBe("203.0.113.9");
  });

  test("two trusted hops step two entries from the right", () => {
    expect(clientKey(reqWithXff("9.9.9.9, 203.0.113.9, 10.0.0.5"), "10.0.0.1", 2)).toBe("203.0.113.9");
  });

  test("falls back to the direct IP when the header is absent or short", () => {
    expect(clientKey(new Request("http://x/"), "10.0.0.1", 1)).toBe("10.0.0.1");
    expect(clientKey(reqWithXff(""), "10.0.0.1", 1)).toBe("10.0.0.1");
  });

  test("never returns undefined — an undefined key would collapse all clients into one bucket", () => {
    expect(clientKey(new Request("http://x/"), undefined, 0)).toBe("unknown");
  });
});

describe("securityHeaders", () => {
  test("defaults deny everything a JSON API never needs", () => {
    const h = securityHeaders();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["content-security-policy"]).toContain("default-src 'none'");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("HSTS is a year with subdomains by default", () => {
    expect(securityHeaders()["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(securityHeaders({ includeSubDomains: false })["strict-transport-security"]).toBe("max-age=31536000");
  });

  test("no default contains unsafe-inline — that would disable the XSS protection", () => {
    expect(securityHeaders()["content-security-policy"]).not.toContain("unsafe-inline");
    expect(securityHeaders()["content-security-policy"]).not.toContain("unsafe-eval");
  });

  test("a caller can supply an HTML-app CSP", () => {
    const csp = "default-src 'self'; script-src 'self' 'nonce-abc'";
    expect(securityHeaders({ contentSecurityPolicy: csp })["content-security-policy"]).toBe(csp);
  });
});

describe("corsHeaders", () => {
  const options = { allowedOrigins: ["https://app.example.com"] };
  const reqFrom = (origin?: string) =>
    new Request("http://x/", origin ? { headers: { origin } } : undefined);

  test("allows a listed origin and echoes it exactly", () => {
    const h = corsHeaders(reqFrom("https://app.example.com"), options)!;
    expect(h["access-control-allow-origin"]).toBe("https://app.example.com");
  });

  test("returns null for an unlisted origin — never reflect what was sent", () => {
    expect(corsHeaders(reqFrom("https://evil.example"), options)).toBeNull();
  });

  test("a lookalike origin is not allowed", () => {
    expect(corsHeaders(reqFrom("https://app.example.com.evil.test"), options)).toBeNull();
    expect(corsHeaders(reqFrom("http://app.example.com"), options)).toBeNull(); // scheme matters
  });

  test("no Origin header means no CORS headers, not a rejection", () => {
    expect(corsHeaders(reqFrom(), options)).toEqual({});
  });

  test("always sets Vary: Origin, or a shared cache leaks one origin's policy to another", () => {
    expect(corsHeaders(reqFrom("https://app.example.com"), options)!["vary"]).toBe("Origin");
  });

  test("credentials are opt-in and never combined with a wildcard", () => {
    const h = corsHeaders(reqFrom("https://app.example.com"), { ...options, allowCredentials: true })!;
    expect(h["access-control-allow-credentials"]).toBe("true");
    expect(h["access-control-allow-origin"]).not.toBe("*");
  });

  test("there is no wildcard option at all — the type forbids it", () => {
    // `*` would have to be an explicit allowed origin, and even then it is compared
    // literally against the Origin header, so it can never match a real browser origin.
    expect(corsHeaders(reqFrom("https://anything.test"), { allowedOrigins: ["*"] })).toBeNull();
  });
});
