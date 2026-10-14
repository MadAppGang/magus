/**
 * status.ts — `status [--deep] [--check-updates]`.
 *
 * A thin shell over `mcp/setup/check.ts`, the one evaluator: this file decides nothing
 * about state, it only runs the check with the CLI's IO and prints the answer. Plain
 * `status` is the fast path (no process, no network), the same check the SessionStart
 * hook runs.
 *
 * Exit 0 whenever the project was measured, whatever state it is in — "unconfigured" is
 * an answer, not a failure. Exit 2 when nothing could be measured.
 *
 * It also reports the Bash `grep` route (`grepRoute`): the same gate the SessionStart hook
 * evaluates, the summary line setup shows the user, `oracle unavailable` when no binary
 * can list the files grep would search, and the 8.1 `rg` shim (rg-shim-removal.ts). These
 * are reports only; none of them is part of the setup state or its headline.
 */

import { settingsLayerPaths } from "../../mcp/core/settings";
import { combineGateEnv, gateSettings, mergeGate } from "../../mcp/grep/gate";
import { resolveOracleBin } from "../../mcp/grep/port";
import { checkSetup, type SetupReport } from "../../mcp/setup/check";
import type { SetupContext, SetupIo } from "./io";
import type { Outcome } from "./report";
import { RG_SHIM_COMMAND, rgShimReport } from "./rg-shim-removal";

/**
 * The one line setup states about the Bash `grep` route once an engine is configured. Its
 * last two sentences are the known limit (the Bash sandbox) and the disclosure (Read deny
 * rules are not applied); both must survive any rewording.
 */
export const GREP_ROUTE_SUMMARY =
  "Bash `grep` appends related locations from the index, starting with your next session. " +
  "To start now: reconnect `ca` in `/mcp`, then run `/clear`. " +
  "Turn it off with `grep.route: false` in settings, or `CODE_SEARCH_MERGE=0` on one command. " +
  "It does not run inside Claude Code's Bash sandbox. " +
  "The block may name files that a Read deny rule hides from the Grep tool.";

const GATE_OFF_TEXT: Readonly<Record<string, string>> = {
  win32: "not available on Windows",
  "kill-switch": 'CODE_SEARCH_MERGE is "0"',
  "route-off": "grep.route is false in settings",
  "no-engine": "no engine is configured",
};

export interface GrepRouteReport {
  /** `open`, or why the route is off (`mergeGate`'s reason). */
  gate: string;
  /** `GREP_ROUTE_SUMMARY`, present exactly when the gate is open. */
  summary?: string;
  /** `oracle unavailable: <candidates>`, present when the gate is open and D13 found nothing. */
  oracleUnavailable?: string;
  /** The 8.1 shim finding, when that shim is installed. */
  rgShim?: string;
  /** The `USE_BUILTIN_RIPGREP` line, when the user layer says "0" and no marked shim exists. */
  ripgrepEnv?: string;
}

export function grepRouteReport(io: SetupIo, ctx: SetupContext, report: SetupReport): GrepRouteReport {
  const s = gateSettings(settingsLayerPaths(ctx.home, ctx.projectDir).map((path) => io.readText(path)));
  const closed = mergeGate({
    platform: process.platform,
    env: combineGateEnv(io.env, s.env),
    route: s.route,
    // gate.ts's one definition (review round 1, internal M3), not `report.engine`: an
    // engine id with no `engines` entry never binds a server.
    engineConfigured: s.engineConfigured,
  });
  const out: GrepRouteReport = { gate: closed ?? "open" };
  if (closed === undefined) {
    out.summary = GREP_ROUTE_SUMMARY;
    const oracle = resolveOracleBin(io.env);
    if (oracle.bin === undefined) out.oracleUnavailable = `oracle unavailable: ${oracle.tried.join(", ")}`;
  }
  const shim = rgShimReport(io, ctx);
  if (shim.finding !== undefined) out.rgShim = shim.finding;
  if (shim.envWithoutShim !== undefined) out.ripgrepEnv = shim.envWithoutShim;
  return out;
}

export interface StatusFlags {
  deep: boolean;
  checkUpdates: boolean;
}

export async function status(io: SetupIo, ctx: SetupContext, flags: StatusFlags): Promise<Outcome> {
  if (io.kind(ctx.projectDir) !== "directory") {
    return {
      command: "status",
      ok: false,
      exitCode: 2,
      summary: `${ctx.projectDir} is not a directory; nothing was measured.`,
      failure: {
        code: "project_missing",
        message: `${ctx.projectDir} is not a directory; nothing was measured.`,
        remedy: "Pass the project root with --project <dir>.",
      },
    };
  }

  const report = await checkSetup(
    {
      pluginRoot: ctx.pluginRoot,
      projectDir: ctx.projectDir,
      home: ctx.home,
      deep: flags.deep,
      checkUpdates: flags.checkUpdates,
    },
    io,
  );

  const grepRoute = grepRouteReport(io, ctx, report);
  return {
    command: "status",
    ok: true,
    exitCode: 0,
    summary: `code-search setup: ${report.headline} (${ctx.projectDir})`,
    details: [...describe(report), ...describeGrepRoute(grepRoute)],
    data: { report, grepRoute },
  };
}

function describeGrepRoute(route: GrepRouteReport): string[] {
  const lines = [route.summary ?? `Bash \`grep\` route: off (${GATE_OFF_TEXT[route.gate] ?? route.gate}).`];
  if (route.oracleUnavailable !== undefined) lines.push(route.oracleUnavailable);
  if (route.rgShim !== undefined) lines.push(`${route.rgShim}; remove it with: ${RG_SHIM_COMMAND}`);
  if (route.ripgrepEnv !== undefined) lines.push(route.ripgrepEnv);
  return lines;
}

function describe(report: SetupReport): string[] {
  const lines: string[] = [];

  if (report.findings.length === 0) lines.push("Findings: none.");
  else lines.push("Findings:");
  for (const finding of report.findings) {
    lines.push(`  [${finding.level}] ${finding.code}: ${finding.message}`);
    if (finding.remedy !== undefined) lines.push(`      remedy: ${finding.remedy}`);
  }

  lines.push("Settings layers (later wins):");
  for (const layer of report.layers) lines.push(`  ${layer.status.padEnd(11)} ${layer.path}`);
  lines.push(
    `  engine: ${report.engine === undefined ? "(unset)" : JSON.stringify(report.engine)}; setup: ${report.setup ?? "(unset)"}; ` +
      `plugin enabled in: ${report.enabledIn.length === 0 ? "(no layer)" : report.enabledIn.join(", ")}`,
  );

  const engine = report.engineReport;
  if (engine !== undefined) {
    const parts = [`Engine ${engine.id}:`];
    parts.push(engine.commandPath === undefined ? `${engine.command ?? "command"} not on PATH` : `${engine.commandPath}`);
    if (engine.extrasRecorded !== undefined) parts.push(`extras ${engine.extrasRecorded ? "recorded" : "MISSING"}`);
    if (engine.indexMarker !== undefined) parts.push(`index ${engine.indexed === true ? "present" : "absent"} (${engine.indexMarker})`);
    if (engine.version !== undefined) parts.push(`version ${engine.version}`);
    if (engine.latest !== undefined) parts.push(`latest ${engine.latest}`);
    lines.push(parts.join("  "));
  }

  if (report.advice !== undefined) lines.push("", report.advice.full);
  return lines;
}
