/**
 * p08-sourcing-cost.test.ts — the promoted P0-8 probe reports a number only when every rep
 * measured something, and fails loudly otherwise (code review, outer iteration 3).
 *
 * Exit contract (the probe's header): 0 every line measured; 1 a void measurement (a rep
 * failed, unexpected output, NO-WRAPPER in any rep); 2 bad arguments or a missing
 * prerequisite. A failed rep or unexpected output prints nothing on stdout.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSETS_DIR, captureSync, MAIN_NAME } from "./grep-merge-harness";

const PROBE = join(import.meta.dir, "p08-sourcing-cost.sh");
const ASSET = join(ASSETS_DIR, MAIN_NAME);
const PATH = process.env["PATH"] ?? "/usr/bin:/bin";
const SHELLS = ["/bin/zsh", "/bin/bash"].filter((s) => existsSync(s));
const LINE = /^\/bin\/(zsh|bash) lines=[13] N=\d+ per-call cost \(ms\):( -?\d+\.\d{3}){5} {2}median=-?\d+\.\d{3} {2}\[(wrapper-defined|NO-WRAPPER)\]$/u;

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "csgm-p08-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function probe(args: string[], env: Record<string, string> = {}): { rc: number; stdout: string; stderr: string } {
  return captureSync("/bin/sh", [PROBE, ...args], { PATH, HOME: dir, TMPDIR: dir, ...env });
}

/** A PATH directory holding every tool the probe needs except those named. */
function pathWithout(...missing: string[]): string {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const tool of ["perl", "mktemp", "sed", "sort", "head", "cat", "rm", "dirname", "basename"]) {
    if (missing.includes(tool)) continue;
    const found = captureSync("/bin/sh", ["-c", `command -v ${tool}`], { PATH }).stdout.trim();
    if (found.startsWith("/")) symlinkSync(found, join(bin, tool));
  }
  return bin;
}

describe("p08-sourcing-cost.sh", () => {
  test("healthy: rc 0, one wrapper-defined line per shell and line count, nothing on stderr", () => {
    const r = probe([ASSET, "5"]);
    expect({ rc: r.rc, stderr: r.stderr }).toEqual({ rc: 0, stderr: "" });
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(SHELLS.length * 2);
    for (const line of lines) {
      expect(line).toMatch(LINE);
      expect(line).toEndWith("[wrapper-defined]");
    }
  }, 60_000);

  test("no arguments, or a non-numeric N: rc 2, usage on stderr", () => {
    for (const args of [[], [ASSET, "x"], [ASSET, "0"]]) {
      const r = probe(args);
      expect(r.rc).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("usage:");
    }
  });

  test("perl missing: rc 2, the prerequisite named, no numbers", () => {
    const r = probe([ASSET, "5"], { PATH: pathWithout("perl") });
    expect(r.rc).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("p08: missing prerequisite: perl\n");
  });

  test("a rep that fails (the clock cannot be read): rc 1, no numbers on stdout", () => {
    const fake = join(dir, "fake");
    mkdirSync(fake);
    // Passes the preflight (`perl -MTime::HiRes=time -e 1`), fails every real use.
    writeFileSync(join(fake, "perl"), '#!/bin/sh\ncase "$*" in *"-e 1") exit 0 ;; esac\nexit 1\n');
    chmodSync(join(fake, "perl"), 0o755);
    const r = probe([ASSET, "5"], { PATH: `${fake}:${PATH}` });
    expect(r.rc).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^p08: \/bin\/(zsh|bash) base run failed \(lines=1, rep=1\); no numbers printed\n$/u);
  }, 60_000);

  test("NO-WRAPPER in the first rep only: that line says NO-WRAPPER, rc 1", () => {
    // The stand-in asset loads the real one except on its 2nd sourcing: the first src rep's
    // sanity eval (N=1: one eval in the loop, then the sanity eval). Every later rep loads.
    const asset = join(dir, "flaky.sh");
    const counter = join(dir, "count");
    writeFileSync(
      asset,
      `__t_c=$(cat "$P08_COUNTER" 2>/dev/null || echo 0); __t_c=$((__t_c + 1)); echo "$__t_c" >"$P08_COUNTER"\n` +
        `if [ "$__t_c" != 2 ]; then builtin . '${ASSET}'; fi\n`,
    );
    const r = probe([asset, "1"], { P08_COUNTER: counter });
    expect(r.rc).toBe(1);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(SHELLS.length * 2);
    for (const line of lines) expect(line).toMatch(LINE);
    expect(lines[0]).toEndWith("[NO-WRAPPER]");
    for (const line of lines.slice(1)) expect(line).toEndWith("[wrapper-defined]");
    expect(r.stderr).toContain("NO-WRAPPER in at least one rep");
  }, 60_000);

  test("an asset that defines nothing: every line NO-WRAPPER, rc 1", () => {
    const empty = join(dir, "empty.sh");
    writeFileSync(empty, ":\n");
    const r = probe([empty, "2"]);
    expect(r.rc).toBe(1);
    for (const line of r.stdout.trimEnd().split("\n")) expect(line).toEndWith("[NO-WRAPPER]");
  }, 60_000);

  test("an env line that prints output: rc 1, UNEXPECTED OUTPUT on stderr, no numbers", () => {
    const noisy = join(dir, "noisy.sh");
    writeFileSync(noisy, `echo stray\nbuiltin . '${ASSET}'\n`);
    const r = probe([noisy, "2"]);
    expect(r.rc).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("UNEXPECTED OUTPUT");
    expect(r.stderr).toContain("stray");
  }, 60_000);
});
