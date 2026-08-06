#!/usr/bin/env bun
/**
 * Resolve saved model preferences against the live catalog and print a receipt.
 *
 * The catalog is passed IN rather than fetched here: model routing is claudish's
 * job, and agent workflows call the `list_models` MCP tool, never the CLI. This
 * script is the deterministic half — given a preferences file and the set of IDs
 * the catalog currently lists, it decides what dispatches and what gets reported.
 *
 *   # after calling list_models
 *   bun resolve-models.ts --catalog gpt-5.6-sol,glm-5.2,kimi-k3 --context review
 *   bun resolve-models.ts --catalog "$IDS" --json     # machine-readable receipt
 *
 * Exit codes: 0 resolved (possibly with drops) · 3 nothing survived · 2 bad usage.
 * A missing or corrupt preferences file is NOT an error — it is a receipt saying so.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { render, resolve, type Prefs } from "./lib/preferences";

const DEFAULT_PREFS = ".claude/multimodel-team.json";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const prefsPath = resolvePath(arg("prefs") ?? DEFAULT_PREFS);
const context = arg("context");
const asJson = process.argv.includes("--json");
const catalogArg = arg("catalog");

if (catalogArg === undefined) {
  console.error(
    "usage: resolve-models.ts --catalog <id,id,...> [--prefs <path>] [--context <name>] [--json]\n" +
      "\n" +
      "  --catalog  IDs the live catalog lists right now (from the list_models MCP tool).\n" +
      "             Pass an empty string when the catalog could not be reached — that is\n" +
      "             reported as unverified, never as 'every model is dead'.",
  );
  process.exit(2);
}

const catalogIds = catalogArg
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let prefs: Prefs | null = null;
let parseError: string | null = null;
let mtime: Date | null = null;

try {
  const raw = readFileSync(prefsPath, "utf8");
  mtime = statSync(prefsPath).mtime;
  try {
    prefs = JSON.parse(raw) as Prefs;
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
} catch {
  // Absent file: prefs stays null, parseError stays null — render says "none at".
}

const receipt = resolve({ prefsPath, prefs, parseError, mtime, catalogIds, context });

console.log(asJson ? JSON.stringify(receipt, null, 2) : render(receipt));
process.exit(receipt.exhausted ? 3 : 0);
