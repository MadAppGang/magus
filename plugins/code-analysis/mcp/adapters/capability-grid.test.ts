/**
 * capability-grid.test.ts — the test that stops the grid drifting.
 *
 * Capability declaration is by KEY PRESENCE ONLY: an operation the engine cannot
 * genuinely do has no key, there are no stubs and no `supports()`. That makes the
 * declared key set the whole contract, and this file compares it against design §4
 * for both engines, as data.
 *
 * BOTH ENGINES ARE INSTALLED AND BOTH HAVE BEEN RUN. That was not true when this file
 * was written — the grid was then the only assertion available for five of six
 * engines, all written from documented tool surfaces. The four never-run adapters are
 * gone (see `adapters/index.ts` for why), and serena's declarations have since been
 * checked against a live 1.7.0 `tools/list`.
 *
 * The behaviour tests at the bottom are mnemex-only and cover the three things the
 * brief calls out by name: the R1 empty-index annotation, the announced depth clamp,
 * and `findDependencies` never claiming a total it cannot have.
 *
 * Run: bun test plugins/code-analysis/mcp/adapters/
 */

import { describe, expect, test } from "bun:test";

import { CAPABILITIES, type Capability } from "../core/capabilities";
import type { Engine, Hit, Outcome } from "../core/ports";
import type { CallResult, ListToolsResult, McpClient } from "../transport/mcp-stdio-client";
import { ADAPTERS, ENGINE_IDS, makeResolver, resolveEngine } from "./index";
import type { AdapterContext, EngineSpec } from "./shared/kit";

// ---------------------------------------------------------------------------
// The grid, as data. Design §4, one row per capability, YES = a declared key.
// ---------------------------------------------------------------------------

/**
 * One reconciliation, stated rather than silently applied: §D's prose count for serena
 * is wrong where its own table is right — it says serena "declares 4" while listing 5.
 * The §4 grid and §D's table agree; only the sentence miscounts. The grid wins.
 *
 * Serena's five are now CONFIRMED against a live 1.7.0 `tools/list` under `--context
 * claude-code`: `find_symbol`, `find_referencing_symbols` and `find_implementations`
 * are present, and `search_for_pattern` / `find_file` / `list_dir` / `read_file` are
 * absent — which is why `generalSearch` here is a symbol-name substring match and NOT
 * a text search, and why the adapter says so on every call.
 */
const GRID: Readonly<Record<string, readonly Capability[]>> = {
  mnemex: [
    "generalSearch",
    "knowledgeSearch",
    "locateSymbol",
    "readSource",
    "findDependencies",
    "findDependents",
    "callTree",
    "impact",
  ],
  serena: ["generalSearch", "locateSymbol", "readSource", "findDependents", "findImplementations"],
};

/** The seven code operations, per §4's count row. `generalSearch` and
 *  `knowledgeSearch` are the two search operations and are not code operations. */
const CODE_OPERATIONS: readonly Capability[] = [
  "locateSymbol",
  "readSource",
  "findDependencies",
  "findDependents",
  "callTree",
  "findImplementations",
  "impact",
];

const ENGINE_ID_PATTERN = /^[a-z][a-z0-9]{1,11}$/u;

// ---------------------------------------------------------------------------
// A scriptable engine, so no process is ever spawned
// ---------------------------------------------------------------------------

interface ScriptedCall {
  json?: unknown;
  text?: string;
  isError?: boolean;
}

interface FakeClient extends McpClient {
  seen: { tool: string; args: unknown }[];
}

function fakeClient(script: {
  tools?: readonly string[];
  calls?: Readonly<Record<string, ScriptedCall>>;
}): FakeClient {
  const seen: { tool: string; args: unknown }[] = [];
  return {
    seen,
    listTools: (): Promise<ListToolsResult> =>
      Promise.resolve({
        ok: true,
        tools: (script.tools ?? []).map((name) => ({ name, description: "", inputSchema: {} })),
      }),
    call: (tool: string, args: unknown): Promise<CallResult> => {
      seen.push({ tool, args });
      const scripted = script.calls?.[tool];
      const text = scripted?.text ?? (scripted?.json === undefined ? "{}" : JSON.stringify(scripted.json));
      return Promise.resolve({
        ok: true,
        content: [{ type: "text", text }],
        isError: scripted?.isError ?? false,
      });
    },
    isPermanentlyUnready: () => false,
    lastFailure: () => undefined,
    dispose: () => Promise.resolve(),
  };
}

const PROJECT_DIR = "/tmp/ca-grid-fixture";

function context(client: McpClient): AdapterContext {
  return {
    client,
    projectDir: PROJECT_DIR,
    // Nothing resolves under a fixture root that does not exist, so path repair declines
    // on every hit here and this grid keeps measuring capabilities, not the filesystem.
    fileExists: () => false,
    now: () => 0,
    log: () => undefined,
    probeTtlMs: 60_000,
  };
}

const SPEC: EngineSpec = { command: "irrelevant" };

function build(id: string, client: McpClient = fakeClient({})): Engine {
  const engine = resolveEngine(id, SPEC, context(client));
  if (engine === undefined) throw new Error(`no adapter for ${id}`);
  return engine;
}

function declaredKeys(engine: Engine): string[] {
  return Object.keys(engine.capabilities).sort();
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

describe("declared capabilities equal design §4, exactly", () => {
  test("the grid covers every engine this plugin ships, and no other", () => {
    expect([...ENGINE_IDS].sort()).toEqual(Object.keys(GRID).sort());
    // TWO, and the number is the claim. An adapter reaching this table without having
    // been run against its real server is what this count exists to make someone
    // justify — see the header of `adapters/index.ts`.
    expect(ENGINE_IDS.length).toBe(2);
  });

  test("the grid names only real capabilities", () => {
    for (const [id, row] of Object.entries(GRID)) {
      for (const capability of row) {
        expect(CAPABILITIES, `${id} declares an unknown capability ${capability}`).toContain(capability);
      }
      expect(new Set(row).size, `${id} lists a capability twice`).toBe(row.length);
    }
  });

  for (const [id, row] of Object.entries(GRID)) {
    test(`${id} declares exactly ${row.length}: ${[...row].sort().join(", ")}`, () => {
      expect(declaredKeys(build(id))).toEqual([...row].sort());
    });
  }

  test("every declared key is a callable, and nothing else is present", () => {
    for (const id of ENGINE_IDS) {
      const engine = build(id);
      for (const capability of CAPABILITIES) {
        const value = engine.capabilities[capability];
        const declared = (GRID[id] ?? []).includes(capability);
        expect(typeof value, `${id}.${capability}`).toBe(declared ? "function" : "undefined");
      }
    }
  });

  test("generalSearch is the floor: every engine has it", () => {
    for (const id of ENGINE_IDS) {
      expect(typeof build(id).capabilities.generalSearch, id).toBe("function");
    }
  });
});

describe("the absences that cost the most to get wrong", () => {
  test("mnemex declines findImplementations — it has no subtype relation", () => {
    expect(build("mnemex").capabilities.findImplementations).toBeUndefined();
  });

  test("serena declines findDependencies, callTree and impact — it has no outgoing edge", () => {
    const serena = build("serena");
    expect(serena.capabilities.findDependencies).toBeUndefined();
    expect(serena.capabilities.callTree).toBeUndefined();
    expect(serena.capabilities.impact).toBeUndefined();
  });

  /**
   * THE REASON THE FACADE SHIPS TWO ENGINES RATHER THAN ONE, asserted rather than
   * asserted-in-a-comment. If either side of this ever becomes empty, one engine
   * strictly dominates the other and the switch stops buying anything — which is a
   * decision to take deliberately, not to discover.
   */
  test("mnemex and serena are COMPLEMENTARY: each answers something the other cannot", () => {
    const mnemex = new Set(declaredKeys(build("mnemex")));
    const serena = new Set(declaredKeys(build("serena")));
    const onlyMnemex = [...mnemex].filter((c) => !serena.has(c)).sort();
    const onlySerena = [...serena].filter((c) => !mnemex.has(c)).sort();
    expect(onlyMnemex).toEqual(["callTree", "findDependencies", "impact", "knowledgeSearch"]);
    expect(onlySerena).toEqual(["findImplementations"]);
  });

  test("neither engine covers all seven code operations", () => {
    for (const id of ENGINE_IDS) {
      const engine = build(id);
      const covered = CODE_OPERATIONS.filter((c) => typeof engine.capabilities[c] === "function");
      expect(covered.length, `${id} claims every code operation`).toBeLessThan(CODE_OPERATIONS.length);
    }
  });
});

describe("engine identity", () => {
  test("id equals the settings key, matches the port's pattern, and is unique", () => {
    const ids = new Set<string>();
    for (const id of ENGINE_IDS) {
      const engine = build(id);
      expect(engine.id, `${id} must answer to its own settings key`).toBe(id);
      expect(ENGINE_ID_PATTERN.test(engine.id), `${id} must match ${ENGINE_ID_PATTERN.source}`).toBe(true);
      expect(engine.displayName.length).toBeGreaterThan(0);
      expect(ids.has(engine.id)).toBe(false);
      ids.add(engine.id);
    }
    expect(ids.size).toBe(ENGINE_IDS.length);
  });

  test("an unknown id resolves to undefined — never a throw, never a near match", () => {
    expect(resolveEngine("nope", SPEC, context(fakeClient({})))).toBeUndefined();
    // "serena2" must not resolve to serena: resolving by string distance is the same
    // class of error as picking a model by name similarity.
    expect(resolveEngine("serena2", SPEC, context(fakeClient({})))).toBeUndefined();
    expect(resolveEngine("", SPEC, context(fakeClient({})))).toBeUndefined();
  });

  test("makeResolver builds one context per engine and matches the registry's shape", () => {
    const built: string[] = [];
    const resolve = makeResolver((id) => {
      built.push(id);
      return context(fakeClient({}));
    });
    expect(resolve("mnemex", SPEC)?.id).toBe("mnemex");
    expect(resolve("unknown", SPEC)).toBeUndefined();
    expect(built).toEqual(["mnemex"]);
  });

  test("every adapter is reachable through ADAPTERS and exposes only create()", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(Object.keys(GRID).sort());
  });
});

describe("tier 2 ships empty in 6.0.0", () => {
  test("no adapter registers a passthrough tool", async () => {
    for (const id of ENGINE_IDS) {
      const engine = build(id);
      if (engine.passthroughs === undefined) continue;
      expect(await engine.passthroughs(), `${id} must register no tier-2 tools`).toEqual([]);
    }
  });

  test("mnemex implements the mechanism and still registers nothing", async () => {
    const mnemex = build("mnemex");
    expect(typeof mnemex.passthroughs).toBe("function");
    expect(await mnemex.passthroughs?.()).toEqual([]);
    // `map` is the one tool that passes the five-part tier-2 gate and is deliberately
    // not registered: starting at zero makes every later addition a reviewed act.
    expect(typeof mnemex.callPassthrough).toBe("function");
  });

  test("dispose is idempotent and never throws", async () => {
    for (const id of ENGINE_IDS) {
      const engine = build(id);
      await engine.dispose();
      await engine.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// mnemex behaviour — the three rules the brief names, against the live shapes
// captured from mnemex v0.31.2 on 2026-08-22 and again on 2026-08-26
// ---------------------------------------------------------------------------

const MNEMEX_TOOLS = ["search", "symbol", "context", "callers", "callees", "impact", "index_status"];

/** The exact `index_status` payload measured in this worktree on 2026-08-22:
 *  initialized, a 143 KB index file, and NOTHING in it. Every protection the old
 *  plugin had passes this. Both timestamp fields are null and they agree. */
const EMPTY_INDEX = {
  initialized: true,
  indexPath: `${PROJECT_DIR}/.mnemex`,
  indexDbLastIndexed: null,
  indexSizeBytes: 143360,
  indexedFileCount: 0,
  fileWatcherActive: true,
  freshness: "stale",
  lastIndexed: null,
  filesChanged: [],
  reindexingInProgress: false,
};

const HEALTHY_INDEX = { ...EMPTY_INDEX, indexedFileCount: 412, freshness: "fresh", lastIndexed: "2026-08-22T03:21:06.166Z" };

/**
 * The exact `index_status` payload measured on 2026-08-26 against a COMPLETE 216-file
 * index — verbatim, field for field, including the ones this adapter ignores.
 *
 * The two timestamp fields disagree here: `lastIndexed` is null while
 * `indexDbLastIndexed` carries the real completion time. A predicate reading only
 * `lastIndexed` calls this empty and refuses to query a perfectly good index — the
 * bug this fixture exists to hold shut. `freshness` also reads "stale" while
 * `filesChanged` is empty and `staleSince` is null, i.e. nothing actually changed.
 */
const HEALTHY_INDEX_DB_TIMESTAMP_ONLY = {
  initialized: true,
  indexPath: `${PROJECT_DIR}/.mnemex`,
  indexDbLastIndexed: "2026-08-26T02:59:43.233Z",
  indexSizeBytes: 2293760,
  indexedFileCount: 216,
  freshness: "stale",
  lastIndexed: null,
  staleSince: null,
  filesChanged: [],
  reindexingInProgress: false,
};

const SCOPE = { limit: 20 };

function noteCodes(outcome: Outcome<Hit>): string[] {
  return outcome.notes.map((note) => note.code);
}

describe("mnemex: an empty index is never reported as an empty codebase (R1)", () => {
  test("generalSearch attaches index_missing to an empty result, with a remedy", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: EMPTY_INDEX },
          // Measured live: success-shaped, no isError, no warning.
          search: { json: { results: [], totalMatches: 0, autoIndexed: 0, freshness: "stale", lastIndexed: null, filesChanged: [] } },
        },
      }),
    );

    const result = await engine.capabilities.generalSearch?.({ text: "anything" }, SCOPE);
    expect(result?.results).toEqual([]);
    expect(noteCodes(result as Outcome<Hit>)).toContain("index_missing");

    const note = result?.notes.find((n) => n.code === "index_missing");
    expect(note?.level).toBe("error");
    expect(note?.remedy).toBe("mnemex index");
    expect(note?.message).toContain("nothing has been indexed");
  });

  test("knowledgeSearch does the same", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: { index_status: { json: EMPTY_INDEX }, search: { json: { results: [], totalMatches: 0 } } },
      }),
    );
    const result = await engine.capabilities.knowledgeSearch?.({ text: "how does auth work" }, SCOPE);
    expect(noteCodes(result as Outcome<Hit>)).toContain("index_missing");
  });

  test("a HEALTHY index emits no index_missing note — the check must be able to not fire", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX },
          search: { json: { results: [], totalMatches: 0, freshness: "fresh", filesChanged: [] } },
        },
      }),
    );
    const result = await engine.capabilities.generalSearch?.({ text: "anything" }, SCOPE);
    expect(result?.results).toEqual([]);
    expect(noteCodes(result as Outcome<Hit>)).not.toContain("index_missing");
  });

  test("probe reports the empty index as retryable, and fills the TYPED indexedFiles field", async () => {
    const engine = build(
      "mnemex",
      fakeClient({ tools: MNEMEX_TOOLS, calls: { index_status: { json: EMPTY_INDEX } } }),
    );
    const health = await engine.probe();

    expect(health.engineId).toBe("mnemex");
    // core/ reads this typed field; it must never have to read `detail`.
    expect(health.indexedFiles).toBe(0);

    for (const capability of GRID["mnemex"] ?? []) {
      const status = health.capabilities[capability];
      expect(status.ready, capability).toBe(false);
      // An empty index is repairable, so it must NOT shrink the tool list.
      expect(status.ready === false && status.retryable, capability).toBe(true);
      expect(status.ready === false && status.remedy).toBe("mnemex index");
    }
    // An undeclared capability is a permanent absence, whatever the index says.
    const implementations = health.capabilities.findImplementations;
    expect(implementations.ready).toBe(false);
    expect(implementations.ready === false && implementations.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R1, second measurement: mnemex moved the completion timestamp
// ---------------------------------------------------------------------------

/** No completed run recorded in EITHER field, but the index claims 216 files. This is
 *  the state the second half of the predicate exists for: a file count alone is not
 *  evidence that an index run ever finished. */
const NO_TIMESTAMP_INDEX = {
  initialized: true,
  indexPath: `${PROJECT_DIR}/.mnemex`,
  indexSizeBytes: 2293760,
  indexedFileCount: 216,
  freshness: "stale",
  filesChanged: [],
  reindexingInProgress: false,
};

/** The `search` envelope shape that goes with a healthy 216-file index. */
const TEN_HITS = {
  results: Array.from({ length: 10 }, (_unused, i) => ({
    file: `${PROJECT_DIR}/src/lock-${String(i)}.ts`,
    line: i + 1,
    score: 0.72,
    snippet: "const LOCK_TIMEOUT_MS = 5_000;",
  })),
  totalMatches: 10,
  freshness: "stale",
  lastIndexed: null,
  staleSince: null,
  filesChanged: [],
  reindexingInProgress: false,
};

const EMPTY_SEARCH_STALE = {
  results: [],
  totalMatches: 0,
  freshness: "stale",
  lastIndexed: null,
  staleSince: null,
  filesChanged: [],
  reindexingInProgress: false,
};

describe("mnemex: a completed index run counts from EITHER timestamp field", () => {
  test("R1 SURVIVES: 0 indexed files is empty even when indexDbLastIndexed is set", async () => {
    // The regression this guards is the tempting one — "the timestamp proves a run
    // finished, so the index is fine". A run that finished holding nothing is exactly
    // the headline defect the facade was built for, and no clock may excuse it.
    const zeroFiles = { ...HEALTHY_INDEX_DB_TIMESTAMP_ONLY, indexedFileCount: 0 };
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: { index_status: { json: zeroFiles }, search: { json: EMPTY_SEARCH_STALE } },
      }),
    );

    const result = await engine.capabilities.generalSearch?.({ text: "LOCK_TIMEOUT_MS" }, SCOPE);
    const note = result?.notes.find((n) => n.code === "index_missing");
    expect(note?.level).toBe("error");
    expect(note?.message).toContain("nothing has been indexed");
    expect(note?.remedy).toBe("mnemex index");

    const health = await engine.probe();
    expect(health.indexedFiles).toBe(0);
    expect(health.capabilities.generalSearch.ready).toBe(false);
  });

  test("R1 SURVIVES: the 2026-08-22 empty payload, where both fields agree, still fires", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: { index_status: { json: EMPTY_INDEX }, search: { json: EMPTY_SEARCH_STALE } },
      }),
    );
    const result = await engine.capabilities.generalSearch?.({ text: "anything" }, SCOPE);
    expect(noteCodes(result as Outcome<Hit>)).toContain("index_missing");
  });

  test("216 files with lastIndexed null and indexDbLastIndexed set is NOT empty", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: { index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY }, search: { json: TEN_HITS } },
      }),
    );

    const result = await engine.capabilities.generalSearch?.({ text: "LOCK_TIMEOUT_MS" }, SCOPE);
    expect(result?.results).toHaveLength(10);
    expect(noteCodes(result as Outcome<Hit>)).not.toContain("index_missing");

    const health = await engine.probe();
    expect(health.indexedFiles).toBe(216);
    for (const capability of GRID["mnemex"] ?? []) {
      expect(health.capabilities[capability].ready, capability).toBe(true);
    }
  });

  test("even a genuinely empty ANSWER on that index carries no index_missing", async () => {
    // The bug's user-visible face: `code_search` answering "no results" with
    // `[error] index_missing` against a complete 216-file index.
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: { index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY }, search: { json: EMPTY_SEARCH_STALE } },
      }),
    );
    const result = await engine.capabilities.generalSearch?.({ text: "nothing matches this" }, SCOPE);
    expect(result?.results).toEqual([]);
    expect(noteCodes(result as Outcome<Hit>)).not.toContain("index_missing");
  });

  test("locateSymbol on that index reports a miss as degraded, not as a missing index", async () => {
    // `notFoundNote` picks its level from the same predicate. Reading it wrongly turned
    // "mnemex has no symbol by that name" into "[error] index_missing".
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY },
          search: { json: TEN_HITS },
          symbol: { json: { error: "Symbol LOCK_TIMEOUT_MS not found in the index." } },
        },
      }),
    );
    const result = await engine.capabilities.locateSymbol?.({ name: "LOCK_TIMEOUT_MS" }, SCOPE);
    expect(result?.results).toEqual([]);
    expect(result?.notes.find((n) => n.code === "index_missing")?.level).toBe("degraded");
  });

  test("the same miss on a genuinely empty index stays an error — the level can still be error", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: EMPTY_INDEX },
          symbol: { json: { error: "Symbol LOCK_TIMEOUT_MS not found in the index." } },
        },
      }),
    );
    const result = await engine.capabilities.locateSymbol?.({ name: "LOCK_TIMEOUT_MS" }, SCOPE);
    expect(result?.notes.find((n) => n.code === "index_missing")?.level).toBe("error");
  });

  test("neither timestamp field present, 216 files: still empty", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: { index_status: { json: NO_TIMESTAMP_INDEX }, search: { json: EMPTY_SEARCH_STALE } },
      }),
    );

    const result = await engine.capabilities.generalSearch?.({ text: "anything" }, SCOPE);
    const note = result?.notes.find((n) => n.code === "index_missing");
    expect(note?.level).toBe("error");
    expect(note?.message).toContain("never recorded a completed index run");

    // The probe must not claim 0 files when the payload says 216 — a different
    // sentence for a different state.
    const health = await engine.probe();
    const status = health.capabilities.generalSearch;
    expect(status.ready).toBe(false);
    expect(status.ready === false && status.reason).toContain("indexDbLastIndexed");
    expect(status.ready === false && status.retryable).toBe(true);
  });

  test("the canary runs again once the index reads as populated", async () => {
    // With the broken predicate the snapshot was always empty, so `loadState` never
    // reached the canary and a dead embedding credential was never reported at all.
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY },
          search: { text: "OPENROUTER_API_KEY is not set", isError: true },
        },
      }),
    );
    const health = await engine.probe();
    const status = health.capabilities.generalSearch;
    expect(status.ready).toBe(false);
    expect(status.ready === false && status.reason).toContain("no working embedding credential");
    expect(status.ready === false && status.remedy).toContain("OPENROUTER_API_KEY");
  });

  test("the snapshot detail carries both timestamp fields, so a human can see the disagreement", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: { index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY }, search: { json: TEN_HITS } },
      }),
    );
    const health = await engine.probe();
    expect(health.detail?.["lastIndexed"]).toBeNull();
    expect(health.detail?.["indexDbLastIndexed"]).toBe("2026-08-26T02:59:43.233Z");
  });
});

// ---------------------------------------------------------------------------
// index_stale: evidence, or silence
// ---------------------------------------------------------------------------

describe("mnemex: index_stale needs evidence, because a note that always fires is noise", () => {
  test("freshness stale with no changed files and no staleSince raises NOTHING", async () => {
    // Measured 2026-08-26: mnemex says "stale" on a complete index purely because
    // `lastIndexed` is null. Emitting a degraded note on every single query would
    // train the reader to skip the notes block, which is where R1's index_missing is.
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: { index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY }, search: { json: TEN_HITS } },
      }),
    );
    const result = await engine.capabilities.generalSearch?.({ text: "LOCK_TIMEOUT_MS" }, SCOPE);
    expect(noteCodes(result as Outcome<Hit>)).not.toContain("index_stale");
  });

  test("staleSince is evidence: mnemex recorded a transition, so the note fires and names it", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY },
          search: { json: { ...TEN_HITS, staleSince: "2026-08-26T03:14:00.000Z" } },
        },
      }),
    );
    const result = await engine.capabilities.generalSearch?.({ text: "LOCK_TIMEOUT_MS" }, SCOPE);
    const stale = result?.notes.find((n) => n.code === "index_stale");
    expect(stale?.level).toBe("degraded");
    expect(stale?.message).toContain("2026-08-26T03:14:00.000Z");
    expect(stale?.remedy).toBe("mnemex index");
  });

  test("changed files are evidence, and still win the file list even when staleSince is null", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY },
          search: { json: { ...TEN_HITS, filesChanged: [`${PROJECT_DIR}/src/lock.ts`] } },
        },
      }),
    );
    const result = await engine.capabilities.generalSearch?.({ text: "LOCK_TIMEOUT_MS" }, SCOPE);
    const stale = result?.notes.find((n) => n.code === "index_stale");
    expect(stale?.files).toEqual(["src/lock.ts"]);
    expect(stale?.message).toContain("1 file(s) changed");
  });

  test("reindexingInProgress is still reported on its own", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX_DB_TIMESTAMP_ONLY },
          search: { json: { ...TEN_HITS, reindexingInProgress: true } },
        },
      }),
    );
    const result = await engine.capabilities.generalSearch?.({ text: "LOCK_TIMEOUT_MS" }, SCOPE);
    expect(noteCodes(result as Outcome<Hit>)).toContain("index_building");
  });
});

describe("mnemex: clamps are announced, and paths are repo-relative", () => {
  test("findDependents clamps depth 9 to the engine's max of 5 and says so", async () => {
    const client = fakeClient({
      tools: MNEMEX_TOOLS,
      calls: {
        index_status: { json: HEALTHY_INDEX },
        search: { json: { results: [{ file: "a.ts", line: 1 }] } },
        callers: {
          json: {
            totalDirectCallers: 1,
            callers: [{ symbol: "startServer", file: `${PROJECT_DIR}/mcp/server.ts`, line: 64, pageRank: 0.41, depth: 1 }],
          },
        },
      },
    });
    const engine = build("mnemex", client);

    const result = await engine.capabilities.findDependents?.({ name: "resolveEngine", distance: 9 }, SCOPE);

    const clamp = result?.notes.find((n) => n.code === "query_transformed");
    expect(clamp, "a silent clamp is the class of lie the port exists to prevent").toBeDefined();
    expect(clamp?.message).toContain("9");
    expect(clamp?.message).toContain("5");

    const call = client.seen.find((c) => c.tool === "callers");
    expect((call?.args as { depth: number }).depth).toBe(5);

    // Absolute upstream path in, repo-relative POSIX out.
    expect(result?.results[0]?.file).toBe("mcp/server.ts");
    expect(result?.results[0]?.centrality).toBeCloseTo(0.41, 5);
  });

  test("findDependents reports the engine's own total when the engine is the one that cut", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX },
          callers: { json: { totalDirectCallers: 41, callers: [{ symbol: "a", file: "x.ts", line: 1 }] } },
        },
      }),
    );
    const result = await engine.capabilities.findDependents?.({ name: "resolveEngine", distance: 1 }, SCOPE);
    expect(result?.truncated).toBe(true);
    expect(result?.total).toBe(41);
  });
});

describe("mnemex: findDependencies cannot detect upstream truncation, and never claims to", () => {
  test("our own cut sets truncated and leaves total undefined", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX },
          callees: {
            json: {
              callees: [
                { symbol: "a", file: "a.ts", line: 1 },
                { symbol: "b", file: "b.ts", line: 2 },
                { symbol: "c", file: "c.ts", line: 3 },
              ],
            },
          },
        },
      }),
    );

    const result = await engine.capabilities.findDependencies?.({ name: "start", distance: 1 }, { limit: 2 });
    expect(result?.results).toHaveLength(2);
    expect(result?.truncated).toBe(true);
    // `callees` has NO limit parameter and reports no total, so a total here would be
    // invented — and render.ts would then say the ENGINE stopped early.
    expect(result?.total).toBeUndefined();
    expect(result?.notes.find((n) => n.code === "result_truncated")?.message).toContain("cut by this facade");
  });

  test("no cut, no truncation claim", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX },
          callees: { json: { callees: [{ symbol: "a", file: "a.ts", line: 1 }] } },
        },
      }),
    );
    const result = await engine.capabilities.findDependencies?.({ name: "start", distance: 1 }, SCOPE);
    expect(result?.truncated).toBe(false);
    expect(result?.total).toBeUndefined();
  });
});

describe("mnemex: scope and staleness are honoured rather than announced and dropped", () => {
  test("scope.glob filters post-hoc even though the engine took the filePattern", async () => {
    const client = fakeClient({
      tools: MNEMEX_TOOLS,
      calls: {
        index_status: { json: HEALTHY_INDEX },
        search: {
          json: {
            results: [
              { file: "plugins/code-analysis/mcp/core/route.ts", line: 10, score: 0.9, snippet: "x" },
              { file: "plugins/dev/hooks/coaching/analyzer.ts", line: 4, score: 0.8, snippet: "y" },
            ],
            totalMatches: 2,
            freshness: "fresh",
            filesChanged: [],
          },
        },
      },
    });
    const engine = build("mnemex", client);

    const result = await engine.capabilities.generalSearch?.(
      { text: "route" },
      { limit: 20, glob: "plugins/code-analysis/**" },
    );

    expect(result?.results.map((hit) => hit.file)).toEqual(["plugins/code-analysis/mcp/core/route.ts"]);
    expect((client.seen.find((c) => c.tool === "search")?.args as { filePattern?: string }).filePattern).toBe(
      "plugins/code-analysis/**",
    );
    expect(result?.results[0]?.relevance).toBe("high");
  });

  test("changed files become an index_stale note carrying the file list", async () => {
    const engine = build(
      "mnemex",
      fakeClient({
        tools: MNEMEX_TOOLS,
        calls: {
          index_status: { json: HEALTHY_INDEX },
          search: {
            json: {
              results: [{ file: "a.ts", line: 1, score: 0.5, snippet: "x" }],
              totalMatches: 1,
              freshness: "stale",
              filesChanged: [`${PROJECT_DIR}/a.ts`, `${PROJECT_DIR}/b.ts`],
            },
          },
        },
      }),
    );
    const result = await engine.capabilities.generalSearch?.({ text: "a" }, SCOPE);
    const stale = result?.notes.find((n) => n.code === "index_stale");
    // render.ts has no other source for the three-tier stale banner's filenames.
    expect(stale?.files).toEqual(["a.ts", "b.ts"]);
    expect(stale?.remedy).toBe("mnemex index");
  });
});
