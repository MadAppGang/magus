#!/usr/bin/env bun
/**
 * setup.ts — the code-search setup CLI. The guided skill, the /code-search:setup command
 * and the SessionStart prompt all end up here; nothing else installs or configures.
 *
 *   bun --env-file=/dev/null --config=/dev/null "<root>/scripts/setup.ts" <subcommand> [args] [--json] [--project <dir>]
 *     status    [--deep] [--check-updates]
 *     install   <engine> [--dry-run]
 *     upgrade   <engine> [--dry-run]
 *     configure <engine|none> [--layer local|project|user] [--replace] [--dry-run]
 *     index     <engine> [--dry-run]
 *     dismiss   [--layer local|project] [--dry-run]
 *     verify    [--query <text>]
 *
 * Exit codes: 0 done, 1 failed or refused, 2 usage error or nothing measured.
 * An unknown engine is a usage error that lists the shipped ids; nothing is near-matched.
 */

import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { SHIPPED_ENGINE_IDS, type LayerName } from "../mcp/setup/check";
import { installEngine, indexEngine, upgradeEngine } from "./setup/install";
import { makeNodeSetupIo, type SetupContext, type SetupIo } from "./setup/io";
import { renderJson, renderText, usageError, type Outcome } from "./setup/report";
import { configure, dismiss } from "./setup/settings-writer";
import { status } from "./setup/status";
import { verify } from "./setup/verify";

export const USAGE = `Usage: setup.ts <subcommand> [args] [--json] [--project <dir>]

  status    [--deep] [--check-updates]
  install   <engine> [--dry-run]
  upgrade   <engine> [--dry-run]
  configure <engine|none> [--layer local|project|user] [--replace] [--dry-run]
  index     <engine> [--dry-run]
  dismiss   [--layer local|project] [--dry-run]
  verify    [--query <text>]

Engines: ${SHIPPED_ENGINE_IDS.join(", ")}
Exit codes: 0 done, 1 failed or refused, 2 usage error or nothing measured.
`;

const SUBCOMMANDS = ["status", "install", "upgrade", "configure", "index", "dismiss", "verify"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

/** Flags each subcommand accepts, beyond the global --json and --project. */
const ALLOWED: Readonly<Record<Subcommand, readonly string[]>> = {
  status: ["--deep", "--check-updates"],
  install: ["--dry-run"],
  upgrade: ["--dry-run"],
  configure: ["--layer", "--replace", "--dry-run"],
  index: ["--dry-run"],
  dismiss: ["--layer", "--dry-run"],
  verify: ["--query"],
};
const TAKES_VALUE = new Set(["--project", "--layer", "--query"]);
const BOOLEAN = new Set(["--json", "--deep", "--check-updates", "--dry-run", "--replace"]);

export interface Parsed {
  subcommand: Subcommand;
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: readonly string[]): Parsed | { error: string } | { help: true } {
  if (argv.length === 0) return { error: "no subcommand given" };
  if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") return { help: true };
  const [first, ...rest] = argv;
  if (!(SUBCOMMANDS as readonly string[]).includes(first ?? "")) {
    return { error: `unknown subcommand "${first ?? ""}"; expected one of ${SUBCOMMANDS.join(", ")}` };
  }
  const subcommand = first as Subcommand;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? "";
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const global = name === "--json" || name === "--project";
    if (!global && !ALLOWED[subcommand].includes(name)) {
      return { error: `${subcommand} does not take ${name}` };
    }
    if (flags.has(name)) return { error: `${name} given twice` };
    if (TAKES_VALUE.has(name)) {
      const value = eq === -1 ? rest[++i] : arg.slice(eq + 1);
      if (value === undefined || (eq === -1 && value.startsWith("--"))) return { error: `${name} needs a value` };
      flags.set(name, value);
    } else if (BOOLEAN.has(name)) {
      if (eq !== -1) return { error: `${name} takes no value` };
      flags.set(name, true);
    } else {
      return { error: `unknown flag ${name}` };
    }
  }
  return { subcommand, positional, flags };
}

function stringFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function layerFlag(parsed: Parsed, allowed: readonly LayerName[]): LayerName | undefined | { error: string } {
  const value = stringFlag(parsed, "--layer");
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as LayerName;
  return { error: `--layer must be one of ${allowed.join(", ")} for ${parsed.subcommand}, not "${value}"` };
}

/** Exactly one positional, from `choices`. Never near-matched. */
function onePositional(parsed: Parsed, what: string, choices: readonly string[]): string | { error: string } {
  if (parsed.positional.length === 0) return { error: `${parsed.subcommand} needs ${what}: one of ${choices.join(", ")}` };
  if (parsed.positional.length > 1) return { error: `${parsed.subcommand} takes one ${what}, got ${parsed.positional.join(" ")}` };
  const value = parsed.positional[0] ?? "";
  if (!choices.includes(value)) {
    return { error: `unknown ${what} "${value}"; this build ships: ${choices.join(", ")}` };
  }
  return value;
}

/**
 * The JSON identity of an outcome (A21): `command` is exactly the subcommand and `target`
 * the positional argument when one was given. Handlers label their summaries however
 * reads best ("install mnemex: …"); this is the one place the machine-readable fields
 * are set, so no handler can drift from the contract.
 */
export function stampOutcome(outcome: Outcome, subcommand: string, target: string | undefined): Outcome {
  const { command: _label, target: _target, ...rest } = outcome;
  return { command: subcommand, ...(target === undefined ? {} : { target }), ...rest };
}

export async function dispatch(parsed: Parsed, io: SetupIo, ctx: SetupContext): Promise<Outcome> {
  return stampOutcome(await route(parsed, io, ctx), parsed.subcommand, parsed.positional[0]);
}

async function route(parsed: Parsed, io: SetupIo, ctx: SetupContext): Promise<Outcome> {
  const dryRun = parsed.flags.get("--dry-run") === true;
  const usage = (message: string): Outcome => usageError(parsed.subcommand, message);
  const noPositional = (): Outcome | undefined =>
    parsed.positional.length > 0 ? usage(`${parsed.subcommand} takes no argument, got ${parsed.positional.join(" ")}`) : undefined;

  switch (parsed.subcommand) {
    case "status": {
      const extra = noPositional();
      if (extra !== undefined) return extra;
      return status(io, ctx, {
        deep: parsed.flags.get("--deep") === true,
        checkUpdates: parsed.flags.get("--check-updates") === true,
      });
    }
    case "install":
    case "upgrade": {
      const target = onePositional(parsed, "engine", SHIPPED_ENGINE_IDS);
      if (typeof target !== "string") return usage(target.error);
      return parsed.subcommand === "install"
        ? installEngine(io, ctx, target, { dryRun })
        : upgradeEngine(io, ctx, target, { dryRun });
    }
    case "configure": {
      const target = onePositional(parsed, "engine", [...SHIPPED_ENGINE_IDS, "none"]);
      if (typeof target !== "string") return usage(target.error);
      const layer = layerFlag(parsed, ["local", "project", "user"]);
      if (typeof layer === "object") return usage(layer.error);
      return configure(io, ctx, target, {
        dryRun,
        replace: parsed.flags.get("--replace") === true,
        ...(layer === undefined ? {} : { layer }),
      });
    }
    case "index": {
      const target = onePositional(parsed, "engine", SHIPPED_ENGINE_IDS);
      if (typeof target !== "string") return usage(target.error);
      return indexEngine(io, ctx, target, { dryRun });
    }
    case "dismiss": {
      const extra = noPositional();
      if (extra !== undefined) return extra;
      // Never the user file: a dismissal is about THIS project.
      const layer = layerFlag(parsed, ["local", "project"]);
      if (typeof layer === "object") return usage(layer.error);
      return dismiss(io, ctx, { dryRun, ...(layer === undefined ? {} : { layer: layer as "local" | "project" }) });
    }
    case "verify": {
      const extra = noPositional();
      if (extra !== undefined) return extra;
      const query = stringFlag(parsed, "--query");
      return verify(io, ctx, query === undefined ? {} : { query });
    }
  }
}

/** Runs one invocation and returns its exit code. Output goes through `io` only. */
export async function main(argv: readonly string[], io: SetupIo, pluginRoot: string): Promise<number> {
  const parsed = parseArgs(argv);
  const json = argv.includes("--json");
  const emit = (outcome: Outcome): number => {
    if (json) io.stdout(renderJson(outcome));
    else if (outcome.ok) io.stdout(renderText(outcome));
    else io.stderr(renderText(outcome));
    return outcome.exitCode;
  };

  if ("help" in parsed) {
    io.stdout(USAGE);
    return 0;
  }
  if ("error" in parsed) {
    if (!json) io.stderr(USAGE);
    // The arguments did not parse, so no positional is known: `target` is omitted.
    return emit(stampOutcome(usageError(argv[0] ?? "", parsed.error), argv[0] ?? "", undefined));
  }

  const home = io.env["HOME"] ?? homedir();
  const projectFlag = stringFlag(parsed, "--project");
  const declared = io.env["CLAUDE_PROJECT_DIR"];
  const projectDir = resolve(
    io.cwd(),
    projectFlag ?? (declared !== undefined && declared !== "" ? declared : io.cwd()),
  );
  const ctx: SetupContext = { pluginRoot, projectDir, home };

  try {
    return emit(await dispatch(parsed, io, ctx));
  } catch (error) {
    // A programmer error: say so plainly, with the stack, and do not dress it as a refusal.
    io.stderr(`setup.ts: internal error in ${parsed.subcommand}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return 1;
  }
}

/** This file lives in `<root>/scripts/`. */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), makeNodeSetupIo(), PLUGIN_ROOT);
}
