/**
 * inherit.ts — start a new linked worktree from the main tree's index.
 *
 * One run, under ONE lock:
 *
 *   probe main -> refresh main if stale -> copy (state: copying) -> the engine's own
 *   incremental update in the worktree -> verify -> state: complete
 *
 * Any failure, or the deadline passing, means: delete the files the descriptor's `owned`
 * allowlist names in THIS worktree, record `failed`, and fall back to today's setup question.
 * There is no resume and no partial index. A `copying` record left by a run that died is
 * rolled back by the next start (row 6 of the decision table).
 *
 * Rows 0-5 of the table are static facts the hook answers before the lock; this module owns
 * rows 6-11 and calls `eligibility` again under the lock.
 */

import { join } from "node:path";

import { CATALOG } from "../adapters/catalog";
import type { Env, IndexDescriptor, IndexSource, IndexState } from "../core/index-descriptor";
import {
  eligibility,
  parseWorktreeState,
  staleness,
  worktreeLockPath,
  worktreeStatePath,
  type BlockStage,
  type InheritOutcome,
  type WorktreeLayout,
  type WorktreeState,
} from "../core/worktree";
import { whichOnPath } from "../setup/check";
import { changedFiles, uncommittedPaths } from "./changed-files";
import { containedKind } from "./containment";
import type { WorktreeIo } from "./ports";
import { copyIndex } from "./snapshot";
import { ownedTrackedState, rollbackIndex } from "./state";

export type { InheritOutcome } from "../core/worktree";

type CopyDescriptor = Extract<IndexDescriptor, { worktrees: "copy" }>;

export interface InheritInput {
  layout: Extract<WorktreeLayout, { kind: "linked" }>;
  projectDir: string;
  home: string;
  env: Env;
  engineId: string;
  descriptor: CopyDescriptor;
  budgetMs: number;
  /** The descriptor of the engine a dead run recorded, when it is not `engineId`. Defaults to the catalog's. */
  descriptorOf?: (engineId: string) => IndexDescriptor | undefined;
}

/** A lock older than this belongs to a dead run (above the hook's 120 s timeout). */
const LOCK_STALE_MS = 150_000;
/** Cap on the engine's own refresh of main; the catch-up gets whatever remains. */
const REFRESH_CAP_MS = 60_000;
const VCS_TIMEOUT_MS = 15_000;
/** At most this much budget left after the lock wait (a tenth of a small budget): do not start (nothing created, nothing recorded). */
const MIN_START_MS = 5_000;
const WORKTREES_DIR = ".claude/worktrees";

function defaultDescriptorOf(engineId: string): IndexDescriptor | undefined {
  const entry = (CATALOG as Record<string, { index?: IndexDescriptor } | undefined>)[engineId];
  return entry?.index;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The trimmed stdout of `rev-parse HEAD` run in `dir`; undefined when it fails or the run's
 * budget is spent (the call is bounded by what remains, and not started with nothing left).
 */
async function headOf(io: WorktreeIo, dir: string, remainingMs: () => number): Promise<string | undefined> {
  const timeoutMs = Math.min(VCS_TIMEOUT_MS, remainingMs());
  if (timeoutMs <= 0) return undefined;
  const r = await io.run(["git", "--no-optional-locks", "-C", dir, "rev-parse", "HEAD"], { cwd: dir, timeoutMs });
  if (r.spawnError !== undefined || r.timedOut || r.exitCode !== 0) return undefined;
  const head = r.stdout.trim();
  return head === "" ? undefined : head;
}

function underOwned(rel: string, owned: readonly string[]): boolean {
  return owned.some((root) => {
    const r = root.replace(/\/+$/u, "");
    return rel === r || rel.startsWith(`${r}/`);
  });
}

/** Paths a source-change comparison should consider: indexable, not the engine's own, not a nested worktree. */
function relevant(descriptor: CopyDescriptor, paths: readonly string[]): string[] {
  return paths.filter(
    (rel) =>
      !underOwned(rel, descriptor.owned) &&
      rel !== WORKTREES_DIR &&
      !rel.startsWith(`${WORKTREES_DIR}/`) &&
      descriptor.copy.isIndexable(rel, undefined),
  );
}

/** Reads main's index state, never throwing. */
function inspectMain(io: WorktreeIo, descriptor: CopyDescriptor, mainProjectDir: string): IndexState {
  let source: IndexSource | undefined;
  try {
    source = io.openIndexSource(mainProjectDir);
    return descriptor.copy.inspect(source);
  } catch {
    return { complete: false };
  } finally {
    try {
      source?.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * Rows 6-11. Never throws: every failure is an outcome. The lock is released on every path.
 */
export async function inheritWorktreeIndex(input: InheritInput, io: WorktreeIo): Promise<InheritOutcome> {
  const { layout, projectDir, descriptor } = input;
  const recipe = descriptor.copy;
  const deadline = io.now() + input.budgetMs;
  const remaining = (): number => deadline - io.now();

  const statePath = worktreeStatePath(input.env, input.home, projectDir);
  const lockPath = worktreeLockPath(input.env, input.home, layout.mainRoot);
  const rel = (p: string): string => (layout.relative === "" ? p : join(layout.relative, p));

  // ---- the lock ---------------------------------------------------------------------
  const wait = remaining();
  if (wait <= 0) return { kind: "blocked", stage: "timeout", reason: "no time left to wait for the lock", advice: true };
  let lock: Awaited<ReturnType<WorktreeIo["acquireLock"]>>;
  try {
    lock = await io.acquireLock(lockPath, { staleMs: LOCK_STALE_MS, waitMs: wait });
  } catch (error) {
    return { kind: "blocked", stage: "timeout", reason: `the lock could not be taken: ${messageOf(error)}`, advice: true };
  }
  if (!lock.ok) return { kind: "blocked", stage: "timeout", reason: "the lock is held by another start", advice: true };

  try {
    return await underLock();
  } catch (error) {
    // The body handles its own failures; this is the last line of defence.
    return { kind: "blocked", stage: "state", reason: messageOf(error), advice: true };
  } finally {
    await lock.release().catch(() => undefined);
  }

  /** Writes the state record for `engine` (this run's by default); false when it could not be written. */
  async function record(
    s: Omit<WorktreeState, "engine" | "incarnation" | "updatedAt">,
    engine: string = input.engineId,
  ): Promise<boolean> {
    try {
      await io.writeText(statePath, JSON.stringify({ engine, incarnation: layout.incarnation, updatedAt: io.now(), ...s }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The ONE way out of `copying` once the files are rolled back: a durable `failed` record, or
   * failing that no record at all (a `copying` left behind would make the next start delete
   * whatever index the user builds meanwhile, and the facade hold the index back). True only
   * when the state read back is no longer `copying`.
   */
  async function leaveCopying(stage: BlockStage, reason: string, engine: string = input.engineId): Promise<boolean> {
    if (await record({ phase: "failed", stage, reason }, engine)) return true;
    await io.removeTree(statePath);
    return parseWorktreeState(io.readText(statePath), layout.incarnation)?.phase !== "copying";
  }

  // ---- everything below runs holding the lock ----------------------------------------
  async function underLock(): Promise<InheritOutcome> {
    const recorded = parseWorktreeState(io.readText(statePath), layout.incarnation);

    // ---- row 6: a `copying` record under a free lock is a dead run ----------------------
    // Judged FIRST: cleaning up a dead run needs none of rows 4-5 (main may have lost its index,
    // the engine may have left PATH or changed since), and skipping it would leave the facade
    // holding the index back for good.
    if (recorded?.phase === "copying") return recoverDeadRun(recorded);

    const containedAll = (root: string, paths: readonly string[]) =>
      paths.map((p) => containedKind(io, root, rel(p)));
    const mainMarker = containedKind(io, layout.mainRoot, rel(descriptor.path));
    // The marker, the include files and every owned entry must be real files or directories
    // inside the worktree; one symlink or escape makes the whole index path unsafe.
    const worktreeKinds = containedAll(layout.root, [descriptor.path, ...recipe.include, ...descriptor.owned]);
    // The MARKER's own kind decides "has an index" and "missing"; `include` and `owned` entries
    // only veto (an absent `owned` directory is the normal state before the copy).
    const worktreeMarker = worktreeKinds.includes("other") ? "other" : (worktreeKinds[0] ?? "missing");

    const owned = await ownedTrackedState(io, { projectDir, owned: descriptor.owned, remainingMs: remaining });

    // Row 7: a `complete` record whose marker is gone (the index was deleted since) is no index at
    // all: a new attempt, decided from the marker, not from the leftovers of our own earlier run
    // (an ignore file the user committed under `owned` is not a reason to refuse).
    const restarting = recorded?.phase === "complete" && worktreeMarker === "missing";
    const state = restarting ? undefined : recorded;

    const verdict = eligibility({
      claudishChild: input.env["CLAUDISH_PANE_CHILD"] === "1",
      layout,
      engineId: input.engineId,
      setup: "active",
      descriptor,
      commandOnPath: recipe.update[0] !== undefined && whichOnPath(recipe.update[0], input.env["PATH"], io) !== undefined,
      mainMarker,
      worktreeMarker,
      ownedTracked: !restarting && owned !== "clean",
      state,
    });
    if (!verdict.ok) {
      if (verdict.reason !== "path_unsafe") return { kind: "skipped", reason: verdict.reason };
      // The worktree already has a regular index file: nothing to ask, nothing to record.
      if (worktreeMarker === "file") return { kind: "skipped", reason: "path_unsafe" };
      // The VCS merely did not answer in time (the marker itself is fine): not a fact about the
      // paths, so nothing is recorded and the next start looks again.
      if (owned === "unknown" && worktreeMarker === "missing") {
        return { kind: "blocked", stage: "state", reason: "the VCS did not say whether engine files are tracked", advice: true };
      }
      // A link or a directory at the marker, or a tracked file under `owned`: nothing is created or
      // deleted, but the question must not vanish. Recording `failed` hands it to the evaluator
      // (which owns the question for that state, in this and every later session) instead of
      // leaving it with a hook that will skip again. The stage is `path`: nothing was copied.
      const reason = "the worktree's index path is a link or a directory, or a file the VCS tracks sits under it";
      await record({ phase: "failed", stage: "path", reason });
      return { kind: "blocked", stage: "path", reason, advice: true };
    }

    // ---- row 9: the record comes BEFORE anything is created --------------------------
    // The lock wait can spend the whole budget; a run that gets the lock with none left
    // creates nothing and records nothing (a `failed` record is never retried), so the next
    // start tries again.
    if (remaining() <= Math.min(MIN_START_MS, Math.floor(input.budgetMs / 10))) {
      return { kind: "blocked", stage: "timeout", reason: "no time left to start after waiting for the lock", advice: true };
    }
    if (!(await record({ phase: "copying" }))) {
      return { kind: "blocked", stage: "state", reason: "the state record could not be written", advice: true };
    }

    /** Roll back this worktree's index and record `failed`. Incomplete rollback keeps `copying`. */
    const fail = async (stage: BlockStage, reason: string): Promise<InheritOutcome> => {
      const rolled = await rollbackIndex(io, { projectDir, owned: descriptor.owned, marker: descriptor.path }).catch(() => ({
        ok: false,
      }));
      if (!rolled.ok) return { kind: "blocked", stage, reason, advice: false };
      // Advice only once the state is out of `copying` for good (a `failed` record, or none).
      return { kind: "blocked", stage, reason, advice: await leaveCopying(stage, reason) };
    };

    try {
      // ---- row 10: probe main -----------------------------------------------------
      const mainFiles = containedAll(layout.mainRoot, recipe.include);
      if (mainFiles.some((k) => k !== "file")) return await fail("probe", "an index file of the main project is missing or not a plain file");
      if (recipe.store === "sqlite" && !(await io.sqliteIntegrity(join(layout.mainProjectDir, descriptor.path)))) {
        return await fail("probe", "the main project's database failed its integrity check");
      }
      const mainState = inspectMain(io, descriptor, layout.mainProjectDir);
      if (!mainState.complete) return await fail("probe", "the main project's index does not read as complete");

      // ---- row 11: staleness and refresh (section 6) -------------------------------
      const mainHead = await headOf(io, layout.mainProjectDir, remaining);
      const dirtyNow = await uncommittedPaths(io, layout.mainProjectDir, { remainingMs: remaining });
      const mainDirty = dirtyNow === undefined ? undefined : relevant(descriptor, dirtyNow);
      const indexedDirty = mainState.dirtyPaths === undefined ? undefined : relevant(descriptor, mainState.dirtyPaths);
      const fresh =
        staleness(
          indexedDirty === undefined ? { complete: false } : { ...mainState, dirtyPaths: indexedDirty },
          mainHead,
          mainDirty,
        ) === "fresh";

      let refresh: "fresh" | "refreshed" | "not_refreshed" = "fresh";
      if (!fresh) {
        const left = remaining();
        if (left <= 0) return await fail("copy", "no time left to refresh the main project's index");
        if (containedAll(layout.mainRoot, [descriptor.path, ...recipe.include]).some((k) => k !== "file")) {
          return await fail("probe", "the main project's index moved out of the project");
        }
        const cwd = io.realpath(layout.mainProjectDir) ?? layout.mainProjectDir;
        const run = await io.run(recipe.update, { cwd, timeoutMs: Math.min(REFRESH_CAP_MS, left) });
        const after = inspectMain(io, descriptor, layout.mainProjectDir);
        const ran = run.spawnError === undefined && !run.timedOut && run.exitCode === 0;
        // Caught up only when main's HEAD is KNOWN and the index records exactly it; an unreadable
        // HEAD is "unknown", never evidence of success.
        if (ran && after.complete && mainHead !== undefined && after.commit === mainHead) {
          refresh = "refreshed";
        } else {
          // Never copy a broken index; a merely stale one is copied and caught up from its own commit.
          if (!after.complete) return await fail("probe", "the main project's index does not read as complete after its refresh");
          refresh = "not_refreshed";
        }
      }

      // ---- copy ---------------------------------------------------------------------
      if (remaining() <= 0) return await fail("copy", "no time left to copy the index");
      if (containedAll(layout.mainRoot, [descriptor.path, ...recipe.include]).some((k) => k !== "file")) {
        return await fail("probe", "the main project's index moved out of the project");
      }
      const copied = await copyIndex(io, {
        recipe,
        marker: descriptor.path,
        fromProjectDir: layout.mainProjectDir,
        toProjectDir: projectDir,
      });
      if (!copied.ok) return await fail(copied.stage, copied.reason);

      // The changed set is measured from the COPY's commit, never from the pre-copy inspect.
      const delta = await changedFiles(io, {
        worktreeDir: projectDir,
        baseCommit: copied.state.commit,
        owned: descriptor.owned,
        remainingMs: remaining,
      });
      // The copy's own dirty paths describe MAIN's uncommitted content at index time; the engine's
      // update brings them current, but they are not in the git delta, so a count would understate.
      const copiedDirty = copied.state.dirtyPaths === undefined ? 0 : relevant(descriptor, copied.state.dirtyPaths).length;

      // ---- catch-up: the engine's own incremental update, in place -------------------------
      const budget = remaining();
      if (budget <= 0) return await fail("catchup", "no time left for the catch-up");
      const update = await io.run(recipe.update, { cwd: projectDir, timeoutMs: budget });
      if (update.spawnError !== undefined) return await fail("catchup", `the engine's update did not start: ${update.spawnError}`);
      if (update.timedOut) return await fail("catchup", "the engine's update timed out");
      if (update.exitCode !== 0) return await fail("catchup", `the engine's update exited ${String(update.exitCode)}`);

      // ---- verification (section 7): a tripwire; the update is the authority -------------
      // The deadline is checked again here and before `complete`: the VCS calls in between have
      // their own timeouts, and a run must not publish success after its budget is gone.
      if (remaining() <= 0) return await fail("verify", "no time left to verify the index");
      const problem = await verify(delta);
      if (problem !== undefined) return await fail("verify", problem);

      // ---- complete -----------------------------------------------------------------
      if (remaining() <= 0) return await fail("verify", "no time left to finish");
      if (!(await record({ phase: "complete" }))) return await fail("state", "the state record could not be written");
      return {
        kind: "inherited",
        refresh,
        changed: delta.engineWide || copiedDirty > 0 ? undefined : delta.changed.length + delta.deleted.length,
      };
    } catch (error) {
      return await fail("copy", messageOf(error));
    }
  }

  /** Row 6: roll the dead run back with the RECORDED engine's descriptor. */
  async function recoverDeadRun(state: WorktreeState): Promise<InheritOutcome> {
    const recorded =
      state.engine === input.engineId ? descriptor : (input.descriptorOf ?? defaultDescriptorOf)(state.engine);
    const stuck: InheritOutcome = {
      kind: "blocked",
      stage: "state",
      reason: "a previous start did not finish and its files could not be removed",
      advice: false,
    };
    if (recorded === undefined || recorded.worktrees !== "copy") return stuck;

    const kinds = [recorded.path, ...recorded.owned].map((p) => containedKind(io, layout.root, layout.relative === "" ? p : join(layout.relative, p)));
    if (kinds.includes("other")) return stuck;
    // `rollbackIndex` runs `ownedTracked` over THIS (the recorded engine's) `owned` first.
    const rolled = await rollbackIndex(io, { projectDir, owned: recorded.owned, marker: recorded.path }).catch(() => ({
      ok: false,
    }));
    if (!rolled.ok) return stuck;

    const reason = "a previous start did not finish";
    // Advice only once the record is out of `copying` (written `failed`, or removed); otherwise
    // the gate keeps holding and the next start recovers again.
    const left = await leaveCopying("state", reason, state.engine);
    return { kind: "blocked", stage: "state", reason, advice: left };
  }

  async function verify(delta: Awaited<ReturnType<typeof changedFiles>>): Promise<string | undefined> {
    let source: IndexSource | undefined;
    try {
      source = io.openIndexSource(projectDir);
      const state = recipe.inspect(source);
      if (!state.complete) return "the index does not read as complete after the update";

      const head = await headOf(io, projectDir, remaining);
      if (head === undefined) return "the worktree's HEAD could not be read";
      if (state.commit !== head) return "the index is not at the worktree's HEAD after the update";

      if (delta.engineWide) return undefined;
      const indexed = recipe.indexedFiles(source);
      if (indexed === undefined) return undefined;
      const stale = delta.deleted.find((p) => indexed.has(p));
      if (stale !== undefined) return `a deleted file is still indexed: ${stale}`;
      for (const path of delta.changed) {
        const size = io.statFile(join(projectDir, path))?.size;
        if (recipe.isIndexable(path, size) && !indexed.has(path)) return `a changed file is not indexed: ${path}`;
      }
      return undefined;
    } catch (error) {
      return `verification failed: ${messageOf(error)}`;
    } finally {
      try {
        source?.close();
      } catch {
        // Already closed.
      }
    }
  }
}
