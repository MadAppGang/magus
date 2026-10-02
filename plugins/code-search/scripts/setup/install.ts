/**
 * install.ts — `install <engine>`, `upgrade <engine>`, `index <engine>`.
 *
 * Every command is an argv array from `mcp/adapters/catalog.ts`, run with no shell. No
 * `curl | sh` exists anywhere: when the package manager itself is missing, the answer is
 * `prerequisite_missing` with the page that explains how to install it, and the user
 * decides.
 *
 * Upgrades go through the INSTALLING package manager (npm for codegraph, not
 * `codegraph upgrade`), and only when the binary on PATH lives in that manager's own bin
 * directory — asked of the manager (`npm prefix -g`, `bun pm bin -g`, `uv tool dir --bin`),
 * never assumed. A binary anywhere else was installed some other way, and upgrading
 * through this manager would leave that one on PATH: `installed_elsewhere`.
 */

import { dirname, join } from "node:path";

import {
  PREREQUISITES,
  catalogEntry,
  shellQuote,
  withProjectDir,
  type CatalogEntry,
  type PackageManager,
} from "../../mcp/adapters/catalog";
import {
  extrasRecorded,
  parseVersionLine,
  setupCliCommand,
  whichOnPath,
  type RunResult,
} from "../../mcp/setup/check";
import type { SetupContext, SetupIo } from "./io";
import { failed, processFailure, processSucceeded, type Outcome } from "./report";

/**
 * Deadline for an install, upgrade or index run. Under the ten minutes the guided skill
 * gives its Bash call, so this CLI reports the R8 failure itself instead of being killed
 * mid-sentence by the caller.
 */
export const LONG_RUN_TIMEOUT_MS = 540_000;
const QUERY_TIMEOUT_MS = 30_000;
const VERSION_TIMEOUT_MS = 15_000;

export interface RunFlags {
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

export async function installEngine(io: SetupIo, ctx: SetupContext, id: string, flags: RunFlags): Promise<Outcome> {
  const command = `install ${id}`;
  const entry = mustEntry(id);
  const planned = shellQuote(entry.install);

  const prerequisite = checkPrerequisite(io, command, entry, planned);
  if (prerequisite !== undefined) return prerequisite;

  const missing = missingBinaries(io, entry);
  // A binary on PATH is not proof: graphify's server script exists without its [mcp]
  // extra, and only uv's receipt says whether the extra is there.
  const first = entry.binaries[0];
  const firstPath = first === undefined ? undefined : whichOnPath(first, io.env["PATH"], io);
  if (firstPath !== undefined && extrasRecorded(entry, firstPath, ctx.home, io) === false) {
    missing.push(`${entry.package.name}[${(entry.package.extras ?? []).join(",")}]`);
  }
  if (missing.length === 0) {
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: `${id} is already installed (${entry.binaries.map((b) => whichOnPath(b, io.env["PATH"], io)).join(", ")}); nothing to do.`,
      actions: [],
      data: { installed: true, changed: false },
      details: [`To move to the latest release: ${setupCliCommand(ctx.pluginRoot, ["upgrade", id])}`],
    };
  }

  if (flags.dryRun) {
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: `${command}: would run ${planned} (missing: ${missing.join(", ")}).`,
      dryRun: true,
      actions: [planned],
      data: { installed: false, missing },
    };
  }

  // cwd = HOME: a project's own .npmrc or bunfig.toml must not redirect a global install.
  const result = await io.run(entry.install, { cwd: ctx.home, timeoutMs: LONG_RUN_TIMEOUT_MS });
  if (!processSucceeded(result)) {
    return failed(
      command,
      {
        code: "install_failed",
        message: `${planned} did not succeed.`,
        remedy: `Run it yourself to see the whole output: ${planned}`,
        process: processFailure(entry.install, result),
      },
      { actions: [planned] },
    );
  }

  const installedPath = first === undefined ? undefined : whichOnPath(first, io.env["PATH"], io);
  if (installedPath !== undefined && extrasRecorded(entry, installedPath, ctx.home, io) === false) {
    return failed(
      command,
      {
        code: "extras_missing",
        message: `${planned} succeeded, but uv's receipt still does not record the [${(entry.package.extras ?? []).join(",")}] extra.`,
        remedy: `uv tool uninstall ${entry.package.name}, then ${planned}`,
      },
      { actions: [planned] },
    );
  }
  const stillMissing = missingBinaries(io, entry);
  if (stillMissing.length > 0) {
    const binDir = await packageManagerBinDir(io, entry.packageManager);
    return failed(
      command,
      {
        code: "not_on_path",
        message:
          `${planned} succeeded, but ${stillMissing.join(", ")} ${stillMissing.length === 1 ? "is" : "are"} not on PATH` +
          (binDir.dir === undefined ? "." : `; ${entry.packageManager} puts binaries in ${binDir.dir}.`),
        remedy:
          binDir.dir === undefined
            ? `Find where ${entry.packageManager} installed ${stillMissing.join(", ")} and add that directory to PATH.`
            : `Add ${binDir.dir} to PATH, then restart Claude Code.`,
      },
      { actions: [planned] },
    );
  }

  return {
    command,
    ok: true,
    exitCode: 0,
    summary: `Installed ${id}: ${entry.binaries.map((b) => whichOnPath(b, io.env["PATH"], io)).join(", ")}.`,
    actions: [planned],
    data: { installed: true, changed: true },
    details: [`Next: ${setupCliCommand(ctx.pluginRoot, ["configure", id])}`],
  };
}

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------

export async function upgradeEngine(io: SetupIo, ctx: SetupContext, id: string, flags: RunFlags): Promise<Outcome> {
  const command = `upgrade ${id}`;
  const entry = mustEntry(id);
  const planned = shellQuote(entry.upgrade);

  const prerequisite = checkPrerequisite(io, command, entry, planned);
  if (prerequisite !== undefined) return prerequisite;

  const binary = entry.binaries[0];
  const found = binary === undefined ? undefined : whichOnPath(binary, io.env["PATH"], io);
  if (binary === undefined || found === undefined) {
    return failed(command, {
      code: "not_installed",
      message: `${binary ?? id} is not on PATH, so there is nothing to upgrade.`,
      remedy: setupCliCommand(ctx.pluginRoot, ["install", id]),
    });
  }

  const binDir = await packageManagerBinDir(io, entry.packageManager);
  if (binDir.dir === undefined) {
    return failed(command, {
      code: "bin_dir_unknown",
      message: `Could not ask ${entry.packageManager} for its bin directory, so ${found} cannot be proved to be its install.`,
      remedy: `Upgrade it yourself: ${planned}`,
      ...(binDir.failure === undefined ? {} : { process: binDir.failure }),
    });
  }
  if (!sameDir(dirname(found), binDir.dir, io)) {
    return failed(command, {
      code: "installed_elsewhere",
      message:
        `${binary} on PATH is ${found}, outside ${entry.packageManager}'s bin directory ${binDir.dir}; ` +
        `upgrading through ${entry.packageManager} would leave that one in place.`,
      remedy: `Upgrade ${binary} the way it was installed, or remove ${found} and run ${setupCliCommand(ctx.pluginRoot, ["install", id])}`,
      path: found,
    });
  }

  const before = await engineVersion(io, ctx, entry);
  if (flags.dryRun) {
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: `${command}: would run ${planned} (installed: ${before ?? "version unknown"}, at ${found}).`,
      dryRun: true,
      actions: [planned],
      data: { path: found, binDir: binDir.dir, ...(before === undefined ? {} : { before }) },
    };
  }

  const result = await io.run(entry.upgrade, { cwd: ctx.home, timeoutMs: LONG_RUN_TIMEOUT_MS });
  if (!processSucceeded(result)) {
    return failed(
      command,
      {
        code: "upgrade_failed",
        message: `${planned} did not succeed.`,
        remedy: `Run it yourself to see the whole output: ${planned}`,
        process: processFailure(entry.upgrade, result),
      },
      { actions: [planned] },
    );
  }

  const after = await engineVersion(io, ctx, entry);
  return {
    command,
    ok: true,
    exitCode: 0,
    summary: `Upgraded ${id}: ${before ?? "?"} -> ${after ?? "?"}.`,
    actions: [planned],
    restartRequired: true,
    data: {
      path: found,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    },
  };
}

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

export async function indexEngine(io: SetupIo, ctx: SetupContext, id: string, flags: RunFlags): Promise<Outcome> {
  const command = `index ${id}`;
  const entry = mustEntry(id);
  const step = entry.projectStep;
  if (step === undefined) {
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: `${id} has no per-project step; nothing to do.`,
      actions: [],
      data: { step: false },
    };
  }

  const argv = withProjectDir([...step.argv, ...(step.unattended ?? [])], ctx.projectDir);
  const planned = shellQuote(argv);
  const marker = join(ctx.projectDir, step.marker);
  const gitignore = `${step.marker.split("/")[0] ?? step.marker}/`;

  const binary = argv[0];
  if (binary === undefined || whichOnPath(binary, io.env["PATH"], io) === undefined) {
    return failed(command, {
      code: "engine_missing",
      message: `${binary ?? id} is not on PATH, so ${id} cannot index this project.`,
      remedy: setupCliCommand(ctx.pluginRoot, ["install", id]),
    });
  }

  if (flags.dryRun) {
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: `${command}: would run ${planned} in ${ctx.projectDir}.`,
      dryRun: true,
      actions: [`cd ${shellQuote([ctx.projectDir])} && ${planned}`],
      details: [`Cost: ${step.cost}`],
      data: { marker, gitignore, cost: step.cost },
    };
  }

  const result = await io.run(argv, { cwd: ctx.projectDir, timeoutMs: LONG_RUN_TIMEOUT_MS });
  if (!processSucceeded(result)) {
    return failed(
      command,
      {
        code: "index_failed",
        message: `${planned} did not succeed in ${ctx.projectDir}.`,
        remedy: `Run it yourself in the project to see the whole output: ${planned}`,
        process: processFailure(argv, result),
      },
      { actions: [planned] },
    );
  }
  if (io.kind(marker) === "missing") {
    return failed(
      command,
      {
        code: "index_marker_missing",
        message: `${planned} exited 0, but ${step.marker} was not created.`,
        remedy: `Run it yourself in the project and read its output: ${planned}`,
        path: marker,
        process: processFailure(argv, result),
      },
      { actions: [planned] },
    );
  }

  return {
    command,
    ok: true,
    exitCode: 0,
    summary: `Indexed this project with ${id}: ${step.marker} exists.`,
    actions: [planned],
    data: { marker, gitignore },
    details: [`Consider adding ${gitignore} to .gitignore: it is generated and machine-specific.`],
  };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function mustEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  // The argument parser rejects unknown ids with exit 2 before a handler runs.
  if (entry === undefined) throw new TypeError(`${id} is not a catalog id`);
  return entry;
}

function checkPrerequisite(io: SetupIo, command: string, entry: CatalogEntry, planned: string): Outcome | undefined {
  const prerequisite = PREREQUISITES[entry.packageManager];
  if (whichOnPath(prerequisite.binary, io.env["PATH"], io) !== undefined) return undefined;
  return failed(
    command,
    {
      code: "prerequisite_missing",
      message: `${prerequisite.binary} is not on PATH, and ${command.split(" ")[1] ?? "this engine"} installs through it.`,
      remedy: `Install ${prerequisite.binary} yourself (${prerequisite.docsUrl}), then run this again.`,
    },
    { planned: [planned] },
  );
}

function missingBinaries(io: SetupIo, entry: CatalogEntry): string[] {
  return entry.binaries.filter((binary) => whichOnPath(binary, io.env["PATH"], io) === undefined);
}

/** The first line of the version probe, parsed. undefined when it cannot be read. */
async function engineVersion(io: SetupIo, ctx: SetupContext, entry: CatalogEntry): Promise<string | undefined> {
  const result = await io.run(entry.versionProbe.argv, { cwd: ctx.home, timeoutMs: VERSION_TIMEOUT_MS });
  if (result.spawnError !== undefined) return undefined;
  return parseVersionLine(result.stdout, entry.versionProbe.pattern);
}

/** Where the package manager puts global binaries, as the manager itself reports it. */
export async function packageManagerBinDir(
  io: SetupIo,
  manager: PackageManager,
): Promise<{ dir?: string; failure?: ReturnType<typeof processFailure> }> {
  const argv: readonly string[] =
    manager === "npm" ? ["npm", "prefix", "-g"] : manager === "bun" ? ["bun", "pm", "bin", "-g"] : ["uv", "tool", "dir", "--bin"];
  const result: RunResult = await io.run(argv, { timeoutMs: QUERY_TIMEOUT_MS });
  if (!processSucceeded(result)) return { failure: processFailure(argv, result) };
  const line = result.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (line === "") return { failure: processFailure(argv, result) };
  // `npm prefix -g` names the prefix; its binaries live in <prefix>/bin on POSIX.
  return { dir: manager === "npm" ? join(line, "bin") : line };
}

function sameDir(a: string, b: string, io: SetupIo): boolean {
  if (a === b) return true;
  const ra = io.realpath(a);
  return ra !== undefined && ra === io.realpath(b);
}
