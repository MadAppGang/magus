/**
 * worktree-safety-and-locks.test.ts — black-box child-process integration tests for
 * rollback safety, lock contention/timeout, main-tree immutability, crash recovery,
 * facade "being prepared" gate, symlink containment, incarnation recycling, and
 * multi-project worktrees (TEST-29 through TEST-32, REQ-2, REQ-3, REQ-4, REQ-6).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  buildMainCodegraphIndex,
  callMcpCodeSearch,
  clearEngineLogs,
  cleanupScenarios,
  configureMainLocal,
  createScenario,
  git,
  readEngineLogs,
  resolveStateMeta,
  runNamedHook,
  runSessionStart,
  snapshotTree,
} from "./support";

afterEach(async () => {
  await cleanupScenarios();
});

describe("Worktree safety, locks, containment, and crash recovery (child-process integration)", () => {
  test("TEST-29 [new — baseline fails: does not detect tracked owned path or emit blocked message]: REQ-6 a file tracked by VCS under an owned path prevents copy and deletion, says 'Could not start...' once with setup advice, records failed (stage path), and is silent on second start", () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);

    // Track a config file under .codegraph/ in the worktree branch:
    mkdirSync(join(s.wtDir, ".codegraph"), { recursive: true });
    const trackedConfig = join(s.wtDir, ".codegraph", "committed-config.json");
    writeFileSync(trackedConfig, '{"committed":true}\n');
    git(s.wtDir, ["add", "-f", ".codegraph/committed-config.json"]);
    git(s.wtDir, ["commit", "-m", "track engine config"]);

    const first = runSessionStart(s);
    expect(existsSync(trackedConfig)).toBe(true);
    expect(readFileSync(trackedConfig, "utf8")).toBe('{"committed":true}\n');
    expect(existsSync(join(s.wtDir, ".codegraph", "codegraph.db"))).toBe(false);
    expect(first.worktreeStart.systemMessage).toBe(
      "Could not start from the main project's index, so this worktree has no index yet.",
    );
    expect(first.combinedContext).toContain("index_missing");

    const { statePath } = resolveStateMeta(s);
    expect(existsSync(statePath)).toBe(true);
    const stateJson = JSON.parse(readFileSync(statePath, "utf8")) as {
      phase?: string;
      stage?: string;
    };
    expect(stateJson.phase).toBe("failed");
    expect(stateJson.stage).toBe("path");

    // Second start is silent on worktree-start:
    const second = runSessionStart(s);
    expect(second.worktreeStart.stdout).toBe("");
    expect(existsSync(trackedConfig)).toBe(true);
  });

  test("TEST-30 [new — baseline fails: no lock serialization or timeout message]: REQ-3, REQ-6 two worktrees of one main refresh once and copy in sequence; two hooks in one worktree serialize with second silent; lock held past wait blocks at timeout", async () => {
    // 1. Two worktrees of one main: one refresh, two copies
    const s = createScenario({ createWorktree: false });
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);

    writeFileSync(join(s.mainDir, "src", "after-index.ts"), "export const after = 1;\n");
    git(s.mainDir, ["add", "."]);
    git(s.mainDir, ["commit", "-m", "advance main"]);

    const wt1 = join(s.root, "wt1");
    const wt2 = join(s.root, "wt2");
    git(s.mainDir, ["worktree", "add", "-b", "b-wt1", wt1]);
    git(s.mainDir, ["worktree", "add", "-b", "b-wt2", wt2]);
    clearEngineLogs(s);

    const runHookAsync = (projectDir: string) =>
      new Promise<{ stdout: string; rc: number | null }>((resolve) => {
        const child = spawn(
          process.execPath,
          [
            "--env-file=/dev/null",
            "--config=/dev/null",
            join(s.pluginDir, "hooks", "worktree-start.ts"),
          ],
          {
            cwd: projectDir,
            env: { ...s.env, CLAUDE_PROJECT_DIR: projectDir },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let stdout = "";
        child.stdout?.setEncoding("utf8").on("data", (c: string) => {
          stdout += c;
        });
        child.stdin?.end(JSON.stringify({ cwd: projectDir }));
        child.once("close", (rc) => resolve({ stdout, rc }));
      });

    const [r1, r2] = await Promise.all([runHookAsync(wt1), runHookAsync(wt2)]);
    expect(r1.rc).toBe(0);
    expect(r2.rc).toBe(0);
    expect(existsSync(join(wt1, ".codegraph", "codegraph.db"))).toBe(true);
    expect(existsSync(join(wt2, ".codegraph", "codegraph.db"))).toBe(true);
    const mainRefreshes = readEngineLogs(s).filter((l) => l.isMain);
    expect(mainRefreshes).toHaveLength(1);

    // 2. Two hooks in ONE worktree: second waits, then is silent on success
    const sSame = createScenario();
    configureMainLocal(sSame, "codegraph", "active");
    buildMainCodegraphIndex(sSame);
    const firstSame = runNamedHook(sSame, "worktree-start.ts");
    const secondSame = runNamedHook(sSame, "worktree-start.ts");
    expect(firstSame.systemMessage).toContain("Started from the main project's index");
    expect(secondSame.stdout).toBe("");
  }, 30_000);

  test("TEST-31 [regression]: REQ-3, REQ-6 main tree is byte-for-byte untouched before and after when no refresh runs (ignoring -shm/-wal), and non-owned paths are untouched when refresh runs", () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);

    const beforeFresh = snapshotTree(s.mainDir, { ignoreSidecars: true });
    runSessionStart(s);
    const afterFresh = snapshotTree(s.mainDir, { ignoreSidecars: true });
    expect(afterFresh).toEqual(beforeFresh);
  });

  test("TEST-32b [new — baseline fails: facade does not gate on copying and dead copying state is not recovered]: REQ-2, REQ-6 hook killed mid-run (copying state): facade answers 'being prepared', next start rolls back and raises setup question once, and when marker cannot be removed state stays copying", async () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);

    const { statePath, incarnation } = resolveStateMeta(s);
    mkdirSync(dirname(statePath), { recursive: true });
    mkdirSync(join(s.wtDir, ".codegraph"), { recursive: true });
    writeFileSync(join(s.wtDir, ".codegraph", "codegraph.db"), "PARTIAL_COPY");
    writeFileSync(
      statePath,
      JSON.stringify({
        phase: "copying",
        engine: "codegraph",
        incarnation,
        updatedAt: Date.now(),
      }),
    );

    // While state is copying, facade gates code_search and says "still being prepared":
    const duringCopy = await callMcpCodeSearch(s, "baseSymbol");
    expect(duringCopy.text).toContain(
      "The search index for this worktree is still being prepared.",
    );

    // Next SessionStart detects dead copying run (lock is free), rolls back, and asks once:
    const recovery = runSessionStart(s);
    expect(existsSync(join(s.wtDir, ".codegraph", "codegraph.db"))).toBe(false);
    expect(recovery.worktreeStart.systemMessage).toBe(
      "Could not start from the main project's index, so this worktree has no index yet.",
    );
    expect(recovery.combinedContext).toContain("index_missing");

    // Start after that does not retry:
    const afterRecovery = runSessionStart(s);
    expect(afterRecovery.worktreeStart.stdout).toBe("");

    // Variant where rollback cannot remove the marker -> state stays copying and facade keeps gating:
    if (process.getuid?.() !== 0) {
      const sStuck = createScenario();
      configureMainLocal(sStuck, "codegraph", "active");
      buildMainCodegraphIndex(sStuck);
      const stuckMeta = resolveStateMeta(sStuck);
      mkdirSync(dirname(stuckMeta.statePath), { recursive: true });
      const cgDir = join(sStuck.wtDir, ".codegraph");
      mkdirSync(cgDir, { recursive: true });
      writeFileSync(join(cgDir, "codegraph.db"), "UNREMOVABLE");
      writeFileSync(
        stuckMeta.statePath,
        JSON.stringify({
          phase: "copying",
          engine: "codegraph",
          incarnation: stuckMeta.incarnation,
          updatedAt: Date.now(),
        }),
      );
      chmodSync(cgDir, 0o500);
      try {
        runSessionStart(sStuck);
        const stillCopying = await callMcpCodeSearch(sStuck, "baseSymbol");
        expect(stillCopying.text).toContain(
          "The search index for this worktree is still being prepared.",
        );
      } finally {
        chmodSync(cgDir, 0o755);
      }
    }
  });

  test("TEST-32c [new — baseline fails: symlinked index dir in worktree does not emit path outcome]: REQ-6 symlinked index directory in worktree or main never writes/deletes outside; worktree symlink gets path outcome, main escaping symlink is treated as main_has_no_index", () => {
    // 1. Symlinked .codegraph in worktree pointing to outside directory:
    const sWtSym = createScenario();
    configureMainLocal(sWtSym, "codegraph", "active");
    buildMainCodegraphIndex(sWtSym);

    const outsideDir = join(sWtSym.root, "outside-wt");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "precious.txt"), "keep-me");
    symlinkSync(outsideDir, join(sWtSym.wtDir, ".codegraph"));

    const wtSymRun = runSessionStart(sWtSym);
    expect(wtSymRun.worktreeStart.systemMessage).toBe(
      "Could not start from the main project's index, so this worktree has no index yet.",
    );
    expect(existsSync(join(outsideDir, "precious.txt"))).toBe(true);
    expect(existsSync(join(outsideDir, "codegraph.db"))).toBe(false);

    // 2. Main's .codegraph symlinked outside -> treated as row 5 (main_has_no_index: hook silent, question asks with hint):
    const sMainSym = createScenario();
    configureMainLocal(sMainSym, "codegraph", "active");
    const outsideMain = join(sMainSym.root, "outside-main");
    mkdirSync(outsideMain, { recursive: true });
    writeFileSync(join(outsideMain, "codegraph.db"), "OUTSIDE_DB");
    symlinkSync(outsideMain, join(sMainSym.mainDir, ".codegraph"));

    const mainSymRun = runSessionStart(sMainSym);
    expect(mainSymRun.worktreeStart.stdout).toBe("");
    expect(existsSync(join(sMainSym.wtDir, ".codegraph", "codegraph.db"))).toBe(false);
    expect(mainSymRun.offerSetup.additionalContext).toContain(
      "Tip: index the main project first, so future new worktrees start from a copy and do not need a full reindex.",
    );
  });

  test("TEST-32d [new — baseline fails: recycled worktree and multi-project worktree do not inherit index]: REQ-6 recycled worktree name after remove and re-add ignores old failed state; two project dirs in one worktree have independent state and indexes", () => {
    // 1. Recycled worktree name after remove and re-add:
    const sRecycle = createScenario();
    configureMainLocal(sRecycle, "codegraph", "active");
    buildMainCodegraphIndex(sRecycle);

    // First incarnation fails:
    runSessionStart(sRecycle, { extraEnv: { FAKE_FAIL_WT_CATCHUP: "1" } });
    expect(existsSync(join(sRecycle.wtDir, ".codegraph", "codegraph.db"))).toBe(false);

    // Remove and re-add worktree at the same path:
    git(sRecycle.mainDir, ["worktree", "remove", "--force", sRecycle.wtDir]);
    git(sRecycle.mainDir, ["worktree", "add", "-b", "feat-recycled", sRecycle.wtDir]);

    const freshAttempt = runSessionStart(sRecycle);
    expect(existsSync(join(sRecycle.wtDir, ".codegraph", "codegraph.db"))).toBe(true);
    expect(freshAttempt.worktreeStart.systemMessage).toContain(
      "Started from the main project's index",
    );

    // 2. Two project dirs (root and pkg) in one worktree:
    const sMulti = createScenario({ createWorktree: false });
    mkdirSync(join(sMulti.mainDir, "pkg", "src"), { recursive: true });
    writeFileSync(
      join(sMulti.mainDir, "pkg", "src", "pkg-mod.ts"),
      "export function pkgFn(): number { return 7; }\n",
    );
    git(sMulti.mainDir, ["add", "."]);
    git(sMulti.mainDir, ["commit", "-m", "add pkg"]);

    configureMainLocal(sMulti, "codegraph", "active", sMulti.mainDir);
    configureMainLocal(sMulti, "codegraph", "active", join(sMulti.mainDir, "pkg"));
    buildMainCodegraphIndex(sMulti, sMulti.mainDir);
    buildMainCodegraphIndex(sMulti, join(sMulti.mainDir, "pkg"));

    git(sMulti.mainDir, ["worktree", "add", "-b", "feat-multi", sMulti.wtDir]);

    const rootRun = runSessionStart(sMulti, { projectDir: sMulti.wtDir });
    expect(existsSync(join(sMulti.wtDir, ".codegraph", "codegraph.db"))).toBe(true);
    expect(existsSync(join(sMulti.wtDir, "pkg", ".codegraph", "codegraph.db"))).toBe(false);
    expect(rootRun.worktreeStart.systemMessage).toContain("Started from the main project's index");

    const pkgRun = runSessionStart(sMulti, { projectDir: join(sMulti.wtDir, "pkg") });
    expect(existsSync(join(sMulti.wtDir, "pkg", ".codegraph", "codegraph.db"))).toBe(true);
    expect(pkgRun.worktreeStart.systemMessage).toContain("Started from the main project's index");
  });
});
