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
 */

import { checkSetup, type SetupReport } from "../../mcp/setup/check";
import type { SetupContext, SetupIo } from "./io";
import type { Outcome } from "./report";

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

  return {
    command: "status",
    ok: true,
    exitCode: 0,
    summary: `code-search setup: ${report.headline} (${ctx.projectDir})`,
    details: describe(report),
    data: { report },
  };
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
