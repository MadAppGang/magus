/**
 * ports.ts — the port. The application owns every type here.
 *
 * Nothing is named after mnemex, ripgrep, LSP, or an embedding model. An adapter
 * translates its engine's vocabulary into these types, and only these types cross.
 *
 * This is the leaf of core/: it imports ./capabilities and nothing else, so an
 * import from any other core module back into it would be a cycle.
 */

import type { Capability, CapabilityStatus } from "./capabilities";

/** What a `line` is pointing AT. Engines genuinely disagree, and the disagreement is
 *  invisible without this field.
 *
 *  Measured 2026-08-28 on the same edge — `saveSettings` is declared on line 3 of
 *  `src/settings.ts` and calls `withFileLock` on line 4. Asked what depends on
 *  `withFileLock`, codegraph answers `src/settings.ts:3` and graphify answers
 *  `src/settings.ts:L4`. Neither is wrong; they answer different questions.
 *
 *  Normalising one into the other would throw away a real number, so the port carries
 *  which one it is instead. */
export type LineAnchor =
  /** The line declaring the symbol. "Where is this defined." */
  | "declaration"
  /** The line where the symbol is used. "Where is it called from." */
  | "reference";

export interface CodeLocation {
  /** Repo-relative POSIX path. Adapters normalise; absolute paths never cross the port. */
  file: string;
  /** 1-based, inclusive. */
  line: number;
  endLine?: number;
  /** OMIT when the engine does not make it knowable. Absence means "unstated", never
   *  "declaration" — an adapter that cannot tell must not guess, because a wrong anchor
   *  is worse than an absent one: it reads as a fact the engine never asserted. */
  anchor?: LineAnchor;
}

export type SymbolKind = "function" | "class" | "interface" | "type" | "variable" | "unknown";

export interface SymbolRef {
  name: string;
  kind: SymbolKind;
  /** Present only when the engine can prove it. `undefined` is not `false`. */
  exported?: boolean;
}

export interface Ranked {
  /** Coarse band. OMIT if the engine cannot rank — omission is honest and is
   *  distinguishable from "low". Never synthesise this. */
  relevance?: "high" | "medium" | "low";

  /** Graph centrality 0..1. The CONCEPT is the application's ("how connected is this");
   *  PageRank is one algorithm for it. Absent when the engine has no call graph. */
  centrality?: number;

  /** NON-CONTRACTUAL. Raw engine numbers, for rendering and debugging only.
   *  HARD RULE: nothing under core/ may read a named key out of this.
   *
   *  Typed `unknown`, NOT `Readonly<Record<string, unknown>>`. The Record form reads
   *  like a guard and is not one: it gives every key the type `unknown`, and *reading*
   *  an unknown is legal — only using it is not — so an optional-chained key read and
   *  a destructure of the object both compile clean under --strict. With `unknown`
   *  the compiler rejects both with TS2339, while `Object.entries(x ?? {})` still
   *  type-checks, which is the single generic access render.ts needs. */
  evidence?: unknown;
}

export interface Hit extends CodeLocation, Ranked {
  /** Enclosing symbol, when the engine has an AST. Absent is honest for a lexical engine. */
  symbol?: SymbolRef;
  /** Verbatim source. ABSENT for a pointer-only engine that returns locations and no
   *  body. The agent Reads. */
  text?: string;
}

export type NoteLevel = "info" | "degraded" | "error";

export interface BackendNote {
  level: NoteLevel;
  /** Stable machine-readable code. Skills branch on THIS, never on message text. */
  code:
    | "index_stale"
    | "index_missing"
    | "index_building"
    | "result_truncated"
    | "query_transformed"
    | "backend_unavailable"
    /** "This engine can never do this, here" — a {ready:false, retryable:false}
     *  capability, and the honest answer to an in-flight call to a delisted tool.
     *  Distinct from backend_unavailable on purpose: that one means "retry later or
     *  fix your install". Conflating them makes a permanent absence look transient
     *  and a transient outage look permanent. */
    | "capability_unsupported"
    /** A settings layer or value was skipped, so the effective configuration is not
     *  what the file says. Coding this as backend_unavailable would make a typo in
     *  settings.local.json indistinguishable from a crashed engine. */
    | "settings_ignored"
    /** The Grep tool's ripgrep routing is not what the settings imply — shim missing,
     *  shadowed on PATH or by a shell function, or repaired but not yet live. Same
     *  argument as settings_ignored: this is not the engine. */
    | "grep_routing";
  message: string;
  /** A command the user can run, when one exists. Verbatim, copy-pasteable. */
  remedy?: string;
  /** Files this note is about, repo-relative POSIX. Populated for staleness notes;
   *  render.ts splits them by whether the file appears among the results being
   *  rendered, which is what makes the three-tier stale banner possible at all.
   *  Absent for notes that are not about specific files. */
  files?: readonly string[];
}

export interface Outcome<T> {
  results: T[];
  notes: BackendNote[];
  /** True when the engine stopped early. Distinct from `results.length < limit`. */
  truncated: boolean;
  /** Engine-reported total, when the engine reports one. ABSENCE is the discriminator
   *  render.ts uses to pick its truncation sentence: without a total, the only honest
   *  claim is that WE cut the list. Never synthesise it from `results.length` —
   *  mnemex `callees` has no total and no limit parameter, and inventing one there
   *  would let the facade claim the engine truncated when it did not. */
  total?: number;
}

export interface Scope {
  /** Glob, repo-relative. Engines that cannot filter server-side MUST filter post-hoc.
   *  Ignoring it silently is a lie. */
  glob?: string;
  /** Resolved by core; never undefined at the port. */
  limit: number;
}

/** Presence of a key IS the capability declaration. No supports() to drift out of sync,
 *  no NotImplemented stubs. */
export interface Capabilities {
  generalSearch?(q: { text: string }, s: Scope): Promise<Outcome<Hit>>;
  knowledgeSearch?(q: { text: string }, s: Scope): Promise<Outcome<Hit>>;
  locateSymbol?(q: { name: string; kind?: SymbolKind }, s: Scope): Promise<Outcome<Hit>>;
  readSource?(q: { at: CodeLocation; radius?: number }, s: Scope): Promise<Outcome<Hit>>;
  findDependencies?(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>>;
  findDependents?(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>>;
  callTree?(q: { name: string; maxDistance: number }, s: Scope): Promise<Outcome<Hit>>;
  findImplementations?(q: { name: string }, s: Scope): Promise<Outcome<Hit>>;
  impact?(
    q: { name: string; maxDistance: number },
    s: Scope,
  ): Promise<Outcome<Hit> & { risk: "low" | "medium" | "high" }>;
}

export interface BackendHealth {
  engineId: string;
  capabilities: Record<Capability, CapabilityStatus>;
  /** Typed, engine-agnostic. Every adapter populates it from whatever its engine calls
   *  the number. Absent when the engine cannot report one — absence is honest.
   *
   *  It exists so registry.ts can put a file count in the tier-0 call-budget sentence
   *  without reading `detail`, whose key name is mnemex's `indexedFileCount` and would
   *  be spelled differently by any other engine. Reading that from core/ would be core/
   *  learning an engine's vocabulary inside the module that exists to be the
   *  engine-agnostic dispatch table. */
  indexedFiles?: number;
  /** Deliberately opaque and per-engine. Health IS engine-specific; it is the one place
   *  an engine may speak its own vocabulary. Rendered for humans, never branched on.
   *  Named in exactly one core module — render.ts — and iterated generically there. */
  detail?: Readonly<Record<string, unknown>>;
}

export interface PassthroughTool {
  /** Adapter-local, unprefixed. /^[a-z][a-z0-9_]{2,23}$/ — the facade adds the prefix. */
  name: string;
  description: string; // <= 400 chars, facade-enforced
  inputSchema: object; // draft-07; facade SANITISES before exposure
  upstream: { tool: string };
  /** REQUIRED. Names which tier-2 gate criterion is binding, and why. Reviewed like code.
   *  Not shown to the agent. "It's useful" is a rejection. */
  justification: string;
}

export interface Engine {
  readonly id: string; // /^[a-z][a-z0-9]{1,11}$/ — no underscores
  readonly displayName: string;
  readonly capabilities: Capabilities;
  probe(): Promise<BackendHealth>;
  passthroughs?(): Promise<PassthroughTool[]>;
  callPassthrough?(name: string, args: unknown): Promise<unknown>;
  /** Idempotent. Must not throw. */
  dispose(): Promise<void>;
}
