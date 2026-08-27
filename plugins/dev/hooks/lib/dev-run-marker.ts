/**
 * A marker saying "a /dev:dev run is in progress", shared by two hooks.
 *
 * WHY A MARKER AND NOT A DIRECTORY CHECK.
 *
 * `resume-after-plan.ts` fires on EVERY `ExitPlanMode`, including plan-mode sessions that
 * have nothing to do with this plugin. It must stay silent in those, or it tells an
 * unrelated session to "resume at Phase 4" of a pipeline it never started.
 *
 * The obvious signal is the session directory (`ai-docs/sessions/dev-feature-*`), and it
 * is wrong for the case that matters most: when plan mode is adopted at the START of a
 * run, the protocol explicitly forbids creating that directory until after the exit. So
 * at the moment `ExitPlanMode` fires, the directory does not exist yet — precisely when
 * the resume instruction is needed.
 *
 * So the marker is written by the UserPromptSubmit hook the instant `/dev:dev` is seen,
 * and consumed once by the PostToolUse hook. It lives under `.claude/.coaching/`, which
 * this plugin already owns and which is git-ignored.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Six hours. Long enough for a real run, short enough that a stale marker expires. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function markerPath(cwd: string): string {
  return join(cwd, ".claude", ".coaching", "dev-run.json");
}

/** Record that `/dev:dev` was invoked. Never throws — a hook must not break the turn. */
export function writeDevRunMarker(cwd: string, at: number): void {
  try {
    const p = markerPath(cwd);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ startedAt: at }));
  } catch {
    // A read-only or unwritable cwd just means the resume hint is skipped.
  }
}

/**
 * Consume the marker. Returns true only for a marker that exists and is recent.
 *
 * Consuming is deliberate: the resume instruction is for the FIRST plan approval of a
 * run. A later `ExitPlanMode` in the same session is the user planning something else,
 * and injecting "resume at Phase 4" there would be noise at best.
 */
export function consumeDevRunMarker(cwd: string, now: number): boolean {
  try {
    const p = markerPath(cwd);
    if (!existsSync(p)) return false;
    const { startedAt } = JSON.parse(readFileSync(p, "utf8")) as { startedAt?: number };
    rmSync(p, { force: true });
    if (typeof startedAt !== "number") return false;
    return now - startedAt < MAX_AGE_MS;
  } catch {
    return false;
  }
}
