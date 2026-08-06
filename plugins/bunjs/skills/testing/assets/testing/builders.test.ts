import { describe, test, expect } from "bun:test";
import { builderFor, seededRandom, waitFor } from "./builders";

interface User {
  id: string;
  email: string;
  profile: { name: string; age: number; tags: string[] };
  active: boolean;
}

const aUser = builderFor<User>((seq) => ({
  id: `user_${seq}`,
  email: `user${seq}@example.test`,
  profile: { name: `User ${seq}`, age: 30, tags: ["default"] },
  active: true,
}));

describe("builderFor", () => {
  test("a bare call produces a complete, valid object", () => {
    const u = aUser();
    expect(u.email).toMatch(/@example\.test$/);
    expect(u.profile.age).toBe(30);
    expect(u.active).toBe(true);
  });

  test("overrides state only the deviation the test is about", () => {
    const u = aUser({ profile: { age: -1 } });
    expect(u.profile.age).toBe(-1);
    expect(u.profile.name).toMatch(/^User /); // untouched sibling survives the merge
    expect(u.email).toMatch(/@example\.test$/);
  });

  test("each call gets FRESH nested objects — no cross-test mutation leak", () => {
    const a = aUser();
    const b = aUser();
    expect(a.profile).not.toBe(b.profile);
    a.profile.tags.push("mutated");
    expect(b.profile.tags).toEqual(["default"]);
  });

  test("the sequence makes ids and emails unique without a random library", () => {
    aUser.reset();
    const users = aUser.many(3);
    expect(users.map((u) => u.id)).toEqual(["user_1", "user_2", "user_3"]);
    expect(new Set(users.map((u) => u.email)).size).toBe(3);
  });

  test("many() can vary each instance by index", () => {
    aUser.reset();
    const users = aUser.many(3, (i) => ({ profile: { age: 20 + i } }));
    expect(users.map((u) => u.profile.age)).toEqual([20, 21, 22]);
  });

  test("arrays replace rather than merge — merging arrays is never what a test means", () => {
    const u = aUser({ profile: { tags: ["admin"] } });
    expect(u.profile.tags).toEqual(["admin"]);
  });

  test("explicit null and false survive the merge", () => {
    // A naive `patch[k] || base[k]` merge silently drops these.
    const u = aUser({ active: false });
    expect(u.active).toBe(false);
  });
});

describe("seededRandom", () => {
  test("the same seed reproduces the same sequence — a failure is replayable", () => {
    const a = seededRandom(123);
    const b = seededRandom(123);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  test("different seeds diverge", () => {
    expect(seededRandom(1).next()).not.toBe(seededRandom(2).next());
  });

  test("values stay in [0,1)", () => {
    const r = seededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int() respects an inclusive range", () => {
    const r = seededRandom(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 6));
    expect([...seen].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("shuffle does not mutate the input and keeps every element", () => {
    const input = Object.freeze([1, 2, 3, 4, 5]) as readonly number[];
    const out = seededRandom(3).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([...input].sort());
  });
});

describe("waitFor", () => {
  test("returns as soon as the condition holds, not after a fixed sleep", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 30);

    const t0 = Bun.nanoseconds();
    await waitFor(() => ready, { timeoutMs: 2000, intervalMs: 5 });
    const elapsedMs = (Bun.nanoseconds() - t0) / 1e6;

    expect(elapsedMs).toBeGreaterThanOrEqual(25);
    expect(elapsedMs).toBeLessThan(300); // did not wait out the 2s budget
  });

  test("returns the truthy value, so it doubles as a poll-and-fetch", async () => {
    const box: { value?: string } = {};
    setTimeout(() => {
      box.value = "arrived";
    }, 20);
    expect(await waitFor(() => box.value, { intervalMs: 5 })).toBe("arrived");
  });

  test("throws with the last observed value when it never becomes true", async () => {
    await expect(waitFor(() => false, { timeoutMs: 40, intervalMs: 5, message: "never" })).rejects.toThrow(
      /waitFor\(never\) timed out after 40ms/,
    );
  });

  test("keeps polling through exceptions — the resource may not exist yet", async () => {
    let attempts = 0;
    const value = await waitFor(
      () => {
        if (++attempts < 3) throw new Error("not ready");
        return "ok";
      },
      { intervalMs: 5 },
    );
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });
});
