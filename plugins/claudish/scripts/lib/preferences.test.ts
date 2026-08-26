import { describe, expect, test } from "bun:test";
import { computeFreshness, render, resolve, type Prefs } from "./preferences";

const NOW = new Date("2026-08-06T12:00:00Z");
const LIVE = ["gpt-5.6-sol", "gemini-3.6-flash", "grok-4.5", "glm-5.2", "kimi-k3", "minimax-m3", "glm-5-turbo"];

function run(prefs: Prefs | null, over: Partial<Parameters<typeof resolve>[0]> = {}) {
  return resolve({
    prefsPath: ".claude/multimodel-team.json",
    prefs,
    mtime: new Date("2026-08-04T12:00:00Z"),
    catalogIds: LIVE,
    now: NOW,
    ...over,
  });
}

describe("field verification", () => {
  test("all live IDs survive", () => {
    const r = run({ defaultModels: ["internal", "glm-5.2", "kimi-k3"] });
    expect(r.selected).toEqual(["internal", "glm-5.2", "kimi-k3"]);
    expect(r.dropped).toEqual([]);
    expect(r.exhausted).toBe(false);
  });

  test("dead IDs in defaultModels are dropped — the field the old skill never checked", () => {
    const r = run({ defaultModels: ["internal", "grok-4.20-beta", "glm-5-turbo", "kimi-k2.5"] });
    expect(r.selected).toEqual(["internal", "glm-5-turbo"]);
    expect(r.dropped.sort()).toEqual(["grok-4.20-beta", "kimi-k2.5"]);
  });

  test("mixed list keeps survivors rather than abandoning the run", () => {
    const r = run({ defaultModels: ["gpt-5.4", "glm-5.2"] });
    expect(r.selected).toEqual(["glm-5.2"]);
    expect(r.exhausted).toBe(false);
  });

  test("all-dead is reported as exhausted, not silently empty", () => {
    const r = run({ defaultModels: ["gpt-5.4", "kimi-k2.5"] });
    expect(r.selected).toEqual([]);
    expect(r.exhausted).toBe(true);
  });

  test("`internal` alone does not count as a surviving model", () => {
    const r = run({ defaultModels: ["internal", "gpt-5.4"] });
    expect(r.selected).toEqual(["internal"]);
    expect(r.exhausted).toBe(true);
  });

  test("contextPreferences are verified and take precedence over defaults", () => {
    const r = run(
      {
        defaultModels: ["glm-5.2"],
        contextPreferences: { review: ["internal", "gpt-5.2", "grok-4.5"] },
      },
      { context: "review" },
    );
    expect(r.selected).toEqual(["internal", "grok-4.5"]);
    expect(r.dropped).toContain("gpt-5.2");
  });

  test("an absent context falls back to defaultModels", () => {
    const r = run(
      { defaultModels: ["glm-5.2"], contextPreferences: { debug: ["grok-4.5"] } },
      { context: "review" },
    );
    expect(r.selected).toEqual(["glm-5.2"]);
  });

  test("customAlias targets are verified too", () => {
    const r = run({ defaultModels: ["glm-5.2"], customAliases: { kimi3: "kimi-k2.5" } });
    expect(r.dropped).toContain("kimi-k2.5");
    // A dead alias must not invalidate the run — the survivors still dispatch.
    expect(r.selected).toEqual(["glm-5.2"]);
  });

  test("examined counts distinct non-internal IDs across every field", () => {
    const r = run({
      defaultModels: ["internal", "glm-5.2", "gpt-5.4"],
      contextPreferences: { review: ["glm-5.2", "kimi-k2.5"] },
      customAliases: { a: "gpt-5.4" },
    });
    expect(r.examined).toBe(3); // glm-5.2, gpt-5.4, kimi-k2.5 — internal excluded, duplicates collapsed
  });
});

describe("catalog unavailable — must not be read as 'everything is dead'", () => {
  test("empty catalog keeps every ID and drops none", () => {
    const r = run({ defaultModels: ["glm-5.2", "gpt-5.4"] }, { catalogIds: [] });
    expect(r.selected).toEqual(["glm-5.2", "gpt-5.4"]);
    expect(r.dropped).toEqual([]);
    expect(r.exhausted).toBe(false);
    expect(r.catalogAvailable).toBe(false);
  });

  test("must NOT claim a verification that never happened", () => {
    // Regression: the first version rendered "all 6 saved model IDs are still in the
    // live catalog" with an empty catalog — asserting a check it had not performed.
    const out = render(run({ defaultModels: ["glm-5.2", "gpt-5.4"] }, { catalogIds: [] }));
    expect(out).toContain("could NOT be verified");
    expect(out).not.toContain("still in the live catalog");
  });

  test("a reachable catalog still reports positively", () => {
    expect(render(run({ defaultModels: ["glm-5.2"] }))).toContain("still in the live catalog");
  });
});

describe("freshness is reported, never enforced", () => {
  test("mtime drives the age and is labelled as its source", () => {
    const f = computeFreshness({}, new Date("2026-03-02T12:00:00Z"), NOW);
    expect(f.mtimeDays).toBe(157);
    expect(f.ageSource).toBe("mtime");
  });

  test("no mtime yields unknown rather than a guess", () => {
    const f = computeFreshness({ lastUpdated: "2026-03-02T00:00:00Z" }, null, NOW);
    expect(f.mtimeDays).toBeNull();
    expect(f.ageSource).toBe("unknown");
  });

  test("lastUpdated older than newest history is flagged inconsistent", () => {
    // The real-world case: file claims March, its own history records July.
    const f = computeFreshness(
      { lastUpdated: "2026-03-02T14:52:00Z", history: [{ date: "2026-07-29" }] },
      new Date("2026-07-29T00:00:00Z"),
      NOW,
    );
    expect(f.metadataConsistent).toBe(false);
    expect(f.declaredLastUpdated).toBe("2026-03-02T14:52:00Z");
    expect(f.newestHistoryDate).toBe("2026-07-29");
  });

  test("consistent metadata is not flagged", () => {
    const f = computeFreshness(
      { lastUpdated: "2026-07-30T00:00:00Z", history: [{ date: "2026-07-29" }] },
      NOW,
      NOW,
    );
    expect(f.metadataConsistent).toBe(true);
  });

  test("missing and malformed dates degrade quietly", () => {
    expect(computeFreshness({}, null, NOW).metadataConsistent).toBe(true);
    const f = computeFreshness({ lastUpdated: "not-a-date", history: [{ date: "nope" }] }, null, NOW);
    expect(f.newestHistoryDate).toBeNull();
    expect(f.metadataConsistent).toBe(true);
  });

  test("an old file whose IDs are all live still dispatches every one of them", () => {
    const r = run(
      { lastUpdated: "2026-03-02T00:00:00Z", defaultModels: ["glm-5.2", "kimi-k3"] },
      { mtime: new Date("2026-03-02T00:00:00Z") },
    );
    expect(r.selected).toEqual(["glm-5.2", "kimi-k3"]); // age must never reject
    expect(r.freshness.mtimeDays).toBe(157);
  });

  test("a file written today with dead IDs is still caught — age never approves", () => {
    const r = run(
      { lastUpdated: NOW.toISOString(), defaultModels: ["gpt-5.4", "kimi-k2.5"] },
      { mtime: NOW },
    );
    expect(r.freshness.mtimeDays).toBe(0);
    expect(r.exhausted).toBe(true);
  });
});

describe("missing / unreadable file", () => {
  test("absent file is reported, not thrown", () => {
    const r = run(null);
    expect(r.exists).toBe(false);
    expect(render(r)).toContain("none at");
  });

  test("parse error is surfaced and the run continues", () => {
    const r = run(null, { parseError: "Unexpected token }" });
    expect(render(r)).toContain("could not be read");
  });
});

describe("render — the disclosure the command prints", () => {
  test("states the measured count when IDs are dead", () => {
    const out = render(run({ defaultModels: ["internal", "gpt-5.4", "kimi-k2.5", "glm-5-turbo"] }));
    expect(out).toContain("2 of 3 saved model IDs are no longer in the live catalog");
    expect(out).toContain("gpt-5.4");
  });

  test("states the count even when nothing was dropped", () => {
    const out = render(run({ defaultModels: ["glm-5.2", "kimi-k3"] }));
    expect(out).toContain("all 2 saved model IDs are still in the live catalog");
  });

  test("labels the age source and never quotes lastUpdated as the age", () => {
    const out = render(run({ lastUpdated: "2026-03-02T00:00:00Z", defaultModels: ["glm-5.2"] }));
    expect(out).toContain("filesystem mtime");
    expect(out).not.toContain("2026-03-02T00:00:00Z ago");
  });

  test("names both dates when freshness metadata conflicts", () => {
    const out = render(
      run({ lastUpdated: "2026-03-02T00:00:00Z", history: [{ date: "2026-07-29" }], defaultModels: ["glm-5.2"] }),
    );
    expect(out).toContain("Freshness metadata inconsistent");
    expect(out).toContain("2026-07-29");
  });

  test("reports unknown freshness rather than inventing one", () => {
    expect(render(run({ defaultModels: ["glm-5.2"] }, { mtime: null }))).toContain("File freshness unknown");
  });
});
