/**
 * Tests for the tool set, the listing predicate, the probe cache and the tier-2 cap.
 *
 * The predicate is the file's centre of gravity, because the design contradicted
 * itself about it: declaration decides the LIST, health decides the NOTES, and a probe
 * removes a tool only for a PERMANENT incapacity. A failed probe that shrank the tool
 * list would turn every transient outage into "this engine cannot do that", which the
 * agent has no way to un-learn for the rest of the session.
 *
 * Run: bun test plugins/code-analysis/mcp/core/registry.test.ts
 */

import { describe, expect, test } from "bun:test";
import { CAPABILITIES, type Capability, type CapabilityStatus } from "./capabilities";
import type { BackendHealth, Engine, PassthroughTool } from "./ports";
import { DEFAULTS, type CodeAnalysisSettings, type EngineSpec } from "./settings";
import {
  buildRegistry,
  collectPassthroughs,
  describePassthrough,
  listedCapabilities,
  MCP_NAME_CEILING,
  NAME_PREFIX_LENGTH,
  sanitiseSchema,
  TierTwoCapExceeded,
  TIER0_TOOL,
  type ProbeResult,
  type Registry,
  type RegistryInput,
} from "./registry";

/**
 * Declared capability sets. `mnemex` and `serena` are the two engines this plugin
 * ships; `enginea`…`engined` are SYNTHETIC SHAPES and deliberately not product names.
 *
 * They are here because the gate has to be exercised on shapes the two real engines do
 * not have — an engine with zero tier-1 capabilities, one that declares both `callTree`
 * and `findImplementations` — and because `core/` must never learn an engine id. A grid
 * of only real names would let a dispatch-on-id bug pass this file unnoticed.
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
  enginea: [
    "generalSearch",
    "locateSymbol",
    "readSource",
    "findDependencies",
    "findDependents",
    "callTree",
    "impact",
  ],
  serena: ["generalSearch", "locateSymbol", "readSource", "findDependents", "findImplementations"],
  engineb: [
    "generalSearch",
    "knowledgeSearch",
    "locateSymbol",
    "findDependencies",
    "findDependents",
    "callTree",
    "findImplementations",
  ],
  enginec: ["generalSearch", "knowledgeSearch"],
  engined: ["generalSearch", "knowledgeSearch"],
};

const ALL_TIER1 = [
  "find_dependencies",
  "find_dependents",
  "call_tree",
  "find_implementations",
  "impact",
];

interface FakeOptions {
  probe?: () => Promise<BackendHealth>;
  passthroughs?: PassthroughTool[];
}

function fakeEngine(id: string, capabilities: readonly Capability[], opts: FakeOptions = {}): Engine {
  const caps: Record<string, unknown> = {};
  for (const capability of capabilities) caps[capability] = async () => ({});

  const engine: Engine = {
    id,
    displayName: id,
    capabilities: caps as Engine["capabilities"],
    probe: opts.probe ?? (async () => readyHealth(id, capabilities)),
    dispose: async () => undefined,
  };
  if (opts.passthroughs !== undefined) {
    const declared = opts.passthroughs;
    return { ...engine, passthroughs: async () => declared };
  }
  return engine;
}

function readyHealth(id: string, ready: readonly Capability[]): BackendHealth {
  const capabilities = {} as BackendHealth["capabilities"];
  for (const capability of CAPABILITIES) {
    capabilities[capability] = ready.includes(capability)
      ? { ready: true }
      : { ready: false, reason: "not declared", retryable: false };
  }
  return { engineId: id, capabilities };
}

function healthWith(
  id: string,
  overrides: Partial<Record<Capability, CapabilityStatus>>,
): BackendHealth {
  const health = readyHealth(id, CAPABILITIES);
  for (const [capability, status] of Object.entries(overrides)) {
    health.capabilities[capability as Capability] = status;
  }
  return health;
}

function settingsFor(engineId: string, spec?: Partial<EngineSpec>): CodeAnalysisSettings {
  return {
    ...DEFAULTS,
    engine: engineId,
    engines: { [engineId]: { command: engineId, ...spec } },
  };
}

/** What `server.ts` passes as `availableEngines`, spelled here rather than imported:
 *  `core/` must not learn a real engine id, and neither must its test. */
const SHIPPED: readonly string[] = ["mnemex", "serena"];

function build(engine: Engine | undefined, overrides: Partial<RegistryInput> = {}): {
  registry: Registry;
  changes: () => number;
} {
  let changes = 0;
  const registry = buildRegistry({
    settings: engine === undefined ? DEFAULTS : settingsFor(engine.id),
    resolve: () => engine,
    availableEngines: SHIPPED,
    now: () => 0,
    onToolsChanged: () => {
      changes += 1;
    },
    ...overrides,
  });
  return { registry, changes: () => changes };
}

function names(registry: Registry): string[] {
  return registry.tools().map((tool) => tool.name);
}

function passthrough(name: string, overrides: Partial<PassthroughTool> = {}): PassthroughTool {
  return {
    name,
    description: `does ${name}`,
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    upstream: { tool: name },
    justification: "G1 — inexpressible through tier 0 or 1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

describe("listedCapabilities — the truth table", () => {
  const declared = new Set<Capability>(["generalSearch", "findDependents"]);

  test("a probe that has not run lists everything declared", () => {
    expect(listedCapabilities(declared, undefined)).toEqual(["generalSearch", "findDependents"]);
  });

  test("a FAILED probe lists everything declared", () => {
    // The row that matters. Unavailability is an answer, not a missing tool: the call
    // returns backend_unavailable with a remedy, which is actionable. A vanished tool
    // is not.
    const probe: ProbeResult = { ok: false, reason: "spawn failed" };
    expect(listedCapabilities(declared, probe)).toEqual(["generalSearch", "findDependents"]);
  });

  test("a ready capability is listed", () => {
    const probe: ProbeResult = { ok: true, health: healthWith("mnemex", {}) };
    expect(listedCapabilities(declared, probe)).toEqual(["generalSearch", "findDependents"]);
  });

  test("a RETRYABLE incapacity stays listed", () => {
    const probe: ProbeResult = {
      ok: true,
      health: healthWith("mnemex", {
        findDependents: { ready: false, reason: "index building", retryable: true },
      }),
    };
    expect(listedCapabilities(declared, probe)).toEqual(["generalSearch", "findDependents"]);
  });

  test("a PERMANENT incapacity is delisted", () => {
    const probe: ProbeResult = {
      ok: true,
      health: healthWith("serena", {
        findDependents: { ready: false, reason: "no such LSP method here", retryable: false },
      }),
    };
    expect(listedCapabilities(declared, probe)).toEqual(["generalSearch"]);
  });

  test("nothing undeclared is ever listed, however healthy the probe", () => {
    const probe: ProbeResult = { ok: true, health: healthWith("mnemex", {}) };
    expect(listedCapabilities(new Set(), probe)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tier 0
// ---------------------------------------------------------------------------

describe("tier 0 is always present", () => {
  test("with no settings block at all", () => {
    expect(names(build(undefined).registry)).toEqual(["code_search"]);
  });

  test("when `engine` names an id with no entry", () => {
    const registry = buildRegistry({
      settings: { ...DEFAULTS, engine: "enginea" },
      resolve: () => undefined,
      availableEngines: SHIPPED,
      now: () => 0,
      onToolsChanged: () => undefined,
    });
    expect(names(registry)).toEqual(["code_search"]);
    const note = registry.notes()[0];
    expect(note?.code).toBe("backend_unavailable");
    expect(note?.message).toContain("enginea");
    expect(note?.remedy).toBeDefined();
  });

  test("when resolve returns undefined for a configured engine", () => {
    const registry = buildRegistry({
      settings: settingsFor("engineb"),
      resolve: () => undefined,
      availableEngines: SHIPPED,
      now: () => 0,
      onToolsChanged: () => undefined,
    });
    expect(names(registry)).toEqual(["code_search"]);
    expect(registry.notes()[0]?.code).toBe("backend_unavailable");
  });

  /**
   * A TYPO IN `engine` IS SILENT EVERYWHERE ELSE. The settings file has no schema, the
   * tool list looks exactly like a correct tier-0 configuration, and nothing else the
   * user sees mentions it — so this remedy is the only place they can learn what to
   * type instead. That makes its CONTENT a behaviour, not decoration.
   */
  test("an unresolvable engine names the ones this build actually ships", () => {
    const registry = buildRegistry({
      settings: settingsFor("serana"), // one letter off "serena", which is the real case
      resolve: () => undefined,
      availableEngines: SHIPPED,
      now: () => 0,
      onToolsChanged: () => undefined,
    });
    const remedy = registry.notes()[0]?.remedy ?? "";
    for (const id of SHIPPED) expect(remedy, `remedy must name ${id}`).toContain(`"${id}"`);
    // And it must NOT guess. "serana" resolving to serena by string distance is the same
    // class of error as picking a model by name similarity.
    expect(remedy).not.toContain("did you mean");
  });

  test("with no engines shipped at all the remedy degrades instead of listing nothing", () => {
    // Not reachable in this build, but the empty-join would otherwise render a dangling
    // "This build ships: ." and the failure would be cosmetic-looking rather than absent.
    const registry = buildRegistry({
      settings: settingsFor("serana"),
      resolve: () => undefined,
      availableEngines: [],
      now: () => 0,
      onToolsChanged: () => undefined,
    });
    expect(registry.notes()[0]?.remedy).not.toContain("This build ships");
  });

  test("when the probe throws", async () => {
    const engine = fakeEngine("mnemex", GRID["mnemex"] ?? [], {
      probe: async () => {
        throw new Error("index is corrupt");
      },
    });
    const { registry } = build(engine);
    const probe = await registry.probeOnce();
    expect(probe.ok).toBe(false);
    expect(names(registry)).toContain("code_search");
  });

  test("the tier-0 schema is closed and requires only the query", () => {
    const schema = TIER0_TOOL.inputSchema as Record<string, unknown>;
    expect(schema["required"]).toEqual(["query"]);
    expect(schema["additionalProperties"]).toBe(false);
    expect(Object.keys(schema["properties"] as object)).toEqual(["query", "intent", "scope"]);
  });
});

// ---------------------------------------------------------------------------
// Tier 1
// ---------------------------------------------------------------------------

describe("tier-1 gating follows the engine grid", () => {
  const expected: Readonly<Record<string, string[]>> = {
    mnemex: ["find_dependencies", "find_dependents", "call_tree", "impact"],
    enginea: ["find_dependencies", "find_dependents", "call_tree", "impact"],
    engineb: ["find_dependencies", "find_dependents", "call_tree", "find_implementations"],
    serena: ["find_dependents", "find_implementations"],
    enginec: [],
    engined: [],
  };

  for (const [id, tools] of Object.entries(expected)) {
    test(`${id} lists ${tools.length} tier-1 tool(s)`, () => {
      const { registry } = build(fakeEngine(id, GRID[id] ?? []));
      expect(names(registry)).toEqual(["code_search", ...tools]);
    });
  }

  test("an agent working against a pure vector engine sees exactly one tool", () => {
    // That is the design working, not a bug: a text or vector approximation of a
    // structural question is absence, not degradation.
    expect(names(build(fakeEngine("enginec", GRID["enginec"] ?? [])).registry)).toEqual([
      "code_search",
    ]);
  });

  test("every tier-1 tool takes `symbol` and closes its schema", () => {
    const { registry } = build(fakeEngine("mnemex", CAPABILITIES));
    const tier1 = registry.tools().filter((tool) => tool.tier === 1);
    expect(tier1.map((tool) => tool.name).sort()).toEqual([...ALL_TIER1].sort());
    for (const tool of tier1) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema["required"]).toEqual(["symbol"]);
      expect(schema["additionalProperties"]).toBe(false);
      expect(tool.capability).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

describe("probeOnce", () => {
  test("never spawns for tools(), and caches for 60s", async () => {
    let probes = 0;
    let clock = 0;
    const engine = fakeEngine("mnemex", GRID["mnemex"] ?? [], {
      probe: async () => {
        probes += 1;
        return readyHealth("mnemex", GRID["mnemex"] ?? []);
      },
    });
    const registry = buildRegistry({
      settings: settingsFor("mnemex"),
      resolve: () => engine,
      availableEngines: SHIPPED,
      now: () => clock,
      onToolsChanged: () => undefined,
    });

    names(registry);
    names(registry);
    expect(probes).toBe(0); // tools/list NEVER spawns

    await registry.probeOnce();
    await registry.probeOnce();
    expect(probes).toBe(1);

    clock = 59_999;
    await registry.probeOnce();
    expect(probes).toBe(1);

    clock = 60_001;
    await registry.probeOnce();
    expect(probes).toBe(2);

    registry.invalidateProbe();
    await registry.probeOnce();
    expect(probes).toBe(3);
  });

  test("a delisting probe fires onToolsChanged, and the set shrinks", async () => {
    const engine = fakeEngine("serena", GRID["serena"] ?? [], {
      probe: async () =>
        healthWith("serena", {
          findImplementations: {
            ready: false,
            reason: "this language server has no find_implementations",
            retryable: false,
          },
        }),
    });
    const { registry, changes } = build(engine);
    expect(names(registry)).toContain("find_implementations");

    await registry.probeOnce();
    expect(changes()).toBe(1);
    expect(names(registry)).not.toContain("find_implementations");
    // The name stays known, so an in-flight call to it can still be answered.
    expect(registry.everListed().has("find_implementations")).toBe(true);
  });

  test("a probe that changes nothing fires no notification", async () => {
    const { registry, changes } = build(fakeEngine("mnemex", GRID["mnemex"] ?? []));
    await registry.probeOnce();
    expect(changes()).toBe(0);
  });

  test("the call budget appears only after a probe, and never invents a file count", async () => {
    const withCount = fakeEngine("mnemex", GRID["mnemex"] ?? [], {
      probe: async () => ({ ...readyHealth("mnemex", GRID["mnemex"] ?? []), indexedFiles: 1234 }),
    });
    const { registry } = build(withCount);
    expect(registry.tools()[0]?.description).not.toContain("Make at most");

    await registry.probeOnce();
    expect(registry.tools()[0]?.description).toContain("Make at most 8 calls for this project (1234 files indexed).");

    const noCount = fakeEngine("engineb", GRID["engineb"] ?? []);
    const second = build(noCount);
    await second.registry.probeOnce();
    const description = second.registry.tools()[0]?.description ?? "";
    expect(description).toContain("Make at most 8 calls for this project.");
    expect(description).not.toContain("files indexed");
  });

  test("probeOnce with no engine answers rather than throwing", async () => {
    const probe = await build(undefined).registry.probeOnce();
    expect(probe.ok).toBe(false);
  });

  test("dispose survives an engine that breaks its no-throw contract", async () => {
    const engine = fakeEngine("mnemex", GRID["mnemex"] ?? []);
    const { registry } = build({
      ...engine,
      dispose: async () => {
        throw new Error("child already gone");
      },
    });
    await registry.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tier 2
// ---------------------------------------------------------------------------

describe("tier 2", () => {
  const enabled: CodeAnalysisSettings = {
    ...settingsFor("mnemex"),
    passthrough: { enabled: true, maxPerEngine: 3, maxTotal: 6 },
  };

  test("ships EMPTY in 6.0.0, and collection is never even attempted", async () => {
    let asked = 0;
    const engine = fakeEngine("mnemex", GRID["mnemex"] ?? [], { passthroughs: [] });
    const spy: Engine = {
      ...engine,
      passthroughs: async () => {
        asked += 1;
        return [];
      },
    };
    const { registry } = build(spy);
    await registry.ready();
    expect(registry.tools().filter((tool) => tool.tier === 2)).toEqual([]);
    expect(asked).toBe(0);
    expect(DEFAULTS.passthrough.enabled).toBe(false);
  });

  test("A3 — the cap THROWS; a warning is a cap that gets exceeded", async () => {
    const engine = fakeEngine("mnemex", GRID["mnemex"] ?? [], {
      passthroughs: ["map", "hover", "observe", "reindex"].map((n) => passthrough(n)),
    });
    const error = await collectPassthroughs(engine, {
      enabled: true,
      maxPerEngine: 3,
      maxTotal: 6,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TierTwoCapExceeded);
    expect(error).toMatchObject({ engineId: "mnemex", count: 4, cap: 3 });
  });

  test("buildRegistry catches exactly that, keeps serving, and records one note", async () => {
    const engine = fakeEngine("mnemex", GRID["mnemex"] ?? [], {
      passthroughs: ["map", "hover", "observe", "reindex"].map((n) => passthrough(n)),
    });
    const registry = buildRegistry({
      settings: enabled,
      resolve: () => engine,
      availableEngines: SHIPPED,
      now: () => 0,
      onToolsChanged: () => undefined,
    });
    await registry.ready();

    // The engine's passthroughs are refused ENTIRELY; tier 0 and 1 are unaffected.
    expect(registry.tools().filter((tool) => tool.tier === 2)).toEqual([]);
    expect(names(registry)).toContain("code_search");
    expect(names(registry)).toContain("call_tree");

    const errors = registry.notes().filter((note) => note.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("4 passthrough tools against a cap of 3");
  });

  test("maxTotal admits in passthroughs() order and refuses the remainder", async () => {
    const engine = fakeEngine("mnemex", GRID["mnemex"] ?? [], {
      passthroughs: ["map", "graph", "trace"].map((n) => passthrough(n)),
    });
    const tools = await collectPassthroughs(engine, {
      enabled: true,
      maxPerEngine: 3,
      maxTotal: 2,
    });
    expect(tools.map((tool) => tool.name)).toEqual(["mnemex_map", "mnemex_graph"]);
  });

  test("a passthrough is always namespaced, even with no collision", async () => {
    const engine = fakeEngine("mnemex", GRID["mnemex"] ?? [], { passthroughs: [passthrough("map")] });
    const tools = await collectPassthroughs(engine, { enabled: true, maxPerEngine: 3, maxTotal: 6 });
    expect(tools[0]?.name).toBe("mnemex_map");
    expect(tools[0]?.tier).toBe(2);
    expect(tools[0]?.passthrough).toEqual({ engineId: "mnemex", upstream: "map" });
  });

  test("an engine that declares no passthroughs contributes none", async () => {
    const engine = fakeEngine("enginea", GRID["enginea"] ?? []);
    expect(await collectPassthroughs(engine, DEFAULTS.passthrough)).toEqual([]);
  });
});

describe("describePassthrough rejections", () => {
  test("a bad name", () => {
    expect(describePassthrough("mnemex", passthrough("Map"))).toMatchObject({ ok: false });
  });

  test("an over-long description", () => {
    const result = describePassthrough("mnemex", passthrough("map", { description: "x".repeat(401) }));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.reason).toContain("401");
  });

  test("the 64-char MCP name ceiling genuinely binds", () => {
    const engineId = "abcdefghijkl"; // 12, the maximum the id pattern allows
    const name = "a".repeat(23); // 23, the maximum the name pattern allows
    const result = describePassthrough(engineId, passthrough(name));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    // The reason names the computed name and its length, or nobody can act on it.
    expect(result.reason).toContain(`${engineId}_${name}`);
    expect(result.reason).toContain("66");
    expect(NAME_PREFIX_LENGTH).toBe(30);
    expect(NAME_PREFIX_LENGTH + engineId.length + 1 + name.length).toBeGreaterThan(
      MCP_NAME_CEILING,
    );
  });
});

// ---------------------------------------------------------------------------
// Schema sanitiser
// ---------------------------------------------------------------------------

describe("sanitiseSchema", () => {
  test("a non-object root is rejected", () => {
    expect(sanitiseSchema({ type: "string" })).toEqual({
      ok: false,
      reason: 'schema root must be {"type":"object"}',
    });
    expect(sanitiseSchema(null)).toMatchObject({ ok: false });
    expect(sanitiseSchema([])).toMatchObject({ ok: false });
  });

  test("oneOf nested three levels deep is stripped AND reported", () => {
    const result = sanitiseSchema({
      type: "object",
      properties: {
        a: { type: "object", properties: { b: { type: "string", oneOf: [{ const: 1 }] } } },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stripped).toEqual(["properties.a.properties.b.oneOf"]);
    expect(JSON.stringify(result.schema)).not.toContain("oneOf");
  });

  test("depth 5 is rejected", () => {
    const deep = {
      type: "object",
      properties: {
        a: {
          type: "object",
          properties: {
            b: { type: "object", properties: { c: { type: "object", properties: { d: { type: "string" } } } } },
          },
        },
      },
    };
    expect(sanitiseSchema(deep)).toMatchObject({ ok: false });
  });

  test("31 properties is rejected, 30 is not", () => {
    const properties = (count: number): Record<string, object> =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, { type: "string" }]));
    expect(sanitiseSchema({ type: "object", properties: properties(30) })).toMatchObject({ ok: true });
    expect(sanitiseSchema({ type: "object", properties: properties(31) })).toMatchObject({ ok: false });
  });

  test("keys outside the allow-list are dropped and additionalProperties is forced false", () => {
    const result = sanitiseSchema({
      type: "object",
      title: "ignored",
      $schema: "http://json-schema.org/draft-07/schema#",
      additionalProperties: true,
      properties: { q: { type: "string", description: "keep", examples: ["drop"] } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { q: { type: "string", description: "keep" } },
    });
  });

  test("items recurses like properties do", () => {
    const result = sanitiseSchema({
      type: "object",
      properties: { xs: { type: "array", items: { type: "string", $ref: "#/x" } } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stripped).toEqual(["properties.xs.items.$ref"]);
  });
});
