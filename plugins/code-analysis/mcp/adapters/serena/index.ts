/**
 * serena adapter — `serena start-mcp-server --context claude-code --project-from-cwd`.
 *
 * Declares 5 of 9 (design §4). Four absences, and three of them are one fact:
 *
 *   - `findDependencies`, `callTree`, `impact` — Serena has NO outgoing-edge tool at
 *     all. Verified in `symbol_tools.py`: 13 tool classes, none returns callees.
 *     `find_referencing_symbols` is LSP `textDocument/references`, incoming-only. LSP
 *     itself has `callHierarchy/outgoingCalls`; Serena does not expose it. Without an
 *     outgoing edge there is no dependency list, no call tree, and no blast radius.
 *   - `knowledgeSearch` — no document or comment model.
 *
 * `generalSearch` is a real constraint made visible rather than hidden. Serena's own
 * `claude-code` context sets `excluded_tools:` including `search_for_pattern`,
 * `find_file`, `list_dir` and `read_file`, so in its recommended configuration it
 * exposes NO regex search. A free-form query therefore runs as a symbol-name substring
 * match, and every such call emits `query_transformed` saying so — an agent that thinks
 * it ran a text search over a corpus would misread an empty answer completely.
 *
 * MEASURED AGAINST A REAL INSTALL — serena 1.7.0, 2026-08-26. Two of the three things
 * R2 left open are now facts; the third is still open and is still marked.
 *
 *   TOOL NAMES: CONFIRMED. `find_symbol`, `find_referencing_symbols` and
 *   `find_implementations` are all present in `tools/list` under `--context claude-code`
 *   (21 tools registered). The same listing confirms the excluded set above:
 *   `search_for_pattern`, `find_file`, `list_dir` and `read_file` are absent, so
 *   `generalSearch` really is a symbol-name substring match and not a text search.
 *
 *   LINE BASE: 0-BASED. `find_symbol name_path=LOCK_TIMEOUT_MS` returned
 *   `body_location.start_line: 15` for a declaration on line 16 of the file. THE DECISION
 *   NOT TO ±1 CORRECT STILL STANDS — do not add a correction here. What changed is that
 *   the offset is now known rather than unknown; the pass-through is a deliberate contract
 *   with the caller, not a hedge against not knowing.
 *
 *   PARAMETER NAMES: STILL UNVERIFIED. Nothing above exercised the argument shapes, so the
 *   names this adapter sends are still taken from Serena's documentation rather than from a
 *   round trip.
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
  asRecord,
  buildHealth,
  callEngine,
  cutToLimit,
  disposeQuietly,
  emptyOutcome,
  locationsFromText,
  makeNote,
  makeTtlCache,
  outcome,
  readHits,
  unreadyHealth,
  unusableShapeNote,
  upstreamNote,
  withinScope,
  type AdapterContext,
  type EngineAnswer,
  type EngineSpec,
} from "../shared/kit";

const ID = "serena";
const DISPLAY_NAME = "Serena";

const TOOL = {
  findSymbol: "find_symbol",
  findReferencing: "find_referencing_symbols",
  findImplementations: "find_implementations",
} as const;

const START_REMEDY =
  "serena start-mcp-server --context claude-code --project-from-cwd  (check the project is activated)";

const TOOLS_FOR: Readonly<Partial<Record<Capability, readonly string[]>>> = {
  generalSearch: [TOOL.findSymbol],
  locateSymbol: [TOOL.findSymbol],
  readSource: [TOOL.findSymbol],
  findDependents: [TOOL.findReferencing],
  findImplementations: [TOOL.findImplementations],
};

/** A name no codebase contains, used once at probe time to ask the language server
 *  whether it implements the request at all. U2 is answered by the engine rather than
 *  guessed from Serena's "only available for some languages" documentation. */
const SENTINEL = "__ca_probe_sentinel__";

/** Errors that mean "this language server cannot do this, ever, here" as opposed to
 *  "that symbol does not exist". Matched on the message because LSP servers do not
 *  agree on a code. */
const UNSUPPORTED = /unsupported|not supported|no such method|method not found|unimplemented|not implemented|capabilit/iu;

export function create(spec: EngineSpec, ctx: AdapterContext): Engine {
  void spec;

  const state = makeTtlCache(ctx, loadState);

  interface State {
    present: Set<string>;
    failure?: BackendNote;
    /** Set when the language server rejected `find_implementations` outright. */
    implementationsUnsupported?: string;
  }

  async function loadState(): Promise<State> {
    const listed = await ctx.client.listTools();
    if (!listed.ok) return { present: new Set<string>(), failure: listed.note };
    const present = new Set(listed.tools.map((tool) => tool.name));

    if (!present.has(TOOL.findImplementations)) return { present };

    const answer = await callEngine(ctx.client, TOOL.findImplementations, { name_path: SENTINEL });
    if (answer.ok) return { present };
    const text = answer.kind === "transport" ? answer.note.message : answer.text;
    // Any error that is NOT an unsupported-method error means the tool works and the
    // sentinel simply does not exist — which is the answer we wanted.
    if (UNSUPPORTED.test(text)) return { present, implementationsUnsupported: text.trim().slice(0, 300) };
    return { present };
  }

  function fail(answer: Exclude<EngineAnswer, { ok: true }>, tool: string): Outcome<Hit> {
    return emptyOutcome([
      answer.kind === "transport" ? answer.note : upstreamNote(ID, tool, answer.text, START_REMEDY),
    ]);
  }

  function hitsFrom(
    answer: { json: unknown; text: string },
    tool: string,
    withText: boolean,
  ): { hits: Hit[]; notes: BackendNote[] } {
    const notes: BackendNote[] = [];
    const record = asRecord(answer.json);
    const container = Array.isArray(answer.json)
      ? answer.json
      : record === undefined
        ? undefined
        : (record["symbols"] ?? record["results"] ?? record["references"] ?? record["implementations"]);

    if (Array.isArray(container)) {
      const read = readHits(container, { projectDir: ctx.projectDir, fileExists: ctx.fileExists, withText });
      if (read.dropped > 0) {
        notes.push(
          makeNote(
            "degraded",
            "backend_unavailable",
            `${ID} ${tool} returned ${read.dropped} symbol(s) with no file path; a hit the agent cannot open is not a hit, so they were dropped.`,
          ),
        );
      }
      return { hits: read.hits, notes };
    }

    const hits = locationsFromText(answer.text, ctx);
    if (hits.length === 0 && answer.text.trim() !== "") notes.push(unusableShapeNote(ID, tool, answer.text));
    return { hits, notes };
  }

  async function symbolQuery(
    args: Record<string, unknown>,
    scope: Scope,
    opts: { tool: string; withText: boolean; notes?: BackendNote[] },
  ): Promise<Outcome<Hit>> {
    const answer = await callEngine(ctx.client, opts.tool, args);
    if (!answer.ok) return fail(answer, opts.tool);

    const read = hitsFrom(answer, opts.tool, opts.withText);
    const notes = [...(opts.notes ?? []), ...read.notes];
    const scoped = withinScope(read.hits, scope);
    const cut = cutToLimit(scoped, scope.limit);
    if (cut.cut) {
      notes.push(
        makeNote(
          "info",
          "result_truncated",
          `${cut.results.length} of ${scoped.length} results shown; the rest were cut by this facade. ` +
            `${ID} reports no total, so whether it truncated first cannot be known.`,
        ),
      );
    }
    // No `total`, ever: Serena reports no count, and inventing one would let render.ts
    // claim the engine stopped early when only this facade did.
    return outcome(cut.results, notes, { truncated: cut.cut });
  }

  /** `find_referencing_symbols` needs the file the symbol lives in, which the port does
   *  not carry. One extra `find_symbol` call resolves it — the alternative is guessing
   *  a path or refusing the capability. */
  async function locateFile(name: string): Promise<{ file?: string; note?: BackendNote }> {
    const answer = await callEngine(ctx.client, TOOL.findSymbol, { name_path: name, include_body: false });
    if (!answer.ok) {
      return {
        note:
          answer.kind === "transport"
            ? answer.note
            : upstreamNote(ID, TOOL.findSymbol, answer.text, START_REMEDY),
      };
    }
    const first = hitsFrom(answer, TOOL.findSymbol, false).hits[0];
    if (first === undefined) {
      return {
        note: makeNote(
          "degraded",
          "index_missing",
          `${ID} could not locate a symbol named ${name}, so it has no file to look for references in. That is not the same as the symbol having no callers.`,
        ),
      };
    }
    return { file: first.file };
  }

  const capabilities: Capabilities = {
    generalSearch(q: { text: string }, s: Scope): Promise<Outcome<Hit>> {
      return symbolQuery(
        { name_path: q.text, substring_matching: true, include_body: false },
        s,
        {
          tool: TOOL.findSymbol,
          withText: false,
          notes: [
            makeNote(
              "degraded",
              "query_transformed",
              `${ID} exposes no text search in its claude-code context, so this ran as a symbol-name substring match on "${q.text}". ` +
                `An empty answer means no symbol NAME matched, not that the codebase has no such text.`,
            ),
          ],
        },
      );
    },

    locateSymbol(q: { name: string; kind?: SymbolKind }, s: Scope): Promise<Outcome<Hit>> {
      return symbolQuery({ name_path: q.name, include_body: false }, s, {
        tool: TOOL.findSymbol,
        withText: false,
      });
    },

    readSource(q: { at: CodeLocation; radius?: number }, s: Scope): Promise<Outcome<Hit>> {
      // Serena addresses bodies by symbol path, not by line, so the file is passed as
      // the restriction and the answer is filtered back to that file. Said out loud
      // because it changes what an empty answer means.
      return symbolQuery(
        { relative_path: q.at.file, include_body: true, depth: 1 },
        { ...s, glob: q.at.file },
        {
          tool: TOOL.findSymbol,
          withText: true,
          notes: [
            makeNote(
              "info",
              "query_transformed",
              `${ID} addresses source by symbol path rather than by line, so the symbols of ${q.at.file} were requested and filtered to that file.`,
            ),
          ],
        },
      );
    },

    async findDependents(q: { name: string; distance: number }, s: Scope): Promise<Outcome<Hit>> {
      const notes: BackendNote[] = [];
      if (q.distance > 1) {
        notes.push(
          makeNote(
            "degraded",
            "query_transformed",
            `${ID} returns direct references only (LSP textDocument/references), so depth ${q.distance} was answered at depth 1.`,
          ),
        );
      }
      const located = await locateFile(q.name);
      if (located.file === undefined) {
        return emptyOutcome(located.note === undefined ? notes : [...notes, located.note]);
      }
      return symbolQuery({ name_path: q.name, relative_path: located.file }, s, {
        tool: TOOL.findReferencing,
        withText: false,
        notes,
      });
    },

    findImplementations(q: { name: string }, s: Scope): Promise<Outcome<Hit>> {
      return symbolQuery({ name_path: q.name }, s, {
        tool: TOOL.findImplementations,
        withText: false,
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
        reason: `this ${ID} server does not expose ${absent.join(", ")}; its context configuration excludes the tool this capability needs.`,
        remedy: START_REMEDY,
        // Excluded by the context config, not broken: for THIS project, with THIS
        // context, the operation does not exist. Permanent, so the tool is delisted.
        retryable: false,
      };
    }

    // U2, answered by the engine: an unsupported-method error means this project's
    // language server has no implementations request, so the tool disappears rather
    // than failing at call time.
    if (current.implementationsUnsupported !== undefined) {
      statuses.findImplementations = {
        ready: false,
        reason: `${ID}'s language server for this project does not support finding implementations: ${current.implementationsUnsupported}`,
        retryable: false,
      };
    }

    return buildHealth({
      engineId: ID,
      capabilities,
      statuses,
      detail: {
        exposedTools: [...current.present].sort(),
        implementationsSupported: current.implementationsUnsupported === undefined,
      },
    });
  }

  return {
    id: ID,
    displayName: DISPLAY_NAME,
    capabilities,
    probe,
    dispose: () => disposeQuietly(ctx.client),
  };
}
