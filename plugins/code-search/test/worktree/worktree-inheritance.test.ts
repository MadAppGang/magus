/**
 * worktree-inheritance.test.ts — black-box child-process integration tests for worktree
 * setup inheritance, index copy, refresh, fallback, verification, hint, and engine-managed
 * behaviour (TEST-18 through TEST-28, REQ-1, REQ-2, REQ-3, REQ-4, REQ-5).
 *
 * Never imports new plugin modules so the identical suite executes against both the
 * current tree and the extracted baseline commit (validation 10 negative control).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMainCodegraphIndex,
  callMcpCodeSearch,
   clearEngineLogs,
  cleanupScenarios,
  configureMainLocal,
  createScenario,
  git,
  readEngineLogs,
  runSessionStart,
  runSetupStatus,
} from "./support";

afterEach(async () => {
  await cleanupScenarios();
});

describe("Worktree setup and index inheritance (child-process integration)", () => {
  test("TEST-18 [new — baseline fails: worktree is unconfigured and offer-setup asks]: REQ-1 main has settings.local.json engine choice; fresh worktree is not unconfigured and offer-setup prints nothing about setup", () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);

    const { offerSetup } = runSessionStart(s);
    const st = runSetupStatus(s);

    expect(st.headline).not.toBe("unconfigured");
    expect(offerSetup.stdout).toBe("");
  });

  test("TEST-19 [new — baseline fails: worktree index missing and hook does not run]: REQ-2, REQ-4 main indexed at HEAD; hook runs; index appears; engine log lists only changed files", () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);
    clearEngineLogs(s);

    // Modify one file in the worktree so the diff has 1 changed file:
    writeFileSync(
      join(s.wtDir, "src", "base.ts"),
      "export function baseSymbol(): string {\n  return 'modified-in-wt';\n}\n",
    );

    const { worktreeStart, offerSetup } = runSessionStart(s);
    expect(existsSync(join(s.wtDir, ".codegraph", "codegraph.db"))).toBe(true);
    expect(worktreeStart.systemMessage).toBe(
      "Started from the main project's index; 1 changed files updated.",
    );
    expect(offerSetup.stdout).toBe("");

    const wtLogs = readEngineLogs(s).filter((l) => !l.isMain);
    expect(wtLogs).toHaveLength(1);
    expect(wtLogs[0]?.files).toEqual(["src/base.ts"]);
  });

  test("TEST-20 [new — baseline fails: code_search in worktree has no index and misses worktree-only symbol]: REQ-4 a real code_search in the worktree's first session returns the worktree-only file and not the deleted one", async () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);

    // Add a worktree-only file and delete removable.ts in the worktree branch:
    writeFileSync(
      join(s.wtDir, "src", "wt-only.ts"),
      "export function worktreeUniqueSymbol(): string {\n  return 'wt-only';\n}\n",
    );
    rmSync(join(s.wtDir, "src", "removable.ts"));
    git(s.wtDir, ["add", "-A"]);
    git(s.wtDir, ["commit", "-m", "worktree changes"]);

    runSessionStart(s);

    const found = await callMcpCodeSearch(s, "worktreeUniqueSymbol");
    expect(found.isError).toBe(false);
    expect(found.text).toContain("src/wt-only.ts");

    const deleted = await callMcpCodeSearch(s, "removableSymbol");
    expect(deleted.isError).toBe(false);
    expect(deleted.text).not.toContain("src/removable.ts");
  });

  test("TEST-21 [new — baseline fails: stale main index is neither refreshed nor copied]: REQ-3, REQ-4 main index 20 commits behind is refreshed first and file added in those commits is found; fallback variant copies stale, updates full diff, and message says so", async () => {
    // Part A: Main index 20 commits behind -> refreshed first, then copied
    const s = createScenario({ createWorktree: false });
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);
    clearEngineLogs(s);

    for (let i = 1; i <= 20; i += 1) {
      writeFileSync(
        join(s.mainDir, "src", `commit-${i}.ts`),
        `export function symbolFromCommit${i}(): number { return ${i}; }\n`,
      );
      git(s.mainDir, ["add", "."]);
      git(s.mainDir, ["commit", "-m", `commit ${i}`]);
    }
    git(s.mainDir, ["worktree", "add", "-b", "feat-wt", s.wtDir]);

    const { worktreeStart } = runSessionStart(s);
    expect(worktreeStart.systemMessage).toBe(
      "Started from the main project's index, brought up to date first; nothing to update.",
    );

    const searchHit = await callMcpCodeSearch(s, "symbolFromCommit20");
    expect(searchHit.text).toContain("src/commit-20.ts");

    // Part B: Fallback variant when main refresh fails -> copies stale index, updates full diff in worktree
    const sFallback = createScenario({ createWorktree: false });
    configureMainLocal(sFallback, "codegraph", "active");
    buildMainCodegraphIndex(sFallback);

    writeFileSync(
      join(sFallback.mainDir, "src", "added-while-stale.ts"),
      "export function staleCommitSymbol(): number { return 42; }\n",
    );
    git(sFallback.mainDir, ["add", "."]);
    git(sFallback.mainDir, ["commit", "-m", "advance main"]);
    git(sFallback.mainDir, ["worktree", "add", "-b", "feat-fallback", sFallback.wtDir]);

    const fallbackRun = runSessionStart(sFallback, {
      extraEnv: { FAKE_FAIL_MAIN_REFRESH: "1" },
    });
    expect(fallbackRun.worktreeStart.systemMessage).toBe(
      "Started from the main project's index, which is behind and could not be brought up to date first; 1 changed files updated.",
    );
    const fallbackHit = await callMcpCodeSearch(sFallback, "staleCommitSymbol");
    expect(fallbackHit.text).toContain("src/added-while-stale.ts");
  });

  test("TEST-22 [new — baseline fails: no blocked message and no failed state recorded]: REQ-4, REQ-6 catch-up failing or verification failing leaves no marker, records failed state, and shows the setup question once", () => {
    // 1. Catch-up command failing:
    const sCatchup = createScenario();
    configureMainLocal(sCatchup, "codegraph", "active");
    buildMainCodegraphIndex(sCatchup);

    const firstCatchup = runSessionStart(sCatchup, {
      extraEnv: { FAKE_FAIL_WT_CATCHUP: "1" },
    });
    expect(existsSync(join(sCatchup.wtDir, ".codegraph", "codegraph.db"))).toBe(false);
    expect(firstCatchup.worktreeStart.systemMessage).toBe(
      "Could not start from the main project's index, so this worktree has no index yet.",
    );
    expect(firstCatchup.combinedContext).toContain("index_missing");
    // Exactly one setup question across the SessionStart hooks:
    const secondCatchup = runSessionStart(sCatchup);
    expect(secondCatchup.worktreeStart.stdout).toBe("");

    // 2. Verification failing (changed indexable file not indexed):
    const sVerify = createScenario();
    configureMainLocal(sVerify, "codegraph", "active");
    buildMainCodegraphIndex(sVerify);
    writeFileSync(join(sVerify.wtDir, "src", "unindexed.ts"), "export const u = 1;\n");

    const firstVerify = runSessionStart(sVerify, {
      extraEnv: { FAKE_SKIP_CHANGED: "1" },
    });
    expect(existsSync(join(sVerify.wtDir, ".codegraph", "codegraph.db"))).toBe(false);
    expect(firstVerify.worktreeStart.systemMessage).toBe(
      "Could not start from the main project's index, so this worktree has no index yet.",
    );
    expect(firstVerify.combinedContext).toContain("index_missing");
  });

  test("TEST-23 [new — baseline fails: hook does not run on docs-only change]: REQ-4 docs-only worktree change passes verification with no blocked message", () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    buildMainCodegraphIndex(s);
    writeFileSync(join(s.wtDir, "README.md"), "# Worktree documentation\n");

    const { worktreeStart, offerSetup } = runSessionStart(s);
    expect(existsSync(join(s.wtDir, ".codegraph", "codegraph.db"))).toBe(true);
    expect(worktreeStart.systemMessage).toBe(
      "Started from the main project's index; 1 changed files updated.",
    );
    expect(offerSetup.stdout).toBe("");
  });

  test("TEST-24 [new — baseline fails: question is unconfigured without the main-index Tip line]: REQ-1, REQ-4 main has no index, copy engine chosen: hook is silent, worktree unchanged, and normal setup question carries the hint line", () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");

    const { worktreeStart, offerSetup } = runSessionStart(s);
    expect(worktreeStart.stdout).toBe("");
    expect(existsSync(join(s.wtDir, ".codegraph", "codegraph.db"))).toBe(false);
    expect(offerSetup.additionalContext).toContain("index_missing");
    expect(offerSetup.additionalContext).toContain(
      "Tip: index the main project first, so future new worktrees start from a copy and do not need a full reindex.",
    );
  });

  test("TEST-25 [regression]: REQ-1, REQ-2 main has no index and no engine chosen: behaviour identical to today (no worktree-start output, no index files)", () => {
    const s = createScenario();
    const { worktreeStart } = runSessionStart(s);
    expect(worktreeStart.stdout).toBe("");
    expect(existsSync(join(s.wtDir, ".codegraph"))).toBe(false);
    expect(existsSync(join(s.wtDir, ".mnemex"))).toBe(false);
  });

  test("TEST-26 [new — baseline fails: worktree does not inherit mnemex setup and raises unconfigured]: REQ-1, REQ-5 engine-managed stand-in and real CATALOG mnemex copy no files, inherit setup, stay silent on offer-setup when main has index, and answer code_search", async () => {
    const s = createScenario({ descriptorMode: "engine-managed" });
    configureMainLocal(s, "mnemex", "active");
    mkdirSync(join(s.mainDir, ".mnemex"), { recursive: true });
    writeFileSync(join(s.mainDir, ".mnemex", "index.db"), "MNEMEX_MAIN_INDEX");

    const { worktreeStart, offerSetup } = runSessionStart(s);
    expect(worktreeStart.stdout).toBe("");
    expect(existsSync(join(s.wtDir, ".mnemex"))).toBe(false);
    expect(offerSetup.stdout).toBe("");

    const hit = await callMcpCodeSearch(s, "how does base symbol work");
    expect(hit.isError).toBe(false);
    expect(hit.text).toContain("src/base.ts");

    // Variant where the engine-managed adapter cannot answer: its own index_missing note appears
    const sEmpty = createScenario({ descriptorMode: "untouched" });
    configureMainLocal(sEmpty, "mnemex", "active");
    mkdirSync(join(sEmpty.mainDir, ".mnemex"), { recursive: true });
    writeFileSync(join(sEmpty.mainDir, ".mnemex", "index.db"), "MNEMEX_MAIN_INDEX");
    sEmpty.env["FAKE_MNEMEX_EMPTY"] = "1";

    const emptyRun = runSessionStart(sEmpty);
    expect(emptyRun.worktreeStart.stdout).toBe("");
    expect(existsSync(join(sEmpty.wtDir, ".mnemex"))).toBe(false);
    const miss = await callMcpCodeSearch(sEmpty, "how does base symbol work");
    expect(miss.text).toContain("index_missing");
  });

  test("TEST-27 [new — baseline fails: truncated main db produces no probe message]: REQ-4, REQ-6 truncated/corrupt main db is not copied and emits probe message plus advice", () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    mkdirSync(join(s.mainDir, ".codegraph"), { recursive: true });
    writeFileSync(join(s.mainDir, ".codegraph", "codegraph.db"), "not-a-valid-sqlite-header");

    const { worktreeStart, combinedContext } = runSessionStart(s);
    expect(existsSync(join(s.wtDir, ".codegraph", "codegraph.db"))).toBe(false);
    expect(worktreeStart.systemMessage).toBe(
      "The main project's search index could not be used, so this worktree has no index yet.",
    );
    expect(combinedContext).toContain("index_missing");
  });

  test("TEST-28 [new — baseline fails: asks unconfigured instead of index_missing]: REQ-1, REQ-5 absolute-path engine with no index descriptor inherits setup from main's settings.local.json, copies nothing, and asks index_missing rather than unconfigured", () => {
    const s = createScenario({ descriptorMode: "none" });
    configureMainLocal(s, "graphify", "active");
    mkdirSync(join(s.mainDir, "graphify-out"), { recursive: true });
    writeFileSync(join(s.mainDir, "graphify-out", "graph.json"), "{}");

    const { worktreeStart, offerSetup } = runSessionStart(s);
    const st = runSetupStatus(s);

    expect(worktreeStart.stdout).toBe("");
    expect(existsSync(join(s.wtDir, "graphify-out", "graph.json"))).toBe(false);
    expect(st.headline).toBe("index_missing");
    expect(offerSetup.additionalContext).toContain("index_missing");
    expect(offerSetup.additionalContext).not.toContain("unconfigured");
  });

  test("TEST-32a [new — baseline fails: dirty main edit is not refreshed and not inherited]: REQ-3, REQ-4 main's already-dirty file edited again after main was indexed refreshes main, worktree finds new content, and message omits git-only count when dirtyPaths remain", async () => {
    const s = createScenario();
    configureMainLocal(s, "codegraph", "active");
    // Create dirty file in main and index main while dirty:
    writeFileSync(
      join(s.mainDir, "src", "dirty-main.ts"),
      "export function dirtyV1(): string { return 'v1'; }\n",
    );
    buildMainCodegraphIndex(s);

    // Edit main's dirty file again after main was indexed, and also edit it in worktree:
    writeFileSync(
      join(s.mainDir, "src", "dirty-main.ts"),
      "export function dirtyV2(): string { return 'v2'; }\n",
    );
    writeFileSync(
      join(s.wtDir, "src", "dirty-main.ts"),
      "export function dirtyV2(): string { return 'v2'; }\n",
    );

    const { worktreeStart } = runSessionStart(s);
    expect(worktreeStart.systemMessage).toContain("Started from the main project's index");
    const res = await callMcpCodeSearch(s, "dirtyV2");
    expect(res.text).toContain("src/dirty-main.ts");
  });
});
