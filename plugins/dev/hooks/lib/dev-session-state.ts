/**
 * Recover a /dev:dev run's state from disk — the only place it survives a cleared or
 * compacted context.
 *
 * WHY THE NEXT PHASE IS DERIVED FROM FILES, NOT READ FROM THE CHECKPOINT.
 *
 * `session-meta.json` carries a `checkpoint`, but until the resume protocol landed
 * nothing after Phase 0 updated it, so every run read `nextPhase: phase1` for its whole
 * life. The files a phase writes are the evidence the phase-artifact gate already
 * trusts, so the next phase is derived from them and the checkpoint is reported beside
 * it, never instead of it. Same rule and same reasoning as
 * `phase-completion-validator.ts`: a hook that trusts a config the command writes
 * reports nothing for a run that died before writing it.
 *
 * Pure over an injected `Deps` so the tests need no filesystem.
 */
import { join } from "node:path";
import {
  PHASE_ARTIFACTS,
  checkArtifacts,
  type Deps,
} from "../phase-completion-validator.ts";

/** The phases each depth runs, in order. Mirrors <scope_selection> in commands/dev.md. */
export const DEPTH_PHASES: Record<string, string[]> = {
  quick: ["phase0", "phase4"],
  standard: ["phase0", "phase3", "phase4", "phase6", "phase8"],
  full: [
    "phase0",
    "phase1",
    "phase2",
    "phase3",
    "phase4",
    "phase5",
    "phase6",
    "phase7",
    "phase8",
  ],
};

export interface SessionMeta {
  sessionId?: string;
  feature?: string;
  depth?: string;
  automation?: string;
  status?: string;
  checkpoint?: { lastCompletedPhase?: string; nextPhase?: string };
}

export type PhaseState = "complete" | "partial" | "not-started";

export interface PhaseStatus {
  phase: string;
  name: string;
  state: PhaseState;
  /** What is missing or malformed — empty when complete or not started. */
  errors: string[];
}

export interface RunState {
  sessionPath: string;
  /** Parsed session-meta.json, or null when absent or malformed. */
  meta: SessionMeta | null;
  /** Phases with artifact specs, in the depth's order. Phases 0 and 2 write nothing gated. */
  phases: PhaseStatus[];
  /** First phase whose artifacts are incomplete, or null when every gated phase is done. */
  nextPhase: string | null;
}

export function readSessionMeta(sessionPath: string, deps: Deps): SessionMeta | null {
  const body = deps.read(join(sessionPath, "session-meta.json"));
  if (body === null) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as SessionMeta;
  } catch {
    return null;
  }
}

/**
 * Sessions that are still open. `status` is the command's own word; a directory with no
 * readable meta at all is still a candidate, because a run that died before Phase 0
 * finished is exactly the kind this exists to recover.
 */
/**
 * Newest first. The id is `dev-feature-<slug>-YYYYMMDD-HHMMSS-XXXX`, so the slug comes
 * BEFORE the date and a plain lexical sort would order by feature name. Sort on the date
 * segment; a directory without one sorts last.
 */
function startedAt(sessionPath: string): string {
  const m = /(\d{8}-\d{6})/.exec(sessionPath);
  return m ? m[1] : "00000000-000000";
}

export function inProgressSessions(deps: Deps): string[] {
  return deps
    .sessions()
    .filter((p) => {
      const meta = readSessionMeta(p, deps);
      if (meta === null) return true;
      return meta.status !== "completed" && meta.status !== "cancelled";
    })
    .sort((a, b) => startedAt(b).localeCompare(startedAt(a)));
}

export function deriveRunState(sessionPath: string, deps: Deps): RunState {
  const meta = readSessionMeta(sessionPath, deps);
  const depth = typeof meta?.depth === "string" ? meta.depth.toLowerCase() : undefined;
  const sequence =
    depth && Object.hasOwn(DEPTH_PHASES, depth) ? DEPTH_PHASES[depth] : DEPTH_PHASES.full;

  const phases: PhaseStatus[] = [];
  let nextPhase: string | null = null;

  for (const phase of sequence) {
    const spec = PHASE_ARTIFACTS[phase];
    if (!spec || spec.required.length === 0) continue;

    const present = spec.required.filter(
      (a) => deps.sizeOf(join(sessionPath, a.file)) !== null,
    ).length;
    const errors = checkArtifacts(spec, sessionPath, deps);

    // `checkArtifacts` skips a grouped artifact set nothing has touched, because a
    // Standard run legitimately never writes the plan review. At Full depth the review
    // IS Phase 3's second half (Steps 3.10-3.13), so a Full run cleared at approval —
    // architecture.md and context.json present, no review — must read as partial, not
    // done, or the resume would skip straight to Phase 4.
    if (depth === "full") {
      const grouped = spec.required.filter((a) => a.group);
      const untouched =
        grouped.length > 0 &&
        grouped.every((a) => deps.sizeOf(join(sessionPath, a.file)) === null);
      if (untouched && present > 0) {
        errors.push(`${grouped[0].group} not attempted (Full depth requires it)`);
      }
    }

    let state: PhaseState;
    if (present === 0) state = "not-started";
    else if (errors.length === 0) state = "complete";
    else state = "partial";

    phases.push({ phase, name: spec.name, state, errors });
    if (nextPhase === null && state !== "complete") nextPhase = phase;
  }

  return { sessionPath, meta, phases, nextPhase };
}
