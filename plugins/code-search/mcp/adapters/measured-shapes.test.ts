/**
 * measured-shapes.test.ts — the parsers, against bytes the engines really sent.
 *
 * codegraph and graphify both answer in TEXT. There is no JSON anywhere in either tool
 * surface, so two adapters in this plugin parse prose, and prose is the one input that
 * changes without warning between releases.
 *
 * Every string in this file was CAPTURED from a live server on 2026-08-28 — codegraph
 * 1.6.0 and graphify 0.9.50 — and is pasted verbatim, escapes and Unicode included.
 * That is the whole point: a fixture an author invented tests the author's idea of the
 * engine, which is exactly what produced four adapters that had never been run. A
 * fixture the engine emitted tests the engine.
 *
 * `live-engines.test.ts` re-runs these calls against the real binaries when they are
 * installed. This file is what still holds when they are not, and it is what says
 * WHICH BYTE the parser broke on when one of them changes.
 *
 * Run: bun test plugins/code-search/mcp/adapters/measured-shapes.test.ts
 */

import { describe, expect, test } from "bun:test";

import type { McpClient } from "../transport/mcp-stdio-client";
import { parseEdgeRows, parseImpactRows, parseSearchRows } from "./codegraph/index";
import { parseNeighborRows, parseNodeRows, splitName } from "./graphify/index";
import { ADAPTERS } from "./index";
import { readHit } from "./shared/kit";

// ---------------------------------------------------------------------------
// codegraph 1.6.0 — captured payloads
// ---------------------------------------------------------------------------

/** `codegraph_search {"query":"withFileLock"}` */
const SEARCH =
  '**Search Results (2 found)**\n\n**withFileLock** (function)\nsrc/lock.ts:3\n`(path: string, fn: () => Promise<T>): Promise<T>`\n\n**./lock** (import)\nsrc/settings.ts:1\n`import { withFileLock } from "./lock";`\n';

/** `codegraph_callers {"symbol":"withFileLock"}` — note the em dash and the file row. */
const CALLERS =
  "**Callers of withFileLock (2 found)**\n\n- saveSettings (function) - src/settings.ts:3\n- settings.ts (file) - src/settings.ts:1 — via import";

/** `codegraph_callees {"symbol":"saveSettings"}` */
const CALLEES = "**Callees of saveSettings (1 found)**\n\n- withFileLock (function) - src/lock.ts:3";

/** `codegraph_impact {"symbol":"withFileLock"}` — grouped by file, lines on the symbols. */
const IMPACT =
  '**Impact: "withFileLock" affects 5 symbols**\n\n**src/lock.ts:**\nwithFileLock:3\n\n**src/settings.ts:**\nsaveSettings:3, settings.ts:1\n\n**src/index.ts:**\nmain:3, index.ts:1\n';

/** `codegraph_callers {"symbol":"BaseStore"}` — the empty answer, which must not be
 *  mistaken for an unparseable one. */
const NO_CALLERS = 'No callers found for "BaseStore"';

describe("codegraph text shapes, as captured from 1.6.0", () => {
  test("search returns the definition AND an import row, and both are parsed", () => {
    const rows = parseSearchRows(SEARCH);
    expect(rows).toEqual([
      { name: "withFileLock", kind: "function", file: "src/lock.ts", line: 3 },
      { name: "./lock", kind: "import", file: "src/settings.ts", line: 1 },
    ]);
  });

  test("the search header is not mistaken for a result row", () => {
    // `**Search Results (2 found)**` has the `**bold** (parenthetical)` shape and is a
    // heading, not a hit. A parser that takes it emits a phantom result at whatever
    // path happens to follow.
    expect(parseSearchRows(SEARCH).map((row) => row.name)).not.toContain("Search Results");
  });

  test("LINE BASE IS 1-BASED — withFileLock is on line 3 and codegraph says 3", () => {
    // Guarded explicitly because serena is 0-BASED and passes that through. If these
    // two ever share a line-base helper, this is the assertion that catches it.
    expect(parseSearchRows(SEARCH)[0]?.line).toBe(3);
  });

  test("callers parses the real caller and the file-level pseudo-caller separately", () => {
    const rows = parseEdgeRows(CALLERS);
    expect(rows).toEqual([
      { name: "saveSettings", kind: "function", file: "src/settings.ts", line: 3 },
      { name: "settings.ts", kind: "file", file: "src/settings.ts", line: 1, via: "import" },
    ]);
    // The em dash in " — via import" is U+2014, not a hyphen. Asserted because a
    // parser written from a terminal paste often gets a hyphen and silently drops
    // `via`, which is the only thing marking the row as an import edge.
    expect(CALLERS).toContain("\u2014 via import");
  });

  test("callees parses a clean single edge", () => {
    expect(parseEdgeRows(CALLEES)).toEqual([
      { name: "withFileLock", kind: "function", file: "src/lock.ts", line: 3 },
    ]);
  });

  test("impact pairs each symbol with the file heading above it", () => {
    // Neither half is parseable alone: the path is on the heading, the line is on the
    // symbol, and two symbols share one line of text.
    expect(parseImpactRows(IMPACT)).toEqual([
      { name: "withFileLock", kind: "unknown", file: "src/lock.ts", line: 3 },
      { name: "saveSettings", kind: "unknown", file: "src/settings.ts", line: 3 },
      { name: "settings.ts", kind: "unknown", file: "src/settings.ts", line: 1 },
      { name: "main", kind: "unknown", file: "src/index.ts", line: 3 },
      { name: "index.ts", kind: "unknown", file: "src/index.ts", line: 1 },
    ]);
  });

  test("the impact HEADING never becomes a file heading", () => {
    // `**Impact: "withFileLock" affects 5 symbols**` contains a colon and is bold. It
    // is only excluded because the file pattern demands the colon IMMEDIATELY before
    // the closing `**`.
    expect(parseImpactRows(IMPACT).some((row) => row.file.startsWith("Impact"))).toBe(false);
  });

  test("an empty answer parses to nothing, and is a sentence rather than a shape", () => {
    expect(parseEdgeRows(NO_CALLERS)).toEqual([]);
    expect(parseSearchRows(NO_CALLERS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// graphify 0.9.50 — captured payloads
// ---------------------------------------------------------------------------

/** `get_neighbors {"label":"withFileLock"}` — mixed relations, both directions. */
const NEIGHBORS =
  "Neighbors of withFileLock():\n  <-- lock.ts [contains] [EXTRACTED] at=src/lock.ts:L3\n  <-- settings.ts [imports] [EXTRACTED] at=src/settings.ts:L1\n  <-- saveSettings() [calls] [EXTRACTED] at=src/settings.ts:L4";

/** `get_neighbors {"label":"BaseStore"}` — the inheritance answer. */
const INHERITANCE =
  "Neighbors of BaseStore:\n  --> Store [implements] [EXTRACTED] at=src/store.ts:L5\n  <-- store.ts [contains] [EXTRACTED] at=src/store.ts:L5\n  <-- FileStore [inherits] [EXTRACTED] at=src/store.ts:L9\n  <-- MemoryStore [inherits] [EXTRACTED] at=src/store.ts:L15";

/** `query_graph {"question":"main","mode":"dfs","depth":4,"context_filter":["calls"]}` */
const DFS =
  "Graph: graphify-out/graph.json (17 nodes) | Traversal: DFS depth=4 | Start: ['main()'] | Context: call (explicit) | 3 nodes found\n\nNODE main() [src=src/index.ts loc=L3 community=]\nNODE saveSettings() [src=src/settings.ts loc=L3 community=]\nNODE withFileLock() [src=src/lock.ts loc=L3 community=]\nEDGE main() --calls [EXTRACTED context=call]--> saveSettings() at=src/index.ts:L4\nEDGE saveSettings() --calls [EXTRACTED context=call]--> withFileLock() at=src/settings.ts:L4";

describe("graphify text shapes, as captured from 0.9.50", () => {
  test("the arrow carries the dependency direction, and it is parsed", () => {
    const rows = parseNeighborRows(NEIGHBORS);
    expect(rows).toEqual([
      { name: "lock.ts", file: "src/lock.ts", line: 3, direction: "in", relation: "contains", confidence: "EXTRACTED" },
      {
        name: "settings.ts",
        file: "src/settings.ts",
        line: 1,
        direction: "in",
        relation: "imports",
        confidence: "EXTRACTED",
      },
      {
        name: "saveSettings()",
        file: "src/settings.ts",
        line: 4,
        direction: "in",
        relation: "calls",
        confidence: "EXTRACTED",
      },
    ]);
  });

  test("BOTH directions appear in one answer and are told apart", () => {
    const rows = parseNeighborRows(INHERITANCE);
    expect(rows.filter((row) => row.direction === "out").map((row) => row.name)).toEqual(["Store"]);
    expect(rows.filter((row) => row.direction === "in").map((row) => row.name)).toEqual([
      "store.ts",
      "FileStore",
      "MemoryStore",
    ]);
  });

  test("`implements` and `inherits` are DISTINCT relations, which is what closes §4.3 item 3", () => {
    const relations = parseNeighborRows(INHERITANCE).map((row) => row.relation);
    expect(relations).toContain("implements");
    expect(relations).toContain("inherits");
    // The design document recorded this as an inference from documentation. It is now
    // a measurement, and this is the assertion that keeps it one.
    expect(new Set(relations).size).toBe(3);
  });

  test("the dependents of withFileLock point at the CALL SITE, line 4, not line 3", () => {
    // `saveSettings` is DECLARED on line 3 of src/settings.ts and CALLS withFileLock on
    // line 4. codegraph answers 3 for the same edge (see the callers fixture above).
    // This divergence is the entire reason `LineAnchor` exists on the port.
    const call = parseNeighborRows(NEIGHBORS).find((row) => row.name === "saveSettings()");
    expect(call?.line).toBe(4);
    expect(parseEdgeRows(CALLERS).find((row) => row.name === "saveSettings")?.line).toBe(3);
  });

  test("NODE rows are parsed and EDGE rows are not mistaken for neighbour rows", () => {
    expect(parseNodeRows(DFS)).toEqual([
      { name: "main()", file: "src/index.ts", line: 3 },
      { name: "saveSettings()", file: "src/settings.ts", line: 3 },
      { name: "withFileLock()", file: "src/lock.ts", line: 3 },
    ]);
    // `EDGE main() --calls [...]--> saveSettings()` contains `-->`, but not at the
    // start of the line. The neighbour parser must not claim it.
    expect(parseNeighborRows(DFS)).toEqual([]);
  });

  test("the `()` suffix is the only kind signal, and it is read then stripped", () => {
    expect(splitName("withFileLock()")).toEqual({ name: "withFileLock", kind: "function" });
    // A class carries no suffix, so `unknown` is the honest kind — NOT `class`, which
    // graphify never said.
    expect(splitName("BaseStore")).toEqual({ name: "BaseStore", kind: "unknown" });
    // A name of `withFileLock()` would match nothing the agent subsequently searches for.
    expect(splitName("  main()  ").name).toBe("main");
  });

  test("a row with no `at=` location is dropped rather than given a synthetic line 1", () => {
    // A hit the agent cannot open is not a hit. Line 1 of the right file is a
    // plausible-looking wrong answer, which is worse than no answer.
    expect(parseNeighborRows("Neighbors of X:\n  <-- Y [calls] [INFERRED]")).toEqual([]);
  });

  test("graphify's line numbers are L-PREFIXED, which the shared scraper cannot read", () => {
    // Documented as an assertion because it is why this adapter has its own fallback
    // scraper instead of using `locationsFromText`, which looks for `path:line`.
    expect(NEIGHBORS).toContain("at=src/lock.ts:L3");
    expect(DFS).toContain("loc=L3");
  });
});

// ---------------------------------------------------------------------------
// Line bases — one row per adapter, required
// ---------------------------------------------------------------------------

/**
 * The base each engine's line numbers are in, as measured: serena 0 (1.7.0, header of
 * serena/index.ts), codegraph and graphify 1 (the captures above), mnemex 1. `line` is
 * never corrected for it; the Grep merge reads `Engine.lineBase` with `rawLine` to emit
 * an exact line from the file. A new adapter fails the first test until it has a row
 * here, because a wrong base puts every merged line one off.
 */
const LINE_BASES: Readonly<Record<string, 0 | 1>> = { codegraph: 1, graphify: 1, mnemex: 1, serena: 0 };

/** Constructing an adapter must not touch its engine, so any client access throws. */
const untouchable = new Proxy({} as McpClient, {
  get: (_target, key) => {
    throw new Error(`adapter construction touched client.${String(key)}`);
  },
});

describe("line bases and raw lines", () => {
  test("every adapter declares exactly its measured line base", () => {
    const declared: Record<string, number> = {};
    for (const [id, create] of Object.entries(ADAPTERS)) {
      const engine = create(
        { command: "unused" },
        {
          client: untouchable,
          projectDir: "/nonexistent-project",
          fileExists: () => false,
          now: () => 0,
          log: () => undefined,
          probeTtlMs: 60_000,
        },
      );
      declared[id] = engine.lineBase ?? 1;
    }
    expect(declared).toEqual(LINE_BASES);
  });

  test("serena's measured record keeps the engine's number beside the clamped line", () => {
    // `find_symbol` gave `start_line: 15` for a declaration on line 16 (serena 1.7.0).
    const at = (record: Record<string, unknown>) =>
      readHit(
        { relative_path: "src/a.ts", ...record },
        { projectDir: "/nonexistent-project", fileExists: () => false, withText: false },
      );
    expect(at({ body_location: { start_line: 15 } })).toMatchObject({ line: 15, rawLine: 15 });
    // The first line: the clamp makes it line 1 either way, and only rawLine says it was 0.
    expect(at({ body_location: { start_line: 0 } })).toMatchObject({ line: 1, rawLine: 0 });
    // No number from the engine: no rawLine, never a synthesised one.
    expect(at({})).toEqual({ file: "src/a.ts", line: 1 });
  });
});
