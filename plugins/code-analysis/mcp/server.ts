#!/usr/bin/env bun
/**
 * server.ts — the composition root, and the JSON-RPC server half of the facade.
 *
 * The ONE file that imports `core/`, `adapters/` and `transport/` together. Everything
 * below it is a pure function or a translator; this file is where the process, the
 * clock, the filesystem and the host's stdio finally arrive.
 *
 * Four properties are load-bearing, and each is asserted by `server.e2e.test.ts`:
 *
 * 1. `initialize` advertises `capabilities.tools.listChanged`. A host is entitled to
 *    ignore `notifications/tools/list_changed` from a server that never declared it —
 *    and then the registry's delisting reduces to a no-op: the tool stays in the
 *    host's list and every call to it fails. It is not optional polish.
 *
 * 2. `tools/call` dispatch is THREE-way, and the middle branch is why it exists:
 *      listed now              -> dispatch
 *      listed earlier, not now -> success-shaped answer carrying the probe's own
 *                                 reason. The race is the NORMAL path: the probe that
 *                                 delisted the tool ran as part of this very call.
 *      never ours              -> JSON-RPC -32601
 *
 * 3. `tools/list` NEVER spawns. The startup set is a pure function of committed
 *    settings; the first `tools/call` is what probes.
 *
 * 4. NOTHING reaches stdout except JSON-RPC. stdout IS the protocol channel, so one
 *    stray line corrupts the framing and the failure then presents as a protocol
 *    error, nowhere near the logging mistake that caused it. Every diagnostic goes to
 *    stderr. `core/imports.test.ts` enforces this over the whole shipped tree.
 *
 * And one more that governs every result: errors are SUCCESS-shaped. An engine that is
 * missing, down, or out of its depth produces `isError: false` with a note and a
 * remedy. `isError` is reserved for a security refusal or a genuine malfunction,
 * because one or two errors early in a session and the agent stops calling the tool
 * for the rest of it.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ENGINE_IDS, makeResolver } from "./adapters/index";
import type { AdapterContext } from "./adapters/shared/kit";
import type { Capability } from "./core/capabilities";
import type { BackendNote, Capabilities, Hit, Outcome } from "./core/ports";
import {
  TIER1_TOOLS,
  buildRegistry,
  listedCapabilities,
  type ProbeResult,
  type Registry,
  type ToolDescriptor,
} from "./core/registry";
import {
  DEFAULT_MAX_TEXT_LINES,
  makeLedger,
  renderNotes,
  renderOutcome,
  renderUnavailable,
  type EmissionLedger,
  type RenderOptions,
} from "./core/render";
import {
  INTENTS,
  route,
  routeCapability,
  type Intent,
  type RouteDecision,
  type RouteResult,
  type ServedBy,
} from "./core/route";
import {
  loadSettings,
  type CodeAnalysisSettings,
  type EngineSpec,
  type SettingsIo,
} from "./core/settings";
import { encode, makeLineReader, type RpcId, type RpcResponse } from "./transport/jsonrpc";
import { MCP_CLIENT_DEFAULTS, makeMcpClient, type McpClient } from "./transport/mcp-stdio-client";

/**
 * The MCP revision this server declares.
 *
 * BUMPED FROM `2024-11-05` FOR ONE CONCRETE REASON: `_meta` does not exist on `Tool` in
 * that revision — it defines `name`, `description` and `inputSchema` and nothing else —
 * and `_meta` is how a tool asks a host not to defer it
 * (`adoption.alwaysLoad`). Sending an unknown field on an older negotiated
 * version is undefined behaviour: a host is entitled to drop it, and a silently dropped
 * lever is one that measures as "no effect" while never having been delivered.
 *
 * `2025-06-18` adds `_meta`, `title` and `annotations` on `Tool`. Nothing this server
 * already sends changes shape, so the bump is additive.
 */
const PROTOCOL_VERSION = "2025-06-18";

/**
 * The `initialize` instructions, sent only when `adoption.instructions` is on.
 *
 * WRITTEN AS ROUTING, NOT ADVERTISING. It names the question shapes this server answers
 * better than a text search, and — deliberately — the ones it does not, because a server
 * that claims everything gets trusted for nothing. The measured failure it exists to
 * address is an agent that reached for `Bash` 146 times and this server 0 times across 72
 * scenarios.
 *
 * It is a STRING CONSTANT rather than generated prose so the bench can vary exactly one
 * thing. If this text is ever tuned, that is a new arm, not an edit.
 */
const SERVER_INSTRUCTIONS = `This project has a pre-built code index. Use \`code_search\` INSTEAD OF running \`grep\`, \`rg\`, \`find\` or \`ls -R\` through Bash when you need to locate code.

WHEN TO USE IT
- "where is X defined", "what is X", "how does X work" -> \`code_search\`. One call returns ranked locations with the enclosing symbol, which a text match cannot give you.
- "what calls X" / "what does X call" / "what breaks if I change X" -> the structural tools, when they are listed. They answer from the index's edges, not from string matching, so they find call sites that grep cannot see and skip matches that only look like calls.

WHEN NOT TO USE IT
- An exact literal you already know the spelling of, a count of occurrences, or a filename pattern: Bash with \`rg\`/\`find\` is the better tool and this server does not claim otherwise.
- Files the index does not cover. Every answer names the engine that served it, so an empty result is distinguishable from an unindexed one.

Only the tools listed in this session are available; a capability the configured engine cannot genuinely answer is absent rather than degraded.`;

/** Matches the key in `.mcp.json`; the host prefixes it into every tool name. */
const SERVER_NAME = "ca";

/** Probe-result TTL handed to each adapter, per design §8.1. */
const PROBE_TTL_MS = 60_000;

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// stderr — the only channel a diagnostic may use
// ---------------------------------------------------------------------------

function log(line: string): void {
  process.stderr.write(`[code-analysis/ca] ${line}\n`);
}

// ---------------------------------------------------------------------------
// Tool name -> capability, for the delisted branch
// ---------------------------------------------------------------------------

/**
 * The middle dispatch branch has to name the capability a delisted tool stood for, so
 * it can quote the probe's own reason rather than inventing one. Built from the same
 * table the registry lists from, so the two cannot drift.
 */
const CAPABILITY_BY_TOOL: ReadonlyMap<string, Capability> = (() => {
  const map = new Map<string, Capability>();
  for (const [capability, descriptor] of Object.entries(TIER1_TOOLS)) {
    if (descriptor !== undefined) map.set(descriptor.name, capability as Capability);
  }
  return map;
})();

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface Facade {
  registry: Registry;
  settings: CodeAnalysisSettings;
  ledger: EmissionLedger;
  /** Layers that were skipped, and values that were dropped. A typo in
   *  settings.local.json that makes the engine vanish with no explanation is the
   *  silent-failure class this whole facade exists to remove. */
  startupNotes: readonly BackendNote[];
  /** Every client this process constructed, so shutdown can reap children even if an
   *  adapter forgets to. `dispose()` is documented idempotent. */
  clients: McpClient[];
  dispose(): Promise<void>;
}

/**
 * The per-call deadline for one engine: its own `callTimeoutMs` when settings set one,
 * the transport's default otherwise.
 *
 * The ONE place `EngineSpec` meets `McpClientOptions`. Exported so the resolution can
 * be asserted without spawning anything — the mapping is three tokens long and it is
 * still the whole feature, because a deadline that silently reverts to 30_000 looks
 * identical to one that was never configured.
 *
 * `??` and not `||`: a `callTimeoutMs` of 0 must not fall through to the default. It
 * cannot reach here — `validateEngines` rejects it — and relying on a validator two
 * modules away to keep an operator from disabling every deadline is not a property
 * worth resting on.
 */
export function callMsFor(spec: EngineSpec): number {
  return spec.callTimeoutMs ?? MCP_CLIENT_DEFAULTS.callMs;
}

function projectDirOf(env: NodeJS.ProcessEnv): string {
  // CLAUDE_PROJECT_DIR is injected into every stdio MCP server by the host, declared
  // or not — which is why `.mcp.json` carries no `env` block at all. cwd is the
  // fallback for a server started by hand.
  const declared = env["CLAUDE_PROJECT_DIR"];
  return declared !== undefined && declared !== "" ? declared : process.cwd();
}

function homeOf(env: NodeJS.ProcessEnv): string {
  return env["HOME"] ?? env["USERPROFILE"] ?? "";
}

/** `serverInfo.version`. Read from the manifest rather than restated here, because a
 *  restated version is a version that drifts silently. */
function pluginVersion(): string {
  try {
    const raw = readFileSync(join(HERE, "..", "plugin.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const version = (parsed as Record<string, unknown>)["version"];
      if (typeof version === "string" && version !== "") return version;
    }
  } catch {
    // Fall through. A manifest we cannot read is worth one stderr line, not a refusal
    // to start: the tools work perfectly well without a version string.
  }
  log("could not read plugin.json; reporting serverInfo.version as unknown");
  return "unknown";
}

/** Existence, never contents. A path that cannot be stat'd — permissions, a dangling
 *  symlink, a name the OS rejects — is "does not exist", which makes the repair decline
 *  and the honest `../` answer stand. */
function fileExists(absolutePath: string): boolean {
  try {
    return existsSync(absolutePath);
  } catch {
    return false;
  }
}

function buildFacade(env: NodeJS.ProcessEnv, onToolsChanged: () => void): Facade {
  const projectDir = projectDirOf(env);
  const io: SettingsIo = {
    home: homeOf(env),
    projectDir,
    readFileText(path: string): string | undefined {
      try {
        return readFileSync(path, "utf8");
      } catch {
        // Absent and unreadable are the same answer here: the layer said nothing.
        return undefined;
      }
    },
  };

  const load = loadSettings(io);
  const clients: McpClient[] = [];

  const resolve = makeResolver((id: string, spec: EngineSpec): AdapterContext => {
    // The composition root is the only place a child process may be constructed. An
    // adapter never spawns, never sets a timer, never handles a restart.
    const client = makeMcpClient(
      {
        engineId: id,
        command: spec.command,
        args: spec.args ?? [],
        env: spec.env,
        cwd: spec.cwd ?? projectDir,
      },
      // The per-call deadline is the ONE transport option settings may set, and this is
      // the only line that reads it. The transport quotes whatever number it was given
      // in its own timeout note ("<engine> did not answer <tool> within <callMs>ms"),
      // so an operator who configured 120_000 reads 120_000 back rather than chasing a
      // constant that is not in effect.
      { ...MCP_CLIENT_DEFAULTS, callMs: callMsFor(spec), log },
    );
    clients.push(client);
    // `fileExists` is the ONLY filesystem access an adapter gets, and it is injected for
    // the same reason the clock is: `repairForeignPath` has to ask whether a candidate
    // resolves under projectDir, and kit.ts may not reach for node:fs to find out.
    return { client, projectDir, fileExists, now: Date.now, log, probeTtlMs: PROBE_TTL_MS };
  });

  const registry = buildRegistry({
    settings: load.settings,
    resolve,
    availableEngines: ENGINE_IDS,
    now: Date.now,
    onToolsChanged,
  });

  // Skipped layers are reported once at boot on stderr, AND ride along in every tool
  // result as notes, so a human who never reads stderr still learns why their engine
  // vanished.
  for (const note of load.notes) log(`${note.code}: ${note.message}`);
  for (const layer of load.layers) log(`settings ${layer.status}: ${layer.path}`);

  return {
    registry,
    settings: load.settings,
    ledger: makeLedger(),
    startupNotes: load.notes,
    clients,
    async dispose(): Promise<void> {
      await registry.dispose();
      for (const client of clients) await client.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Capability invocation
// ---------------------------------------------------------------------------

type Invocation = () => Promise<Outcome<Hit>>;

/**
 * Bind a routed decision to the engine method that answers it.
 *
 * `undefined` means the engine does not declare the capability, or the routed argument
 * shape does not match it — both of which are answers ("this engine cannot do that
 * here"), never a throw. The argument kinds are guaranteed by `route`; checking them
 * anyway is what keeps a future chain edit from silently handing an engine a name
 * where it expected free text.
 */
function bind(caps: Capabilities, decision: RouteDecision): Invocation | undefined {
  const { args, scope } = decision;

  switch (decision.capability) {
    case "generalSearch": {
      const fn = caps.generalSearch?.bind(caps);
      if (fn === undefined || args.kind !== "text") return undefined;
      return () => fn({ text: args.text }, scope);
    }
    case "knowledgeSearch": {
      const fn = caps.knowledgeSearch?.bind(caps);
      if (fn === undefined || args.kind !== "text") return undefined;
      return () => fn({ text: args.text }, scope);
    }
    case "locateSymbol": {
      const fn = caps.locateSymbol?.bind(caps);
      if (fn === undefined || args.kind !== "name") return undefined;
      return () => fn({ name: args.name }, scope);
    }
    case "readSource":
      // No capability chain reaches readSource and no tier-1 tool selects it, so this
      // is unreachable in 6.0.0. It is left explicit rather than defaulted, because a
      // CodeLocation is not a name and guessing one would be a fabrication.
      return undefined;
    case "findDependencies": {
      const fn = caps.findDependencies?.bind(caps);
      if (fn === undefined || args.kind !== "distance") return undefined;
      return () => fn({ name: args.name, distance: args.distance }, scope);
    }
    case "findDependents": {
      const fn = caps.findDependents?.bind(caps);
      if (fn === undefined || args.kind !== "distance") return undefined;
      return () => fn({ name: args.name, distance: args.distance }, scope);
    }
    case "callTree": {
      const fn = caps.callTree?.bind(caps);
      if (fn === undefined || args.kind !== "maxDistance") return undefined;
      return () => fn({ name: args.name, maxDistance: args.maxDistance }, scope);
    }
    case "findImplementations": {
      const fn = caps.findImplementations?.bind(caps);
      if (fn === undefined || args.kind !== "name") return undefined;
      return () => fn({ name: args.name }, scope);
    }
    case "impact": {
      const fn = caps.impact?.bind(caps);
      if (fn === undefined || args.kind !== "maxDistance") return undefined;
      return () => fn({ name: args.name, maxDistance: args.maxDistance }, scope);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError: boolean;
}

/** A success-shaped result. The only shape this server ever returns for a tool call. */
function answer(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: false };
}

type Dispatch = { kind: "result"; result: ToolResult } | { kind: "unknown-tool" };

export function createServer(env: NodeJS.ProcessEnv, write: (line: string) => void) {
  let initialized = false;

  const notifyToolsChanged = (): void => {
    if (!initialized) return; // Nothing to notify before the handshake completes.
    write(encode({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }));
  };

  const facade = buildFacade(env, notifyToolsChanged);
  const version = pluginVersion();

  /** Startup notes ride along on every result: they describe a misconfiguration that
   *  persists, and a cause nobody sees is the silent failure this facade exists to
   *  remove. On a healthy install this array is empty and costs nothing. */
  function facadeNotes(): BackendNote[] {
    return [...facade.startupNotes, ...facade.registry.notes()];
  }

  function engineLabel(): string {
    return facade.registry.engineId() ?? "none";
  }

  function unavailable(served: Partial<ServedBy>, note: BackendNote): ToolResult {
    const extra = facadeNotes();
    const base = renderUnavailable(served, note);
    return answer(extra.length === 0 ? base : `${base}${renderNotes(extra)}\n`);
  }

  /**
   * The middle dispatch branch: a tool the host still holds, which this session has
   * since delisted. The probe that removed it is the authority on why, so its own
   * reason and remedy are what the caller gets — never a bare -32601.
   */
  function delisted(name: string, probe: ProbeResult | undefined): ToolResult {
    const capability = CAPABILITY_BY_TOOL.get(name);
    const status =
      capability !== undefined && probe !== undefined && probe.ok
        ? probe.health.capabilities[capability]
        : undefined;

    const note: BackendNote = {
      level: "error",
      code: "capability_unsupported",
      message:
        status !== undefined && !status.ready
          ? status.reason
          : `${engineLabel()} no longer offers ${name} for this project; it was withdrawn after the engine was probed.`,
    };
    if (status !== undefined && !status.ready && status.remedy !== undefined) {
      note.remedy = status.remedy;
    }

    const served: Partial<ServedBy> = { engine: engineLabel() };
    if (capability !== undefined) served.capability = capability;
    return unavailable(served, note);
  }

  /**
   * The remedy the answer could not carry itself.
   *
   * A spawn that fails with ENOENT reaches the transport as "<engine> could not be
   * started", and the transport has no idea how to install that engine — the adapter
   * does, and it put that command in the probe's `CapabilityStatus.remedy`. So when an
   * answer arrives carrying no remedy at all, the probe's own status for the capability
   * that served the call supplies one. An answer that already names a fix is left
   * alone, and a healthy capability adds nothing.
   *
   * Scoped to the ONE capability that served this call on purpose. `summariseEngineHealth`
   * walks all nine, so it also reports every capability the engine never declared —
   * tools that were never listed, about which "cannot answer" is the design, not news.
   */
  function probeRemedy(
    probe: ProbeResult | undefined,
    capability: Capability,
    notes: readonly BackendNote[],
  ): BackendNote | undefined {
    if (probe === undefined) return undefined;
    if (notes.some((note) => note.remedy !== undefined && note.remedy !== "")) return undefined;

    if (!probe.ok) {
      if (probe.remedy === undefined) return undefined;
      return {
        level: "degraded",
        code: "backend_unavailable",
        message: probe.reason,
        remedy: probe.remedy,
      };
    }

    const status = probe.health.capabilities[capability];
    if (status === undefined || status.ready || status.remedy === undefined) return undefined;
    return {
      level: "degraded",
      code: "backend_unavailable",
      message: `${capability} is unavailable right now: ${status.reason}`,
      remedy: status.remedy,
    };
  }

  async function runRoutedCall(
    descriptor: ToolDescriptor,
    args: Record<string, unknown>,
    probe: ProbeResult | undefined,
  ): Promise<ToolResult> {
    const engineId = facade.registry.engineId() ?? "";
    // The SAME predicate the tool list uses. `registry.declared()` is the static key
    // set and never shrinks, so routing over it would send a question to a capability
    // the probe has already proven this engine can never answer here — and `route`
    // would report `served_by` for an operation that was withdrawn a moment earlier.
    const declared = new Set(listedCapabilities(facade.registry.declared(), probe));
    const limits = facade.settings.limits;
    const scope = readString(args, "scope");

    let routed: RouteResult;
    if (descriptor.tier === 0) {
      // A missing required argument is a PROTOCOL mistake by the caller, not a backend
      // answer, and no `BackendNote.code` describes one. -32602 with a message naming
      // the argument tells the agent exactly what to send next; dressing it up as a
      // success-shaped note would leave it guessing.
      const query = readString(args, "query");
      if (query === undefined) {
        throw new InvalidParams(`${descriptor.name} requires a non-empty string "query".`);
      }
      const intent = readIntent(args);
      if (intent === null) {
        throw new InvalidParams(
          `"intent" must be one of ${INTENTS.join(", ")}, or omitted so the server infers it.`,
        );
      }
      routed = route({
        query,
        ...(intent === undefined ? {} : { intent }),
        ...(scope === undefined ? {} : { scope }),
        declared,
        limits,
        engine: engineId,
      });
    } else {
      const capability = descriptor.capability;
      if (capability === undefined) {
        return unavailable(
          { engine: engineId || "none" },
          {
            level: "error",
            code: "capability_unsupported",
            message: `${descriptor.name} declares no capability, so it cannot be routed.`,
          },
        );
      }
      const symbol = readString(args, "symbol");
      if (symbol === undefined) {
        throw new InvalidParams(`${descriptor.name} requires a non-empty string "symbol".`);
      }
      const depth = readNumber(args, "depth");
      const maxDepth = readNumber(args, "max_depth");
      routed = routeCapability(capability, {
        symbol,
        ...(scope === undefined ? {} : { scope }),
        ...(depth === undefined ? {} : { depth }),
        ...(maxDepth === undefined ? {} : { maxDepth }),
        declared,
        limits,
        engine: engineId,
      });
    }

    if (!routed.ok) {
      return unavailable({ engine: engineId || "none" }, routed.note);
    }

    const engine = facade.registry.engine();
    if (engine === undefined) {
      return unavailable(routed.decision.served, {
        level: "error",
        code: "backend_unavailable",
        message: `No engine is available to answer ${routed.decision.capability} for this project.`,
        remedy: 'Set "code-analysis".engine and its "engines" entry in .claude/settings.json.',
      });
    }

    const invocation = bind(engine.capabilities, routed.decision);
    if (invocation === undefined) {
      return unavailable(routed.decision.served, {
        level: "error",
        code: "capability_unsupported",
        message: `${engine.id} cannot answer ${routed.decision.capability} for this project.`,
      });
    }

    const outcome = await invocation();
    const options: RenderOptions = {
      ledger: facade.ledger,
      maxTextLines: DEFAULT_MAX_TEXT_LINES,
      // Raw engine numbers cost tokens and mean nothing to the agent. Off by default,
      // per §B.7.
      showEvidence: false,
    };
    const notes = [...outcome.notes, ...facadeNotes()];
    const supplied = probeRemedy(probe, routed.decision.capability, notes);
    if (supplied !== undefined) notes.push(supplied);
    const merged: Outcome<Hit> = { ...outcome, notes };
    return answer(renderOutcome(merged, routed.decision.served, options));
  }

  async function runPassthrough(
    descriptor: ToolDescriptor,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const passthrough = descriptor.passthrough;
    const engine = facade.registry.engine();
    if (passthrough === undefined || engine?.callPassthrough === undefined) {
      return unavailable(
        { engine: engineLabel() },
        {
          level: "error",
          code: "capability_unsupported",
          message: `${descriptor.name} has no engine behind it any more.`,
        },
      );
    }
    const raw = await engine.callPassthrough(passthrough.upstream, args);
    return answer(typeof raw === "string" ? raw : `${JSON.stringify(raw, null, 2)}\n`);
  }

  async function dispatch(name: string, args: Record<string, unknown>): Promise<Dispatch> {
    // Tier-2 collection, when enabled, must have settled before the set is read. It is
    // already resolved on every default install, where tier 2 ships empty.
    await facade.registry.ready();

    const find = (): ToolDescriptor | undefined =>
      facade.registry.tools().find((tool) => tool.name === name);

    if (find() === undefined && !facade.registry.everListed().has(name)) {
      // Never ours. This is the ONE branch that earns a protocol error.
      return { kind: "unknown-tool" };
    }

    // Lazy by design: `tools/list` never spawns, so the first call is what probes.
    const probe = await facade.registry.probeOnce();

    const descriptor = find();
    if (descriptor === undefined) {
      // The probe that just ran is what withdrew this tool. Normal path, not an edge.
      return { kind: "result", result: delisted(name, probe) };
    }

    if (descriptor.tier === 2) {
      return { kind: "result", result: await runPassthrough(descriptor, args) };
    }

    return { kind: "result", result: await runRoutedCall(descriptor, args, probe) };
  }

  async function handle(message: unknown): Promise<RpcResponse | undefined> {
    const record = asRecord(message);
    if (record === undefined) return undefined;
    const method = record["method"];
    if (typeof method !== "string") return undefined;

    if (method === "notifications/initialized") {
      initialized = true;
      return undefined;
    }

    // A notification carries no id and MUST NOT be answered — replying to one is a
    // spurious line on the protocol channel, which is the failure this file guards.
    const id = idOf(record);
    if (id === undefined) return undefined;

    switch (method) {
      case "initialize":
        // `listChanged: true` is not decoration. Without it a host may discard
        // notifications/tools/list_changed, and the registry's delisting becomes a
        // silent no-op: the tool stays listed and every call to it fails.
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: SERVER_NAME, version },
            // OMITTED unless switched on, rather than sent empty: absence and an empty
            // string are different messages to a host, and the control arm must send
            // exactly what this server sent before the lever existed.
            ...(facade.settings.adoption.instructions ? { instructions: SERVER_INSTRUCTIONS } : {}),
          },
        };

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list": {
        // A pure read of the cached set. No subprocess, ever.
        await facade.registry.ready();
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: facade.registry.tools().map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              // `anthropic/alwaysLoad` asks the host to keep this tool in context at
              // session start instead of deferring it behind a tool search. Namespaced
              // key inside `_meta`, per MCP 2025-06-18 — and the reason PROTOCOL_VERSION
              // had to move off 2024-11-05, where `_meta` is not part of `Tool` at all.
              ...(facade.settings.adoption.alwaysLoad
                ? { _meta: { "anthropic/alwaysLoad": true } }
                : {}),
            })),
          },
        };
      }

      case "tools/call": {
        const params = asRecord(record["params"]);
        const name = params === undefined ? undefined : params["name"];
        if (typeof name !== "string" || name === "") {
          return rpcError(id, INVALID_PARAMS, 'tools/call requires a string "name".');
        }
        const args = asRecord(params?.["arguments"]) ?? {};

        try {
          const outcome = await dispatch(name, args);
          if (outcome.kind === "unknown-tool") {
            return rpcError(id, METHOD_NOT_FOUND, `Unknown tool: ${name}`);
          }
          return { jsonrpc: "2.0", id, result: outcome.result };
        } catch (error) {
          if (error instanceof InvalidParams) {
            return rpcError(id, INVALID_PARAMS, error.message);
          }
          // THE error boundary. Anything that got this far is a bug or an adapter that
          // broke its no-throw contract, and neither is worth teaching the agent that
          // this tool is unreliable. It becomes an answer, and the cause goes to
          // stderr where a human can find it.
          log(`unhandled failure in ${name}: ${describe(error)}`);
          return {
            jsonrpc: "2.0",
            id,
            result: unavailable(
              { engine: engineLabel() },
              {
                level: "error",
                code: "backend_unavailable",
                message: `${name} could not be completed: ${describe(error)}`,
                remedy: "Retry; if it repeats, run /code-analysis:setup to check the engine.",
              },
            ),
          };
        }
      }

      default:
        return rpcError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  return {
    handle,
    dispose: (): Promise<void> => facade.dispose(),
  };
}

class InvalidParams extends Error {}

function rpcError(id: RpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Argument reading — defensive, because the other end is a language model
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** The id of a message, when it has one. `undefined` means it is a notification and
 *  must not be answered — not even with an error. */
function idOf(message: unknown): RpcId | undefined {
  const raw = asRecord(message)?.["id"];
  return typeof raw === "number" || typeof raw === "string" ? raw : undefined;
}

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

/** `undefined` = omitted (infer it). `null` = supplied and not an intent. */
function readIntent(args: Record<string, unknown>): Intent | undefined | null {
  const value = args["intent"];
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return INTENTS.includes(value as Intent) ? (value as Intent) : null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ---------------------------------------------------------------------------
// stdio driving adapter
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const write = (line: string): void => {
    process.stdout.write(line);
  };

  const server = createServer(process.env, write);
  log(`started (bun ${process.versions["bun"] ?? "?"}, pid ${process.pid})`);

  let closing = false;
  const shutdown = (reason: string): void => {
    if (closing) return;
    closing = true;
    log(`shutting down (${reason})`);
    void server
      .dispose()
      .catch((error: unknown) => log(`shutdown: ${describe(error)}`))
      .finally(() => process.exit(0));
  };

  // A crash mid-session takes the whole tool surface down with it. Report it and keep
  // serving; the request that caused it already got a success-shaped answer.
  process.on("uncaughtException", (error: Error) => log(`uncaught: ${describe(error)}`));
  process.on("unhandledRejection", (error: unknown) => log(`unhandled: ${describe(error)}`));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Messages are answered in order, one at a time.
  //
  // The `.catch` is not defensive decoration: a rejection anywhere in this chain would
  // skip every `.then` queued behind it, so ONE unexpected throw would stop the server
  // answering anything for the rest of the session while the process stayed alive and
  // apparently healthy. Whatever went wrong, the caller still gets an answer for its id
  // and the queue survives.
  let queue: Promise<void> = Promise.resolve();
  const feed = makeLineReader((message: unknown) => {
    queue = queue
      .then(async () => {
        const response = await server.handle(message);
        if (response !== undefined) write(encode(response));
      })
      .catch((error: unknown) => {
        log(`handler failed: ${describe(error)}`);
        const id = idOf(message);
        if (id !== undefined) {
          write(encode(rpcError(id, INTERNAL_ERROR, `The server failed: ${describe(error)}`)));
        }
      });
  });

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => feed(chunk));
  process.stdin.on("end", () => shutdown("stdin closed"));
  process.stdin.resume();
}

if (import.meta.main) {
  await main();
}
