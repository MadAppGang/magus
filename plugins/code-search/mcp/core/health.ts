/**
 * health.ts — pure assessors for ripgrep/shim/engine health.
 *
 * NO PRODUCTION CALLER since code-search 8.2.0: setup stopped checking the ripgrep shim,
 * because the shim runs the host's own embedded ripgrep and never reaches an engine
 * (ai-docs/code-search-ripgrep-shim-and-adoption.md). `assessRipgrep` and its tests stay
 * until the next iteration decides whether the shim goes or gets a real job.
 *
 * This module spawns nothing and reads no file. A caller runs plain `claude doctor`,
 * looks `rg` up on PATH and takes `type rg` from its shell, and hands the captured text
 * in as `RipgrepEvidence`. That is what makes the three
 * states that break silently — a setting that prefers a system rg with no shim
 * installed, a foreign shim, and a Bash shell function shadowing the file — testable at
 * all.
 *
 * USE_BUILTIN_RIPGREP is a soft PREFERENCE, never routing: the host treats
 * `0|false|no|off` as "prefer a system rg" and silently falls through to its embedded
 * copy when the PATH lookup finds nothing. Any check that infers routing from the
 * setting is wrong, which is why `mode` comes from the doctor's `Search:` line and the
 * setting appears only as `settingPrefersSystem`.
 */

import { CAPABILITIES } from "./capabilities";
import type { CapabilityStatus } from "./capabilities";
import type { BackendHealth, BackendNote } from "./ports";
import type { LayerReport } from "./settings";
import type { ProbeResult } from "./registry";
import { SETUP_COMMAND } from "./setup-state";

export interface RipgrepStatus {
  working: boolean;
  mode: "system" | "embedded" | "unknown";
  systemPath?: string;
}

/**
 * Who wrote the shim at `~/.local/bin/rg`, read from its `OWNER=` header.
 *
 *   code-search    ours
 *   code-analysis  ours too, written before the plugin was renamed (2026-09-15): it routes
 *                  Grep, and is always outdated
 *   mnemex         a sibling's shim that also routes Grep
 *   foreign        anything else, including no OWNER= at all; never overwritten
 *   none           no file
 */
export type ShimOwner = "code-search" | "code-analysis" | "mnemex" | "foreign" | "none";

export interface ShimReport {
  path: string;
  present: boolean;
  owner: ShimOwner;
  version?: string;
  /** What `command -v rg` resolved to, when different from `path`. */
  shadowedBy?: string;
  /** True when `type rg` reports a shell function. */
  functionShadowed: boolean;
  /** settings say USE_BUILTIN_RIPGREP is 0|false|no|off. A PREFERENCE, never routing. */
  settingPrefersSystem: boolean;
  /** A repair happened this session; USE_BUILTIN_RIPGREP is read at host startup. */
  restartRequired: boolean;
}

/** Everything is pre-captured text. This module spawns nothing and reads no file. */
export interface RipgrepEvidence {
  /** The stdout of plain `claude doctor`, or undefined when it was not run. There is no
   *  `--json` (Claude Code 2.1.283: `error: unknown option '--json'`); the one line read
   *  is `Search: OK (<path>)` or `Search: OK (bundled)`. */
  doctorText: string | undefined;
  shimPath: string;
  shimHeader?: string; // first ~5 lines of the shim, when present
  commandVRg?: string; // `command -v rg`
  typeRg?: string; // `type rg`
  settingPrefersSystem: boolean;
  repairedThisSession: boolean;
}

export interface FacadeHealth {
  engineId?: string;
  engine?: BackendHealth;
  settingsLayers: readonly LayerReport[];
  ripgrep?: RipgrepStatus;
  shim?: ShimReport;
  notes: readonly BackendNote[];
}

export function assessRipgrep(e: RipgrepEvidence): {
  ripgrep: RipgrepStatus;
  shim: ShimReport;
  notes: BackendNote[];
} {
  const ripgrep = readRipgrepStatus(e.doctorText);
  const owner = readOwner(e.shimHeader);
  const resolved = e.commandVRg?.trim();

  const shim: ShimReport = {
    path: e.shimPath,
    present: e.shimHeader !== undefined,
    owner,
    functionShadowed: /\bfunction\b/u.test(e.typeRg ?? ""),
    settingPrefersSystem: e.settingPrefersSystem,
    restartRequired: e.repairedThisSession,
  };
  const version = readHeaderField(e.shimHeader, "VERSION");
  if (version !== undefined) shim.version = version;
  if (resolved !== undefined && resolved !== "" && resolved !== e.shimPath) {
    shim.shadowedBy = resolved;
  }

  const notes: BackendNote[] = [];

  // The live dead state worth auto-recovering: the setting says "prefer a system rg"
  // and the file it points at does not exist, so Grep silently uses the embedded copy
  // and every search looks like it worked.
  if (shim.settingPrefersSystem && !shim.present) {
    notes.push({
      level: "degraded",
      code: "grep_routing",
      message: `USE_BUILTIN_RIPGREP prefers a system ripgrep but ${shim.path} does not exist, so Grep silently falls back to the embedded copy.`,
      remedy: SETUP_COMMAND,
    });
  }

  if (shim.owner === "foreign") {
    notes.push({
      level: "degraded",
      code: "grep_routing",
      message: `${shim.path} carries an owner marker this plugin does not recognise; it will not be overwritten.`,
      remedy: `Inspect ${shim.path} and remove it yourself if it is no longer wanted, then run ${SETUP_COMMAND}.`,
    });
  }

  if (shim.shadowedBy !== undefined) {
    notes.push({
      level: "degraded",
      code: "grep_routing",
      message: `rg resolves to ${shim.shadowedBy}, not ${shim.path}; PATH order puts another rg first.`,
      remedy: `Put the directory containing ${shim.path} earlier on PATH.`,
    });
  }

  if (shim.functionShadowed) {
    notes.push({
      level: "degraded",
      code: "grep_routing",
      message:
        "In Bash, rg is a shell function defined by the host's shell snapshot, and a function beats PATH.",
      remedy: `Run ${SETUP_COMMAND} to reinstall the shim so the snapshot's guard finds an rg and defines no function.`,
    });
  }

  if (shim.restartRequired) {
    notes.push({
      level: "info",
      code: "grep_routing",
      message:
        "Grep routing was repaired this session. USE_BUILTIN_RIPGREP is read at host startup, so restart Claude Code before trusting that routing is live.",
      remedy: "Restart Claude Code.",
    });
  }

  return { ripgrep, shim, notes };
}

export function summariseEngineHealth(probe: ProbeResult): BackendNote[] {
  if (!probe.ok) {
    const note: BackendNote = {
      level: "error",
      code: "backend_unavailable",
      message: probe.reason,
    };
    if (probe.remedy !== undefined) note.remedy = probe.remedy;
    return [note];
  }

  const notes: BackendNote[] = [];
  for (const capability of CAPABILITIES) {
    const status: CapabilityStatus | undefined = probe.health.capabilities[capability];
    if (status === undefined || status.ready) continue;
    // retryable is the whole distinction: a permanent incapacity delists the tool and
    // means "stop asking"; a retryable one keeps it listed and means "fix or wait".
    const note: BackendNote = status.retryable
      ? {
          level: "degraded",
          code: "backend_unavailable",
          message: `${capability} is unavailable right now: ${status.reason}`,
        }
      : {
          level: "error",
          code: "capability_unsupported",
          message: `${probe.health.engineId} cannot answer ${capability} for this project: ${status.reason}`,
        };
    if (status.remedy !== undefined) note.remedy = status.remedy;
    notes.push(note);
  }
  return notes;
}

/**
 * A health record for an engine that could not be probed at all. Every capability is
 * `retryable: true` DELIBERATELY: a failed probe must never shrink the tool list, or a
 * transient outage would look like a permanent incapacity and the agent would stop
 * asking for good.
 */
export function emptyHealth(engineId: string, reason: string, remedy?: string): BackendHealth {
  const status: CapabilityStatus =
    remedy === undefined
      ? { ready: false, reason, retryable: true }
      : { ready: false, reason, remedy, retryable: true };

  const capabilities = {} as BackendHealth["capabilities"];
  for (const capability of CAPABILITIES) capabilities[capability] = status;
  return { engineId, capabilities };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The host's own ripgrep routing, read off the one line `claude doctor` prints for it.
 *
 * The 2.1.283 format string is
 *   `Search: ${working ? "OK" : "Not working"} (${mode === "embedded" ? "bundled" : systemPath || "system"})`
 * so the parenthesis is either `bundled` (the embedded copy) or the rg that won the PATH
 * lookup. The path may be printed with a leading `~`; callers compare after expanding it.
 *
 * Another program's human output: read defensively. A missing or reworded line is
 * `unknown`, never a throw, so an upgrade that changes the wording degrades the report
 * instead of taking the check down.
 */
export function readRipgrepStatus(doctorText: string | undefined): RipgrepStatus {
  if (doctorText === undefined) return { working: false, mode: "unknown" };
  // Colour codes, should a future build emit them without a TTY.
  const plain = doctorText.replace(/\u001b\[[0-9;]*m/gu, "");
  const match = /\bSearch:[^\S\n]*(OK|Not working)[^\S\n]*\((.*)\)[^\S\n]*$/mu.exec(plain);
  if (match === null) return { working: false, mode: "unknown" };

  const working = match[1] === "OK";
  const inside = (match[2] ?? "").trim();
  if (inside === "bundled") return { working, mode: "embedded" };
  if (inside === "" || inside === "system") return { working, mode: "system" };
  return { working, mode: "system", systemPath: inside };
}

/** The shim's header names its owner, so ours (under either name) can be told from
 *  mnemex's and from a stranger's. */
export function readOwner(header: string | undefined): ShimOwner {
  if (header === undefined) return "none";
  const owner = readHeaderField(header, "OWNER");
  if (owner === "code-search") return "code-search";
  if (owner === "code-analysis") return "code-analysis";
  if (owner === "mnemex") return "mnemex";
  return "foreign";
}

/** One `FIELD=value` out of the shim header (`OWNER=`, `VERSION=`). */
export function readHeaderField(header: string | undefined, field: string): string | undefined {
  if (header === undefined) return undefined;
  const match = new RegExp(`\\b${field}=([A-Za-z0-9._-]+)`, "u").exec(header);
  return match?.[1];
}
