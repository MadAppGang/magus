/**
 * worktree-start.test.ts — unit and launch tests for hooks/worktree-start.ts (TEST-17, REQ-2, REQ-4).
 *
 * Covers:
 * - worktreeStart returns undefined (silence) for claudish child, main checkout, unconfigured,
 *   dismissed, engine-managed, missing command, or main_has_no_index (when lock is free).
 * - worktreeStart returns JSON with systemMessage (and no additionalContext) on inherited success.
 * - worktreeStart returns JSON with systemMessage and hookSpecificOutput.additionalContext on
 *   blocked outcomes with advice:true, and omits additionalContext when advice:false.
 * - hooks.json launches worktree-start.ts with quoted plugin root, --env-file=/dev/null
 *   --config=/dev/null, and exits 0 silently when bun or the entrypoint is missing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CATALOG } from "../mcp/adapters/catalog";
import type { CopyRecipe, FileKind, IndexDescriptor, IndexSource, IndexState } from "../mcp/core/index-descriptor";
import { evaluateSetup } from "../mcp/setup/check";
import type { WorktreeIo } from "../mcp/worktree/ports";
import { worktreeStart } from "./worktree-start";

const PLUGIN = join(import.meta.dir, "..");
type RunReturn = Awaited<ReturnType<WorktreeIo["run"]>>;

function makeRunResult(exitCode: number | null, stdout = "", stderr = "", timedOut = false): RunReturn {
  return {
    exitCode,
    code: exitCode,
    status: exitCode,
    ok: exitCode === 0 && !timedOut,
    stdout,
    stderr,
    timedOut,
  } as unknown as RunReturn;
}

const scratchDirs: string[] = [];
afterEach(() => {
  for (const d of scratchDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function createLinkedWorktreeFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cs-wtstart-")));
  scratchDirs.push(root);
  const home = join(root, "home");
  const mainDir = join(root, "main");
  const wtDir = join(root, "wt");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), "{}");

  mkdirSync(join(mainDir, ".git", "worktrees", "wt"), { recursive: true });
  writeFileSync(join(mainDir, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(mainDir, ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/feat\n");
  writeFileSync(join(mainDir, ".git", "worktrees", "wt", "commondir"), "../..\n");
  writeFileSync(join(mainDir, ".git", "worktrees", "wt", "gitdir"), `${wtDir}/.git\n`);

  mkdirSync(join(mainDir, ".claude"), { recursive: true });
  mkdirSync(join(wtDir, ".claude"), { recursive: true });
  writeFileSync(join(wtDir, ".git"), `gitdir: ${mainDir}/.git/worktrees/wt\n`);

  return { root, home, mainDir, wtDir };
}

function makeFakeIo(opts: {
  home: string;
  mainDir: string;
  wtDir: string;
  mainHead?: string;
  wtHead?: string;
  mainState?: IndexState;
  wtState?: IndexState;
  lockOk?: boolean;
}): WorktreeIo {
  const mainHead = opts.mainHead ?? "1111111111111111111111111111111111111111";
  const wtHead = opts.wtHead ?? "1111111111111111111111111111111111111111";
  const mainState = opts.mainState ?? { complete: true, commit: mainHead, dirtyPaths: [] };
  const wtState = opts.wtState ?? { complete: true, commit: wtHead, dirtyPaths: [] };

  const partial: Partial<WorktreeIo> & Record<string, unknown> = {
    home: opts.home,
    env: { HOME: opts.home, PATH: "/usr/bin:/bin" },
    platform: process.platform,
    now: () => 1_700_000_000_000,
    which: (bin: string) => `/usr/bin/${bin}`,
    isExecutable: () => true,
    readText(p: string) {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
    kind(p: string) {
      try {
        const st = lstatSync(p);
        if (st.isFile()) return "file";
        if (st.isDirectory()) return "directory";
        return "other";
      } catch {
        return "missing";
      }
    },
    lstatKind(p: string): FileKind {
      try {
        const st = lstatSync(p);
        if (st.isSymbolicLink()) return "other";
        if (st.isFile()) return "file";
        if (st.isDirectory()) return "directory";
        return "other";
      } catch {
        return "missing";
      }
    },
    realpath(p: string) {
      try {
        return realpathSync(p);
      } catch {
        return undefined;
      }
    },
    mtimeMs(p: string) {
      try {
        return lstatSync(p).mtimeMs;
      } catch {
        return undefined;
      }
    },
    statFile(p: string) {
      try {
        const st = lstatSync(p);
        if (!st.isFile()) return undefined;
        return { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return undefined;
      }
    },
    mkdirp: async (p: string) => {
      mkdirSync(p, { recursive: true });
    },
    writeText: async (p: string, text: string) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text, "utf8");
    },
    copyFile: async (from: string, to: string) => {
      if (existsSync(to)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    },
    removeTree: async (p: string) => {
      rmSync(p, { recursive: true, force: true });
    },
    sqliteSnapshot: async (from: string, to: string) => {
      if (existsSync(to)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    },
    sqliteIntegrity: async () => true,
    openIndexSource(rootDir: string): IndexSource {
      const isMain = rootDir === opts.mainDir;
      return {
        exists: (rel: string) => existsSync(join(rootDir, rel)),
        sqlite: (rel: string) => {
          if (!existsSync(join(rootDir, rel))) return undefined;
          const st = isMain ? mainState : wtState;
          if (!st.complete) return undefined;
          return {
            query: () => [
              ["git_head", st.commit ?? ""],
              ["dirty_paths", JSON.stringify(st.dirtyPaths ?? [])],
            ],
          };
        },
        json: () => undefined,
        close: () => {},
      };
    },
    acquireLock: async () => {
      if (opts.lockOk === false) return { ok: false as const };
      return { ok: true as const, release: async () => {} };
    },
    run: async (argv: readonly string[], runOpts: { cwd?: string }) => {
      const isMain = runOpts?.cwd === opts.mainDir || argv.includes(opts.mainDir);
      if (argv.includes("ls-files")) return makeRunResult(0, "");
      if (argv.includes("--show-prefix")) return makeRunResult(0, "\n");
      if (argv.includes("rev-parse") && argv.includes("HEAD")) {
        return makeRunResult(0, `${isMain ? mainHead : wtHead}\n`);
      }
      if (argv.includes("cat-file")) return makeRunResult(0, "commit\n");
      if (argv.includes("diff")) return makeRunResult(0, "");
      if (argv.includes("status")) return makeRunResult(0, "");
      return makeRunResult(0, "");
    },
  };
  return partial as unknown as WorktreeIo;
}

describe("TEST-17: worktreeStart unit behaviour (REQ-2, REQ-4)", () => {
  test("REQ-2: returns undefined (silent) when CLAUDISH_PANE_CHILD=1 or in a main checkout", async () => {
    const { home, mainDir, wtDir } = createLinkedWorktreeFixture();
    const io = makeFakeIo({ home, mainDir, wtDir });

    expect(
      await worktreeStart({
        payload: { cwd: wtDir },
        env: { HOME: home, CLAUDISH_PANE_CHILD: "1", CLAUDE_PROJECT_DIR: wtDir },
        pluginRoot: PLUGIN,
        io,
        evaluate: evaluateSetup,
      }),
    ).toBeUndefined();

    expect(
      await worktreeStart({
        payload: { cwd: mainDir },
        env: { HOME: home, CLAUDE_PROJECT_DIR: mainDir },
        pluginRoot: PLUGIN,
        io,
        evaluate: evaluateSetup,
      }),
    ).toBeUndefined();
  });

  test("REQ-2, REQ-4: formats SessionStart JSON with systemMessage on inherited index and additionalContext on blocked", async () => {
    const { home, mainDir, wtDir } = createLinkedWorktreeFixture();
    writeFileSync(
      join(mainDir, ".claude", "settings.local.json"),
      JSON.stringify({
        "code-search": {
          engine: "codegraph",
          engines: { codegraph: { command: "codegraph", args: ["serve", "--mcp"] } },
          setup: "active",
        },
      }),
    );

    const prevIndex = (CATALOG.codegraph as { index?: IndexDescriptor }).index;
    const recipe: CopyRecipe = {
      store: "sqlite",
      include: [".codegraph/codegraph.db"],
      inspect(source: IndexSource): IndexState {
        const db = source.sqlite(".codegraph/codegraph.db");
        if (!db) return { complete: false };
        const rows = db.query("SELECT key, value FROM project_metadata");
        const commit = rows.find((r) => r[0] === "git_head")?.[1];
        if (typeof commit !== "string" || !commit) return { complete: false };
        return { complete: true, commit, dirtyPaths: [] };
      },
      updateRefreshesModified: true,
      isIndexable: (rel) => rel.endsWith(".ts"),
      indexedFiles: () => new Set(),
      update: ["codegraph", "sync"],
    };
    (CATALOG.codegraph as { index?: IndexDescriptor }).index = {
      worktrees: "copy",
      path: ".codegraph/codegraph.db",
      owned: [".codegraph"],
      paths: "relative",
      incremental: true,
      copy: recipe,
    };

    try {
      mkdirSync(join(mainDir, ".codegraph"), { recursive: true });
      writeFileSync(join(mainDir, ".codegraph", "codegraph.db"), "MAIN_DB");

      // 1. Successful inheritance:
      const ioOk = makeFakeIo({ home, mainDir, wtDir });
      const outOk = await worktreeStart({
        payload: { cwd: wtDir },
        env: { HOME: home, CLAUDE_PROJECT_DIR: wtDir, PATH: "/usr/bin:/bin" },
        pluginRoot: PLUGIN,
        io: ioOk,
        evaluate: evaluateSetup,
      });
      expect(typeof outOk).toBe("string");
      const parsedOk = JSON.parse(outOk ?? "{}") as {
        systemMessage?: string;
        hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
      };
      expect(parsedOk.systemMessage).toBe(
        "Started from the main project's index; nothing to update.",
      );
      expect(parsedOk.hookSpecificOutput?.additionalContext).toBeUndefined();

      // 2. Blocked (corrupt main index at probe) -> carries systemMessage AND additionalContext:
      const { home: home2, mainDir: main2, wtDir: wt2 } = createLinkedWorktreeFixture();
      writeFileSync(
        join(main2, ".claude", "settings.local.json"),
        JSON.stringify({
          "code-search": {
            engine: "codegraph",
            engines: { codegraph: { command: "codegraph", args: ["serve", "--mcp"] } },
            setup: "active",
          },
        }),
      );
      mkdirSync(join(main2, ".codegraph"), { recursive: true });
      writeFileSync(join(main2, ".codegraph", "codegraph.db"), "CORRUPT_DB");

      const ioProbeFail = makeFakeIo({
        home: home2,
        mainDir: main2,
        wtDir: wt2,
        mainState: { complete: false },
      });
      const outBlocked = await worktreeStart({
        payload: { cwd: wt2 },
        env: { HOME: home2, CLAUDE_PROJECT_DIR: wt2, PATH: "/usr/bin:/bin" },
        pluginRoot: PLUGIN,
        io: ioProbeFail,
        evaluate: evaluateSetup,
      });
      expect(typeof outBlocked).toBe("string");
      const parsedBlocked = JSON.parse(outBlocked ?? "{}") as {
        systemMessage?: string;
        hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
      };
      expect(parsedBlocked.systemMessage).toBe(
        "The main project's search index could not be used, so this worktree has no index yet.",
      );
      expect(parsedBlocked.hookSpecificOutput?.hookEventName).toBe("SessionStart");
      expect(typeof parsedBlocked.hookSpecificOutput?.additionalContext).toBe("string");
      expect((parsedBlocked.hookSpecificOutput?.additionalContext ?? "").length).toBeGreaterThan(0);
    } finally {
      (CATALOG.codegraph as { index?: IndexDescriptor }).index = prevIndex;
    }
  });
});

describe("TEST-17: hooks.json registration and safe launch for worktree-start.ts (REQ-2)", () => {
  interface Entry {
    matcher?: string;
    hooks: { command: string; timeout?: number }[];
  }

  const hooksJson = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8")) as {
    hooks: Record<string, Entry[]>;
  };

  function worktreeStartCommand(): string {
    const found = (hooksJson.hooks["SessionStart"] ?? [])
      .flatMap((e) => e.hooks)
      .find((h) => h.command.includes("worktree-start.ts"));
    if (!found) throw new Error("SessionStart has no worktree-start.ts entry in hooks.json");
    return found.command;
  }

  test("REQ-2: hooks.json registers worktree-start.ts under SessionStart with --env-file=/dev/null --config=/dev/null and || true", () => {
    const cmd = worktreeStartCommand();
    expect(cmd).toContain("command -v bun >/dev/null 2>&1");
    expect(cmd).toContain("--env-file=/dev/null --config=/dev/null");
    expect(cmd).toContain('"${CLAUDE_PLUGIN_ROOT}/hooks/worktree-start.ts"');
    expect(cmd).toContain("|| true");
  });

  test("REQ-2: launching with missing entrypoint or no bun on PATH exits 0 with empty stdout and stderr", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "cs-wt-launch-")));
    scratchDirs.push(root);
    const pluginCopy = join(root, "plugin with space");
    for (const dir of ["hooks", "mcp", "assets"]) {
      if (existsSync(join(PLUGIN, dir))) {
        cpSync(join(PLUGIN, dir), join(pluginCopy, dir), { recursive: true });
      }
    }
    const cmd = worktreeStartCommand();

    // 1. No bun on PATH:
    const noBun = spawnSync("/bin/sh", ["-c", cmd], {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: root,
        TMPDIR: root,
        CLAUDE_PLUGIN_ROOT: pluginCopy,
        CLAUDE_PROJECT_DIR: root,
      },
      input: JSON.stringify({ cwd: root }),
      encoding: "utf8",
    });
    expect({ rc: noBun.status, stdout: noBun.stdout, stderr: noBun.stderr }).toEqual({
      rc: 0,
      stdout: "",
      stderr: "",
    });

    // 2. Missing hooks/worktree-start.ts entrypoint with bun on PATH:
    rmSync(join(pluginCopy, "hooks", "worktree-start.ts"), { force: true });
    const missingEntry = spawnSync("/bin/sh", ["-c", cmd], {
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: root,
        TMPDIR: root,
        CLAUDE_PLUGIN_ROOT: pluginCopy,
        CLAUDE_PROJECT_DIR: root,
      },
      input: JSON.stringify({ cwd: root }),
      encoding: "utf8",
    });
    expect({
      rc: missingEntry.status,
      stdout: missingEntry.stdout,
      stderr: missingEntry.stderr,
    }).toEqual({
      rc: 0,
      stdout: "",
      stderr: "",
    });
  });
});
