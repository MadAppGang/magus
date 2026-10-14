/**
 * health.ts — pure assessors for engine health, and the record `renderHealth` prints.
 *
 * This module spawns nothing and reads no file: a caller probes the engine and hands the
 * result in.
 */

import { CAPABILITIES } from "./capabilities";
import type { CapabilityStatus } from "./capabilities";
import type { BackendHealth, BackendNote } from "./ports";
import type { LayerReport } from "./settings";
import type { ProbeResult } from "./registry";

export interface FacadeHealth {
  engineId?: string;
  engine?: BackendHealth;
  settingsLayers: readonly LayerReport[];
  notes: readonly BackendNote[];
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
