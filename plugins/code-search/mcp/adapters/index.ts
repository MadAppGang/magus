/**
 * adapters/index.ts — the ONE file that knows the engines by name.
 *
 * Everything else dispatches on capability presence, never on an engine id: that is
 * what stops `core/` growing a switch over backend names. `registry.ts` takes a
 * `resolve` function and never learns an id; `server.ts` supplies one from here.
 *
 * Adding an engine is one line in this file plus its own directory. Nothing in `core/`
 * changes, which is the whole point of the port.
 *
 * ---------------------------------------------------------------------------------
 * FOUR ENGINES, AND THE COUNT IS A CLAIM ABOUT VERIFICATION, NOT ABOUT AMBITION.
 *
 * This table held six, then two. The six were written against upstream documentation
 * and four had never once been run: no binary for any of them existed on the machines
 * that built them, so their tool names, argument shapes, result shapes and line bases
 * were all unconfirmed. Shipping them made the facade advertise six switchable engines
 * when two had been exercised, and a user who selected one of the four would have got
 * a plausible adapter failing in a way nobody had ever seen. They were deleted rather
 * than disabled, because a disabled adapter is still code that rots and the whole cost
 * of re-adding one is the verification.
 *
 * TWO OF THE FOUR HAVE NOW BEEN PAID FOR, on the stated terms: installed, `tools/list`
 * read from a running server, every argument shape exercised by a round trip, and the
 * result recorded in the adapter's own header. `codegraph` and `graphify` are back on
 * that basis and on no other. `claudectx` and `cocoindex` remain deleted — both score
 * ZERO of the seven code operations (no symbol table, no edges), and claudectx also
 * requires a running Milvus and an embedding credential, so neither has been run here.
 *
 * What the re-verification actually caught, none of which is in any of their docs:
 *   - codegraph's docs say an un-indexed workspace lists NO tools. It lists one.
 *   - `serve` is a HIDDEN subcommand in both; neither `--help` admits it exists.
 *   - graphify's MCP server is an OPTIONAL EXTRA (`graphifyy[mcp]`); the README's own
 *     install command produces a package that cannot serve MCP at all.
 *   - codegraph and graphify are 1-BASED. serena is 0-BASED and passes that through.
 *     There is deliberately no shared line-base helper: one would corrupt an engine.
 *   - the two disagree on what a dependent's line MEANS — declaration vs call site —
 *     which is why the port now carries `LineAnchor`.
 *
 * The four, and what each has been run against:
 *   mnemex    — embedding + AST, 8 capabilities. KNOWN-BROKEN under a fresh sandbox
 *               HOME: its `index.db` bakes in absolute paths, so an index built
 *               elsewhere reports every hit under the tree that built it.
 *               `repairForeignPath` in the kit recovers the relative path where it can.
 *   serena    — language-server symbols, 5 capabilities. Verified against 1.7.0.
 *   codegraph — SQLite graph, FTS5, no external service. 7 capabilities. Verified
 *               against 1.6.0, 2026-08-28. Answers in MARKDOWN, never JSON.
 *   graphify  — deterministic AST graph, no vector store. 7 capabilities. Verified
 *               against 0.9.50, 2026-08-28. Pointer-only: it never returns source.
 */

import type { Engine } from "../core/ports";
import type { AdapterContext, EngineSpec } from "./shared/kit";
import { create as createCodegraph } from "./codegraph/index";
import { create as createGraphify } from "./graphify/index";
import { create as createMnemex } from "./mnemex/index";
import { create as createSerena } from "./serena/index";

export type EngineFactory = (spec: EngineSpec, ctx: AdapterContext) => Engine;

/**
 * Settings key = engine id.
 *
 * `Engine.id` is /^[a-z][a-z0-9]{1,11}$/ — no hyphens, 12 characters — so an engine
 * whose upstream package name carries a hyphen gets a settings key that does not match
 * it. One identifier is worth more than matching an upstream name.
 */
export const ADAPTERS: Readonly<Record<string, EngineFactory>> = {
  codegraph: createCodegraph,
  graphify: createGraphify,
  mnemex: createMnemex,
  serena: createSerena,
};

/** Stable order, used by tests and by anything reporting what this plugin ships. */
export const ENGINE_IDS: readonly string[] = Object.keys(ADAPTERS);

/**
 * `undefined` for an unknown id — never a throw and never a guess.
 *
 * A name that resolves to nothing is a configuration answer: `registry.ts` turns it
 * into a `backend_unavailable` note that names the id, and tier 0 keeps working. A
 * near-match ("serena2" -> serena) would be the same class of error as resolving a
 * model alias by string distance, and is deliberately not done.
 */
export function resolveEngine(id: string, spec: EngineSpec, ctx: AdapterContext): Engine | undefined {
  const factory = ADAPTERS[id];
  if (factory === undefined) return undefined;
  return factory(spec, ctx);
}

/**
 * The shape `RegistryInput.resolve` wants: `(id, spec) => Engine | undefined`.
 *
 * The context is built per engine by the caller, because it carries an `McpClient`
 * that only the composition root can construct — an adapter never spawns a process.
 */
export function makeResolver(
  context: (id: string, spec: EngineSpec) => AdapterContext,
): (id: string, spec: EngineSpec) => Engine | undefined {
  return (id, spec) => {
    const factory = ADAPTERS[id];
    if (factory === undefined) return undefined;
    return factory(spec, context(id, spec));
  };
}
