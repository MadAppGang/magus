import { describe, test, expect } from "bun:test";
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  generateToken,
  hashToken,
  safeEqual,
  verifyToken,
  authenticate,
  makeDummyHash,
  redact,
} from "./credentials";

describe("password hashing", () => {
  test("uses argon2id with the parameters that make brute force expensive", async () => {
    const hash = await hashPassword("hunter2");
    // MEASURED default in Bun 1.3.10.
    expect(hash).toStartWith("$argon2id$v=19$m=65536,t=2,p=1");
    expect(hash.length).toBe(118);
  });

  test("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("Correct horse", hash)).toBe(false);
  });

  test("the same password hashes differently each time — salts are per-hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  test("verify auto-detects a legacy bcrypt hash, so migration needs no flag day", async () => {
    const legacy = await Bun.password.hash("old-password", { algorithm: "bcrypt", cost: 4 });
    expect(legacy).toStartWith("$2b$04$");
    expect(await verifyPassword("old-password", legacy)).toBe(true); // no options passed
  });

  test("needsRehash flags legacy hashes and passes current ones", async () => {
    const legacy = await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 });
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword("x"))).toBe(false);
  });

  test("hashing is deliberately slow — that cost IS the security control", async () => {
    const t0 = Bun.nanoseconds();
    await hashPassword("timing");
    const ms = (Bun.nanoseconds() - t0) / 1e6;
    // MEASURED ~96ms. A wide band keeps this from flaking on a loaded CI box while
    // still failing loudly if someone "optimises" the cost parameters down.
    expect(ms).toBeGreaterThan(20);
  });
});

describe("tokens", () => {
  test("generates URL-safe tokens with no padding to escape", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("tokens are unique across many draws", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateToken()));
    expect(seen.size).toBe(2000);
  });

  test("32 bytes yields 43 base64url chars (256 bits)", () => {
    expect(generateToken(32).length).toBe(43);
  });

  test("hashToken is stable and one-way", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  test("token hashing is FAST — argon2 here would tax every authenticated request", () => {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < 1000; i++) hashToken("some-token-value");
    const msPerOp = (Bun.nanoseconds() - t0) / 1e6 / 1000;
    expect(msPerOp).toBeLessThan(1);
  });

  test("verifyToken accepts the real token and rejects a near-miss", () => {
    const token = generateToken();
    const stored = hashToken(token);
    expect(verifyToken(token, stored)).toBe(true);
    expect(verifyToken(token.slice(0, -1) + "X", stored)).toBe(false);
  });
});

describe("safeEqual", () => {
  test("matches equal strings and rejects different ones", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
  });

  test("handles different LENGTHS without throwing — timingSafeEqual alone does not", () => {
    // MEASURED: node:crypto.timingSafeEqual throws "Input buffers must have the same
    // byte length". Hashing both sides first is what makes this safe.
    expect(safeEqual("short", "a-much-longer-value")).toBe(false);
    expect(safeEqual("", "nonempty")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  test("handles unicode without throwing on byte-length mismatch", () => {
    expect(safeEqual("café", "café")).toBe(true);
    expect(safeEqual("café", "cafe")).toBe(false);
  });
});

describe("authenticate — user enumeration resistance", () => {
  const password = "s3cret-password";

  async function fixture() {
    const hash = await hashPassword(password);
    const dummyHash = await makeDummyHash();
    return {
      dummyHash,
      deps: {
        findUser: async (id: string) => (id === "real@example.test" ? { id: "u1", hash } : null),
        getHash: (u: { hash: string }) => u.hash,
        dummyHash,
      },
    };
  }

  test("returns the user for correct credentials", async () => {
    const { deps } = await fixture();
    expect(await authenticate("real@example.test", password, deps)).toMatchObject({ id: "u1" });
  });

  test("returns null for a wrong password", async () => {
    const { deps } = await fixture();
    expect(await authenticate("real@example.test", "wrong", deps)).toBeNull();
  });

  test("returns null for an unknown user", async () => {
    const { deps } = await fixture();
    expect(await authenticate("ghost@example.test", password, deps)).toBeNull();
  });

  test("an unknown user costs the SAME order as a known one — no timing oracle", async () => {
    const { deps } = await fixture();

    // Sequential on purpose: running argon2 hashes concurrently makes them contend for
    // CPU, which adds far more variance than the effect being measured.
    const timeOf = async (id: string) => {
      const t0 = Bun.nanoseconds();
      await authenticate(id, "some-guess", deps);
      return (Bun.nanoseconds() - t0) / 1e6;
    };
    const median = async (id: string) => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) samples.push(await timeOf(id));
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)]!;
    };

    const known = await median("real@example.test");
    const unknown = await median("ghost@example.test");

    // The security property is a RATIO FLOOR, not a symmetric band: the attack works by
    // spotting a branch that returns orders of magnitude faster. Without the dummy-hash
    // burn this ratio would be ~0.001 (microseconds against ~96ms), so a floor of 0.5
    // fails loudly if the burn is removed while tolerating normal scheduler noise.
    expect(unknown).toBeGreaterThan(20);
    expect(unknown / known).toBeGreaterThan(0.5);
  });

  test("removing the dummy-hash burn WOULD be detectable — the control this test guards", async () => {
    // Negative control: prove the assertion above can fail. A naive implementation that
    // returns early for an unknown user is orders of magnitude faster, and this measures
    // exactly that gap so the test above is known to be meaningful rather than vacuous.
    const { deps } = await fixture();
    const naive = async (id: string) => (await deps.findUser(id)) ?? null; // no burn

    const t0 = Bun.nanoseconds();
    await naive("ghost@example.test");
    const naiveMs = (Bun.nanoseconds() - t0) / 1e6;

    const t1 = Bun.nanoseconds();
    await authenticate("ghost@example.test", "guess", deps);
    const guardedMs = (Bun.nanoseconds() - t1) / 1e6;

    expect(naiveMs).toBeLessThan(5);
    expect(guardedMs).toBeGreaterThan(20);
  });
});

describe("redact", () => {
  test("masks secret-bearing keys anywhere in the tree", () => {
    const out = redact({
      email: "a@b.c",
      password: "hunter2",
      nested: { apiKey: "sk_live_abc", token: "t", safe: "keep" },
    });
    expect(out).toEqual({
      email: "a@b.c",
      password: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", token: "[REDACTED]", safe: "keep" },
    });
  });

  test("covers the common spellings", () => {
    const out = redact({
      pass: "x", password: "x", secret: "x", api_key: "x", "api-key": "x",
      apiKey: "x", authorization: "x", Cookie: "x", session: "x", cvv: "x", ssn: "x",
    }) as Record<string, string>;
    for (const [k, v] of Object.entries(out)) expect(v).toBe("[REDACTED]");
  });

  test("walks arrays", () => {
    expect(redact({ users: [{ name: "a", password: "p" }] })).toEqual({
      users: [{ name: "a", password: "[REDACTED]" }],
    });
  });

  test("terminates on deeply nested input rather than recursing forever", () => {
    let deep: Record<string, unknown> = { password: "leaf" };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
  });

  test("leaves primitives and null alone", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
  });
});
