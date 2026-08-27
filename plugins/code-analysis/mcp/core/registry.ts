/**
 * registry.ts — the tool set, the listing predicate, the probe cache, the schema
 * sanitiser and the tier-2 cap.
 *
 * Two resolutions govern this file:
 *
 * 1. DECLARATION decides the list; HEALTH decides the notes. A probe removes a tool
 *    only when it reports a PERMANENT incapacity, which is a capability answer rather
 *    than a health answer. A configured engine that is installed but down keeps its
 *    tools and returns `backend_unavailable` with a remedy — unavailability is an
 *    answer, not a missing tool.
 * 2. `tools/list` NEVER spawns. At startup the set is a pure function of committed
 *    settings; the first `tools/call` probes and, if that delists something, fires
 *    `onToolsChanged`. Tier 2 is the sole exception, because you cannot enumerate an
 *    engine's extras without asking it — and it ships disabled.
 *
 * This module must never learn an engine id: `resolve` is injected, and the only file
 * count it will read is the typed, engine-agnostic `BackendHealth.indexedFiles`. The
 * opaque per-engine health map is off limits here — mnemex spells that number
 * `indexedFileCount` and every other engine spells it something else, so reading it
 * would be core/ learning an engine's vocabulary inside the module that exists to be
 * the engine-agnostic dispatch table. render.ts is the only core module allowed to
 * name that map, and it only iterates it for humans.
 */

import { CAPABILITIES } from "./capabilities";
import type { Capability, CapabilityStatus } from "./capabilities";
import type { BackendHealth, BackendNote, Engine, PassthroughTool } from "./ports";
import type { CodeAnalysisSettings, EngineSpec, PassthroughSettings } from "./settings";

export interface ToolDescriptor {
  /** The unprefixed name. Claude Code adds `mcp__plugin_code-analysis_ca__`. */
  name: string;
  description: string;
  inputSchema: object;
  tier: 0 | 1 | 2;
  capability?: Capability; // tier 0 and 1
  passthrough?: { engineId: string; upstream: string }; // tier 2
}

const SCOPE_PROPERTY = {
  type: "string",
  description: "Path or glob to restrict the search to. A bare path is widened to <path>/**.",
} as const;

const SYMBOL_PROPERTY = {
  type: "string",
  description: "Symbol name. A qualified name (User.Service, Auth::login) is accepted whole.",
} as const;

export const TIER0_TOOL: ToolDescriptor = {
  name: "code_search",
  description:
    "Search this codebase and get back ranked source locations. Ask in your own words: " +
    "the server infers what shape of question it is, picks the operation the configured " +
    "engine can genuinely answer, and reports which one answered on the served_by line. " +
    "Use it for anything naming a symbol or a concept. Use Grep instead for a literal " +
    "string, a count, or a filename pattern. An empty result is an answer, and it says so.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-form question or symbol name." },
      intent: {
        type: "string",
        enum: ["locate", "understand", "dependents", "implementations", "impact", "knowledge"],
        description: "Optional hint. Omit it and the server infers the intent from the query.",
      },
      scope: SCOPE_PROPERTY,
    },
    required: ["query"],
    additionalProperties: false,
  },
  tier: 0,
};

export const TIER1_TOOLS: Readonly<Partial<Record<Capability, ToolDescriptor>>> = {
  findDependencies: tier1("find_dependencies", "findDependencies", "depth", {
    description:
      "What `symbol` depends on — its outgoing edges. Structural, from the engine's call graph, not a text search.",
  }),
  findDependents: tier1("find_dependents", "findDependents", "depth", {
    description: "What depends on `symbol` — its callers and references. Incoming edges only.",
  }),
  callTree: tier1("call_tree", "callTree", "max_depth", {
    description:
      "Transitive call paths through `symbol`, not just direct edges. A depth the engine cannot honour is clamped, and the clamp is reported.",
  }),
  findImplementations: tier1("find_implementations", "findImplementations", undefined, {
    description: "Concrete implementations or subclasses of `symbol`.",
  }),
  impact: tier1("impact", "impact", "max_depth", {
    description: "Blast radius of changing `symbol`: what breaks, and how risky the change looks.",
  }),
};

function tier1(
  name: string,
  capability: Capability,
  depthKey: "depth" | "max_depth" | undefined,
  meta: { description: string },
): ToolDescriptor {
  const properties: Record<string, object> = { symbol: SYMBOL_PROPERTY, scope: SCOPE_PROPERTY };
  if (depthKey !== undefined) {
    properties[depthKey] = {
      type: "number",
      minimum: 1,
      description: "How many edges to traverse. Clamped to what the engine supports.",
    };
  }
  return {
    name,
    description: meta.description,
    inputSchema: { type: "object", properties, required: ["symbol"], additionalProperties: false },
    tier: 1,
    capability,
  };
}

/** 30, computed once: "mcp__" + "plugin_code-analysis" + "_ca" + "__". */
export const NAME_PREFIX_LENGTH: number =
  "mcp__".length + "plugin_code-analysis".length + "_ca".length + "__".length;
export const MCP_NAME_CEILING = 64 as const;

/** The tier-0 call budget, injected into the description after the first probe. */
export const CALL_BUDGET = 8;
const PROBE_TTL_MS = 60_000;

const PASSTHROUGH_NAME_PATTERN = /^[a-z][a-z0-9_]{2,23}$/u;
const MAX_DESCRIPTION_CHARS = 400;
const MAX_DESCRIPTION_PLUS_SCHEMA_CHARS = 2500;
const MAX_SCHEMA_DEPTH = 4;
const MAX_SCHEMA_PROPERTIES = 30;

const SCHEMA_ALLOWED = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "const",
  "default",
  "description",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "additionalProperties",
  "minItems",
  "maxItems",
]);

const SCHEMA_FORBIDDEN = [
  "oneOf",
  "allOf",
  "anyOf",
  "not",
  "if",
  "then",
  "else",
  "$ref",
  "$defs",
  "definitions",
];

export type ProbeResult =
  | { ok: true; health: BackendHealth }
  | { ok: false; reason: string; remedy?: string };

/**
 * THE predicate, exported so the truth table is directly testable.
 *
 *   listed(cap) ⟺ declared.has(cap)
 *               ∧ ¬(probe.ok ∧ capabilities[cap].ready === false
 *                            ∧ capabilities[cap].retryable === false)
 *
 * A probe that has not run, a probe that failed, and a retryable incapacity all keep
 * the tool listed. Only a permanent incapacity removes it.
 */
export function listedCapabilities(
  declared: ReadonlySet<Capability>,
  probe: ProbeResult | undefined,
): Capability[] {
  return CAPABILITIES.filter((capability) => {
    if (!declared.has(capability)) return false;
    if (probe === undefined || !probe.ok) return true;
    const status: CapabilityStatus | undefined = probe.health.capabilities[capability];
    if (status === undefined || status.ready) return true;
    return status.retryable;
  });
}

export class TierTwoCapExceeded extends Error {
  readonly engineId: string;
  readonly count: number;
  readonly cap: number;

  constructor(engineId: string, count: number, cap: number) {
    super(`${engineId} declares ${count} passthrough tools; the cap is ${cap}.`);
    this.name = "TierTwoCapExceeded";
    this.engineId = engineId;
    this.count = count;
    this.cap = cap;
  }
}

/**
 * THROWS TierTwoCapExceeded. Never called unless passthrough.enabled === true.
 *
 * It throws rather than warns because a cap that logs is a cap that gets exceeded, and
 * because the facade's named failure mode is accreting methods until it is a God
 * Object that merely delegates. Per-tool rejections inside the cap are individually
 * caught, so one malformed tool costs only itself.
 */
export async function collectPassthroughs(
  engine: Engine,
  limits: PassthroughSettings,
): Promise<ToolDescriptor[]> {
  if (engine.passthroughs === undefined) return [];

  const declared = await engine.passthroughs();
  if (declared.length > limits.maxPerEngine) {
    throw new TierTwoCapExceeded(engine.id, declared.length, limits.maxPerEngine);
  }

  const admitted: ToolDescriptor[] = [];
  for (const tool of declared) {
    // maxTotal admits in `passthroughs()` array order and refuses the remainder.
    if (admitted.length >= limits.maxTotal) break;
    try {
      const described = describePassthrough(engine.id, tool);
      if (described.ok) admitted.push(described.tool);
    } catch {
      // A passthrough that throws while being described costs itself and nothing else.
    }
  }
  return admitted;
}

export type DescribeResult =
  | { ok: true; tool: ToolDescriptor }
  | { ok: false; reason: string };

/** Per-tool gate. Every rejection carries a reason a human can act on — a passthrough
 *  that vanishes with no explanation is the silent-failure class this facade exists to
 *  remove, at a smaller scale. */
export function describePassthrough(engineId: string, tool: PassthroughTool): DescribeResult {
  if (!PASSTHROUGH_NAME_PATTERN.test(tool.name)) {
    return { ok: false, reason: `name "${tool.name}" does not match ${PASSTHROUGH_NAME_PATTERN.source}` };
  }
  if (tool.description.length > MAX_DESCRIPTION_CHARS) {
    return {
      ok: false,
      reason: `description is ${tool.description.length} chars, over the ${MAX_DESCRIPTION_CHARS} ceiling`,
    };
  }

  const sanitised = sanitiseSchema(tool.inputSchema);
  if (!sanitised.ok) return { ok: false, reason: sanitised.reason };

  const serialised = JSON.stringify(sanitised.schema);
  const weight = tool.description.length + serialised.length;
  if (weight > MAX_DESCRIPTION_PLUS_SCHEMA_CHARS) {
    return {
      ok: false,
      reason: `description plus schema is ${weight} chars, over the ${MAX_DESCRIPTION_PLUS_SCHEMA_CHARS} ceiling`,
    };
  }

  // Tier 2 is ALWAYS `<engineId>_<name>`, even with no collision, so installing a
  // different engine never renames a tool that already exists.
  const name = `${engineId}_${tool.name}`;
  const mcpLength = NAME_PREFIX_LENGTH + name.length;
  if (mcpLength > MCP_NAME_CEILING) {
    return {
      ok: false,
      reason: `mcp__plugin_code-analysis_ca__${name} is ${mcpLength} chars, over the ${MCP_NAME_CEILING} ceiling`,
    };
  }

  return {
    ok: true,
    tool: {
      name,
      description: tool.description,
      inputSchema: sanitised.schema,
      tier: 2,
      passthrough: { engineId, upstream: tool.upstream.tool },
    },
  };
}

export type SanitiseResult =
  | { ok: true; schema: object; stripped: string[] }
  | { ok: false; reason: string };

/**
 * Allow-list, and it RECURSES. mnemex is an unpinned auto-updating binary, so a
 * verbatim upstream schema is a bet that its next release adds no keyword the host
 * rejects — and one upstream `oneOf` has already broken all MCP tool registration for
 * a whole session elsewhere in this marketplace.
 */
export function sanitiseSchema(schema: unknown): SanitiseResult {
  if (!isPlainObject(schema)) return { ok: false, reason: "schema root is not an object" };
  if (schema["type"] !== "object") {
    return { ok: false, reason: 'schema root must be {"type":"object"}' };
  }

  const stripped: string[] = [];
  const counted = { properties: 0 };
  const sanitised = sanitiseNode(schema, 1, "", stripped, counted);
  if (sanitised === undefined) {
    return {
      ok: false,
      reason: `schema exceeds depth ${MAX_SCHEMA_DEPTH} or ${MAX_SCHEMA_PROPERTIES} properties`,
    };
  }
  return { ok: true, schema: sanitised, stripped };
}

function sanitiseNode(
  node: Record<string, unknown>,
  depth: number,
  path: string,
  stripped: string[],
  counted: { properties: number },
): Record<string, unknown> | undefined {
  if (depth > MAX_SCHEMA_DEPTH) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (SCHEMA_FORBIDDEN.includes(key)) {
      stripped.push(path === "" ? key : `${path}.${key}`);
      continue;
    }
    if (!SCHEMA_ALLOWED.has(key)) continue;

    if (key === "properties") {
      if (!isPlainObject(value)) continue;
      const properties: Record<string, unknown> = {};
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        counted.properties += 1;
        if (counted.properties > MAX_SCHEMA_PROPERTIES) return undefined;
        if (!isPlainObject(propertySchema)) continue;
        const child = sanitiseNode(
          propertySchema,
          depth + 1,
          path === "" ? `properties.${propertyName}` : `${path}.properties.${propertyName}`,
          stripped,
          counted,
        );
        if (child === undefined) return undefined;
        properties[propertyName] = child;
      }
      out["properties"] = properties;
      continue;
    }

    if (key === "items" && isPlainObject(value)) {
      const child = sanitiseNode(
        value,
        depth + 1,
        path === "" ? "items" : `${path}.items`,
        stripped,
        counted,
      );
      if (child === undefined) return undefined;
      out["items"] = child;
      continue;
    }

    out[key] = value;
  }

  // Force it closed. An open object schema is how an unknown upstream key reaches the
  // adapter unvalidated.
  if (out["type"] === "object" || out["properties"] !== undefined) {
    out["additionalProperties"] = false;
  }
  return out;
}

export interface RegistryInput {
  settings: CodeAnalysisSettings;
  /** Injected by server.ts. registry.ts must never know an engine id. */
  resolve: (id: string, spec: EngineSpec) => Engine | undefined;
  /**
   * Every engine id this build ships, for REMEDY TEXT ONLY.
   *
   * Injected for the same reason `resolve` is: the ids belong to `adapters/`, and this
   * module importing them would be core/ learning the backend names it exists not to
   * know. It is a list to quote, never a thing to branch on — no code path here
   * compares an entry against a literal, and adding one must not become a way to.
   *
   * It exists because the alternative is worse than the rule it bends. "Set `engine` to
   * an engine this plugin ships an adapter for" tells a user who typed `serana` nothing
   * they did not already know, and there is no other surface that would tell them: the
   * settings file has no schema, the tool list looks identical to a correct tier-0
   * configuration, and the typo is silent everywhere else.
   */
  availableEngines: readonly string[];
  now: () => number;
  onToolsChanged: () => void;
}

export interface Registry {
  /** Pure read of the cached set. NEVER spawns a process. */
  tools(): readonly ToolDescriptor[];
  engineId(): string | undefined;
  declared(): ReadonlySet<Capability>;
  /** Lazy. Spawns on first call, caches 60 s, NEVER throws. */
  probeOnce(): Promise<ProbeResult>;
  invalidateProbe(): void;
  engine(): Engine | undefined;
  notes(): readonly BackendNote[];
  /** Resolves once startup work has settled — tier-2 collection, when enabled.
   *  Already resolved when it is not, which is every 6.0.0 default install. Without
   *  it the first `tools/list` could race the collection it is supposed to include. */
  ready(): Promise<void>;
  /** Every tool name listed at any point this session. A `tools/call` for a name that
   *  was listed and no longer is must answer, not raise -32601: the probe that ran as
   *  part of that very call is what delisted it, so the race is the normal path. */
  everListed(): ReadonlySet<string>;
  dispose(): Promise<void>;
}

export function buildRegistry(input: RegistryInput): Registry {
  const notes: BackendNote[] = [];
  const everListed = new Set<string>();
  const { engine, engineId } = resolveEngine(input, notes);

  const declared = new Set<Capability>();
  if (engine !== undefined) {
    for (const capability of CAPABILITIES) {
      if (typeof engine.capabilities[capability] === "function") declared.add(capability);
    }
  }

  let probe: ProbeResult | undefined;
  let probedAt = 0;
  let inFlight: Promise<ProbeResult> | undefined;
  let passthroughs: ToolDescriptor[] = [];

  const tools = (): readonly ToolDescriptor[] => {
    const set: ToolDescriptor[] = [describeTier0(probe)];
    for (const capability of listedCapabilities(declared, probe)) {
      const descriptor = TIER1_TOOLS[capability];
      if (descriptor !== undefined) set.push(descriptor);
    }
    set.push(...passthroughs);
    for (const tool of set) everListed.add(tool.name);
    return set;
  };

  const ready = startPassthroughCollection();
  tools(); // Seed `everListed` with the startup set.

  function startPassthroughCollection(): Promise<void> {
    if (!input.settings.passthrough.enabled || engine === undefined) return Promise.resolve();
    return collectPassthroughs(engine, input.settings.passthrough)
      .then((collected) => {
        passthroughs = collected;
        if (collected.length > 0) input.onToolsChanged();
      })
      .catch((error: unknown) => {
        // Exactly one error type is caught here. Anything else is a bug and must not
        // be swallowed into a silent tier-0-only server.
        if (!(error instanceof TierTwoCapExceeded)) throw error;
        passthroughs = [];
        notes.push({
          level: "error",
          code: "capability_unsupported",
          message: `${error.engineId} declares ${error.count} passthrough tools against a cap of ${error.cap}; all of its passthroughs are refused. Tier 0 and tier 1 are unaffected.`,
          remedy: `Lower ${error.engineId}'s passthrough count, or leave "code-analysis".passthrough.enabled false.`,
        });
      });
  }

  return {
    tools,
    engineId: () => engineId,
    declared: () => declared,
    engine: () => engine,
    notes: () => notes,
    ready: () => ready,
    everListed: () => everListed,

    invalidateProbe(): void {
      probe = undefined;
      probedAt = 0;
    },

    async probeOnce(): Promise<ProbeResult> {
      if (probe !== undefined && input.now() - probedAt < PROBE_TTL_MS) return probe;
      if (inFlight !== undefined) return inFlight;
      if (engine === undefined) {
        return { ok: false, reason: "no engine is configured for this project." };
      }

      const before = listedCapabilities(declared, probe).join(",");
      inFlight = runProbe(engine)
        .then((result) => {
          probe = result;
          probedAt = input.now();
          if (listedCapabilities(declared, result).join(",") !== before) input.onToolsChanged();
          return result;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },

    async dispose(): Promise<void> {
      await ready.catch(() => undefined);
      if (engine === undefined) return;
      try {
        await engine.dispose();
      } catch {
        // dispose() is documented idempotent and non-throwing; an engine that breaks
        // that promise must not stop the server from exiting.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveEngine(
  input: RegistryInput,
  notes: BackendNote[],
): { engine: Engine | undefined; engineId: string | undefined } {
  const id = input.settings.engine;
  // No engine named is a legitimate configuration, not a fault: tier 0 alone.
  if (id === undefined) return { engine: undefined, engineId: undefined };

  // Quoted, so an id with a stray space or a smart quote in it is visible rather than
  // reading as a clean name that mysteriously does not work.
  const shipped = input.availableEngines.map((each) => `"${each}"`).join(", ");
  const shippedClause = shipped === "" ? "" : ` This build ships: ${shipped}.`;

  const spec = input.settings.engines[id];
  if (spec === undefined) {
    notes.push({
      level: "error",
      code: "backend_unavailable",
      message: `"code-analysis".engine names "${id}", but "code-analysis".engines has no entry for it.`,
      remedy: `Add an "engines"."${id}" entry with a "command" to .claude/settings.json, or change "engine".${shippedClause}`,
    });
    return { engine: undefined, engineId: id };
  }

  let engine: Engine | undefined;
  try {
    engine = input.resolve(id, spec);
  } catch {
    engine = undefined;
  }
  if (engine === undefined) {
    notes.push({
      level: "error",
      code: "backend_unavailable",
      message: `No adapter is available for engine "${id}".`,
      // NEVER a near-match suggestion. Resolving "serana" to "serena" by string distance
      // is the same class of error as picking a model by name similarity: it is right
      // often enough to be trusted and wrong silently. The list is shown; the choice
      // stays the operator's.
      remedy: `Set "code-analysis".engine to an engine this plugin ships an adapter for.${shippedClause}`,
    });
  }
  return { engine, engineId: id };
}

async function runProbe(engine: Engine): Promise<ProbeResult> {
  try {
    return { ok: true, health: await engine.probe() };
  } catch (error) {
    // probeOnce NEVER throws. A probe that blows up is exactly the state the facade
    // exists to report, so it becomes an answer.
    return {
      ok: false,
      reason: `${engine.id} failed to probe: ${errorText(error)}`,
      remedy: `Check that ${engine.displayName} is installed and runnable, then retry.`,
    };
  }
}

/**
 * The tier-0 descriptor, with the per-repo call budget appended once a probe has run.
 * The first `tools/list` carries no budget sentence, because producing one would need
 * a spawn. When the engine reports no file count the sentence is emitted WITHOUT the
 * parenthetical rather than with a fabricated number.
 */
function describeTier0(probe: ProbeResult | undefined): ToolDescriptor {
  if (probe === undefined || !probe.ok) return TIER0_TOOL;
  const files = probe.health.indexedFiles;
  const parenthetical = files === undefined ? "" : ` (${files} files indexed)`;
  return {
    ...TIER0_TOOL,
    description: `${TIER0_TOOL.description} Make at most ${CALL_BUDGET} calls for this project${parenthetical}.`,
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
