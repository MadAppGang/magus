/**
 * kit.ts — everything the six adapters share, and nothing core/ may see.
 *
 * `AdapterContext` lives here rather than in core/ because it carries an `McpClient`,
 * which is transport vocabulary, and core/ may not import transport/. `EngineSpec` is
 * declared in core/settings.ts — settings own it — and is re-exported here so an
 * adapter imports exactly one module.
 *
 * The helpers below exist so the same decision is not made six times differently:
 * how an absolute path becomes repo-relative, how an index-time path from another
 * checkout is mapped back onto this one, how a scope glob is honoured when the
 * engine cannot filter server-side, how a clamp is announced, how a score becomes a
 * band, and how an upstream answer becomes an `Outcome` instead of a throw.
 *
 * Two rules hold everywhere in adapters/:
 *   - nothing throws. Every failure is an `Outcome` carrying a `BackendNote`.
 *   - nothing writes to stdout. stdout is the JSON-RPC channel; `ctx.log` is stderr.
 */

import type { Capability, CapabilityStatus } from "../../core/capabilities";
import { CAPABILITIES } from "../../core/capabilities";
import type {
  BackendHealth,
  BackendNote,
  Capabilities,
  Hit,
  NoteLevel,
  Outcome,
  Scope,
  SymbolKind,
} from "../../core/ports";
import type { CallResult, McpClient } from "../../transport/mcp-stdio-client";

/** The parsed settings entry for one engine. The only type that legitimately crosses
 *  from core/ outward — settings own it, adapters consume it. */
export type { EngineSpec } from "../../core/settings";

/** Does this absolute path name something that exists? Injected, never `existsSync`
 *  reached for directly, so every path helper below stays testable with no filesystem
 *  — the same rule `now` already obeys for the clock. */
export type PathExists = (absolutePath: string) => boolean;

/**
 * The repo root and the one probe that can be run against it.
 *
 * They travel together deliberately. `repairForeignPath` is only meaningful relative to
 * a root, and a call site that carried the root without the probe would silently get
 * today's unrepaired behaviour back — which is the defect, not a fallback.
 */
export interface PathContext {
  /** Repo root. The one input every adapter needs and cannot derive: it is what
   *  makes an upstream absolute path repo-relative before it crosses the port. */
  projectDir: string;
  /** Wired to the real filesystem in the composition root (server.ts). */
  fileExists: PathExists;
}

export interface AdapterContext extends PathContext {
  /** Already constructed by server.ts from the EngineSpec, and already
   *  lifecycle-managed: lazy spawn, idle kill, per-call timeout, restart backoff.
   *  An adapter NEVER spawns a process, sets a timer, or handles a restart. */
  client: McpClient;

  /** Injected so probe-cache expiry is testable without waiting. Never Date.now(). */
  now: () => number;

  /** stderr ONLY. An adapter that writes to stdout corrupts the JSON-RPC stream. */
  log: (line: string) => void;

  /** Probe result TTL, per design §8.1. Injected so a test can compress it. */
  probeTtlMs: number;
}

// ---------------------------------------------------------------------------
// Paths — absolute paths never cross the port
// ---------------------------------------------------------------------------

/**
 * Repo-relative POSIX, always. An engine may answer with an absolute path, a
 * Windows-style path, a `./`-prefixed path, or a path outside the repo; none of
 * those may reach a `CodeLocation`.
 *
 * A file genuinely outside the repo becomes a `../`-prefixed relative path rather
 * than an absolute one. That is still repo-relative, still POSIX, and still honest
 * about where the file is — whereas silently returning the absolute path would put
 * a machine-specific string in front of the agent.
 */
export function toRepoRelative(raw: string, projectDir: string): string {
  const file = normalisePath(raw);
  const root = normalisePath(projectDir);
  if (file === "") return "";
  if (!file.startsWith("/")) return file;
  if (root === "" || !root.startsWith("/")) return file.replace(/^\/+/u, "");
  if (file === root) return "";

  const fileParts = file.split("/").filter((p) => p !== "");
  const rootParts = root.split("/").filter((p) => p !== "");

  let shared = 0;
  while (shared < fileParts.length && shared < rootParts.length && fileParts[shared] === rootParts[shared]) {
    shared += 1;
  }
  const up = rootParts.length - shared;
  const down = fileParts.slice(shared);
  return [...Array<string>(up).fill(".."), ...down].join("/");
}

/** Separator normalisation plus `.`/`..` resolution. No filesystem access. */
export function normalisePath(raw: string): string {
  const slashed = raw.replace(/\\/gu, "/").trim();
  if (slashed === "") return "";
  const absolute = slashed.startsWith("/");
  const out: string[] = [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      const last = out[out.length - 1];
      if (last !== undefined && last !== "..") {
        out.pop();
        continue;
      }
      if (absolute) continue; // `..` above the root is the root
    }
    out.push(part);
  }
  return `${absolute ? "/" : ""}${out.join("/")}`;
}

/**
 * An absolute path that belongs to some OTHER checkout of this same corpus, mapped back
 * onto `projectDir`. Anything else is returned untouched.
 *
 * WHY THIS IS IN kit.ts AND NOT IN ONE ADAPTER. Engines that persist an index store the
 * paths they saw AT INDEX TIME, and hand them back verbatim from wherever they are later
 * run. Measured on mnemex v0.31.x: copy corpus + `index.db` to a new directory, run the
 * MCP `search` tool from there, and every hit still names the original absolute path; a
 * full re-index at the new location reports `indexed_files=0` and rewrites nothing, and no
 * root-override env var exists. Nothing about that is mnemex-specific — it is the defect
 * class of "index stores absolute paths", and any of the six engines can ship it. So the
 * repair belongs behind the interface we own, once, where every adapter gets it.
 *
 * It matters most where the corpus is a copy: in a madbench sandbox the workspace is a
 * fresh tmpdir, so `toRepoRelative` faithfully turns an index-time path into
 * `../../../Users/...` — honest per its contract, and useless to the agent holding it.
 *
 * THE RULE: take the LONGEST trailing run of segments that resolves to something real
 * under `projectDir`. Longest, because a short suffix is ambiguous and a long one is
 * specific — `/a/b/repo/utils/index.ts` may resolve as both `utils/index.ts` and
 * `index.ts`, and `index.ts` names dozens of different files in a real corpus. Picking
 * the short one would silently point at the wrong file, which is worse than not repairing.
 *
 * If no trailing run resolves, the path is returned UNCHANGED and `toRepoRelative` gets
 * to give its honest `../`-prefixed answer. A path that genuinely points outside the repo
 * is a real fact about the answer, and relocating it would be a worse bug than this one.
 */
export function repairForeignPath(raw: string, paths: PathContext): string {
  const file = normalisePath(raw);
  const root = normalisePath(paths.projectDir);
  // A relative path is already the shape we want, and carries no foreign root to strip.
  if (file === "" || !file.startsWith("/")) return raw;
  // With no usable root there is nothing to resolve candidates against.
  if (root === "" || !root.startsWith("/")) return raw;
  // Already inside the repo: never touched, so no existing behaviour can regress.
  if (file === root || file.startsWith(`${root}/`)) return raw;

  const parts = file.split("/").filter((p) => p !== "");
  // Ascending `start` walks candidates longest-first, so the first hit IS the longest.
  for (let start = 0; start < parts.length; start += 1) {
    const candidate = parts.slice(start).join("/");
    if (paths.fileExists(`${root}/${candidate}`)) return candidate;
  }
  return raw;
}

/** Repair, then relativise. The one call every adapter should make: `toRepoRelative`
 *  stays pure and exported for what it is, and nothing about it changed. */
export function toPortablePath(raw: string, paths: PathContext): string {
  return toRepoRelative(repairForeignPath(raw, paths), paths.projectDir);
}

// ---------------------------------------------------------------------------
// Globs — ignoring `scope.glob` silently is a lie (ports.ts says so)
// ---------------------------------------------------------------------------

/** `**`, `*`, `?` and `{a,b}`. Character classes are deliberately not supported:
 *  route.ts only ever produces path- and extension-shaped globs, and a half-working
 *  bracket expression would silently drop files. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let braces = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] ?? "";
    if (c === "*") {
      const doubled = glob[i + 1] === "*";
      if (doubled) {
        // `**/` also matches zero directories, so `**/*.md` matches `a.md`.
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
          continue;
        }
        source += ".*";
        i += 1;
        continue;
      }
      source += "[^/]*";
      continue;
    }
    if (c === "?") {
      source += "[^/]";
      continue;
    }
    if (c === "{") {
      braces += 1;
      source += "(?:";
      continue;
    }
    if (c === "}" && braces > 0) {
      braces -= 1;
      source += ")";
      continue;
    }
    if (c === "," && braces > 0) {
      source += "|";
      continue;
    }
    source += c.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
}

export function matchesGlob(file: string, glob: string): boolean {
  try {
    return globToRegExp(glob).test(file);
  } catch {
    // An unparseable glob must not shrink an answer: a filter we cannot apply is
    // reported by not applying it, never by silently returning nothing.
    return true;
  }
}

/** Post-hoc scope filter. Applied even when the engine took the glob server-side:
 *  the promise is the filter, not the parameter, and an engine that ignores the
 *  parameter would otherwise make us lie on its behalf. */
export function withinScope<T extends { file: string }>(hits: readonly T[], scope: Scope): T[] {
  const glob = scope.glob;
  if (glob === undefined || glob === "") return [...hits];
  return hits.filter((hit) => matchesGlob(hit.file, glob));
}

export interface Cut<T> {
  results: T[];
  /** True when WE dropped results. Never conflated with an engine-side stop. */
  cut: boolean;
}

export function cutToLimit<T>(hits: readonly T[], limit: number): Cut<T> {
  const max = Math.max(0, Math.floor(limit));
  if (hits.length <= max) return { results: [...hits], cut: false };
  return { results: hits.slice(0, max), cut: true };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** The ONE place these thresholds exist. A band is only ever derived from a real
 *  0..1 score; a lexical engine with no score omits `relevance` entirely, because
 *  omission is distinguishable from "low" and a synthesised band is not. */
export function scoreBand(score: number): "high" | "medium" | "low" {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

/** A band, or `undefined` when the number cannot honestly produce one. */
export function bandOf(score: number | undefined): "high" | "medium" | "low" | undefined {
  if (score === undefined || !Number.isFinite(score)) return undefined;
  if (score < 0 || score > 1) return undefined;
  return scoreBand(score);
}

/** Centrality is contractually 0..1. A value outside it is clamped, not dropped —
 *  the ordering it carries is still information. */
export function clamp01(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Clamps — a silent clamp is the class of lie the port exists to prevent
// ---------------------------------------------------------------------------

export interface ClampRequest {
  engineId: string;
  /** Upstream tool the ceiling belongs to, so the note names where it came from. */
  tool: string;
  parameter: string;
  requested: number | undefined;
  fallback: number;
  min: number;
  max: number;
}

export interface Clamped {
  value: number;
  note?: BackendNote;
}

export function clampWithNote(req: ClampRequest): Clamped {
  const raw = req.requested === undefined || !Number.isFinite(req.requested) ? req.fallback : req.requested;
  const value = Math.min(req.max, Math.max(req.min, Math.floor(raw)));
  if (value === raw) return { value };
  return {
    value,
    note: makeNote(
      "degraded",
      "query_transformed",
      `${req.engineId}: ${req.parameter} ${raw} was clamped to ${value}; ` +
        `the ${req.tool} tool accepts ${req.min}..${req.max}.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function makeNote(
  level: NoteLevel,
  code: BackendNote["code"],
  message: string,
  extra?: { remedy?: string; files?: readonly string[] },
): BackendNote {
  const note: BackendNote = { level, code, message };
  if (extra?.remedy !== undefined) note.remedy = extra.remedy;
  if (extra?.files !== undefined && extra.files.length > 0) note.files = extra.files;
  return note;
}

/** An upstream `isError`, or any other well-framed answer we cannot use. Recoverable
 *  by contract: the engine is running, so this must never shrink the tool list. */
export function upstreamNote(engineId: string, tool: string, text: string, remedy?: string): BackendNote {
  const detail = text.trim() === "" ? "no detail" : text.trim().slice(0, 500);
  return makeNote("error", "backend_unavailable", `${engineId} ${tool} failed: ${detail}`, { remedy });
}

/** The engine answered, and the answer is in a shape this adapter cannot turn into
 *  locations. Reported rather than swallowed: an empty result here would read as
 *  "nothing found", which is exactly the silent failure the facade exists to remove. */
export function unusableShapeNote(engineId: string, tool: string, text: string): BackendNote {
  return makeNote(
    "degraded",
    "backend_unavailable",
    `${engineId} ${tool} returned ${text.length} characters in a shape this adapter could not ` +
      `read as file locations. The answer is not empty, it is unusable here.`,
  );
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export interface OutcomeExtras {
  truncated?: boolean;
  /** ONLY when the engine reported a real total. Absence is what makes render.ts
   *  say "cut by this facade" instead of "the engine stopped early". */
  total?: number;
}

export function outcome(results: Hit[], notes: BackendNote[], extras?: OutcomeExtras): Outcome<Hit> {
  const out: Outcome<Hit> = { results, notes, truncated: extras?.truncated ?? false };
  if (extras?.total !== undefined) out.total = extras.total;
  return out;
}

export function emptyOutcome(notes: BackendNote[]): Outcome<Hit> {
  return { results: [], notes, truncated: false };
}

// ---------------------------------------------------------------------------
// Talking to the engine
// ---------------------------------------------------------------------------

export type EngineAnswer =
  | { ok: true; json: unknown; text: string }
  /** The transport already turned this into a note: spawn failure, timeout, crash. */
  | { ok: false; kind: "transport"; note: BackendNote }
  /** A well-formed upstream `isError`. The ADAPTER decides whether that is a
   *  recoverable condition or a malfunction — the transport must not decide it. */
  | { ok: false; kind: "upstream"; text: string };

export async function callEngine(
  client: McpClient,
  tool: string,
  args: unknown,
): Promise<EngineAnswer> {
  const res: CallResult = await client.call(tool, args);
  if (!res.ok) return { ok: false, kind: "transport", note: res.note };
  const text = contentText(res.content);
  if (res.isError) return { ok: false, kind: "upstream", text };
  return { ok: true, json: parseJsonLoose(text), text };
}

/** MCP content blocks to plain text. Non-text blocks are named rather than dropped,
 *  so an image-only answer does not read as an empty one. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined ? "" : JSON.stringify(content);
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    const rec = asRecord(block);
    if (rec === undefined) continue;
    const text = readString(rec, "text");
    if (text !== undefined) {
      parts.push(text);
      continue;
    }
    const type = readString(rec, "type");
    if (type !== undefined) parts.push(`[${type} content]`);
  }
  return parts.join("\n");
}

export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Reading untyped upstream JSON
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function readNumber(rec: Record<string, unknown>, key: string): number | undefined {
  const value = rec[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(rec: Record<string, unknown>, key: string): boolean | undefined {
  const value = rec[key];
  return typeof value === "boolean" ? value : undefined;
}

export function readStringArray(rec: Record<string, unknown>, key: string): string[] {
  return asArray(rec[key]).filter((v): v is string => typeof v === "string");
}

/** First key that carries a usable string. Engines spell the same field differently
 *  and five of the six cannot be exercised from this repo (R2), so the accepted
 *  spellings are listed explicitly rather than guessed one engine at a time. */
export function firstString(rec: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readString(rec, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function firstNumber(rec: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = readNumber(rec, key);
    if (value !== undefined) return value;
    // `"12"` and `"12-40"` both occur; the leading integer is the line either way.
    const text = readString(rec, key);
    if (text !== undefined) {
      const match = /^(\d+)/u.exec(text.trim());
      if (match?.[1] !== undefined) return Number.parseInt(match[1], 10);
    }
  }
  return undefined;
}

const FILE_KEYS = ["file", "filePath", "file_path", "path", "relative_path", "relativePath", "source_file"];
const LINE_KEYS = ["line", "startLine", "start_line", "lineNumber", "line_number", "source_location"];
const END_LINE_KEYS = ["endLine", "end_line", "lineEnd", "line_end"];
const NAME_KEYS = ["symbol", "name", "label", "name_path", "symbolName", "symbol_name"];
const KIND_KEYS = ["kind", "type", "symbol_kind", "symbolKind", "node_type"];
const TEXT_KEYS = ["snippet", "text", "body", "code", "source", "content"];
const SCORE_KEYS = ["score", "relevance", "similarity", "confidence"];

export interface ReadHitOptions extends PathContext {
  /** A pointer-only engine never carries a body; asking for one would let a
   *  stray `label` field become fabricated source. */
  withText: boolean;
}

/**
 * One upstream record to a `Hit`, or `undefined` when it carries no location.
 *
 * A record with no file is DROPPED: a hit the agent cannot open is not a hit. The
 * caller reports the drop count rather than presenting a shorter list as complete.
 */
export function readHit(value: unknown, opts: ReadHitOptions): Hit | undefined {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;

  const rawFile = firstString(rec, FILE_KEYS) ?? nestedString(rec, ["location", "position", "range"], FILE_KEYS);
  if (rawFile === undefined) return undefined;

  const rawLine =
    firstNumber(rec, LINE_KEYS) ?? nestedNumber(rec, ["location", "position", "body_location", "range"], LINE_KEYS);
  const hit: Hit = {
    file: toPortablePath(rawFile, opts),
    // 1-based by contract. A 0 can only come from a 0-based engine, and 1 is the
    // nearest true statement; no ±1 correction is applied to other values, because
    // this repo cannot run five of the six engines to verify which base they use.
    line: Math.max(1, rawLine ?? 1),
  };

  const endLine =
    firstNumber(rec, END_LINE_KEYS) ?? nestedNumber(rec, ["location", "body_location", "range"], END_LINE_KEYS);
  if (endLine !== undefined && endLine >= hit.line) hit.endLine = endLine;

  const name = firstString(rec, NAME_KEYS);
  if (name !== undefined) hit.symbol = { name, kind: toSymbolKind(firstString(rec, KIND_KEYS)) };

  if (opts.withText) {
    const text = firstString(rec, TEXT_KEYS);
    if (text !== undefined) hit.text = text;
  }

  const score = firstNumber(rec, SCORE_KEYS);
  const band = bandOf(score);
  if (band !== undefined) hit.relevance = band;
  if (score !== undefined) hit.evidence = { score };

  return hit;
}

export interface ReadHitsResult {
  hits: Hit[];
  /** Records that carried no file path. Named so the caller can say so out loud. */
  dropped: number;
}

export function readHits(values: unknown, opts: ReadHitOptions): ReadHitsResult {
  const hits: Hit[] = [];
  let dropped = 0;
  for (const value of asArray(values)) {
    const hit = readHit(value, opts);
    if (hit === undefined) {
      dropped += 1;
      continue;
    }
    hits.push(hit);
  }
  return { hits, dropped };
}

/**
 * Locations out of a human-formatted answer.
 *
 * Two of the six engines render results as prose rather than JSON. Dropping such an
 * answer would produce an empty result from an engine that found something — the
 * exact silent failure this facade exists to remove — so `path:line` and
 * `path:line-line` references are extracted instead. It is a heuristic and is
 * labelled as one: the caller emits `unusableShapeNote` when this finds nothing in a
 * non-empty answer, rather than reporting an empty list as an answer.
 */
export function locationsFromText(text: string, paths: PathContext): Hit[] {
  const pattern = /(?:^|[\s"'`([])((?:[\w.@~+-]+\/)*[\w.@+-]+\.[A-Za-z0-9]{1,12}):(\d+)(?:[-:](\d+))?/gu;
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    const rawFile = m[1];
    const rawLine = m[2];
    if (rawFile === undefined || rawLine === undefined) continue;
    const file = toPortablePath(rawFile, paths);
    const line = Math.max(1, Number.parseInt(rawLine, 10));
    const key = `${file}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hit: Hit = { file, line };
    const rawEnd = m[3];
    if (rawEnd !== undefined) {
      const endLine = Number.parseInt(rawEnd, 10);
      if (endLine >= line) hit.endLine = endLine;
    }
    hits.push(hit);
  }
  return hits;
}

function nestedString(
  rec: Record<string, unknown>,
  containers: readonly string[],
  keys: readonly string[],
): string | undefined {
  for (const container of containers) {
    const inner = asRecord(rec[container]);
    if (inner === undefined) continue;
    const value = firstString(inner, keys);
    if (value !== undefined) return value;
  }
  return undefined;
}

function nestedNumber(
  rec: Record<string, unknown>,
  containers: readonly string[],
  keys: readonly string[],
): number | undefined {
  for (const container of containers) {
    const inner = asRecord(rec[container]);
    if (inner === undefined) continue;
    const direct = firstNumber(inner, keys);
    if (direct !== undefined) return direct;
    const start = asRecord(inner["start"]);
    if (start !== undefined) {
      const value = firstNumber(start, keys);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

/** A Map, not an object literal: `constructor` is a real symbol kind and an object
 *  literal cannot carry it — it collides with Object.prototype.constructor. A Map is
 *  also immune to a prototype key arriving from an engine's payload. */
const SYMBOL_KINDS = new Map<string, SymbolKind>([
  ["function", "function"],
  ["func", "function"],
  ["fn", "function"],
  ["method", "function"],
  ["constructor", "function"],
  ["class", "class"],
  ["struct", "class"],
  ["object", "class"],
  ["interface", "interface"],
  ["protocol", "interface"],
  ["trait", "interface"],
  ["type", "type"],
  ["typealias", "type"],
  ["enum", "type"],
  ["record", "type"],
  ["variable", "variable"],
  ["var", "variable"],
  ["let", "variable"],
  ["const", "variable"],
  ["constant", "variable"],
  ["property", "variable"],
  ["field", "variable"],
]);

/** Anything unrecognised is `"unknown"`, never a plausible guess. */
export function toSymbolKind(raw: string | undefined): SymbolKind {
  if (raw === undefined) return "unknown";
  return SYMBOL_KINDS.get(raw.toLowerCase()) ?? "unknown";
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthInput {
  engineId: string;
  /** The declared set is read off the capability object itself, so health and the
   *  tool list can never disagree about what this engine claims to do. */
  capabilities: Capabilities;
  /** Per-capability overrides for the DECLARED keys. */
  statuses?: Partial<Record<Capability, CapabilityStatus>>;
  indexedFiles?: number;
  detail?: Readonly<Record<string, unknown>>;
}

/**
 * `BackendHealth` for an engine that answered its probe.
 *
 * An undeclared capability is `{ready:false, retryable:false}` — this engine has no
 * such operation, ever, for any project. It costs nothing: registry.ts only consults
 * statuses for capabilities the adapter declared.
 */
export function buildHealth(input: HealthInput): BackendHealth {
  const declared = declaredCapabilities(input.capabilities);
  const capabilities = {} as Record<Capability, CapabilityStatus>;
  for (const capability of CAPABILITIES) {
    if (!declared.has(capability)) {
      capabilities[capability] = {
        ready: false,
        reason: `${input.engineId} has no operation that genuinely answers ${capability}.`,
        retryable: false,
      };
      continue;
    }
    capabilities[capability] = input.statuses?.[capability] ?? { ready: true };
  }

  const health: BackendHealth = { engineId: input.engineId, capabilities };
  if (input.indexedFiles !== undefined) health.indexedFiles = input.indexedFiles;
  if (input.detail !== undefined) health.detail = input.detail;
  return health;
}

export interface UnreadyInput {
  engineId: string;
  capabilities: Capabilities;
  reason: string;
  remedy?: string;
  indexedFiles?: number;
  detail?: Readonly<Record<string, unknown>>;
}

/**
 * Every declared capability unready and RETRYABLE.
 *
 * `retryable: true` is deliberate and load-bearing: a crashed child, a missing key
 * and an empty index are all repairable, and a repairable failure must never shrink
 * the tool list. `retryable:false` is reserved for a genuine incapacity and is set
 * one capability at a time, by the adapter that proved it.
 */
export function unreadyHealth(input: UnreadyInput): BackendHealth {
  const status: CapabilityStatus = input.remedy === undefined
    ? { ready: false, reason: input.reason, retryable: true }
    : { ready: false, reason: input.reason, remedy: input.remedy, retryable: true };

  const statuses: Partial<Record<Capability, CapabilityStatus>> = {};
  for (const capability of declaredCapabilities(input.capabilities)) statuses[capability] = status;

  return buildHealth({
    engineId: input.engineId,
    capabilities: input.capabilities,
    statuses,
    ...(input.indexedFiles === undefined ? {} : { indexedFiles: input.indexedFiles }),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  });
}

export function declaredCapabilities(capabilities: Capabilities): Set<Capability> {
  const declared = new Set<Capability>();
  for (const capability of CAPABILITIES) {
    if (typeof capabilities[capability] === "function") declared.add(capability);
  }
  return declared;
}

// ---------------------------------------------------------------------------
// TTL cache — one probe per window, one in-flight probe at a time
// ---------------------------------------------------------------------------

export interface TtlCache<T> {
  get(): Promise<T>;
  /** The cached value if one is live, without triggering a load. */
  peek(): T | undefined;
  invalidate(): void;
}

export function makeTtlCache<T>(ctx: AdapterContext, load: () => Promise<T>): TtlCache<T> {
  let value: T | undefined;
  let loadedAt = 0;
  let inFlight: Promise<T> | undefined;

  const live = (): boolean => value !== undefined && ctx.now() - loadedAt < ctx.probeTtlMs;

  return {
    peek: () => (live() ? value : undefined),
    invalidate: () => {
      value = undefined;
      loadedAt = 0;
    },
    get: async () => {
      if (live() && value !== undefined) return value;
      if (inFlight !== undefined) return inFlight;
      inFlight = load()
        .then((loaded) => {
          value = loaded;
          loadedAt = ctx.now();
          return loaded;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
  };
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/** `Engine.dispose` is documented idempotent and non-throwing. */
export async function disposeQuietly(client: McpClient): Promise<void> {
  try {
    await client.dispose();
  } catch {
    // The client's own dispose already swallows what it can; anything left here
    // must not stop the server exiting.
  }
}
