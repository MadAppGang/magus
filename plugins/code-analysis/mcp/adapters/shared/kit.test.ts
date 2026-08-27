/**
 * Tests for the path half of kit.ts — the part an agent actually holds in its hands.
 *
 * The defect these exist for, measured on mnemex v0.31.x through its MCP `search` tool:
 * an index stores the absolute paths it saw AT INDEX TIME and replays them from wherever
 * it is later run, so a corpus copied into a fresh tmpdir answers with paths belonging to
 * the checkout it was indexed in. `toRepoRelative` then honestly produces
 * `../../../Users/...`, which is true and useless.
 *
 * Every test below drives an INJECTED existence predicate — no filesystem, no tmpdir, no
 * ordering between tests. `predicate()` records its arguments so a test can assert the
 * repair actually consulted it, rather than passing against a hardcoded answer.
 *
 * Run: bun test plugins/code-analysis/mcp/adapters/shared/kit.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  locationsFromText,
  normalisePath,
  readHits,
  repairForeignPath,
  toPortablePath,
  toRepoRelative,
  type PathContext,
} from "./kit";

/** The sandbox shape: the corpus lives here now. */
const WORKDIR = "/tmp/mb-workspace-9f2a/repo";
/** The shape mnemex hands back: where the corpus lived when it was indexed. */
const INDEXED_AT = "/home/someone/checkout/benches/code-search/.testdata/repo";

interface Predicate {
  paths: PathContext;
  /** Every absolute candidate the repair asked about, in the order it asked. */
  asked: string[];
}

/** `exists` names the paths that resolve, RELATIVE to `projectDir`. */
function predicate(exists: readonly string[], projectDir = WORKDIR): Predicate {
  const set = new Set(exists.map((p) => `${projectDir}/${p}`));
  const asked: string[] = [];
  return {
    paths: {
      projectDir,
      fileExists: (candidate: string): boolean => {
        asked.push(candidate);
        return set.has(candidate);
      },
    },
    asked,
  };
}

describe("repairForeignPath", () => {
  test("maps an index-time absolute path back onto projectDir", () => {
    const p = predicate(["utils/file-locking.ts"]);
    expect(repairForeignPath(`${INDEXED_AT}/utils/file-locking.ts`, p.paths)).toBe("utils/file-locking.ts");
  });

  test("consults the injected predicate, longest trailing run first", () => {
    const p = predicate(["services/styles-manager.ts"]);
    repairForeignPath("/a/b/services/styles-manager.ts", p.paths);

    // Longest-first is the whole contract: the FIRST question must be the longest
    // candidate, and questioning stops at the first hit.
    expect(p.asked).toEqual([
      `${WORKDIR}/a/b/services/styles-manager.ts`,
      `${WORKDIR}/b/services/styles-manager.ts`,
      `${WORKDIR}/services/styles-manager.ts`,
    ]);
  });

  test("ambiguity: the LONGER trailing run wins", () => {
    // `index.ts` names dozens of files in a real corpus; `utils/index.ts` names one.
    const p = predicate(["utils/index.ts", "index.ts"]);
    expect(repairForeignPath("/elsewhere/repo/utils/index.ts", p.paths)).toBe("utils/index.ts");
    // And it never even asked about the short one, because it stopped at the long one.
    expect(p.asked).not.toContain(`${WORKDIR}/index.ts`);
  });

  test("nothing resolves: the path is returned UNCHANGED", () => {
    const p = predicate([]);
    const raw = "/etc/hosts";
    expect(repairForeignPath(raw, p.paths)).toBe(raw);
    expect(p.asked.length).toBeGreaterThan(0);
  });

  test("a path already under projectDir is never touched, and costs no lookups", () => {
    const p = predicate(["utils/file-locking.ts"]);
    const raw = `${WORKDIR}/utils/file-locking.ts`;
    expect(repairForeignPath(raw, p.paths)).toBe(raw);
    expect(p.asked).toEqual([]);
  });

  test("projectDir itself is never touched", () => {
    const p = predicate([]);
    expect(repairForeignPath(WORKDIR, p.paths)).toBe(WORKDIR);
    expect(p.asked).toEqual([]);
  });

  test("a relative path is never touched, and costs no lookups", () => {
    const p = predicate(["utils/file-locking.ts"]);
    expect(repairForeignPath("utils/file-locking.ts", p.paths)).toBe("utils/file-locking.ts");
    expect(repairForeignPath("./utils/file-locking.ts", p.paths)).toBe("./utils/file-locking.ts");
    expect(p.asked).toEqual([]);
  });

  test("an empty path is never touched", () => {
    const p = predicate([]);
    expect(repairForeignPath("", p.paths)).toBe("");
    expect(p.asked).toEqual([]);
  });

  test("a relative projectDir cannot resolve anything, so nothing is repaired", () => {
    const p = predicate(["utils/file-locking.ts"], "not/absolute");
    const raw = `${INDEXED_AT}/utils/file-locking.ts`;
    expect(repairForeignPath(raw, p.paths)).toBe(raw);
    expect(p.asked).toEqual([]);
  });

  test("a Windows-shaped foreign path is normalised before candidates are cut", () => {
    const p = predicate(["utils/file-locking.ts"]);
    expect(repairForeignPath("/c/checkout/utils\\file-locking.ts", p.paths)).toBe("utils/file-locking.ts");
  });
});

describe("toPortablePath", () => {
  test("repairs, then relativises", () => {
    const p = predicate(["utils/file-locking.ts"]);
    expect(toPortablePath(`${INDEXED_AT}/utils/file-locking.ts`, p.paths)).toBe("utils/file-locking.ts");
  });

  test("keeps the honest `../` answer when the file genuinely is not in the repo", () => {
    const p = predicate([]);
    // Unchanged from what toRepoRelative alone would have said — the fallback is not
    // disabled, it is reached.
    expect(toPortablePath("/etc/hosts", p.paths)).toBe(toRepoRelative("/etc/hosts", WORKDIR));
    expect(toPortablePath("/etc/hosts", p.paths)).toBe("../../../etc/hosts");
  });

  test("a path already under projectDir is unaffected", () => {
    const p = predicate([]);
    expect(toPortablePath(`${WORKDIR}/src/main.ts`, p.paths)).toBe("src/main.ts");
    expect(p.asked).toEqual([]);
  });
});

describe("toRepoRelative is unchanged", () => {
  test("still relativises without any filesystem", () => {
    expect(toRepoRelative(`${WORKDIR}/src/main.ts`, WORKDIR)).toBe("src/main.ts");
    expect(toRepoRelative(`${INDEXED_AT}/utils/file-locking.ts`, WORKDIR)).toBe(
      "../../../home/someone/checkout/benches/code-search/.testdata/repo/utils/file-locking.ts",
    );
    expect(toRepoRelative("already/relative.ts", WORKDIR)).toBe("already/relative.ts");
    expect(normalisePath("a/./b/../c")).toBe("a/c");
  });
});

describe("the repair reaches upstream answers", () => {
  test("readHits repairs a JSON record's index-time path", () => {
    const p = predicate(["utils/file-locking.ts"]);
    const read = readHits([{ file: `${INDEXED_AT}/utils/file-locking.ts`, line: 42 }], {
      ...p.paths,
      withText: false,
    });
    expect(read.hits).toEqual([{ file: "utils/file-locking.ts", line: 42 }]);
    expect(read.dropped).toBe(0);
  });

  test("locationsFromText leaves an unresolvable reference honest", () => {
    const p = predicate([]);
    const hits = locationsFromText("see src/main.ts:10 for the entry point", p.paths);
    expect(hits).toEqual([{ file: "src/main.ts", line: 10 }]);
  });
});
