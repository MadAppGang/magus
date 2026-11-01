#!/usr/bin/env bun
/**
 * measure-index.ts — `bun test-support/measure-index.ts <engine|all>`
 *
 * Prints one engine's measurement (or, for `all`, an object keyed by engine id) as JSON.
 *
 *   - An engine that is not on PATH prints `absent` (for `all`, the value "absent" under its key).
 *   - CODE_SEARCH_MEASURE_REQUIRE=all|<id,id> turns an absent engine into a failure:
 *     stderr `engine "<id>" required but not on PATH`, exit 1. CI sets `all`.
 *   - mnemex and serena are exempt (engine-managed, no index): reported as `exempt`.
 *
 * Exit codes: 0 measured or absent-and-optional, 1 a required engine is absent, 2 usage error.
 * CODE_SEARCH_MEASURE_SCRATCH picks the scratch root; CODE_SEARCH_MEASURE_KEEP=1 keeps it.
 */

import { CATALOG } from "../mcp/adapters/catalog";
import { EXEMPT, isRequired, measurableEngineIds, measureEngine, type MeasureOutcome } from "./index-measurement";

async function main(argv: readonly string[]): Promise<number> {
  const target = argv[0];
  const known = Object.keys(CATALOG);
  const measurable = measurableEngineIds();
  if (target === undefined || (target !== "all" && !known.includes(target))) {
    process.stderr.write(`usage: measure-index.ts <${[...known, "all"].join("|")}>\n`);
    return 2;
  }
  const ids = target === "all" ? measurable : measurable.includes(target) ? [target] : [];
  const out: Record<string, MeasureOutcome | "absent" | { engine: string; status: "exempt"; reason: string }> = {};
  let exit = 0;
  for (const id of ids) {
    const outcome = await measureEngine(id).catch((e: unknown) => {
      process.stderr.write(`engine "${id}" could not be measured: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      exit = 2;
      return undefined;
    });
    if (outcome === undefined) continue;
    if (outcome.status === "absent") {
      if (isRequired(id, process.env)) {
        process.stderr.write(`engine "${id}" required but not on PATH\n`);
        exit = 1;
      }
      out[id] = "absent";
    } else {
      out[id] = outcome;
    }
  }
  for (const [id, reason] of Object.entries(EXEMPT)) {
    if (target === id || target === "all") out[id] = { engine: id, status: "exempt", reason };
  }
  if (target !== "all") {
    const only = out[target];
    if (only === undefined) return exit === 0 ? 2 : exit; // measuring failed; the reason is on stderr
    process.stdout.write(only === "absent" ? "absent\n" : `${JSON.stringify(only, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  }
  return exit;
}

process.exit(await main(process.argv.slice(2)));
