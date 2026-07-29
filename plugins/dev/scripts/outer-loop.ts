#!/usr/bin/env bun
/**
 * Outer-loop bookkeeping for `/dev:dev`.
 *
 * Tracks iteration count, Phase 7 validation results, and the resume checkpoint
 * in `<session>/session-meta.json`. This is state, not enforcement: the command
 * invokes it between phases and reads the exit code. Real gating of phase
 * completion lives in hooks/phase-completion-validator.ts, which the runtime
 * calls on every TaskUpdate whether or not anyone remembers to.
 *
 * Ported from outer-loop-enforcer.js — same on-disk shape and exit codes, so
 * existing sessions keep working.
 *
 * Exit codes:
 *   0  proceed
 *   1  blocked (Phase 8 attempted without a passing Phase 7)
 *   2  escalate to the user (iteration budget exhausted)
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";

export interface Phase7Result {
  iteration: number;
  status: "PASS" | "FAIL" | "PARTIAL";
  timestamp: string;
  reason: string | null;
  score: number | null;
}

export interface SessionMeta {
  sessionId: string;
  createdAt: string;
  status: string;
  outerLoop: {
    currentIteration: number;
    maxIterations: number;
    notifyEvery: number;
    phase7Results: Phase7Result[];
    mode: "limited" | "infinite";
  };
  checkpoint: {
    lastCompletedPhase: string | null;
    nextPhase: string;
    resumable: boolean;
  };
}

export function emptyMeta(sessionPath: string, now: string): SessionMeta {
  return {
    sessionId: basename(sessionPath),
    createdAt: now,
    status: "in_progress",
    outerLoop: {
      currentIteration: 0,
      maxIterations: 3,
      notifyEvery: 5,
      phase7Results: [],
      mode: "limited",
    },
    checkpoint: { lastCompletedPhase: null, nextPhase: "phase0", resumable: true },
  };
}

// ── Pure transitions (no I/O, so they can be tested directly) ───────────────

export interface StartOutcome {
  meta: SessionMeta;
  iteration: number;
  maxReached: boolean;
  shouldNotify: boolean;
  regression: { previous: number; current: number } | null;
}

/** Begin an iteration. `config` is the parsed iteration-config.json, if any. */
export function startIteration(
  meta: SessionMeta,
  config?: { outerLoop?: { maxIterations?: number | "infinite"; notifyEvery?: number } },
): StartOutcome {
  const ol = meta.outerLoop;

  if (config?.outerLoop) {
    const max = config.outerLoop.maxIterations;
    ol.mode = max === "infinite" ? "infinite" : "limited";
    if (typeof max === "number") ol.maxIterations = max;
    if (typeof config.outerLoop.notifyEvery === "number") {
      ol.notifyEvery = config.outerLoop.notifyEvery;
    }
  }

  ol.currentIteration += 1;
  meta.checkpoint.lastCompletedPhase = "phase2";
  meta.checkpoint.nextPhase = "phase3";

  const results = ol.phase7Results;
  let regression: StartOutcome["regression"] = null;
  if (results.length >= 2) {
    const last = results[results.length - 1];
    const prev = results[results.length - 2];
    if (last.score !== null && prev.score !== null && last.score < prev.score) {
      regression = { previous: prev.score, current: last.score };
    }
  }

  return {
    meta,
    iteration: ol.currentIteration,
    maxReached: ol.mode === "limited" && ol.currentIteration > ol.maxIterations,
    shouldNotify:
      ol.mode === "infinite" &&
      ol.notifyEvery > 0 &&
      ol.currentIteration % ol.notifyEvery === 0,
    regression,
  };
}

export function recordResult(
  meta: SessionMeta,
  status: string,
  now: string,
  opts: { reason?: string; score?: number } = {},
): { meta: SessionMeta; result: Phase7Result } {
  const normalised = status.toUpperCase();
  const result: Phase7Result = {
    iteration: meta.outerLoop.currentIteration,
    status: (["PASS", "FAIL", "PARTIAL"].includes(normalised)
      ? normalised
      : "FAIL") as Phase7Result["status"],
    timestamp: now,
    reason: opts.reason ?? null,
    score: typeof opts.score === "number" && Number.isFinite(opts.score) ? opts.score : null,
  };

  meta.outerLoop.phase7Results.push(result);
  if (result.status === "PASS") {
    meta.checkpoint.lastCompletedPhase = "phase7";
    meta.checkpoint.nextPhase = "phase8";
  } else {
    meta.checkpoint.lastCompletedPhase = "phase7-failed";
    meta.checkpoint.nextPhase = "phase3"; // loop back
  }
  return { meta, result };
}

/** Whether Phase 8 may proceed, and why not when it may not. */
export function canComplete(meta: SessionMeta): { ok: boolean; reason?: string } {
  const results = meta.outerLoop?.phase7Results ?? [];
  const last = results[results.length - 1];
  if (!last) return { ok: false, reason: "no Phase 7 result recorded" };
  if (last.status !== "PASS") {
    return {
      ok: false,
      reason: `Phase 7 last recorded ${last.status}${last.reason ? ` — ${last.reason}` : ""}`,
    };
  }
  return { ok: true };
}

// ── I/O ─────────────────────────────────────────────────────────────────────

function metaPath(sessionPath: string): string {
  return join(sessionPath, "session-meta.json");
}

export function loadMeta(sessionPath: string, now: string): SessionMeta {
  const p = metaPath(sessionPath);
  if (!existsSync(p)) return emptyMeta(sessionPath, now);
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<SessionMeta>;
    const base = emptyMeta(sessionPath, now);
    return {
      ...base,
      ...raw,
      outerLoop: { ...base.outerLoop, ...(raw.outerLoop ?? {}) },
      checkpoint: { ...base.checkpoint, ...(raw.checkpoint ?? {}) },
    };
  } catch {
    return emptyMeta(sessionPath, now);
  }
}

export function saveMeta(sessionPath: string, meta: SessionMeta): void {
  const p = metaPath(sessionPath);
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(meta, null, 2));
  renameSync(tmp, p);
}

function usage(): never {
  console.log("Usage: outer-loop.ts <action> <session_path> [options]");
  console.log("");
  console.log("  start-iteration     begin an iteration (exit 2 = budget exhausted)");
  console.log("  record-result       record Phase 7 outcome: PASS | FAIL | PARTIAL");
  console.log("  check-can-complete  gate Phase 8 (exit 1 = blocked)");
  console.log("  get-status          print current loop state");
  process.exit(0);
}

function main(): void {
  const [action, sessionPath, ...rest] = process.argv.slice(2);
  if (!action) usage();
  if (!sessionPath) {
    console.error("session path is required");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const meta = loadMeta(sessionPath, now);

  switch (action) {
    case "start-iteration": {
      let config;
      const configPath = join(sessionPath, "iteration-config.json");
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch {
          // Malformed config: fall back to the meta's own settings.
        }
      }
      const out = startIteration(meta, config);
      saveMeta(sessionPath, out.meta);

      const max = out.meta.outerLoop.mode === "infinite" ? "∞" : out.meta.outerLoop.maxIterations;
      console.log(`OUTER LOOP: iteration ${out.iteration}/${max}`);
      if (out.regression) {
        console.log(
          `Regression: score fell from ${out.regression.previous}% to ${out.regression.current}%.`,
        );
      }
      if (out.shouldNotify) {
        console.log(`${out.iteration} iterations completed in infinite mode.`);
        for (const r of out.meta.outerLoop.phase7Results.slice(-5)) {
          console.log(`  #${r.iteration}: ${r.score ?? "n/a"} ${r.reason ?? r.status}`);
        }
      }
      if (out.maxReached) {
        console.log("Iteration budget exhausted — ask the user how to proceed.");
        process.exit(2);
      }
      process.exit(0);
    }

    case "record-result": {
      const status = rest[0] ?? "FAIL";
      const reason = rest[1];
      const score = rest[2] !== undefined ? Number(rest[2]) : undefined;
      const { meta: next, result } = recordResult(meta, status, now, { reason, score });
      saveMeta(sessionPath, next);
      console.log(
        `Phase 7 iteration ${result.iteration}: ${result.status}` +
          (result.score !== null ? ` (${result.score}%)` : ""),
      );
      console.log(
        result.status === "PASS" ? "Proceed to Phase 8." : "Loop back to Phase 3.",
      );
      process.exit(0);
    }

    case "check-can-complete": {
      const verdict = canComplete(meta);
      if (!verdict.ok) {
        console.error(`BLOCKED: ${verdict.reason}.`);
        console.error("Phase 8 requires a passing Phase 7. Fix and revalidate,");
        console.error("or have the user accept partial completion.");
        process.exit(1);
      }
      console.log(
        `Phase 8 may proceed — Phase 7 passed after ${meta.outerLoop.currentIteration} iteration(s).`,
      );
      process.exit(0);
    }

    case "get-status": {
      const ol = meta.outerLoop;
      const max = ol.mode === "infinite" ? "∞" : ol.maxIterations;
      console.log(`Iteration ${ol.currentIteration}/${max} (${ol.mode})`);
      console.log(`Next phase: ${meta.checkpoint.nextPhase}`);
      if (ol.phase7Results.length === 0) console.log("No Phase 7 results yet.");
      for (const r of ol.phase7Results) {
        console.log(`  #${r.iteration}: ${r.status}${r.score !== null ? ` (${r.score}%)` : ""}`);
      }
      process.exit(0);
    }

    default:
      usage();
  }
}

if (import.meta.main) main();
