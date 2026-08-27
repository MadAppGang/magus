/**
 * Tests for the one text format.
 *
 * Most of these assert an ABSENCE, which is the point: the port's "omission is honest
 * and is distinguishable from low" survives into the text only if the renderer refuses
 * to fill a gap with `rel=?` or `centrality=n/a`.
 *
 * Run: bun test plugins/code-analysis/mcp/core/render.test.ts
 */

import { describe, expect, test } from "bun:test";
import type { BackendNote, Hit, Outcome } from "./ports";
import type { ServedBy } from "./route";
import type { FacadeHealth } from "./health";
import {
  DEFAULT_MAX_TEXT_LINES,
  locationKey,
  makeLedger,
  renderHealth,
  renderNotes,
  renderOutcome,
  renderUnavailable,
  type RenderOptions,
} from "./render";

const SERVED: ServedBy = {
  engine: "mnemex",
  capability: "findDependents",
  defaulted: ["depth=1", "limit=20"],
};

function options(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    ledger: makeLedger(),
    maxTextLines: DEFAULT_MAX_TEXT_LINES,
    showEvidence: false,
    ...overrides,
  };
}

function outcome(results: Hit[], extra: Partial<Outcome<Hit>> = {}): Outcome<Hit> {
  return { results, notes: [], truncated: false, ...extra };
}

const RICH: Hit = {
  file: "plugins/code-analysis/mcp/server.ts",
  line: 64,
  endLine: 71,
  symbol: { name: "startServer", kind: "function", exported: true },
  relevance: "high",
  centrality: 0.412,
  text: "const engine = resolveEngine(settings.engine, spec);",
};

const BARE: Hit = { file: "src/util.ts", line: 3 };

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

describe("the header line", () => {
  test("served_by is the first line, with substitution and defaults", () => {
    const text = renderOutcome(outcome([BARE]), {
      engine: "enginec",
      capability: "generalSearch",
      substituted: { requested: "findDependents", reason: "this engine has no call graph" },
      defaulted: ["limit=20"],
    }, options());
    expect(firstLine(text)).toBe(
      "served_by: enginec/generalSearch  substituted for findDependents: this engine has no call graph  defaults: limit=20",
    );
  });

  test("served_by is present in every shape this module can emit", () => {
    const empty = renderOutcome(outcome([]), SERVED, options());
    const unavailable = renderUnavailable(
      { engine: "enginea", capability: "findDependents" },
      { level: "error", code: "backend_unavailable", message: "spawn failed" },
    );
    for (const text of [empty, unavailable]) expect(firstLine(text)).toStartWith("served_by: ");
  });
});

describe("a hit renders only what the engine actually reported", () => {
  test("everything present", () => {
    const text = renderOutcome(outcome([RICH]), SERVED, options());
    expect(text).toContain(
      "1. plugins/code-analysis/mcp/server.ts:64-71  startServer  [function, exported]  rel=high  centrality=0.412",
    );
    expect(text).toContain("      const engine = resolveEngine(settings.engine, spec);");
  });

  test("nothing present renders nothing — no rel=, no centrality=, no [unknown]", () => {
    const text = renderOutcome(outcome([BARE]), SERVED, options());
    expect(text).toContain("1. src/util.ts:3");
    expect(text).not.toContain("rel=");
    expect(text).not.toContain("centrality=");
    expect(text).not.toContain("unknown");
    expect(text).not.toContain("[");
  });

  test("exported renders only when the engine PROVED it", () => {
    const unproven: Hit = { ...BARE, symbol: { name: "helper", kind: "function" } };
    const proven: Hit = { ...BARE, symbol: { name: "helper", kind: "function", exported: false } };
    expect(renderOutcome(outcome([unproven]), SERVED, options())).toContain("[function]");
    expect(renderOutcome(outcome([proven]), SERVED, options())).not.toContain("exported");
  });

  test("a single-line span omits the range", () => {
    const oneLine: Hit = { ...BARE, endLine: 3 };
    expect(renderOutcome(outcome([oneLine]), SERVED, options())).toContain("1. src/util.ts:3\n");
  });

  test("long text is cut at maxTextLines and says how much was left", () => {
    const long: Hit = { ...BARE, text: Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") };
    const text = renderOutcome(outcome([long]), SERVED, options({ maxTextLines: 3 }));
    expect(text).toContain("      line 2");
    expect(text).not.toContain("      line 3");
    expect(text).toContain("      … +7 more lines (Read the file)");
  });
});

describe("the emission ledger", () => {
  test("a repeat collapses to a pointer and says it is not a gap", () => {
    const opts = options();
    renderOutcome(outcome([RICH]), SERVED, opts);
    const again = renderOutcome(outcome([RICH]), SERVED, opts);

    expect(again).toContain("1. plugins/code-analysis/mcp/server.ts:64-71");
    expect(again).toContain("already sent earlier in this conversation");
    expect(again).toContain("this is a pointer, not a gap");
    // The freed bytes are the whole point: the source must be gone.
    expect(again).not.toContain("const engine = resolveEngine");
  });

  test("locationKey is stable and distinguishes spans", () => {
    expect(locationKey({ file: "a.ts", line: 3 })).toBe("a.ts:3-3");
    expect(locationKey({ file: "a.ts", line: 3, endLine: 9 })).toBe("a.ts:3-9");
  });

  test("the ledger is per-conversation, so a fresh one repeats nothing", () => {
    renderOutcome(outcome([RICH]), SERVED, options());
    const fresh = renderOutcome(outcome([RICH]), SERVED, options());
    expect(fresh).toContain("const engine = resolveEngine");
    expect(fresh).not.toContain("already sent earlier");
  });
});

describe("truncation", () => {
  test("the engine stopped early — the only line that may name a total", () => {
    const text = renderOutcome(outcome([BARE], { truncated: true, total: 41 }), SERVED, options());
    expect(text).toContain("truncated: yes — 1 shown of 41, the engine stopped early.");
  });

  test("no engine total means the cut was OURS, and the line says so", () => {
    // mnemex `callees` has no limit parameter, so this is the only line it can emit.
    const text = renderOutcome(outcome([BARE], { truncated: true }), SERVED, options());
    expect(text).toContain(
      "truncated: yes — 1 shown, cut by this facade; the engine reported no total.",
    );
    expect(text).not.toContain("the engine stopped early");
  });

  test("no truncation renders no truncation line", () => {
    expect(renderOutcome(outcome([BARE]), SERVED, options())).not.toContain("truncated:");
  });
});

describe("the call-budget hint", () => {
  test("renders last when present, and not at all when absent", () => {
    const hint = "Make at most 8 calls for this project (1234 files indexed).";
    const text = renderOutcome(outcome([BARE]), SERVED, options({ budgetHint: hint }));
    expect(text.trimEnd().endsWith(hint)).toBe(true);
    expect(renderOutcome(outcome([BARE]), SERVED, options())).not.toContain("Make at most");
  });
});

describe("empty is a sentence, not a blank", () => {
  test("an unexplained empty result says the engine answered", () => {
    const text = renderOutcome(outcome([]), SERVED, options());
    expect(text).toContain("no results.");
    expect(text).toContain("the engine answered and found nothing (this is not an error).");
  });

  test("an empty result with a note says what the note says instead", () => {
    // The failure the whole facade exists to fix: an unannotated empty result reads as
    // "no matches in this codebase" when the truth is "nothing has been indexed".
    const note: BackendNote = {
      level: "error",
      code: "index_missing",
      message:
        'the engine reports 0 indexed files, so "no results" here means "nothing has been indexed", NOT "this codebase has no matches".',
      remedy: "mnemex index",
    };
    const text = renderOutcome(outcome([], { notes: [note] }), SERVED, options());
    expect(text).toContain("no results.");
    expect(text).not.toContain("the engine answered and found nothing");
    expect(text).toContain("[error] index_missing:");
    expect(text).toContain("  remedy: mnemex index");
  });
});

describe("notes", () => {
  test("code comes before message, always", () => {
    const text = renderNotes([
      { level: "degraded", code: "index_stale", message: "6 files changed." },
    ]);
    expect(text).toBe("[degraded] index_stale: 6 files changed.");
  });

  test("renderUnavailable names the code in the header and carries the remedy", () => {
    const text = renderUnavailable(
      { engine: "enginea", capability: "findDependents" },
      {
        level: "error",
        code: "backend_unavailable",
        message: 'enginea exited 127 on spawn ("enginea: command not found").',
        remedy: "bun install -g enginea",
      },
    );
    expect(firstLine(text)).toBe(
      "served_by: enginea/findDependents  (not served — backend unavailable)",
    );
    expect(text).toContain("  remedy: bun install -g enginea");
  });

  test("renderUnavailable survives a partial ServedBy", () => {
    const text = renderUnavailable(
      {},
      { level: "error", code: "capability_unsupported", message: "no engine configured." },
    );
    expect(firstLine(text)).toBe("served_by: none/none  (not served — capability unsupported)");
  });
});

describe("the three-tier stale banner", () => {
  const staleNote: BackendNote = {
    level: "degraded",
    code: "index_stale",
    message: "6 files changed since the last index; recent edits may be missing.",
    remedy: "mnemex index",
    files: ["src/util.ts", "plugins/dev/hooks/coaching/analyzer.ts"],
  };

  test("referenced above, not referenced above, and the closing clause", () => {
    const text = renderOutcome(outcome([BARE], { notes: [staleNote] }), SERVED, options());
    const lines = text.split("\n");

    expect(lines[0]).toBe("! STALE (referenced below): src/util.ts");
    expect(text).toContain("! stale, not referenced above: plugins/dev/hooks/coaching/analyzer.ts");
    // Mandatory: a bare warning otherwise poisons trust in the whole payload.
    expect(text).toContain("! every file NOT named above is fresh; trust the rest of this response.");
    // The banner sits ABOVE served_by, which is still the first non-banner line.
    expect(lines.find((line) => line.startsWith("served_by:"))).toBeDefined();
  });

  test("no stale note means no banner and no closing clause", () => {
    const text = renderOutcome(outcome([BARE]), SERVED, options());
    expect(text).not.toContain("STALE");
    expect(text).not.toContain("every file NOT named above");
  });
});

describe("evidence", () => {
  const withEvidence: Hit = { ...BARE, evidence: { pageRank: 0.0031, score: 0.82 } };

  test("the default emits no evidence at all", () => {
    const text = renderOutcome(outcome([withEvidence]), SERVED, options());
    expect(text).not.toContain("evidence");
    expect(text).not.toContain("pageRank");
  });

  test("showEvidence iterates generically, never by key", () => {
    const text = renderOutcome(outcome([withEvidence]), SERVED, options({ showEvidence: true }));
    expect(text).toContain("      evidence: pageRank=0.0031, score=0.82");
  });

  test("a hit with no evidence emits no evidence line even when asked", () => {
    const text = renderOutcome(outcome([BARE]), SERVED, options({ showEvidence: true }));
    expect(text).not.toContain("evidence:");
  });
});

describe("renderHealth", () => {
  const health: FacadeHealth = {
    engineId: "mnemex",
    engine: {
      engineId: "mnemex",
      indexedFiles: 0,
      capabilities: {
        generalSearch: { ready: true },
        knowledgeSearch: { ready: true },
        locateSymbol: {
          ready: false,
          reason: "index holds 0 files",
          remedy: "mnemex index",
          retryable: true,
        },
        readSource: { ready: true },
        findDependencies: { ready: true },
        findDependents: { ready: true },
        callTree: { ready: true },
        findImplementations: { ready: false, reason: "not supported", retryable: false },
        impact: { ready: true },
      },
      detail: { indexedFileCount: 0, schema: "v2" },
    },
    settingsLayers: [
      { path: "/fixture/home/.claude/settings.json", status: "read" },
      { path: "/fixture/project/.claude/settings.json", status: "malformed" },
      { path: "/fixture/project/.claude/settings.local.json", status: "absent" },
    ],
    ripgrep: { working: true, mode: "embedded" },
    shim: {
      path: "/fixture/home/.local/bin/rg",
      present: false,
      owner: "none",
      functionShadowed: false,
      settingPrefersSystem: true,
      restartRequired: false,
    },
    notes: [{ level: "degraded", code: "grep_routing", message: "shim missing." }],
  };

  test("prints all three settings layers so a human can see which ones spoke", () => {
    const text = renderHealth(health);
    expect(text).toContain("read: /fixture/home/.claude/settings.json");
    expect(text).toContain("malformed: /fixture/project/.claude/settings.json");
    expect(text).toContain("absent: /fixture/project/.claude/settings.local.json");
  });

  test("separates a retryable incapacity from a permanent one", () => {
    const text = renderHealth(health);
    expect(text).toContain("locateSymbol: unready (retryable) — index holds 0 files");
    expect(text).toContain("findImplementations: unready (permanent) — not supported");
  });

  test("iterates the opaque per-engine map for humans, and branches on none of it", () => {
    expect(renderHealth(health)).toContain("engine detail: indexedFileCount=0, schema=v2");
  });

  test("an unconfigured facade says so rather than printing an empty engine", () => {
    const text = renderHealth({ settingsLayers: [], notes: [] });
    expect(text).toContain("engine: (none configured — tier 0 only)");
  });
});
