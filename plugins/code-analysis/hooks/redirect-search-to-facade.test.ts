/**
 * redirect-search-to-facade.test.ts — the discrimination, which IS the design.
 *
 * A five-model review panel split on whether intercepting Bash is even the right idea,
 * and both reviewers who voted named the same failure: a blanket grep-deny enforces
 * WORSE behaviour, because `rg` genuinely beats an index for an exact literal. So the
 * value of this hook is entirely in what it DOES NOT fire on, and that is what the bulk
 * of this file asserts.
 *
 * Run: bun test plugins/code-analysis/hooks/
 */

import { describe, expect, test } from "bun:test";

import { discoveryTarget } from "./redirect-search-to-facade";

describe("redirects a discovery search — 'where is this symbol'", () => {
  test("a bare identifier is the case this hook exists for", () => {
    expect(discoveryTarget("rg withFileLock")).toBe("withFileLock");
    expect(discoveryTarget("grep -rn saveSettings src/")).toBe("saveSettings");
    expect(discoveryTarget("rg -n LOCK_TIMEOUT_MS")).toBe("LOCK_TIMEOUT_MS");
    expect(discoveryTarget("  grep   BaseStore  ")).toBe("BaseStore");
  });

  test("quoting a plain identifier does not change what it is", () => {
    expect(discoveryTarget('rg "withFileLock"')).toBe("withFileLock");
    expect(discoveryTarget("rg 'saveSettings'")).toBe("saveSettings");
  });
});

/**
 * THE REGRESSION THAT MADE A PAID BENCHMARK ARM MEASURE NOTHING.
 *
 * The first version of this hook rejected any command containing `| ; & > <`. Run against
 * the 84 Bash commands a real agent issued across 24 benchmark scenarios, it fired on
 * exactly ONE: 51 of the 84 were rejected by that guard alone. An agent almost never
 * writes a bare `rg foo` — it writes `rg foo 2>/dev/null` or pipes the result through a
 * filter. The arm ran, cost money, and tested nothing.
 *
 * These are real commands from that run. They are the cases that matter, because they are
 * what the hook will actually meet.
 */
describe("fires on the shapes an agent REALLY writes", () => {
  test("stderr suppression is noise, not a pipeline", () => {
    // `2>/dev/null` hides permission errors. It does not change the question being asked.
    expect(discoveryTarget('grep -r "reconcileOrphanedSymlinks" . 2>/dev/null')).toBe(
      "reconcileOrphanedSymlinks",
    );
    expect(discoveryTarget("rg gapFillInstalledPluginVersions 2>&1")).toBe(
      "gapFillInstalledPluginVersions",
    );
  });

  test("trailing result-trimming keeps the question intact", () => {
    // The agent still wants "where is X"; it is only shortening the list it gets back.
    expect(discoveryTarget("rg withFileLock | head -20")).toBe("withFileLock");
    expect(discoveryTarget("rg saveSettings | sort")).toBe("saveSettings");
    expect(discoveryTarget("grep -rn BaseStore | grep -v node_modules")).toBe("BaseStore");
  });

  test("but a pipeline that TRANSFORMS the answer is still left alone", () => {
    // `wc -l` turns a location question into a count. The facade does not answer counts.
    expect(discoveryTarget("rg withFileLock | wc -l")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock | xargs sed -i ''")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock | awk '{print $1}'")).toBeUndefined();
    // Sequencing further commands: a denial strands everything after it.
    expect(discoveryTarget("rg withFileLock && echo found")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock; ls")).toBeUndefined();
    // Redirection into a file the agent means to read back.
    expect(discoveryTarget("rg withFileLock > hits.txt")).toBeUndefined();
  });
});

describe("LEAVES ALONE everything an index answers no better", () => {
  test("regex metacharacters mean the agent wants pattern semantics", () => {
    // The facade takes a query, not a regex. Redirecting here loses the actual request.
    expect(discoveryTarget("rg 'withFileLock|saveSettings'")).toBeUndefined();
    expect(discoveryTarget("rg '^export async function'")).toBeUndefined();
    expect(discoveryTarget("grep -rn 'save.*Settings' src/")).toBeUndefined();
    expect(discoveryTarget("rg 'TODO(.*)'")).toBeUndefined();
  });

  test("a quoted phrase with spaces is literal text, not a symbol", () => {
    expect(discoveryTarget('rg "no active project"')).toBeUndefined();
    expect(discoveryTarget("grep -rn 'index is stale' .")).toBeUndefined();
  });

  test("counting and file-listing are things the facade does not do at all", () => {
    // THE case the dissenting reviewer raised: rg is not merely acceptable here, it is
    // the only tool that answers. Denying it would enforce strictly worse behaviour.
    expect(discoveryTarget("rg -c withFileLock")).toBeUndefined();
    expect(discoveryTarget("rg --count withFileLock")).toBeUndefined();
    expect(discoveryTarget("rg -l withFileLock")).toBeUndefined();
    expect(discoveryTarget("rg --files-with-matches withFileLock")).toBeUndefined();
    expect(discoveryTarget("rg -o withFileLock")).toBeUndefined();
  });

  test("a listing flag buried in a COMBINED group still counts", () => {
    // Real commands from the benchmark run. `-rli` and `-rIl` are "which files contain
    // this", not "where is this defined", and a word-boundary check missed all of them —
    // which would have redirected exactly the questions the facade cannot answer.
    expect(discoveryTarget('grep -rli "symlink" --include="*.ts" . 2>/dev/null')).toBeUndefined();
    expect(discoveryTarget('grep -rIl "checksum" . 2>/dev/null')).toBeUndefined();
    expect(discoveryTarget('grep -rl "ScreenLayout" . 2>/dev/null')).toBeUndefined();
    expect(discoveryTarget("rg -cn withFileLock")).toBeUndefined();
    // But a group with NONE of c/l/L/o is still a location question.
    expect(discoveryTarget('grep -rn "gapFillInstalledPluginVersions" . 2>/dev/null')).toBe(
      "gapFillInstalledPluginVersions",
    );
  });

  test("`find` is a FILENAME question end to end and is never redirected", () => {
    expect(discoveryTarget("find . -name '*.ts'")).toBeUndefined();
    expect(discoveryTarget("find src -type f -name lock.ts")).toBeUndefined();
    // Even one that looks symbol-shaped: the facade has no filename-pattern operation.
    expect(discoveryTarget("find . -name withFileLock")).toBeUndefined();
  });

  test("a pipeline feeds something else, and denying strands the whole plan", () => {
    expect(discoveryTarget("rg withFileLock | wc -l")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock > out.txt")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock && echo done")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock; ls")).toBeUndefined();
  });

  test("anything not search-shaped is none of this hook's business", () => {
    expect(discoveryTarget("bun test")).toBeUndefined();
    expect(discoveryTarget("git status")).toBeUndefined();
    expect(discoveryTarget("ls -R src")).toBeUndefined();
    expect(discoveryTarget("npm run build")).toBeUndefined();
    // `ls -R` is a directory question; the facade has no directory-listing answer, so it
    // is deliberately absent from the intercepted set rather than silently omitted.
  });

  test("a token too short to be a lookup is a text search", () => {
    // `rg id` matches half a corpus. That is grepping, not locating.
    expect(discoveryTarget("rg id")).toBeUndefined();
    expect(discoveryTarget("rg abc")).toBeUndefined();
    expect(discoveryTarget("rg abcd")).toBe("abcd");
  });

  test("a path argument is not the pattern", () => {
    // `src/` and `lock.ts` must never be mistaken for the thing being searched for.
    expect(discoveryTarget("rg withFileLock src/")).toBe("withFileLock");
    expect(discoveryTarget("rg withFileLock src/lock.ts")).toBe("withFileLock");
  });

  test("no pattern at all is not a redirect", () => {
    expect(discoveryTarget("rg")).toBeUndefined();
    expect(discoveryTarget("rg -n")).toBeUndefined();
    expect(discoveryTarget("")).toBeUndefined();
  });
});

/**
 * THE WIDE GUARD — `discoveryTarget(cmd, { listIsLocation: true })`.
 *
 * A plain option, set per call. It used to be an env var read once at module load and
 * tested through a subprocess; that env var was set by a wrapper script the bench injected
 * by absolute path, which madbench's sandbox refused to read. The calibration now arrives
 * in the `adoption` settings block the hook already opens, so the guard takes it as an
 * argument and the test needs no spawn.
 */
describe("discoveryTarget with listIsLocation", () => {
  const wide = (command: string): string | undefined =>
    discoveryTarget(command, { listIsLocation: true });

  test("`-l` becomes a location query — the shape a real agent actually writes", () => {
    // Measured: over a smoke run the narrow guard fired 11 times and denied 0, because
    // every command was this shape rather than the bare `rg withFileLock` it was tuned on.
    expect(wide('grep -rln "withFileLock" --include="*.ts" .')).toBe("withFileLock");
    expect(wide("grep -rl withFileLock .")).toBe("withFileLock");
    expect(wide("rg -l withFileLock")).toBe("withFileLock");
  });

  test("a count and a matched substring stay excluded — the facade answers neither", () => {
    expect(wide("grep -rc withFileLock .")).toBeUndefined();
    expect(wide("grep -ro withFileLock .")).toBeUndefined();
    expect(wide("grep -r --count withFileLock .")).toBeUndefined();
  });

  test("widening `-l` does not disable any OTHER guard", () => {
    // Each is rejected by a DIFFERENT guard, and all must survive the widening.
    expect(wide('grep -rl "index is stale" .')).toBeUndefined(); // quoted phrase
    expect(wide("grep -rl abc .")).toBeUndefined(); // token too short
    expect(wide('grep -rln "a\\|withFileLock" .')).toBeUndefined(); // regex metachars
    expect(wide("find . -name '*.ts'")).toBeUndefined(); // filename question
    expect(wide("grep -rl withFileLock . | wc -l")).toBeUndefined(); // transforming pipe
  });

  test("the narrow default is unchanged in this same process", () => {
    // Guards the flag against leaking: the module imported here has it unset.
    expect(discoveryTarget('grep -rln "withFileLock" --include="*.ts" .')).toBeUndefined();
    expect(discoveryTarget("rg withFileLock")).toBe("withFileLock");
  });
});
