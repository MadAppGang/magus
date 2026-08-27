/**
 * health.ts — pure assessors for ripgrep/shim/engine health.
 *
 * This module spawns nothing and reads no file. `server.ts` runs `claude doctor
 * --json`, `command -v rg` and `type rg`, and hands the captured text in as
 * `RipgrepEvidence`. That is what makes the three states that break silently —
 * a setting that prefers a system rg with no shim installed, a foreign shim, and a
 * Bash shell function shadowing the file — testable at all.
 *
 * USE_BUILTIN_RIPGREP is a soft PREFERENCE, never routing: the host treats
 * `0|false|no|off` as "prefer a system rg" and silently falls through to its embedded
 * copy when the PATH lookup finds nothing. Any check that infers routing from the
 * setting is wrong, which is why `mode` comes from `ripgrepStatus` and the setting
 * appears only as `settingPrefersSystem`.
 */

import { CAPABILITIES } from "./capabilities";
import type { CapabilityStatus } from "./capabilities";
import type { BackendHealth, BackendNote } from "./ports";
import type { LayerReport } from "./settings";
import type { ProbeResult } from "./registry";

export interface RipgrepStatus {
  working: boolean;
  mode: "system" | "embedded" | "unknown";
  systemPath?: string;
}

export type ShimOwner = "code-analysis" | "mnemex" | "foreign" | "none";

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
  doctorJson: unknown; // `claude doctor --json`, already parsed
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

const SETUP_COMMAND = "/code-analysis:setup";

export function assessRipgrep(e: RipgrepEvidence): {
  ripgrep: RipgrepStatus;
  shim: ShimReport;
  notes: BackendNote[];
} {
  const ripgrep = readRipgrepStatus(e.doctorJson);
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

function readRipgrepStatus(doctorJson: unknown): RipgrepStatus {
  const status = asRecord(asRecord(doctorJson)?.["ripgrepStatus"]);
  if (status === undefined) return { working: false, mode: "unknown" };

  const working = status["working"] === true;
  const rawMode = status["mode"];
  const mode: RipgrepStatus["mode"] =
    rawMode === "system" || rawMode === "embedded" ? rawMode : "unknown";
  const out: RipgrepStatus = { working, mode };
  const systemPath = status["systemPath"];
  if (typeof systemPath === "string" && systemPath !== "") out.systemPath = systemPath;
  return out;
}

/** `claude doctor --json` is another program's output shape: read it defensively or
 *  an upgrade that renames a field takes the server down instead of degrading. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** The shim's header names its owner so setup can tell ours from mnemex's from a
 *  stranger's, and refuse to clobber the stranger. */
function readOwner(header: string | undefined): ShimOwner {
  if (header === undefined) return "none";
  const owner = readHeaderField(header, "OWNER");
  if (owner === "code-analysis") return "code-analysis";
  if (owner === "mnemex") return "mnemex";
  return "foreign";
}

function readHeaderField(header: string | undefined, field: string): string | undefined {
  if (header === undefined) return undefined;
  const match = new RegExp(`\\b${field}=([A-Za-z0-9._-]+)`, "u").exec(header);
  return match?.[1];
}
