import type {
  OrchestratorIdentity, OrchestratorProgress, OrchestratorRecord,
  OrchestratorClaim,
} from "../scripts/lib/state-core";
import type { OrchestratorRow } from "../types";

// These paths belong only to the fake machine; real-process tests use mkdtemp.
export const ROOT = ["", "orchestrator-testdata"].join("/");
export const PRODUCT = ROOT + "/product";
export const NOW = Date.UTC(2026, 10, 8, 12, 39, 30);
export const START = "Sun Nov  8 12:39:30 2026";
export const LATER_START = "Sun Nov  8 12:49:30 2026";
export const SELF = "self0001";
export const TRIAGE = "t-000000000001";
export const MANAGER = "l-000000000002";
export const CHILD = "l-000000000003";
export const TICKET = { id: "example/product#7", url: "https://github.com/example/product/issues/7" };

export function identity(patch: Partial<OrchestratorIdentity> = {}): OrchestratorIdentity {
  return {
    schema: 1, key: MANAGER, sessionId: SELF, previousIds: [], role: "manager",
    name: "api-manager", ticket: { ...TICKET }, parent: TRIAGE,
    product: PRODUCT, cwd: PRODUCT, pid: 701, procStart: START, herdr: null,
    createdAt: NOW - 60_000, updatedAt: NOW - 1000, ...patch,
  };
}

export function progress(patch: Partial<OrchestratorProgress> = {}): OrchestratorProgress {
  return {
    schema: 1, key: MANAGER, rev: 0, updatedAt: 0, tasks: [], deps: [],
    blocked: null, holds: [], state: "active", doneAt: null, ...patch,
  };
}

export function record(patch: Partial<OrchestratorRecord> = {}): OrchestratorRecord {
  return { ...identity(), ...progress(), updatedAt: NOW - 1000, ...patch };
}

export function claim(patch: Partial<OrchestratorClaim> = {}): OrchestratorClaim {
  return {
    schema: 1, key: MANAGER, role: "manager", name: "api-manager",
    ticket: { ...TICKET }, parent: TRIAGE, product: PRODUCT,
    createdAt: NOW - 1000, ...patch,
  };
}

export function row(patch: Partial<OrchestratorRow> = {}): OrchestratorRow {
  return {
    key: MANAGER, sessionId: SELF, depth: 1, role: "manager",
    name: "api-manager", label: "api-manager", ticket: { ...TICKET },
    status: "idle", since: NOW - 180_000, needsYou: false, waits: null,
    progress: null, tasks: [], deps: [], holds: [], isSelf: false, adopted: false,
    target: { mux: "tmux", pane: "%702", window: "@12", session: "product" },
    ...patch,
  };
}

export const taskRows = () => [
  { n: 1, step: "Build API", who: "manager", state: "Done verified" },
  { n: 2, step: "Review", who: "child", state: "working" },
  { n: 3, step: "Old scope", who: "user", state: "moved elsewhere" },
  { n: 4, step: "Unneeded", who: "user", state: "DROPPED by user" },
];
