/**
 * mnemex adapter — `mnemex --mcp`.
 *
 * Declares 8 of 9 capabilities. `findImplementations` has NO key: mnemex has no tool
 * that answers "which concrete types implement this interface", and a text or vector
 * approximation of a structural question is a NO (design §4).
 *
 * THE ONE BEHAVIOUR THIS FILE EXISTS FOR (R1, measured live 2026-08-22 against
 * mnemex v0.31.2 in this worktree):
 *
 *   index_status -> {"initialized":true,"indexedFileCount":0,"lastIndexed":null,...}
 *   search       -> {"results":[],"totalMatches":0,...}       no isError, no warning
 *
 * The engine reports healthy while holding nothing, and an empty answer then reads as
 * "no matches in this codebase" when it means "nothing has been indexed". Every empty
 * result from this adapter is therefore annotated from a cached `index_status`, and
 * `probe()` reports the same state as an `index_missing` note. That is one `if`, and
 * it is the single most important line in the build.
 *
 * WHY THAT `if` READS TWO TIMESTAMP FIELDS AND NOT ONE. `index_status` has been
 * measured twice, and the two shapes disagree about which field carries the timestamp:
 *
 *   2026-08-22, mnemex v0.31.2, a genuinely EMPTY index — both fields agree:
 *     {"initialized":true,"indexPath":"…/.mnemex","indexDbLastIndexed":null,
 *      "indexSizeBytes":143360,"indexedFileCount":0,"fileWatcherActive":true,
 *      "freshness":"stale","lastIndexed":null,"filesChanged":[],
 *      "reindexingInProgress":false}
 *
 *   2026-08-26, mnemex v0.31.2, a COMPLETE 216-file index — they do not:
 *     {"initialized":true,"indexPath":"…/.mnemex",
 *      "indexDbLastIndexed":"2026-08-26T02:59:43.233Z","indexSizeBytes":2293760,
 *      "indexedFileCount":216,"freshness":"stale","lastIndexed":null,
 *      "staleSince":null,"filesChanged":[],"reindexingInProgress":false}
 *
 * `lastIndexed` is null on BOTH, so a predicate reading only `lastIndexed` calls the
 * second one empty and short-circuits every query against a perfectly good index —
 * measured end-to-end as `code_search` returning nothing with `[error] index_missing`
 * while mnemex's own `search` tool returned 10 hits on the same corpus. The completed
 * run is recorded in `indexDbLastIndexed`, so both fields are read and either one
 * counts as evidence that an index run finished. `indexedFileCount === 0` still fires
 * on its own — that is the headline defect above, and no timestamp may rescue it.
 *
 * The parameter ceilings below are not guessed. They were read off the live tool
 * schemas on the same day: `search.limit` 1..50 (default 10), `callers.depth` 1..5 and
 * `callers.limit` 1..100, `callees.depth` 1..5 with NO limit parameter at all,
 * `impact.depth` max 5 (default 3), `context.radius` 1..10. Every clamp is announced —
 * passing a larger number through and letting the engine clamp it silently is exactly
 * the class of lie the port exists to prevent.
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
  PassthroughTool,
  Scope,
  SymbolKind,
} from "../../core/ports";
import {
  asArray,
  asRecord,
  bandOf,
  buildHealth,
  callEngine,
  clamp01,
  clampWithNote,
  cutToLimit,
  disposeQuietly,
  emptyOutcome,
  makeNote,
  makeTtlCache,
  outcome,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
  toPortablePath,
  toSymbolKind,
  unreadyHealth,
  upstreamNote,
  withinScope,
  type AdapterContext,
  type EngineSpec,
  type TtlCache,
} from "../shared/kit";

const ID = "mnemex";
const DISPLAY_NAME = "mnemex";

const TOOL = {
  search: "search",
  symbol: "symbol",
  context: "context",
  callers: "callers",
  callees: "callees",
  impact: "impact",
  indexStatus: "index_status",
} as const;

/** Install command, verbatim and copy-pasteable. `npm install -g mnemex` and
 *  `npm install -g claude-codemem` are both wrong and both appear in the old skills. */
const INSTALL_REMEDY = "bun install -g mnemex";
const INDEX_REMEDY = "mnemex index";

/** Which upstream tools each declared capability needs. Read at probe time so a
 *  version bump that removes one makes the TOOL disappear rather than fail at call
 *  time — mnemex is unpinned and auto-updating (v0.31.2 installed, v0.32.0 out). */
const TOOLS_FOR: Readonly<Partial<Record<Capability, readonly string[]>>> = {
  generalSearch: [TOOL.search],
  knowledgeSearch: [TOOL.search],
  locateSymbol: [TOOL.symbol],
  readSource: [TOOL.context],
  findDependencies: [TOOL.callees],
  findDependents: [TOOL.callers],
  callTree: [TOOL.callers, TOOL.callees],
  impact: [TOOL.impact],
};

/** Doc-ish extensions for `knowledgeSearch`. Applied post-hoc, so the filter is a
 *  fact about the answer rather than a parameter we hope the engine honoured. */
const DOC_EXTENSIONS = ["md", "mdx", "txt", "rst", "adoc"] as const;

/** A query that names nothing in particular, so the canary measures the engine and
 *  not the corpus. Its RESULTS are ignored; only the failure mode is read. */
const CANARY_QUERY = "function";

interface IndexSnapshot {
  /** `index_status` answered and the payload parsed. */
  ok: boolean;
  /** The R1 predicate: no files, or no completed run recorded in EITHER timestamp. */
  empty: boolean;
  indexedFiles?: number;
  /** Present when `index_status` itself could not be reached. */
  failure?: BackendNote;
  detail: Record<string, unknown>;
}

interface EngineState {
  snapshot: IndexSnapshot;
  /** Expected tools absent from the child's `tools/list`. */
  missingTools: string[];
  /** Set when `tools/list` itself failed — the engine is not reachable at all. */
  unreachable?: BackendNote;
  /** Set when the index holds files but a canary search still fails. */
  canary?: { reason: string; remedy: string };
}

export function create(spec: EngineSpec, ctx: AdapterContext): Engine {
  void spec; // Everything this adapter needs from settings is already in ctx.client.

  const state: TtlCache<EngineState> = makeTtlCache(ctx, loadState);

  // -------------------------------------------------------------- state

  async function loadState(): Promise<EngineState> {
    const listed = await ctx.client.listTools();
    if (!listed.ok) {
      return {
        snapshot: { ok: false, empty: false, failure: listed.note, detail: {} },
        missingTools: [],
        unreachable: listed.note,
      };
    }

    const present = new Set(listed.tools.map((tool) => tool.name));
    const expected = new Set<string>();
    for (const tools of Object.values(TOOLS_FOR)) for (const tool of tools) expected.add(tool);
    const missingTools = [...expected].filter((tool) => !present.has(tool)).sort();

    const snapshot = present.has(TOOL.indexStatus)
      ? await loadSnapshot()
      : {
          ok: false,
          empty: false,
          failure: makeNote(
            "error",
            "backend_unavailable",
            `${ID} does not expose ${TOOL.indexStatus}, so this adapter cannot tell an empty index from an empty codebase.`,
            { remedy: INSTALL_REMEDY },
          ),
          detail: {},
        };

    const next: EngineState = { snapshot, missingTools };
    if (!snapshot.empty && snapshot.ok) {
      const canary = await runCanary();
      if (canary !== undefined) next.canary = canary;
    }
    return next;
  }

  async function loadSnapshot(): Promise<IndexSnapshot> {
    const answer = await callEngine(ctx.client, TOOL.indexStatus, {});
    if (!answer.ok) {
      const failure =
        answer.kind === "transport"
          ? answer.note
          : upstreamNote(ID, TOOL.indexStatus, answer.text, INSTALL_REMEDY);
      return { ok: false, empty: false, failure, detail: {} };
    }

    const payload = asRecord(answer.json);
    if (payload === undefined) {
      return {
        ok: false,
        empty: false,
        failure: makeNote(
          "error",
          "backend_unavailable",
          `${ID} ${TOOL.indexStatus} returned something this adapter could not read as JSON.`,
          { remedy: INSTALL_REMEDY },
        ),
        detail: {},
      };
    }

    const indexedFiles = readNumber(payload, "indexedFileCount");
    // Two spellings for "a run finished", and which one is populated varies by index
    // — see the two measured shapes at the top of this file. Either is evidence.
    const lastIndexed = readString(payload, "lastIndexed");
    const dbLastIndexed = readString(payload, "indexDbLastIndexed");
    const snapshot: IndexSnapshot = {
      ok: true,
      // R1's predicate. `initialized: true` and a 143 KB index file both pass every
      // check the old plugin had; only these fields catch the state. The file count
      // stands alone deliberately: 0 files is empty no matter what the clock says.
      empty: indexedFiles === 0 || (lastIndexed === undefined && dbLastIndexed === undefined),
      detail: {
        indexedFileCount: indexedFiles ?? null,
        lastIndexed: lastIndexed ?? null,
        indexDbLastIndexed: dbLastIndexed ?? null,
        freshness: readString(payload, "freshness") ?? null,
        staleSince: readString(payload, "staleSince") ?? null,
        indexSizeBytes: readNumber(payload, "indexSizeBytes") ?? null,
        fileWatcherActive: readBoolean(payload, "fileWatcherActive") ?? null,
      },
    };
    if (indexedFiles !== undefined) snapshot.indexedFiles = indexedFiles;
    return snapshot;
  }

  /** Separates "no embedding key" from "rate-limited" — both retryable, different
   *  remedies, and indistinguishable from an empty result without asking. */
  async function runCanary(): Promise<{ reason: string; remedy: string } | undefined> {
    const answer = await callEngine(ctx.client, TOOL.search, { query: CANARY_QUERY, limit: 1 });
    if (answer.ok) return undefined;

    const text = answer.kind === "transport" ? answer.note.message : answer.text;
    if (/api[ _-]?key|OPENROUTER_API_KEY|unauthori[sz]ed|401/iu.test(text)) {
      return {
        reason: `${ID} has an index but no working embedding credential: ${trim(text)}`,
        remedy: "Set OPENROUTER_API_KEY for mnemex, then run: mnemex index",
      };
    }
    if (/rate[ _-]?limit|429|too many requests/iu.test(text)) {
      return {
        reason: `${ID} is being rate-limited by its embedding provider: ${trim(text)}`,
        remedy: "Wait for the provider's window to reset, then retry.",
      };
    }
    return { reason: `${ID} failed a canary search: ${trim(text)}`, remedy: INDEX_REMEDY };
  }

  /** The R1 note, or nothing. Attached to EVERY empty result, not just search. */
  async function emptyIndexNote(): Promise<BackendNote | undefined> {
    const current = await state.get();
    if (current.unreachable !== undefined) return current.unreachable;
    const snapshot = current.snapshot;
    if (snapshot.failure !== undefined) return snapshot.failure;
    if (!snapshot.empty) return undefined;

    const files = snapshot.indexedFiles;
    const message =
      files === 0
        ? `the engine reports 0 indexed files, so "no results" here means "nothing has been indexed", NOT "this codebase has no matches".`
        : `the engine has never recorded a completed index run, so an empty answer here may mean the index was never built, NOT that this codebase has no matches.`;
    return makeNote("error", "index_missing", message, { remedy: INDEX_REMEDY });
  }

  /** Push the R1 note onto an empty result. One `if`, called from every capability. */
  async function annotateEmpty(results: readonly Hit[], notes: BackendNote[]): Promise<void> {
    if (results.length > 0) return;
    const note = await emptyIndexNote();
    if (note !== undefined) notes.push(note);
  }

  /** mnemex answers "not found" inside a success-shaped payload. Reporting it is what
   *  keeps "this symbol has no callers" distinguishable from "this symbol is not in
   *  the index" — two very different answers that render identically as an empty list. */
  function notFoundNote(payload: Record<string, unknown>, empty: boolean): BackendNote | undefined {
    const error = readString(payload, "error");
    if (error === undefined) return undefined;
    return makeNote(
      empty ? "error" : "degraded",
      "index_missing",
      `${ID}: ${error} This is not the same as the symbol having no callers or callees.`,
      { remedy: INDEX_REMEDY },
    );
  }

  /**
   * The freshness envelope is transport decoration, not a property of an answer
   * (design §3.3), so it becomes notes and never a field on a Hit.
   *
   * `freshness: "stale"` ALONE IS NOT REPORTED, deliberately. Measured 2026-08-26
   * against a complete 216-file index, mnemex answered `freshness:"stale"` with
   * `filesChanged:[]`, `staleSince:null` and `reindexingInProgress:false` — it derives
   * that word from the same null `lastIndexed` that broke the R1 predicate above, so
   * it is a default rather than an observation, and it is emitted on EVERY query
   * against an index of that shape. A degraded note that cannot not fire is not a
   * signal; it teaches the reader to skip the notes block, which is where R1's
   * `index_missing` lives. So the note now requires evidence that something actually
   * went stale, and mnemex offers exactly two pieces:
   *
   *   - `filesChanged` non-empty — the file list render.ts needs for its stale banner;
   *   - `staleSince` — a timestamp, i.e. mnemex recorded an observed transition.
   *
   * With neither, the honest report is silence: nothing in the payload says an edit
   * is missing from the index. This narrows WHEN the note fires and never softens
   * what it says — a real stale index still produces `filesChanged` and still fires.
   */
  function freshnessNotes(payload: Record<string, unknown>): BackendNote[] {
    const notes: BackendNote[] = [];
    if (readBoolean(payload, "reindexingInProgress") === true) {
      notes.push(
        makeNote("info", "index_building", `${ID} is reindexing; results may be incomplete until it finishes.`),
      );
    }
    const changed = readStringArray(payload, "filesChanged").map((file) => toPortablePath(file, ctx));
    const staleSince = readString(payload, "staleSince");
    if (changed.length > 0) {
      notes.push(
        makeNote(
          "degraded",
          "index_stale",
          `${changed.length} file(s) changed since the last index; recent edits may be missing.`,
          { remedy: INDEX_REMEDY, files: changed },
        ),
      );
    } else if (staleSince !== undefined) {
      notes.push(
        makeNote(
          "degraded",
          "index_stale",
          `${ID} reports its index as stale since ${staleSince}; recent edits may be missing.`,
          { remedy: INDEX_REMEDY },
        ),
      );
    }
    return notes;
  }

  function failureOutcome(answer: { kind: "transport"; note: BackendNote } | { kind: "upstream"; text: string }, tool: string): Outcome<Hit> {
    const note =
      answer.kind === "transport" ? answer.note : upstreamNote(ID, tool, answer.text, INDEX_REMEDY);
    // An upstream isError invalidates the cached probe: whatever we believed about
    // this engine's health, this call is newer evidence.
    if (answer.kind === "upstream") state.invalidate();
    return emptyOutcome([note]);
  }

  // -------------------------------------------------------------- search

  async function search(
    text: string,
    scope: Scope,
    extra: { docsOnly: boolean },
  ): Promise<Outcome<Hit>> {
    const notes: BackendNote[] = [];

    // `search.limit` is 1..50 upstream. Doc filtering happens post-hoc, so ask for
    // the ceiling when filtering: the alternative is asking for N, filtering to two,
    // and calling that the answer.
    const wanted = extra.docsOnly ? 50 : scope.limit;
    const limit = clampWithNote({
      engineId: ID,
      tool: TOOL.search,
      parameter: "limit",
      requested: wanted,
      fallback: 10,
      min: 1,
      max: 50,
    });
    if (limit.note !== undefined && !extra.docsOnly) notes.push(limit.note);

    let query = text.trim();
    if (query.length > 500) {
      query = query.slice(0, 500);
      notes.push(
        makeNote(
          "degraded",
          "query_transformed",
          `${ID}: the query was cut to 500 characters, the maximum the ${TOOL.search} tool accepts.`,
        ),
      );
    }
    if (extra.docsOnly) {
      notes.push(
        makeNote(
          "info",
          "query_transformed",
          `${ID}: results were filtered to documentation files (${DOC_EXTENSIONS.join(", ")}) after the search, ` +
            `so an empty answer here means the index holds no matching documentation, not that the query failed.`,
        ),
      );
    }

    const args: Record<string, unknown> = { query, limit: limit.value };
    if (scope.glob !== undefined) args["filePattern"] = scope.glob;

    const answer = await callEngine(ctx.client, TOOL.search, args);
    if (!answer.ok) return failureOutcome(answer, TOOL.search);

    const payload = asRecord(answer.json) ?? {};
    notes.push(...freshnessNotes(payload));

    const raw: Hit[] = [];
    for (const entry of asArray(payload["results"])) {
      const rec = asRecord(entry);
      if (rec === undefined) continue;
      const file = readString(rec, "file");
      if (file === undefined) continue;
      const hit: Hit = {
        file: toPortablePath(file, ctx),
        line: Math.max(1, readNumber(rec, "line") ?? 1),
      };
      const endLine = readNumber(rec, "lineEnd");
      if (endLine !== undefined && endLine >= hit.line) hit.endLine = endLine;
      const symbol = readString(rec, "symbol");
      if (symbol !== undefined) hit.symbol = { name: symbol, kind: "unknown" };
      const snippet = readString(rec, "snippet");
      if (snippet !== undefined) hit.text = snippet;
      const score = readNumber(rec, "score");
      if (score !== undefined) {
        const band = bandOf(score);
        if (band !== undefined) hit.relevance = band;
        hit.evidence = { score, backend: readString(rec, "backend") ?? null };
      }
      raw.push(hit);
    }

    const scoped = withinScope(raw, scope);
    const docFiltered = extra.docsOnly ? scoped.filter((hit) => isDoc(hit.file)) : scoped;
    const cut = cutToLimit(docFiltered, scope.limit);

    // `totalMatches` is `results.length` upstream — NOT a corpus total. Passing it as
    // `Outcome.total` would make render.ts claim the engine stopped early when all it
    // did was honour our own limit, so no total is reported here, ever.
    const hitCeiling = !extra.docsOnly && raw.length >= limit.value;
    const truncated = cut.cut || hitCeiling;
    if (truncated) {
      notes.push(
        makeNote(
          "info",
          "result_truncated",
          hitCeiling
            ? `${ID} returned exactly the ${limit.value} results asked for and reports no corpus total, so there may be more.`
            : `${cut.results.length} of ${docFiltered.length} results shown; the rest were cut by this facade.`,
        ),
      );
    }

    await annotateEmpty(cut.results, notes);
    return outcome(cut.results, notes, { truncated });
  }

  // -------------------------------------------------------------- capabilities

  const capabilities: Capabilities = {
    generalSearch: (q, s) => search(q.text, s, { docsOnly: false }),

    knowledgeSearch: (q, s) => search(q.text, s, { docsOnly: true }),

    async locateSymbol(q: { name: string; kind?: SymbolKind }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      const answer = await callEngine(ctx.client, TOOL.symbol, {
        symbol: q.name,
        kind: upstreamKind(q.kind),
        // Usages are `findDependents`' answer, not this one. Asking for them here
        // would pay for a call-graph walk to throw it away.
        includeUsages: false,
        includeBody: true,
      });
      if (!answer.ok) return failureOutcome(answer, TOOL.symbol);

      const payload = asRecord(answer.json) ?? {};
      notes.push(...freshnessNotes(payload));

      const definition = asRecord(payload["definition"]);
      if (definition === undefined) {
        const missing = notFoundNote(payload, (await state.get()).snapshot.empty);
        if (missing !== undefined) notes.push(missing);
        await annotateEmpty([], notes);
        return emptyOutcome(notes);
      }

      const file = readString(definition, "file");
      if (file === undefined) {
        notes.push(
          makeNote("degraded", "backend_unavailable", `${ID} returned a definition with no file path.`),
        );
        return emptyOutcome(notes);
      }

      const hit: Hit = {
        file: toPortablePath(file, ctx),
        line: Math.max(1, readNumber(definition, "line") ?? 1),
      };
      const endLine = readNumber(definition, "endLine");
      if (endLine !== undefined && endLine >= hit.line) hit.endLine = endLine;
      const name = readString(definition, "name") ?? q.name;
      const exported = readBoolean(definition, "isExported");
      hit.symbol = {
        name,
        kind: toSymbolKind(readString(definition, "kind")),
        // `undefined` is not `false`: absent means the engine could not prove it.
        ...(exported === undefined ? {} : { exported }),
      };
      const body = readString(definition, "body");
      if (body !== undefined) hit.text = body;
      const centrality = clamp01(readNumber(definition, "pageRank"));
      if (centrality !== undefined) hit.centrality = centrality;
      const pageRank = readNumber(definition, "pageRank");
      hit.evidence = {
        ...(pageRank === undefined ? {} : { pageRank }),
        signature: readString(definition, "signature") ?? null,
      };

      if (readBoolean(definition, "bodyStale") === true) {
        notes.push(
          makeNote(
            "degraded",
            "index_stale",
            `the indexed body of ${name} no longer matches the file on disk; the source shown may be out of date.`,
            { remedy: INDEX_REMEDY, files: [hit.file] },
          ),
        );
      }

      const scoped = withinScope([hit], s);
      await annotateEmpty(scoped, notes);
      return outcome(scoped, notes);
    },

    async readSource(q: { at: CodeLocation; radius?: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      const radius = clampWithNote({
        engineId: ID,
        tool: TOOL.context,
        parameter: "radius",
        requested: q.radius,
        fallback: 2,
        min: 1,
        max: 10,
      });
      if (radius.note !== undefined) notes.push(radius.note);

      const answer = await callEngine(ctx.client, TOOL.context, {
        file: q.at.file,
        line: q.at.line,
        radius: radius.value,
        includeBody: true,
      });
      if (!answer.ok) return failureOutcome(answer, TOOL.context);

      const payload = asRecord(answer.json) ?? {};
      notes.push(...freshnessNotes(payload));

      const enclosing = asRecord(payload["enclosingSymbol"]);
      if (enclosing === undefined) {
        notes.push(
          makeNote(
            "degraded",
            "index_missing",
            `${ID} has no indexed symbol enclosing ${q.at.file}:${q.at.line}, so it cannot return a body for it.`,
            { remedy: INDEX_REMEDY, files: [q.at.file] },
          ),
        );
        await annotateEmpty([], notes);
        return emptyOutcome(notes);
      }

      const file = readString(enclosing, "file") ?? q.at.file;
      const hit: Hit = {
        file: toPortablePath(file, ctx),
        line: Math.max(1, readNumber(enclosing, "startLine") ?? q.at.line),
      };
      const endLine = readNumber(enclosing, "endLine");
      if (endLine !== undefined && endLine >= hit.line) hit.endLine = endLine;
      const name = readString(enclosing, "name");
      if (name !== undefined) {
        hit.symbol = { name, kind: toSymbolKind(readString(enclosing, "kind")) };
      }
      const body = readString(enclosing, "body");
      if (body !== undefined) hit.text = body;
      hit.evidence = { signature: readString(enclosing, "signature") ?? null };

      if (readBoolean(enclosing, "bodyStale") === true) {
        notes.push(
          makeNote(
            "degraded",
            "index_stale",
            `the indexed body at ${hit.file}:${hit.line} no longer matches the file on disk.`,
            { remedy: INDEX_REMEDY, files: [hit.file] },
          ),
        );
      }

      const scoped = withinScope([hit], s);
      await annotateEmpty(scoped, notes);
      return outcome(scoped, notes);
    },

    async findDependents(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      const depth = clampWithNote({
        engineId: ID,
        tool: TOOL.callers,
        parameter: "depth",
        requested: q.distance,
        fallback: 1,
        min: 1,
        max: 5,
      });
      if (depth.note !== undefined) notes.push(depth.note);
      const limit = clampWithNote({
        engineId: ID,
        tool: TOOL.callers,
        parameter: "limit",
        requested: s.limit,
        fallback: 20,
        min: 1,
        max: 100,
      });
      if (limit.note !== undefined) notes.push(limit.note);

      const answer = await callEngine(ctx.client, TOOL.callers, {
        symbol: q.name,
        depth: depth.value,
        limit: limit.value,
      });
      if (!answer.ok) return failureOutcome(answer, TOOL.callers);

      const payload = asRecord(answer.json) ?? {};
      notes.push(...freshnessNotes(payload));
      const missing = notFoundNote(payload, (await state.get()).snapshot.empty);
      if (missing !== undefined) notes.push(missing);

      const hits = edgeHits(payload["callers"], "caller");
      const scoped = withinScope(hits, s);
      const cut = cutToLimit(scoped, s.limit);

      // `totalDirectCallers` IS an engine-reported total, so it may set `total` — but
      // only when we did not do the cutting ourselves. If our own cut fired, the
      // honest sentence is "cut by this facade", and that sentence is chosen by the
      // ABSENCE of a total.
      const total = readNumber(payload, "totalDirectCallers");
      const engineTruncated = total !== undefined && total > hits.length;
      const truncated = cut.cut || engineTruncated;
      if (truncated) {
        notes.push(
          makeNote(
            "info",
            "result_truncated",
            cut.cut
              ? `${cut.results.length} of ${scoped.length} callers shown; the rest were cut by this facade.`
              : `${ID} reports ${String(total)} direct callers and returned ${hits.length}.`,
          ),
        );
      }

      await annotateEmpty(cut.results, notes);
      return outcome(cut.results, notes, {
        truncated,
        ...(cut.cut || !engineTruncated ? {} : { total }),
      });
    },

    async findDependencies(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      const depth = clampWithNote({
        engineId: ID,
        tool: TOOL.callees,
        parameter: "depth",
        requested: q.distance,
        fallback: 1,
        min: 1,
        max: 5,
      });
      if (depth.note !== undefined) notes.push(depth.note);

      const answer = await callEngine(ctx.client, TOOL.callees, { symbol: q.name, depth: depth.value });
      if (!answer.ok) return failureOutcome(answer, TOOL.callees);

      const payload = asRecord(answer.json) ?? {};
      notes.push(...freshnessNotes(payload));
      const missing = notFoundNote(payload, (await state.get()).snapshot.empty);
      if (missing !== undefined) notes.push(missing);

      const hits = edgeHits(payload["callees"], "callee");
      const scoped = withinScope(hits, s);
      const cut = cutToLimit(scoped, s.limit);

      // U4: `callees` takes NO limit parameter and reports no total, so upstream
      // truncation cannot be detected here AT ALL. `truncated` therefore comes from
      // OUR post-hoc cut only, and `total` stays undefined so render.ts cannot say
      // the engine stopped early. Never claim otherwise.
      if (cut.cut) {
        notes.push(
          makeNote(
            "info",
            "result_truncated",
            `${cut.results.length} of ${scoped.length} dependencies shown, cut by this facade; ` +
              `${ID}'s ${TOOL.callees} tool takes no limit and reports no total, so whether it truncated cannot be known.`,
          ),
        );
      }

      await annotateEmpty(cut.results, notes);
      return outcome(cut.results, notes, { truncated: cut.cut });
    },

    async callTree(q: { name: string; maxDistance: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      const depth = clampWithNote({
        engineId: ID,
        tool: `${TOOL.callers}/${TOOL.callees}`,
        parameter: "maxDistance",
        requested: q.maxDistance,
        fallback: 3,
        min: 1,
        max: 5,
      });
      if (depth.note !== undefined) notes.push(depth.note);
      const limit = clampWithNote({
        engineId: ID,
        tool: TOOL.callers,
        parameter: "limit",
        requested: s.limit,
        fallback: 20,
        min: 1,
        max: 100,
      });

      const [up, down] = await Promise.all([
        callEngine(ctx.client, TOOL.callers, { symbol: q.name, depth: depth.value, limit: limit.value }),
        callEngine(ctx.client, TOOL.callees, { symbol: q.name, depth: depth.value }),
      ]);

      // Both directions failing is a dead engine; one failing still has an answer.
      if (!up.ok && !down.ok) return failureOutcome(up.ok ? down : up, TOOL.callers);

      const hits: Hit[] = [];
      const seen = new Set<string>();
      for (const [answer, key, direction] of [
        [up, "callers", "caller"],
        [down, "callees", "callee"],
      ] as const) {
        if (!answer.ok) {
          notes.push(
            answer.kind === "transport"
              ? answer.note
              : upstreamNote(ID, key, answer.text, INDEX_REMEDY),
          );
          continue;
        }
        const payload = asRecord(answer.json) ?? {};
        notes.push(...freshnessNotes(payload));
        const missing = notFoundNote(payload, (await state.get()).snapshot.empty);
        if (missing !== undefined) notes.push(missing);
        for (const hit of edgeHits(payload[key], direction)) {
          const dedupe = `${hit.file}:${hit.line}:${hit.symbol?.name ?? ""}:${direction}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          hits.push(hit);
        }
      }

      const scoped = withinScope(hits, s);
      const cut = cutToLimit(scoped, s.limit);
      if (cut.cut) {
        notes.push(
          makeNote(
            "info",
            "result_truncated",
            `${cut.results.length} of ${scoped.length} call-tree entries shown; the rest were cut by this facade.`,
          ),
        );
      }
      await annotateEmpty(cut.results, notes);
      // The two directions are merged here, so no engine-reported total describes the
      // merged list. Absence of `total` is the correct, honest state.
      return outcome(cut.results, notes, { truncated: cut.cut });
    },

    async impact(
      q: { name: string; maxDistance: number },
      s: Scope,
    ): Promise<Outcome<Hit> & { risk: "low" | "medium" | "high" }> {
      const notes: BackendNote[] = [];
      const depth = clampWithNote({
        engineId: ID,
        tool: TOOL.impact,
        parameter: "maxDistance",
        requested: q.maxDistance,
        fallback: 3,
        min: 1,
        max: 5,
      });
      if (depth.note !== undefined) notes.push(depth.note);

      const answer = await callEngine(ctx.client, TOOL.impact, { symbol: q.name, depth: depth.value });
      if (!answer.ok) {
        const failed = failureOutcome(answer, TOOL.impact);
        return { ...failed, risk: "low" };
      }

      const payload = asRecord(answer.json) ?? {};
      notes.push(...freshnessNotes(payload));
      const missing = notFoundNote(payload, (await state.get()).snapshot.empty);
      if (missing !== undefined) notes.push(missing);

      const hits = edgeHits(payload["impactedSymbols"], "caller");
      const scoped = withinScope(hits, s);
      const cut = cutToLimit(scoped, s.limit);

      const transitive = readNumber(payload, "transitiveDependents");
      const engineTruncated = transitive !== undefined && transitive > hits.length;
      const truncated = cut.cut || engineTruncated;
      if (truncated) {
        notes.push(
          makeNote(
            "info",
            "result_truncated",
            cut.cut
              ? `${cut.results.length} of ${scoped.length} affected symbols shown; the rest were cut by this facade.`
              : `${ID} reports ${String(transitive)} affected symbols and returned ${hits.length}.`,
          ),
        );
      }

      const reported = readString(payload, "riskLevel");
      const risk = reported === "low" || reported === "medium" || reported === "high" ? reported : undefined;
      if (risk === undefined && readString(payload, "error") === undefined) {
        notes.push(
          makeNote(
            "degraded",
            "backend_unavailable",
            `${ID} returned an impact result with no risk level; the band shown is a placeholder, not the engine's judgement.`,
          ),
        );
      }

      await annotateEmpty(cut.results, notes);
      return {
        ...outcome(cut.results, notes, {
          truncated,
          ...(cut.cut || !engineTruncated ? {} : { total: transitive }),
        }),
        risk: risk ?? "low",
      };
    },
  };

  // -------------------------------------------------------------- probe

  async function probe(): Promise<BackendHealth> {
    const current = await state.get();

    if (current.unreachable !== undefined) {
      return unreadyHealth({
        engineId: ID,
        capabilities,
        reason: current.unreachable.message,
        remedy: current.unreachable.remedy ?? INSTALL_REMEDY,
        detail: { missingTools: current.missingTools },
      });
    }

    const snapshot = current.snapshot;
    if (snapshot.failure !== undefined) {
      return unreadyHealth({
        engineId: ID,
        capabilities,
        reason: snapshot.failure.message,
        remedy: snapshot.failure.remedy ?? INSTALL_REMEDY,
        detail: { ...snapshot.detail, missingTools: current.missingTools },
      });
    }

    const detail = { ...snapshot.detail, missingTools: current.missingTools };

    // Every mnemex failure state is repairable, so none of them may shrink the tool
    // list — an empty index, a missing key and a stale index are all retryable:true.
    if (snapshot.empty) {
      return unreadyHealth({
        engineId: ID,
        capabilities,
        // Two ways to be empty, two sentences. Saying "holds 0 files" when the count
        // was absent would be the same invented certainty this adapter exists to stop.
        reason:
          snapshot.indexedFiles === 0
            ? `the ${ID} index holds 0 files, so every answer would be empty for reasons that have nothing to do with the codebase.`
            : `${ID} records no completed index run in either lastIndexed or indexDbLastIndexed, so an empty answer here would say nothing about the codebase.`,
        remedy: INDEX_REMEDY,
        indexedFiles: snapshot.indexedFiles ?? 0,
        detail,
      });
    }
    if (current.canary !== undefined) {
      return unreadyHealth({
        engineId: ID,
        capabilities,
        reason: current.canary.reason,
        remedy: current.canary.remedy,
        ...(snapshot.indexedFiles === undefined ? {} : { indexedFiles: snapshot.indexedFiles }),
        detail,
      });
    }

    // F9: a tool that vanished in an upstream release is a PERMANENT incapacity for
    // this install — the tool disappears from tools/list rather than failing when the
    // agent finally calls it.
    const statuses: Partial<Record<Capability, CapabilityStatus>> = {};
    if (current.missingTools.length > 0) {
      for (const [capability, tools] of Object.entries(TOOLS_FOR)) {
        const absent = tools.filter((tool) => current.missingTools.includes(tool));
        if (absent.length === 0) continue;
        statuses[capability as Capability] = {
          ready: false,
          reason: `the installed ${ID} does not expose ${absent.join(", ")}, which this capability needs.`,
          remedy: INSTALL_REMEDY,
          retryable: false,
        };
      }
    }

    return buildHealth({
      engineId: ID,
      capabilities,
      statuses,
      ...(snapshot.indexedFiles === undefined ? {} : { indexedFiles: snapshot.indexedFiles }),
      detail,
    });
  }

  // -------------------------------------------------------------- engine

  return {
    id: ID,
    displayName: DISPLAY_NAME,
    capabilities,
    probe,

    /**
     * Tier 2 ships EMPTY in 6.0.0, deliberately.
     *
     * `map` is the ONE mnemex tool that survives the five-part tier-2 gate (§5.3): the
     * port declined `mapText` on exactly the G1 inexpressibility ground, so no tier-0/1
     * call reproduces it. It is still not registered here. Starting at zero makes every
     * later addition a deliberate, reviewed act; starting at "a handful, TBD" makes the
     * cap a formality — and the cap is what keeps the facade from becoming the God
     * Object the Facade pattern warns about.
     */
    passthroughs: (): Promise<PassthroughTool[]> => Promise.resolve([]),

    callPassthrough: (name: string): Promise<unknown> =>
      Promise.resolve({
        refused: `${ID} registers no passthrough tools in this version, so "${name}" was never listed.`,
      }),

    dispose: () => disposeQuietly(ctx.client),
  };

  // -------------------------------------------------------------- helpers

  /** callers/callees/impact all return `{symbol, file, line, depth, …}`. */
  function edgeHits(value: unknown, direction: "caller" | "callee"): Hit[] {
    const hits: Hit[] = [];
    for (const entry of asArray(value)) {
      const rec = asRecord(entry);
      if (rec === undefined) continue;
      const file = readString(rec, "file");
      if (file === undefined) continue;
      const hit: Hit = {
        file: toPortablePath(file, ctx),
        line: Math.max(1, readNumber(rec, "line") ?? 1),
      };
      const name = readString(rec, "symbol");
      if (name !== undefined) hit.symbol = { name, kind: "unknown" };
      const centrality = clamp01(readNumber(rec, "pageRank"));
      if (centrality !== undefined) hit.centrality = centrality;
      const pageRank = readNumber(rec, "pageRank");
      const external = readBoolean(rec, "isExternal");
      hit.evidence = {
        direction,
        depth: readNumber(rec, "depth") ?? null,
        ...(pageRank === undefined ? {} : { pageRank }),
        ...(external === undefined ? {} : { isExternal: external }),
      };
      hits.push(hit);
    }
    return hits;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function isDoc(file: string): boolean {
  const dot = file.lastIndexOf(".");
  if (dot === -1) return false;
  const extension = file.slice(dot + 1).toLowerCase();
  return (DOC_EXTENSIONS as readonly string[]).includes(extension);
}

/** mnemex's `kind` enum is function|class|interface|type|variable|any. The port's
 *  `"unknown"` means "no filter", which is what `any` says upstream. */
function upstreamKind(kind: SymbolKind | undefined): string {
  if (kind === undefined || kind === "unknown") return "any";
  return kind;
}

function trim(text: string): string {
  return text.trim().slice(0, 300);
}
