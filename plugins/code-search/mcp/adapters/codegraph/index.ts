/**
 * codegraph adapter — `codegraph serve --mcp`, with
 * `CODEGRAPH_MCP_TOOLS=explore,node,search,callers,callees,impact,files,status`.
 *
 * Declares 7 of 9. The two absences are structural and were measured, not assumed:
 *
 *   - `knowledgeSearch` — no document model. Given a corpus of 4 TypeScript files and
 *     one `docs/locking.md`, `codegraph index` reported "Indexed 4 files": the markdown
 *     is not in the graph at all. The server's own `initialize` instructions send the
 *     agent elsewhere for it — "for what codegraph doesn't index (configs, docs)".
 *   - `findImplementations` — no tool returns implementations and no argument selects
 *     an inheritance edge. See the measurement below; this is the cell design §4.3
 *     predicted was "most likely to flip", and it does not flip.
 *
 * MEASURED AGAINST A REAL INSTALL — codegraph 1.6.0, 2026-08-28, macOS. Corpus: the
 * 3-file tree `live-engines.test.ts` uses, extended with an inheritance chain
 * (`Store` interface, `BaseStore implements Store`, `FileStore`/`MemoryStore` extending
 * it) and one markdown document, so the two open cells could be measured rather than
 * inferred. Indexed in 848 ms: 3 files, 9 nodes, 12 edges.
 *
 *   TOOL NAMES: CONFIRMED. All eight are present in `tools/list` under the env var
 *   above, each prefixed `codegraph_`. THE ENV VAR TAKES UNPREFIXED SHORT NAMES
 *   (`explore,node,search`) while the tools it exposes are prefixed — do not "fix" one
 *   to match the other. WITHOUT the variable the server exposes exactly ONE tool,
 *   `codegraph_explore`, and the other seven stay functional but unlisted.
 *
 *   ARGUMENT NAMES: CONFIRMED by round trip, not read from a schema. Every call in
 *   this file was executed against the live server and its answer recorded.
 *
 *   LINE BASE: 1-BASED. `withFileLock` is declared on line 3 of `src/lock.ts` and every
 *   tool answers `src/lock.ts:3`; `codegraph_node` returns a body fenced as
 *   `3\texport async function withFileLock`. THIS IS THE OPPOSITE OF SERENA, which is
 *   0-based and deliberately passes that through. Do not factor the two adapters onto a
 *   shared line-base helper — it would corrupt one of them. The port documents `line`
 *   as 1-based, so this engine needs no correction and must not be given one.
 *
 *   RESULT SHAPE: MARKDOWN TEXT, never JSON. Every tool answers
 *   `content:[{type:"text", text:"**Search Results (2 found)** …"}]`. There is no
 *   structured object anywhere in the surface, so this file parses prose. Every parser
 *   below falls back to `locationsFromText` and emits a note when its own shape stops
 *   matching, because a reworded release must degrade to "fewer fields" and never to
 *   "found nothing".
 *
 * `projectPath` IS SENT ON EVERY CALL, and that is load-bearing. It takes an absolute
 * path and codegraph resolves the nearest `.codegraph/` at or above it. Sending
 * `ctx.projectDir` explicitly removes the entire failure mode that bit serena, where a
 * cwd-relative project walk climbed out of the corpus, indexed the enclosing checkout,
 * and returned a uniform zero that reads as "found nothing" rather than "searched the
 * wrong tree".
 *
 * TWO RESULT-SHAPE TRAPS, both measured, both filtered here:
 *
 *   `codegraph_search "withFileLock"` returns 2 rows, and the second is
 *   `**./lock** (import)` at `src/settings.ts:1` — an import statement, kind `import`.
 *   `locateSymbol` drops non-definition kinds; answering "where is this defined" with
 *   an import line is a wrong answer, not a partial one.
 *
 *   `codegraph_callers withFileLock` returns the real caller AND
 *   `settings.ts (file) - src/settings.ts:1 — via import`. A file does not call a
 *   function. File rows are dropped from `findDependents` and counted in a note, so the
 *   count still reconciles with what the engine said.
 */

import type { Capability, CapabilityStatus } from "../../core/capabilities";
import type {
  BackendHealth,
  BackendNote,
  Capabilities,
  CodeLocation,
  Engine,
  Hit,
  Outcome,
  Scope,
  SymbolKind,
} from "../../core/ports";
import {
  buildHealth,
  callEngine,
  clampWithNote,
  cutToLimit,
  disposeQuietly,
  emptyOutcome,
  locationsFromText,
  makeNote,
  makeTtlCache,
  outcome,
  toRepoRelative,
  toSymbolKind,
  unreadyHealth,
  unusableShapeNote,
  upstreamNote,
  withinScope,
  type AdapterContext,
  type EngineAnswer,
  type EngineSpec,
} from "../shared/kit";

const ID = "codegraph";
const DISPLAY_NAME = "CodeGraph";

const TOOL = {
  explore: "codegraph_explore",
  search: "codegraph_search",
  node: "codegraph_node",
  callers: "codegraph_callers",
  callees: "codegraph_callees",
  impact: "codegraph_impact",
  status: "codegraph_status",
  files: "codegraph_files",
} as const;

const START_REMEDY =
  'codegraph serve --mcp  with CODEGRAPH_MCP_TOOLS=explore,node,search,callers,callees,impact,files,status  ' +
  "(and `codegraph init` in the project, once — without an index the server lists only codegraph_explore)";

const TOOLS_FOR: Readonly<Partial<Record<Capability, readonly string[]>>> = {
  generalSearch: [TOOL.explore],
  locateSymbol: [TOOL.search],
  readSource: [TOOL.node],
  findDependencies: [TOOL.callees],
  findDependents: [TOOL.callers],
  callTree: [TOOL.callees],
  impact: [TOOL.impact],
};

/**
 * Kinds `locateSymbol` refuses to return.
 *
 * `import` is the measured offender — `codegraph_search "withFileLock"` returns the
 * declaration and the import statement that references it, both as "results". `file` is
 * here for the same reason it is dropped from `findDependents`: a file is a container,
 * not a definition of the name asked for.
 */
const NON_DEFINITION_KINDS: ReadonlySet<string> = new Set(["import", "file"]);

/**
 * `**Name** (kind)` followed by `path:line` on the next line — the `codegraph_search`
 * row. Measured shape:
 *
 *     **withFileLock** (function)
 *     src/lock.ts:3
 */
const SEARCH_ROW = /\*\*(.+?)\*\*\s*\(([a-z]+)\)\s*\n\s*(\S+?):(\d+)/gu;

/**
 * `- name (kind) - path:line` optionally followed by ` — via <relation>` — the
 * `codegraph_callers` / `codegraph_callees` row. Measured shape:
 *
 *     - saveSettings (function) - src/settings.ts:3
 *     - settings.ts (file) - src/settings.ts:1 — via import
 */
const EDGE_ROW = /^[-*]\s+(.+?)\s+\(([a-z]+)\)\s+-\s+(\S+?):(\d+)(?:\s+[—-]+\s*via\s+(\S+))?/gmu;

/** `**path:**` — the per-file heading in a `codegraph_impact` answer. */
const IMPACT_FILE = /^\*\*(.+?):\*\*\s*$/u;
/** `name:line` pairs on the line under an impact file heading. */
const IMPACT_SYMBOL = /([A-Za-z_$][\w$.]*):(\d+)/gu;

/** `**Location:** path:line` — `codegraph_node`'s single location line. */
const NODE_LOCATION = /\*\*Location:\*\*\s*(\S+?):(\d+)/u;
/** A fenced block whose lines are `<n>\t<source>`, the shape `Read` returns. */
const NODE_FENCE = /```[a-zA-Z]*\n([\s\S]*?)```/u;

/** `**Files indexed:** 3` and friends, from `codegraph_status`. */
const STATUS_FIELD = (label: string): RegExp => new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\d.]+)`, "u");

interface ParsedRow {
  name: string;
  kind: string;
  file: string;
  line: number;
  /** Present only on an edge row that named the relation, e.g. `via import`. */
  via?: string;
}

/** Rows out of a `codegraph_search` answer. Order preserved — codegraph ranks. */
export function parseSearchRows(text: string): ParsedRow[] {
  return matchRows(text, SEARCH_ROW, false);
}

/** Rows out of a `codegraph_callers` / `codegraph_callees` answer. */
export function parseEdgeRows(text: string): ParsedRow[] {
  return matchRows(text, EDGE_ROW, true);
}

function matchRows(text: string, pattern: RegExp, withVia: boolean): ParsedRow[] {
  const rows: ParsedRow[] = [];
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    const [, name, kind, file, line, via] = m;
    if (name === undefined || kind === undefined || file === undefined || line === undefined) continue;
    const row: ParsedRow = { name: name.trim(), kind, file, line: Number.parseInt(line, 10) };
    if (withVia && via !== undefined) row.via = via;
    rows.push(row);
  }
  return rows;
}

/**
 * `codegraph_impact` groups by file:
 *
 *     **src/settings.ts:**
 *     saveSettings:3, settings.ts:1
 *
 * The file heading carries the path and the line numbers sit on the symbols, so neither
 * half is parseable alone.
 */
export function parseImpactRows(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let file: string | undefined;
  for (const raw of text.split("\n")) {
    const heading = IMPACT_FILE.exec(raw.trim());
    if (heading?.[1] !== undefined) {
      file = heading[1];
      continue;
    }
    if (file === undefined) continue;
    IMPACT_SYMBOL.lastIndex = 0;
    for (let m = IMPACT_SYMBOL.exec(raw); m !== null; m = IMPACT_SYMBOL.exec(raw)) {
      const [, name, line] = m;
      if (name === undefined || line === undefined) continue;
      rows.push({ name, kind: "unknown", file, line: Number.parseInt(line, 10) });
    }
  }
  return rows;
}

export function create(spec: EngineSpec, ctx: AdapterContext): Engine {
  void spec;

  const state = makeTtlCache(ctx, loadState);

  interface State {
    present: Set<string>;
    failure?: BackendNote;
    indexedFiles?: number;
    nodes?: number;
    edges?: number;
    /** True when the server answered but reports no index for this project. */
    noIndex?: boolean;
  }

  /**
   * `projectPath` on every call. See the header: this is what stops codegraph resolving
   * a different `.codegraph/` than the one the facade was pointed at.
   */
  function args(extra: Record<string, unknown>): Record<string, unknown> {
    return { ...extra, projectPath: ctx.projectDir };
  }

  async function loadState(): Promise<State> {
    const listed = await ctx.client.listTools();
    if (!listed.ok) return { present: new Set<string>(), failure: listed.note };
    const present = new Set(listed.tools.map((tool) => tool.name));

    const answer = await callEngine(ctx.client, TOOL.status, args({}));
    if (!answer.ok) return { present, noIndex: true };

    const read = (label: string): number | undefined => {
      const m = STATUS_FIELD(label).exec(answer.text);
      return m?.[1] === undefined ? undefined : Number.parseInt(m[1], 10);
    };
    const indexedFiles = read("Files indexed");
    const status: State = { present };
    if (indexedFiles !== undefined) status.indexedFiles = indexedFiles;
    const nodes = read("Total nodes");
    if (nodes !== undefined) status.nodes = nodes;
    const edges = read("Total edges");
    if (edges !== undefined) status.edges = edges;
    if (indexedFiles === undefined || indexedFiles === 0) status.noIndex = true;
    return status;
  }

  function fail(answer: Exclude<EngineAnswer, { ok: true }>, tool: string): Outcome<Hit> {
    return emptyOutcome([
      answer.kind === "transport" ? answer.note : upstreamNote(ID, tool, answer.text, START_REMEDY),
    ]);
  }

  function toHit(row: ParsedRow, anchor: CodeLocation["anchor"]): Hit {
    const kind: SymbolKind = toSymbolKind(row.kind);
    const hit: Hit = {
      file: toRepoRelative(row.file, ctx.projectDir),
      line: Math.max(1, row.line),
      anchor,
      symbol: { name: row.name, kind },
    };
    return hit;
  }

  /**
   * Rows to an Outcome, with the one behaviour every capability here shares: when the
   * dedicated parser finds nothing in a non-empty answer, fall back to the shared
   * `path:line` scraper rather than reporting an empty result. A reworded release then
   * costs symbol names, not answers.
   */
  function finish(
    rows: readonly ParsedRow[],
    text: string,
    scope: Scope,
    opts: {
      tool: string;
      anchor: CodeLocation["anchor"];
      notes?: BackendNote[];
      total?: number;
      /**
       * Scraping is this call's INTENDED strategy, not a fallback from a failed parse.
       *
       * Without this, a caller that legitimately passes `rows: []` — because the payload
       * has no repeating row shape to parse in the first place — takes the branch below
       * and emits `backend_unavailable` on every successful call. Measured on
       * `generalSearch`, which is the ordinary path for a natural-language query: it
       * returned a correct hit and told the caller the adapter was broken. That both
       * teaches the agent to distrust the facade and drop back to Bash, and jams the
       * alarm, so a REAL format drift becomes indistinguishable from normal operation.
       */
      scrapeIsExpected?: boolean;
    },
  ): Outcome<Hit> {
    const notes = [...(opts.notes ?? [])];
    let hits: Hit[];

    if (rows.length > 0) {
      hits = rows.map((row) => toHit(row, opts.anchor));
    } else {
      hits = locationsFromText(text, ctx).map((hit) => ({ ...hit, anchor: opts.anchor }));
      if (hits.length > 0 && opts.scrapeIsExpected === true) {
        // Scraping was the plan. A successful scrape is a successful call, and says
        // nothing about the adapter being behind the engine.
      } else if (hits.length > 0) {
        notes.push(
          makeNote(
            "degraded",
            "backend_unavailable",
            `${ID} ${opts.tool} answered in a shape this adapter does not recognise; ` +
              `${hits.length} location(s) were recovered by scraping path:line references, without symbol names or kinds. ` +
              `The adapter's parser is behind the engine's output format.`,
          ),
        );
      } else if (text.trim() !== "" && !/\bNo\b.*\bfound\b/iu.test(text)) {
        notes.push(unusableShapeNote(ID, opts.tool, text));
      }
    }

    const scoped = withinScope(hits, scope);
    const cut = cutToLimit(scoped, scope.limit);
    if (cut.cut) {
      notes.push(
        makeNote(
          "info",
          "result_truncated",
          `${cut.results.length} of ${scoped.length} results shown; the rest were cut by this facade.`,
        ),
      );
    }
    const extras: { truncated: boolean; total?: number } = { truncated: cut.cut };
    // A total ONLY when codegraph printed one in its own header. Never results.length.
    if (opts.total !== undefined) extras.total = opts.total;
    return outcome(cut.results, notes, extras);
  }

  /** `(2 found)` / `affects 5 symbols` — codegraph's own count, when it prints one. */
  function reportedTotal(text: string): number | undefined {
    const found = /\((\d+)\s+found\)/u.exec(text);
    if (found?.[1] !== undefined) return Number.parseInt(found[1], 10);
    const affects = /affects\s+(\d+)\s+symbol/u.exec(text);
    if (affects?.[1] !== undefined) return Number.parseInt(affects[1], 10);
    return undefined;
  }

  const capabilities: Capabilities = {
    async generalSearch(q: { text: string }, s: Scope): Promise<Outcome<Hit>> {
      const clamped = clampWithNote({
        engineId: ID,
        tool: TOOL.explore,
        parameter: "maxFiles",
        requested: s.limit,
        fallback: 12,
        min: 1,
        max: 50,
      });
      const answer = await callEngine(ctx.client, TOOL.explore, args({ query: q.text, maxFiles: clamped.value }));
      if (!answer.ok) return fail(answer, TOOL.explore);

      const notes = clamped.note === undefined ? [] : [clamped.note];
      // `explore` returns bodies, a flow section and a blast-radius section in one
      // payload. Its locations are scraped rather than row-parsed: there is no single
      // repeating row shape, and the section headings are prose that has already
      // changed once between the docs and 1.6.0.
      return finish([], answer.text, s, {
        tool: TOOL.explore,
        anchor: "declaration",
        notes,
        scrapeIsExpected: true,
      });
    },

    async locateSymbol(q: { name: string; kind?: SymbolKind }, s: Scope): Promise<Outcome<Hit>> {
      const call: Record<string, unknown> = { query: q.name, limit: s.limit };
      // codegraph's `kind` enum is its own vocabulary and is wider than SymbolKind
      // (`route`, `component`, `method`). Only a value that round-trips is forwarded;
      // anything else is left off and filtered client-side, so a kind this engine
      // spells differently narrows nothing rather than excluding everything.
      if (q.kind !== undefined && q.kind !== "unknown") call["kind"] = q.kind;

      const answer = await callEngine(ctx.client, TOOL.search, args(call));
      if (!answer.ok) return fail(answer, TOOL.search);

      const all = parseSearchRows(answer.text);
      const rows = all.filter((row) => !NON_DEFINITION_KINDS.has(row.kind));
      const notes: BackendNote[] = [];
      const dropped = all.length - rows.length;
      if (dropped > 0) {
        notes.push(
          makeNote(
            "info",
            "query_transformed",
            `${dropped} of ${all.length} ${ID} results were import or file rows rather than definitions and were dropped; ` +
              `a "where is this defined" answer must not point at an import statement.`,
          ),
        );
      }
      return finish(rows, answer.text, s, { tool: TOOL.search, anchor: "declaration", notes });
    },

    async readSource(q: { at: CodeLocation; radius?: number }, s: Scope): Promise<Outcome<Hit>> {
      // File mode: `file` alone returns the whole file in Read's `<n>\t<line>` shape.
      // codegraph addresses source by file or symbol, never by line, so `radius` cannot
      // be honoured and says so rather than being silently ignored.
      const call: Record<string, unknown> = { file: q.at.file };
      if (q.radius !== undefined) {
        call["offset"] = Math.max(1, q.at.line - q.radius);
        call["limit"] = q.radius * 2 + 1;
      }
      const answer = await callEngine(ctx.client, TOOL.node, args(call));
      if (!answer.ok) return fail(answer, TOOL.node);

      const location = NODE_LOCATION.exec(answer.text);
      const fence = NODE_FENCE.exec(answer.text);
      const notes: BackendNote[] = [];

      if (fence?.[1] === undefined) {
        notes.push(
          makeNote(
            "degraded",
            "backend_unavailable",
            `${ID} ${TOOL.node} returned no fenced source block for ${q.at.file}, so this answer carries locations without bodies.`,
          ),
        );
        return finish([], answer.text, s, { tool: TOOL.node, anchor: "declaration", notes });
      }

      const line = location?.[2] === undefined ? q.at.line : Number.parseInt(location[2], 10);
      const file = location?.[1] === undefined ? q.at.file : location[1];
      const hit: Hit = {
        file: toRepoRelative(file, ctx.projectDir),
        line: Math.max(1, line),
        anchor: "declaration",
        // The fence is line-numbered `<n>\t<source>`; the numbers are codegraph's and
        // are 1-based. They are kept verbatim: stripping them would discard the only
        // thing that makes the body addressable.
        text: fence[1].replace(/\n$/u, ""),
      };
      const scoped = withinScope([hit], s);
      return outcome(scoped, notes, { truncated: false });
    },

    async findDependencies(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      if (q.distance > 1) {
        notes.push(
          makeNote(
            "degraded",
            "query_transformed",
            `${ID} ${TOOL.callees} returns direct callees only, so depth ${q.distance} was answered at depth 1. ` +
              `Use callTree for a transitive walk.`,
          ),
        );
      }
      const answer = await callEngine(ctx.client, TOOL.callees, args({ symbol: q.name, limit: s.limit }));
      if (!answer.ok) return fail(answer, TOOL.callees);

      const { rows, notes: filterNotes } = withoutFileRows(parseEdgeRows(answer.text), TOOL.callees);
      const opts: { tool: string; anchor: CodeLocation["anchor"]; notes: BackendNote[]; total?: number } = {
        tool: TOOL.callees,
        anchor: "declaration",
        notes: [...notes, ...filterNotes],
      };
      const total = reportedTotal(answer.text);
      if (total !== undefined) opts.total = total;
      return finish(rows, answer.text, s, opts);
    },

    async findDependents(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      if (q.distance > 1) {
        notes.push(
          makeNote(
            "degraded",
            "query_transformed",
            `${ID} ${TOOL.callers} returns direct callers only, so depth ${q.distance} was answered at depth 1. ` +
              `Use impact for a transitive blast radius.`,
          ),
        );
      }
      const answer = await callEngine(ctx.client, TOOL.callers, args({ symbol: q.name, limit: s.limit }));
      if (!answer.ok) return fail(answer, TOOL.callers);

      const { rows, notes: filterNotes } = withoutFileRows(parseEdgeRows(answer.text), TOOL.callers);
      const opts: { tool: string; anchor: CodeLocation["anchor"]; notes: BackendNote[]; total?: number } = {
        tool: TOOL.callers,
        // MEASURED: codegraph points at the CALLER'S DECLARATION (`saveSettings` at
        // src/settings.ts:3), not at the call site on line 4. graphify does the
        // opposite for the same edge. See `LineAnchor` in core/ports.ts.
        anchor: "declaration",
        notes: [...notes, ...filterNotes],
      };
      const total = reportedTotal(answer.text);
      if (total !== undefined) opts.total = total;
      return finish(rows, answer.text, s, opts);
    },

    /**
     * Assembled from real callee edges, one breadth-first level at a time.
     *
     * codegraph has no single-symbol call-tree tool. `codegraph_explore` DOES return a
     * genuine transitive path — measured: `main → saveSettings → withFileLock` — but
     * only "among the symbols you queried", so it needs BOTH endpoints, and the port
     * supplies one name and a depth. Walking `codegraph_callees` gives the same edges
     * the engine would have used, so this is the real call graph rather than an
     * approximation of it; what it costs is one round trip per node visited, which is
     * why both the depth and the node count are bounded and any cut is announced.
     */
    async callTree(q: { name: string; maxDistance: number }, s: Scope): Promise<Outcome<Hit>> {
      const clamped = clampWithNote({
        engineId: ID,
        tool: TOOL.callees,
        parameter: "maxDistance",
        requested: q.maxDistance,
        fallback: 2,
        min: 1,
        max: MAX_TREE_DEPTH,
      });
      const notes: BackendNote[] = clamped.note === undefined ? [] : [clamped.note];
      notes.push(
        makeNote(
          "info",
          "query_transformed",
          `${ID} exposes no call-tree tool, so this was walked breadth-first over ${TOOL.callees} to depth ${clamped.value}. ` +
            `Every edge is one codegraph reported; the traversal is this facade's.`,
        ),
      );

      const rows: ParsedRow[] = [];
      const seen = new Set<string>([q.name]);
      let frontier: string[] = [q.name];
      let visited = 0;
      let budgetHit = false;

      for (let depth = 0; depth < clamped.value && frontier.length > 0; depth += 1) {
        const next: string[] = [];
        for (const name of frontier) {
          if (visited >= MAX_TREE_NODES) {
            budgetHit = true;
            break;
          }
          visited += 1;
          const answer = await callEngine(ctx.client, TOOL.callees, args({ symbol: name, limit: s.limit }));
          if (!answer.ok) {
            // One unreachable node must not lose the branches already walked.
            notes.push(
              answer.kind === "transport" ? answer.note : upstreamNote(ID, TOOL.callees, answer.text, START_REMEDY),
            );
            continue;
          }
          for (const row of withoutFileRows(parseEdgeRows(answer.text), TOOL.callees).rows) {
            if (seen.has(row.name)) continue;
            seen.add(row.name);
            rows.push(row);
            next.push(row.name);
          }
        }
        if (budgetHit) break;
        frontier = next;
      }

      if (budgetHit) {
        notes.push(
          makeNote(
            "info",
            "result_truncated",
            `the walk stopped after visiting ${MAX_TREE_NODES} symbols; the tree below depth ${clamped.value} is incomplete.`,
          ),
        );
      }
      return finish(rows, rows.length > 0 ? "walked" : "", s, {
        tool: TOOL.callees,
        anchor: "declaration",
        notes,
      });
    },

    async impact(
      q: { name: string; maxDistance: number },
      s: Scope,
    ): Promise<Outcome<Hit> & { risk: "low" | "medium" | "high" }> {
      const clamped = clampWithNote({
        engineId: ID,
        tool: TOOL.impact,
        parameter: "depth",
        requested: q.maxDistance,
        fallback: 2,
        min: 1,
        max: 10,
      });
      const answer = await callEngine(ctx.client, TOOL.impact, args({ symbol: q.name, depth: clamped.value }));
      if (!answer.ok) return { ...fail(answer, TOOL.impact), risk: "low" };

      const rows = parseImpactRows(answer.text);
      const notes = clamped.note === undefined ? [] : [clamped.note];
      const total = reportedTotal(answer.text);
      const opts: { tool: string; anchor: CodeLocation["anchor"]; notes: BackendNote[]; total?: number } = {
        tool: TOOL.impact,
        anchor: "declaration",
        notes,
      };
      if (total !== undefined) opts.total = total;
      const base = finish(rows, answer.text, s, opts);

      // Risk from the affected count codegraph reported, NOT from the page of results
      // this facade cut to `limit` — otherwise a small limit would make a wide blast
      // radius read as low risk.
      const affected = total ?? rows.length;
      const risk = affected >= 20 ? "high" : affected >= 5 ? "medium" : "low";
      return { ...base, risk };
    },
  };

  /**
   * Drop the file-level pseudo-rows. MEASURED: `codegraph_callers withFileLock` returns
   * `settings.ts (file) - src/settings.ts:1 — via import` alongside the real caller. The
   * count is reported so the answer still reconciles with the engine's own header.
   */
  function withoutFileRows(all: readonly ParsedRow[], tool: string): { rows: ParsedRow[]; notes: BackendNote[] } {
    const rows = all.filter((row) => row.kind !== "file");
    const dropped = all.length - rows.length;
    if (dropped === 0) return { rows, notes: [] };
    return {
      rows,
      notes: [
        makeNote(
          "info",
          "query_transformed",
          `${dropped} of ${all.length} ${ID} ${tool} rows were file-level import edges rather than call edges and were dropped; ` +
            `a file does not call a function.`,
        ),
      ],
    };
  }

  async function probe(): Promise<BackendHealth> {
    const current = await state.get();
    if (current.failure !== undefined) {
      return unreadyHealth({
        engineId: ID,
        capabilities,
        reason: current.failure.message,
        remedy: current.failure.remedy ?? START_REMEDY,
      });
    }

    const statuses: Partial<Record<Capability, CapabilityStatus>> = {};
    for (const [capability, needed] of Object.entries(TOOLS_FOR)) {
      const absent = needed.filter((tool) => !current.present.has(tool));
      if (absent.length === 0) continue;
      statuses[capability as Capability] = {
        ready: false,
        reason:
          `this ${ID} server does not expose ${absent.join(", ")}. ` +
          `Unset, CODEGRAPH_MCP_TOOLS leaves only ${TOOL.explore} listed — the other seven work but are hidden.`,
        remedy: START_REMEDY,
        // Retryable: the tool exists and one environment variable lists it.
        retryable: true,
      };
    }

    // No index is a real, recoverable state and NOT a broken engine: measured, the
    // server still starts, still lists a tool, and still answers per-project. Reported
    // as retryable so the capability comes back after `codegraph init` without a
    // restart, which is codegraph's documented live-pickup behaviour.
    if (current.noIndex === true) {
      for (const capability of Object.keys(TOOLS_FOR) as Capability[]) {
        if (statuses[capability] !== undefined) continue;
        statuses[capability] = {
          ready: false,
          reason: `${ID} reports no index for ${ctx.projectDir}, so it has nothing to answer from.`,
          remedy: "codegraph init",
          retryable: true,
        };
      }
    }

    const detail: Record<string, unknown> = { exposedTools: [...current.present].sort() };
    if (current.nodes !== undefined) detail["nodes"] = current.nodes;
    if (current.edges !== undefined) detail["edges"] = current.edges;

    const health: Parameters<typeof buildHealth>[0] = { engineId: ID, capabilities, statuses, detail };
    if (current.indexedFiles !== undefined) health.indexedFiles = current.indexedFiles;
    return buildHealth(health);
  }

  return {
    id: ID,
    displayName: DISPLAY_NAME,
    capabilities,
    probe,
    dispose: () => disposeQuietly(ctx.client),
  };
}

/** Depth ceiling for the assembled call tree. Each level is a round trip per node. */
const MAX_TREE_DEPTH = 5;
/** Hard ceiling on nodes visited, so a hub symbol cannot turn one call into hundreds. */
const MAX_TREE_NODES = 40;
