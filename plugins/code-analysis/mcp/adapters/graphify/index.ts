/**
 * graphify adapter — `graphify-mcp graphify-out/graph.json`, equivalently
 * `python -m graphify.serve graphify-out/graph.json`.
 *
 * `graphify-mcp` is a console entry point the `graphifyy[mcp]` install puts on PATH; its
 * own `--help` identifies itself as `python -m graphify.serve`. Prefer it: it needs no
 * python on PATH and no `-m`, and its presence is the cheapest check that the `[mcp]`
 * extra — rather than the bare package — was installed.
 *
 * Declares 7 of 9. Both absences are structural and were measured:
 *
 *   - `readSource` — graphify holds a graph, not a corpus. `get_node` answers with
 *     label, ID, source POINTER, type, community and degree, and never a body. Measured
 *     on a code node and on a document node alike. This is why `understand` promises
 *     locations only: the agent Reads.
 *   - `impact` — no symbol-level blast-radius tool exists. `get_pr_impact` is NOT this
 *     capability: it is scoped to a GitHub pull request, not to a symbol, and wiring it
 *     here would answer "what does changing X affect" with "what does PR #7 touch".
 *
 * MEASURED AGAINST A REAL INSTALL — graphify 0.9.50, 2026-08-28, macOS. Corpus: the
 * 3-file tree `live-engines.test.ts` uses, extended with an inheritance chain and one
 * markdown document so the two cells design §4.3 left inferred could be measured.
 * Graph built with `graphify update . --no-cluster` — no LLM call — 17 nodes, 21 edges.
 *
 *   INSTALL: THE MCP SERVER IS AN OPTIONAL EXTRA. graphify's own README installs
 *   `graphifyy`, and that install cannot serve MCP at all:
 *       ImportError: mcp not installed. Run: pip install "graphifyy[mcp]"
 *   The engine spec must name `graphifyy[mcp]`. The PyPI package is `graphifyy` with a
 *   DOUBLE Y — `graphify` on PyPI is a 404 and `graphify` on npm is an unrelated random
 *   graph generator. graphify's README carries the warning itself.
 *
 *   ENTRY POINT: `graphify --help` lists no `serve` command; the module is reached with
 *   `python -m graphify.serve`. Its first line is
 *   `# MCP stdio server - exposes graph query tools to Claude and other agents`.
 *
 *   TOOL NAMES: CONFIRMED. 10 in `tools/list`. SEVEN are graph tools; THREE —
 *   `list_prs`, `get_pr_impact`, `triage_prs` — query the GitHub API rather than the
 *   graph and map to nothing in this port.
 *
 *   ARGUMENT NAMES: CONFIRMED by round trip. `relation_filter` was verified to filter
 *   SERVER-side (`get_neighbors BaseStore relation_filter=inherits` returned only the
 *   two `inherits` edges, dropping `implements` and `contains`).
 *
 *   LINE BASE: 1-BASED, spelled `L3`. `withFileLock` is declared on line 3 of
 *   `src/lock.ts` and graphify answers `Source: src/lock.ts L3`. Same base as codegraph,
 *   OPPOSITE to serena. The port documents `line` as 1-based, so nothing is corrected
 *   here and nothing should be.
 *
 *   RESULT SHAPE: PLAIN TEXT, never JSON, and NOT in a shape the shared
 *   `locationsFromText` scraper can read — it looks for `path:line`, and graphify writes
 *   `src/lock.ts L3` and `at=src/settings.ts:L4`. That is why every parser below is
 *   local and why the fallback is a graphify-specific `L`-aware scraper rather than the
 *   shared one.
 *
 * ANCHORS DIFFER BY TOOL, and graphify is the reason the port carries `LineAnchor` at
 * all. A `NODE` row and `get_node` report the DECLARATION (`loc=L3`); an `EDGE` row and
 * a `get_neighbors` row report the CALL SITE (`at=src/settings.ts:L4`). Measured on one
 * edge: `saveSettings` is declared on line 3 of `src/settings.ts` and calls
 * `withFileLock` on line 4 — codegraph answers 3 for that dependent and graphify
 * answers 4. Neither is wrong. Each hit below states which it is.
 *
 * `project_path` IS SENT ON EVERY CALL, for the same reason codegraph's `projectPath`
 * is: it pins the graph to the tree the facade was pointed at instead of whatever the
 * server was started with.
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
  makeNote,
  makeTtlCache,
  outcome,
  toRepoRelative,
  unreadyHealth,
  unusableShapeNote,
  upstreamNote,
  withinScope,
  type AdapterContext,
  type EngineAnswer,
  type EngineSpec,
} from "../shared/kit";

const ID = "graphify";
const DISPLAY_NAME = "Graphify";

const TOOL = {
  queryGraph: "query_graph",
  getNode: "get_node",
  getNeighbors: "get_neighbors",
  shortestPath: "shortest_path",
  graphStats: "graph_stats",
} as const;

const START_REMEDY =
  'uv tool install "graphifyy[mcp]"  then  graphify update <path> --no-cluster  ' +
  "(the bare `graphifyy` install has no MCP server; the [mcp] extra is required, and it is " +
  "what puts `graphify-mcp` on PATH)";

const TOOLS_FOR: Readonly<Partial<Record<Capability, readonly string[]>>> = {
  generalSearch: [TOOL.queryGraph],
  knowledgeSearch: [TOOL.queryGraph],
  locateSymbol: [TOOL.getNode],
  findDependencies: [TOOL.getNeighbors],
  findDependents: [TOOL.getNeighbors],
  callTree: [TOOL.queryGraph],
  findImplementations: [TOOL.getNeighbors],
};

/** graphify's own relation vocabulary, as emitted in `[brackets]` on every edge. */
const RELATION = { calls: "calls", inherits: "inherits", implements: "implements" } as const;

/** Relations that answer "what concrete types realise this one". BOTH are emitted and
 *  they are distinct: `implements` for an interface, `inherits` for a base class. */
const IMPLEMENTATION_RELATIONS: ReadonlySet<string> = new Set([RELATION.inherits, RELATION.implements]);

/**
 * A `get_neighbors` row. Measured shape, two directions:
 *
 *     --> Store [implements] [EXTRACTED] at=src/store.ts:L5
 *     <-- saveSettings() [calls] [EXTRACTED] at=src/settings.ts:L4
 *
 * THE ARROW IS THE WHOLE DEPENDENCY DIRECTION. `-->` is outgoing (this node depends on
 * that one); `<--` is incoming (that one depends on this). A parser that ignores it
 * silently merges dependencies with dependents.
 */
const NEIGHBOR_ROW = /^\s*(-->|<--)\s+(.+?)\s+\[(\w+)\]\s*(?:\[(\w+)\])?\s*(?:at=(\S+?):L(\d+))?\s*$/gmu;

/** `NODE main() [src=src/index.ts loc=L3 community=]` — a `query_graph` node row. */
const NODE_ROW = /^NODE\s+(.+?)\s+\[src=(\S+?)\s+loc=L(\d+)/gmu;

/** `Node: withFileLock()` / `  Source: src/lock.ts L3` / `  Type: code` — `get_node`. */
const GET_NODE_NAME = /^Node:\s*(.+)$/mu;
const GET_NODE_SOURCE = /^\s*Source:\s*(\S+)\s+L(\d+)/mu;
const GET_NODE_TYPE = /^\s*Type:\s*(\w+)/mu;

/** `Nodes: 7` / `Edges: 10` from `graph_stats`. */
const STATS_FIELD = (label: string): RegExp => new RegExp(`^${label}:\\s*(\\d+)`, "mu");

/** Last-resort scraper. The shared `locationsFromText` cannot read graphify's `L`-prefixed
 *  line numbers, so this is the graphify-shaped equivalent: `path L3` or `path:L3`. */
const LOOSE_LOCATION = /((?:[\w.@~+-]+\/)*[\w.@+-]+\.[A-Za-z0-9]{1,12})[\s:]+L(\d+)/gu;

export interface GraphifyRow {
  name: string;
  file: string;
  line: number;
  /** `-->` outgoing, `<--` incoming. Absent on a NODE row, which has no direction. */
  direction?: "out" | "in";
  relation?: string;
  /** graphify's provenance marker: EXTRACTED, INFERRED or AMBIGUOUS. */
  confidence?: string;
}

/**
 * graphify suffixes callables with `()`. The suffix is the only kind signal a neighbour
 * row carries, so it is read and then stripped — a `SymbolRef.name` of `withFileLock()`
 * would not match anything the agent then searches for.
 */
export function splitName(raw: string): { name: string; kind: SymbolKind } {
  const trimmed = raw.trim();
  if (trimmed.endsWith("()")) return { name: trimmed.slice(0, -2), kind: "function" };
  return { name: trimmed, kind: "unknown" };
}

export function parseNeighborRows(text: string): GraphifyRow[] {
  const rows: GraphifyRow[] = [];
  NEIGHBOR_ROW.lastIndex = 0;
  for (let m = NEIGHBOR_ROW.exec(text); m !== null; m = NEIGHBOR_ROW.exec(text)) {
    const [, arrow, label, relation, confidence, file, line] = m;
    if (arrow === undefined || label === undefined || relation === undefined) continue;
    // A row with no `at=` carries no location and cannot become a Hit the agent can
    // open, so it is dropped rather than given a synthetic line 1.
    if (file === undefined || line === undefined) continue;
    const row: GraphifyRow = {
      name: label.trim(),
      file,
      line: Number.parseInt(line, 10),
      direction: arrow === "-->" ? "out" : "in",
      relation,
    };
    if (confidence !== undefined) row.confidence = confidence;
    rows.push(row);
  }
  return rows;
}

export function parseNodeRows(text: string): GraphifyRow[] {
  const rows: GraphifyRow[] = [];
  NODE_ROW.lastIndex = 0;
  for (let m = NODE_ROW.exec(text); m !== null; m = NODE_ROW.exec(text)) {
    const [, label, file, line] = m;
    if (label === undefined || file === undefined || line === undefined) continue;
    rows.push({ name: label.trim(), file, line: Number.parseInt(line, 10) });
  }
  return rows;
}

export function create(spec: EngineSpec, ctx: AdapterContext): Engine {
  void spec;

  const state = makeTtlCache(ctx, loadState);

  interface State {
    present: Set<string>;
    failure?: BackendNote;
    nodes?: number;
    edges?: number;
    emptyGraph?: boolean;
  }

  function args(extra: Record<string, unknown>): Record<string, unknown> {
    return { ...extra, project_path: ctx.projectDir };
  }

  async function loadState(): Promise<State> {
    const listed = await ctx.client.listTools();
    if (!listed.ok) return { present: new Set<string>(), failure: listed.note };
    const present = new Set(listed.tools.map((tool) => tool.name));

    const answer = await callEngine(ctx.client, TOOL.graphStats, args({}));
    if (!answer.ok) return { present, emptyGraph: true };

    const read = (label: string): number | undefined => {
      const m = STATS_FIELD(label).exec(answer.text);
      return m?.[1] === undefined ? undefined : Number.parseInt(m[1], 10);
    };
    const out: State = { present };
    const nodes = read("Nodes");
    if (nodes !== undefined) out.nodes = nodes;
    const edges = read("Edges");
    if (edges !== undefined) out.edges = edges;
    if (nodes === undefined || nodes === 0) out.emptyGraph = true;
    return out;
  }

  function fail(answer: Exclude<EngineAnswer, { ok: true }>, tool: string): Outcome<Hit> {
    return emptyOutcome([
      answer.kind === "transport" ? answer.note : upstreamNote(ID, tool, answer.text, START_REMEDY),
    ]);
  }

  function toHit(row: GraphifyRow, anchor: CodeLocation["anchor"]): Hit {
    const { name, kind } = splitName(row.name);
    const hit: Hit = {
      file: toRepoRelative(row.file, ctx.projectDir),
      line: Math.max(1, row.line),
      anchor,
      symbol: { name, kind },
    };
    // graphify labels every edge EXTRACTED / INFERRED / AMBIGUOUS. That is a real
    // property of the answer and belongs in evidence, which is non-contractual by
    // design — nothing under core/ reads a named key out of it.
    if (row.confidence !== undefined || row.relation !== undefined) {
      hit.evidence = { relation: row.relation, confidence: row.confidence };
    }
    return hit;
  }

  function looseHits(text: string, anchor: CodeLocation["anchor"]): Hit[] {
    const hits: Hit[] = [];
    const seen = new Set<string>();
    LOOSE_LOCATION.lastIndex = 0;
    for (let m = LOOSE_LOCATION.exec(text); m !== null; m = LOOSE_LOCATION.exec(text)) {
      const [, file, line] = m;
      if (file === undefined || line === undefined) continue;
      const resolved = toRepoRelative(file, ctx.projectDir);
      const key = `${resolved}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ file: resolved, line: Math.max(1, Number.parseInt(line, 10)), anchor });
    }
    return hits;
  }

  function finish(
    rows: readonly GraphifyRow[],
    text: string,
    scope: Scope,
    opts: { tool: string; anchor: CodeLocation["anchor"]; notes?: BackendNote[] },
  ): Outcome<Hit> {
    const notes = [...(opts.notes ?? [])];
    let hits: Hit[];

    if (rows.length > 0) {
      hits = rows.map((row) => toHit(row, opts.anchor));
    } else {
      hits = looseHits(text, opts.anchor);
      if (hits.length > 0) {
        notes.push(
          makeNote(
            "degraded",
            "backend_unavailable",
            `${ID} ${opts.tool} answered in a shape this adapter does not recognise; ` +
              `${hits.length} location(s) were recovered by scraping, without symbol names, relations or edge direction. ` +
              `Edge DIRECTION is lost in this mode, so dependencies and dependents are not distinguished here.`,
          ),
        );
      } else if (text.trim() !== "" && !/\b(?:no|0)\b.*\b(?:found|nodes|path)\b/iu.test(text)) {
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
          `${cut.results.length} of ${scoped.length} results shown; the rest were cut by this facade. ` +
            `${ID} also applies its own token_budget server-side, so it may have stopped first without saying so.`,
        ),
      );
    }
    // No `total`, ever: graphify's "N nodes found" counts the traversal, not the
    // matching population, so reporting it as a total would let render.ts claim the
    // engine truncated when it did not.
    return outcome(cut.results, notes, { truncated: cut.cut });
  }

  async function neighbors(
    name: string,
    scope: Scope,
    opts: {
      relationFilter?: string;
      keep: (row: GraphifyRow) => boolean;
      anchor: CodeLocation["anchor"];
      notes?: BackendNote[];
    },
  ): Promise<Outcome<Hit>> {
    const call: Record<string, unknown> = { label: name };
    if (opts.relationFilter !== undefined) call["relation_filter"] = opts.relationFilter;
    const answer = await callEngine(ctx.client, TOOL.getNeighbors, args(call));
    if (!answer.ok) return fail(answer, TOOL.getNeighbors);

    const all = parseNeighborRows(answer.text);
    const rows = all.filter(opts.keep);
    return finish(rows, answer.text, scope, {
      tool: TOOL.getNeighbors,
      anchor: opts.anchor,
      ...(opts.notes === undefined ? {} : { notes: opts.notes }),
    });
  }

  /** Depth is a real graphify parameter on `query_graph`; 1..6 is its documented range. */
  function clampDepth(requested: number | undefined, tool: string): { value: number; note?: BackendNote } {
    return clampWithNote({
      engineId: ID,
      tool,
      parameter: "depth",
      requested,
      fallback: 3,
      min: 1,
      max: 6,
    });
  }

  const capabilities: Capabilities = {
    async generalSearch(q: { text: string }, s: Scope): Promise<Outcome<Hit>> {
      const answer = await callEngine(
        ctx.client,
        TOOL.queryGraph,
        args({ question: q.text, mode: "bfs", depth: 3 }),
      );
      if (!answer.ok) return fail(answer, TOOL.queryGraph);
      return finish(parseNodeRows(answer.text), answer.text, s, {
        tool: TOOL.queryGraph,
        anchor: "declaration",
        notes: [
          makeNote(
            "info",
            "query_transformed",
            `${ID} matched "${q.text}" against node LABELS and expanded by graph traversal, not by embedding. ` +
              `Its scoring is IDF plus trigram overlap over labels, so this is lexical, not semantic.`,
          ),
        ],
      });
    },

    /**
     * The same tool as `generalSearch`, and declared separately because graphify
     * genuinely indexes documents as first-class nodes — MEASURED: querying
     * "lock timeout policy stalled writer" returned
     * `NODE Locking policy [src=docs/locking.md loc=L1]`, and `get_node` reports
     * `Type: document` for it.
     *
     * TWO limits are announced rather than hidden. graphify exposes no node-type
     * filter, so code nodes come back mixed in with documents; and a document enters
     * the graph as its HEADING, not its body, so this answers "which document covers
     * this" and never "what does it say".
     */
    async knowledgeSearch(q: { text: string }, s: Scope): Promise<Outcome<Hit>> {
      const answer = await callEngine(
        ctx.client,
        TOOL.queryGraph,
        args({ question: q.text, mode: "bfs", depth: 2 }),
      );
      if (!answer.ok) return fail(answer, TOOL.queryGraph);
      return finish(parseNodeRows(answer.text), answer.text, s, {
        tool: TOOL.queryGraph,
        anchor: "declaration",
        notes: [
          makeNote(
            "degraded",
            "query_transformed",
            `${ID} indexes documents as nodes keyed by their HEADING, not their body, and exposes no node-type filter. ` +
              `These results therefore name documents that cover the topic, and may include code nodes; ` +
              `they are not a full-text search and an empty answer does not mean the words are absent from the docs.`,
          ),
        ],
      });
    },

    async locateSymbol(q: { name: string; kind?: SymbolKind }, s: Scope): Promise<Outcome<Hit>> {
      void q.kind; // graphify has no kind filter; filtering client-side on `()` alone
      // would drop every class, so the kind is simply not applied.
      const answer = await callEngine(ctx.client, TOOL.getNode, args({ label: q.name }));
      if (!answer.ok) return fail(answer, TOOL.getNode);

      const source = GET_NODE_SOURCE.exec(answer.text);
      const label = GET_NODE_NAME.exec(answer.text);
      if (source?.[1] === undefined || source[2] === undefined) {
        return finish([], answer.text, s, { tool: TOOL.getNode, anchor: "declaration" });
      }
      const type = GET_NODE_TYPE.exec(answer.text)?.[1];
      const row: GraphifyRow = {
        name: label?.[1] ?? q.name,
        file: source[1],
        line: Number.parseInt(source[2], 10),
      };
      const notes: BackendNote[] =
        type === "document"
          ? [
              makeNote(
                "info",
                "query_transformed",
                `${ID} resolved "${q.name}" to a DOCUMENT node, not a code symbol.`,
              ),
            ]
          : [];
      return finish([row], answer.text, s, { tool: TOOL.getNode, anchor: "declaration", notes });
    },

    findDependencies(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      if (q.distance > 1) {
        notes.push(
          makeNote(
            "degraded",
            "query_transformed",
            `${ID} ${TOOL.getNeighbors} returns DIRECT neighbours only, so depth ${q.distance} was answered at depth 1. ` +
              `Use callTree, which graphify serves transitively in one call.`,
          ),
        );
      }
      return neighbors(q.name, s, {
        relationFilter: RELATION.calls,
        keep: (row) => row.direction === "out",
        // MEASURED: `at=` on an edge row is the CALL SITE, not the callee's
        // declaration. See LineAnchor in core/ports.ts.
        anchor: "reference",
        notes,
      });
    },

    findDependents(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      if (q.distance > 1) {
        notes.push(
          makeNote(
            "degraded",
            "query_transformed",
            `${ID} ${TOOL.getNeighbors} returns DIRECT neighbours only, so depth ${q.distance} was answered at depth 1.`,
          ),
        );
      }
      return neighbors(q.name, s, {
        relationFilter: RELATION.calls,
        keep: (row) => row.direction === "in",
        anchor: "reference",
        notes,
      });
    },

    /**
     * One call, and a real transitive walk. MEASURED: `query_graph` with `mode: "dfs"`,
     * `depth: 4` and `context_filter: ["calls"]` on `main` returned
     * `main() --calls--> saveSettings() --calls--> withFileLock()` with all three nodes.
     * Unlike codegraph, graphify needs no client-side traversal here.
     */
    async callTree(q: { name: string; maxDistance: number }, s: Scope): Promise<Outcome<Hit>> {
      const depth = clampDepth(q.maxDistance, TOOL.queryGraph);
      const answer = await callEngine(
        ctx.client,
        TOOL.queryGraph,
        args({
          question: q.name,
          mode: "dfs",
          depth: depth.value,
          context_filter: [RELATION.calls],
        }),
      );
      if (!answer.ok) return fail(answer, TOOL.queryGraph);
      const notes = depth.note === undefined ? [] : [depth.note];
      return finish(parseNodeRows(answer.text), answer.text, s, {
        tool: TOOL.queryGraph,
        // NODE rows carry `loc=`, the declaration. The EDGE rows in the same answer
        // carry call sites; the nodes are returned because a call tree is a set of
        // symbols, and a symbol's home is where it is declared.
        anchor: "declaration",
        notes,
      });
    },

    /**
     * MEASURED, and this closes design §4.3 item 3, which had it as an unverified
     * inference: `get_neighbors BaseStore` returns `--> Store [implements]`,
     * `<-- FileStore [inherits]` and `<-- MemoryStore [inherits]`. `implements` and
     * `inherits` are DISTINCT relation types and both are emitted.
     *
     * One unfiltered call rather than two filtered ones: `relation_filter` takes a
     * single relation, and the concrete realisations of a type arrive as INCOMING edges
     * under either name.
     */
    findImplementations(q: { name: string }, s: Scope): Promise<Outcome<Hit>> {
      return neighbors(q.name, s, {
        keep: (row) => row.direction === "in" && row.relation !== undefined && IMPLEMENTATION_RELATIONS.has(row.relation),
        anchor: "declaration",
      });
    },
  };

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
        reason: `this ${ID} server does not expose ${absent.join(", ")}.`,
        remedy: START_REMEDY,
        retryable: true,
      };
    }

    if (current.emptyGraph === true) {
      for (const capability of Object.keys(TOOLS_FOR) as Capability[]) {
        if (statuses[capability] !== undefined) continue;
        statuses[capability] = {
          ready: false,
          reason: `${ID} reports an empty graph for ${ctx.projectDir}, so it has nothing to answer from.`,
          remedy: "graphify update <path> --no-cluster",
          retryable: true,
        };
      }
    }

    const detail: Record<string, unknown> = { exposedTools: [...current.present].sort() };
    if (current.nodes !== undefined) detail["nodes"] = current.nodes;
    if (current.edges !== undefined) detail["edges"] = current.edges;

    // NOTE: no `indexedFiles`. graphify counts NODES and EDGES and never files, and a
    // node count is not a file count — passing one as the other would put a wrong
    // number into the tier-0 call-budget sentence registry.ts builds.
    return buildHealth({ engineId: ID, capabilities, statuses, detail });
  }

  return {
    id: ID,
    displayName: DISPLAY_NAME,
    capabilities,
    probe,
    dispose: () => disposeQuietly(ctx.client),
  };
}
