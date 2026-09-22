/**
 * Black box tests for contract C21 of `hooks/lib/magus-cli-version.ts`:
 * the seams that make the stale-magus notice print AT MOST ONCE per session start
 * (R11.2) while every installed plugin shares ONE registry answer (R11.3).
 *
 * Written from `ai-docs/sessions/magus-tui-fixes-2026-09-18/requirements.md` (R11) and
 * `architecture.md` (C21) only. No implementation file was read — not the library under
 * test, not the hook that calls it. The module is imported as a NAMESPACE on purpose:
 * a missing export then fails the individual test that needs it, with a message naming
 * the signature C21 promises, instead of killing the whole file with a link error.
 *
 * Surface under test (C21):
 *   cacheFilePath(env): string | null
 *   markerFilePath(env): string | null
 *   claimNotice(env, now?): boolean
 *   MARKER_TTL_MS: number      // short — seconds, not minutes
 *   CACHE_TTL_MS: number       // 24h, unchanged
 *
 * USER STATE SAFETY. Every call gets an explicit `env` whose HOME and XDG_CACHE_HOME are
 * fresh temp dirs, removed after the test. Before any in-process `claimNotice` the helper
 * asks `markerFilePath` where it would write and REFUSES to run when that is outside the
 * sandbox, so an implementation that ignored `env` (e.g. via `os.homedir()`, which per the
 * architecture's C2 correction does not follow a runtime HOME change) cannot reach the real
 * `~/.cache`. Child processes in the race test get HOME replaced at launch as well, which
 * closes the `os.homedir()` route for them too. The last test re-checks the real cache
 * directory and fails if anything magus-shaped appeared there.
 *
 * Assumptions (stated, not derived from any source):
 *   A1 "short — seconds, not minutes" is read as MARKER_TTL_MS < 60_000 ms. Asserted in its
 *      own test so a disagreement about the exact ceiling cannot mask the other TTL rules.
 *   A2 Staleness is exercised through the documented `now` parameter, never by backdating a
 *      file's mtime: C21 does not say where the marker's timestamp lives, and mtime would be
 *      a guess about the implementation. Every `now` is anchored to a real `Date.now()`, so
 *      the assertions hold whether the marker records the passed `now` or the wall clock.
 *   A3 "the directory name is shared across plugins" is checked as: the path from
 *      XDG_CACHE_HOME down to the file names none of the six hook-carrying plugins.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

import * as lib from "./lib/magus-cli-version.ts";

// ---------------------------------------------------------------------------
// The C21 surface, as a shape this test can check at runtime
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

interface Seams {
  cacheFilePath?: (env: Env) => string | null;
  markerFilePath?: (env: Env) => string | null;
  claimNotice?: (env: Env, now?: number) => boolean;
  MARKER_TTL_MS?: number;
  CACHE_TTL_MS?: number;
}

const LIB_REL = "plugins/dev/hooks/lib/magus-cli-version.ts";
const seams = lib as unknown as Seams;

function missing(signature: string): Error {
  return new Error(`C21 seam missing: ${LIB_REL} must export \`${signature}\``);
}

function cacheFilePath(env: Env): string | null {
  const fn = seams.cacheFilePath;
  if (typeof fn !== "function") throw missing("function cacheFilePath(env): string | null");
  return fn(env);
}

function markerFilePath(env: Env): string | null {
  const fn = seams.markerFilePath;
  if (typeof fn !== "function") throw missing("function markerFilePath(env): string | null");
  return fn(env);
}

function claimNotice(env: Env, now?: number): boolean {
  const fn = seams.claimNotice;
  if (typeof fn !== "function") throw missing("function claimNotice(env, now?): boolean");
  return now === undefined ? fn(env) : fn(env, now);
}

function markerTtlMs(): number {
  const v = seams.MARKER_TTL_MS;
  if (typeof v !== "number" || !Number.isFinite(v)) throw missing("const MARKER_TTL_MS: number");
  return v;
}

function cacheTtlMs(): number {
  const v = seams.CACHE_TTL_MS;
  if (typeof v !== "number" || !Number.isFinite(v)) throw missing("const CACHE_TTL_MS: number");
  return v;
}

/** The plugins that carry a copy of the check (R11.1). None may name the shared dir. */
const PLUGIN_NAMES = ["dev", "code-search", "terminal", "multimodel", "stats", "madbench"];

const HOUR_MS = 60 * 60 * 1000;
const RACE_CHILDREN = 8;
const RACE_ROUNDS = 3;

// ---------------------------------------------------------------------------
// Sandbox — nothing outside `base` is ever written
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    try {
      cleanups.pop()!();
    } catch {
      // best effort
    }
  }
});

interface Sandbox {
  /** Removed after the test. Everything below it is fair game; nothing above it is. */
  base: string;
  /** Same directory as `base`, with symlinks resolved (macOS: /var → /private/var). */
  realBase: string;
  /** HOME for the env objects. Exists. */
  home: string;
  /** XDG_CACHE_HOME for the env objects. Exists, empty. */
  cache: string;
  /** A path under `base` that does NOT exist — the claim must create what it needs. */
  missingCache: string;
  /** HOME + XDG_CACHE_HOME, the normal case. */
  env: Env;
}

function sandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), "mnc-"));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "home");
  const cache = join(base, "xdg-cache");
  mkdirSync(home, { recursive: true });
  mkdirSync(cache, { recursive: true });
  return {
    base,
    realBase: realpathSync(base),
    home,
    cache,
    missingCache: join(base, "not-created-yet", "cache"),
    env: { HOME: home, XDG_CACHE_HOME: cache },
  };
}

function isUnder(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function insideSandbox(sb: Sandbox, candidate: string): boolean {
  return isUnder(sb.base, candidate) || isUnder(sb.realBase, candidate);
}

/**
 * `claimNotice`, gated on the seam's own answer about where it writes. The gate is the
 * safety net for the real `~/.cache`: an implementation resolving the home directory by
 * some route other than `env` is refused here instead of touching user state.
 */
function claim(sb: Sandbox, env: Env, now?: number): boolean {
  const marker = markerFilePath(env);
  if (marker === null || !insideSandbox(sb, marker)) {
    throw new Error(
      `refusing to call claimNotice: markerFilePath() answered ${String(marker)}, which is ` +
        `outside the test sandbox ${sb.base}. The seams must resolve paths from the \`env\` ` +
        `argument only (C21), never from the process environment or os.homedir().`,
    );
  }
  return claimNotice(env, now);
}

/** The path from XDG_CACHE_HOME down to `file`, lowercased, "/"-joined. */
function relToCacheRoot(cacheRoot: string, file: string): string {
  return relative(cacheRoot, file).split(/[\\/]/).join("/").toLowerCase();
}

// ---------------------------------------------------------------------------
// R11.3 — one shared location, not one per plugin
// ---------------------------------------------------------------------------

describe("C21 cacheFilePath / markerFilePath (R11.3)", () => {
  test("R11.3 TEST-1: both paths are absolute and under the XDG_CACHE_HOME that was passed", () => {
    const sb = sandbox();
    const cachePath = cacheFilePath(sb.env);
    const markerPath = markerFilePath(sb.env);

    expect(typeof cachePath).toBe("string");
    expect(typeof markerPath).toBe("string");
    expect(isAbsolute(cachePath as string)).toBe(true);
    expect(isAbsolute(markerPath as string)).toBe(true);
    expect(isUnder(sb.cache, cachePath as string)).toBe(true);
    expect(isUnder(sb.cache, markerPath as string)).toBe(true);
  });

  test("R11.3 TEST-2: the cache file and the marker sit in the SAME directory", () => {
    const sb = sandbox();
    const cacheDir = dirname(cacheFilePath(sb.env) as string);
    const markerDir = dirname(markerFilePath(sb.env) as string);

    expect(markerDir).toBe(cacheDir);
    // and that directory is a level below the cache root, not the cache root itself
    expect(isUnder(sb.cache, cacheDir)).toBe(true);
  });

  test("R11.3 TEST-3: the shared directory is not named after any one plugin", () => {
    const sb = sandbox();
    const cacheRel = relToCacheRoot(sb.cache, cacheFilePath(sb.env) as string);
    const markerRel = relToCacheRoot(sb.cache, markerFilePath(sb.env) as string);

    for (const plugin of PLUGIN_NAMES) {
      expect(
        `${cacheRel}\n${markerRel}`.includes(plugin)
          ? `plugin-specific path: cache=${cacheRel} marker=${markerRel} names "${plugin}"`
          : "shared",
      ).toBe("shared");
    }
  });

  test("R11.3 TEST-4: no XDG_CACHE_HOME falls back to $HOME/.cache", () => {
    const sb = sandbox();
    const env: Env = { HOME: sb.home };
    const dotCache = join(sb.home, ".cache");

    expect(isUnder(dotCache, cacheFilePath(env) as string)).toBe(true);
    expect(isUnder(dotCache, markerFilePath(env) as string)).toBe(true);
  });

  test("R11.3 TEST-5: with neither XDG_CACHE_HOME nor HOME both seams return null", () => {
    expect(cacheFilePath({})).toBeNull();
    expect(markerFilePath({})).toBeNull();
  });

  test("R11.3 TEST-6: a relative XDG_CACHE_HOME is ignored and falls back to $HOME/.cache", () => {
    const sb = sandbox();
    const env: Env = { HOME: sb.home, XDG_CACHE_HOME: join("relative", "cache") };
    const dotCache = join(sb.home, ".cache");

    const cachePath = cacheFilePath(env) as string;
    const markerPath = markerFilePath(env) as string;

    expect(isAbsolute(cachePath)).toBe(true);
    expect(isUnder(dotCache, cachePath)).toBe(true);
    expect(isUnder(dotCache, markerPath)).toBe(true);
  });

  test("R11.3 TEST-7: a relative XDG_CACHE_HOME with no HOME returns null", () => {
    const env: Env = { XDG_CACHE_HOME: join("relative", "cache") };
    expect(cacheFilePath(env)).toBeNull();
    expect(markerFilePath(env)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R11.2 — the notice is claimed once
// ---------------------------------------------------------------------------

describe("C21 claimNotice claims once (R11.2)", () => {
  test("R11.2 TEST-8: the first call wins and the next five all lose", () => {
    const sb = sandbox();

    expect(claim(sb, sb.env)).toBe(true);
    for (let i = 2; i <= 6; i++) {
      expect(`call ${i}: ${claim(sb, sb.env)}`).toBe(`call ${i}: false`);
    }
  });

  test("R11.2 TEST-9: the claim works when the cache directory does not exist yet", () => {
    const sb = sandbox();
    const env: Env = { HOME: sb.home, XDG_CACHE_HOME: sb.missingCache };
    expect(existsSync(sb.missingCache)).toBe(false);

    expect(claim(sb, env)).toBe(true);
    expect(claim(sb, env)).toBe(false);
  });

  test("R11.2 TEST-10 (control): a successful claim writes the marker file", () => {
    const sb = sandbox();
    const markerPath = markerFilePath(sb.env) as string;

    expect(existsSync(markerPath)).toBe(false);
    expect(claim(sb, sb.env)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);
  });

  test("R11.2 TEST-11 (control): a separate cache directory is claimed on its own", () => {
    const sb = sandbox();
    const other = join(sb.base, "xdg-cache-2");
    mkdirSync(other, { recursive: true });
    const otherEnv: Env = { HOME: sb.home, XDG_CACHE_HOME: other };

    expect(claim(sb, sb.env)).toBe(true);
    expect(claim(sb, sb.env)).toBe(false);
    // A different cache root is a different session's state: it must still be claimable.
    expect(claim(sb, otherEnv)).toBe(true);
    expect(claim(sb, otherEnv)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R11.2 — racing callers: several plugins' hooks start in the same instant
// ---------------------------------------------------------------------------

const RACE_CHILD = `
const startAt = Number(process.argv[2]);
const libPath = process.argv[3];
const env = { HOME: process.argv[4], XDG_CACHE_HOME: process.argv[5] };

let mod;
try {
  mod = await import(libPath);
} catch (err) {
  console.log("ERR import: " + String(err && err.message ? err.message : err));
  process.exit(0);
}

// All children converge on the same wall-clock instant: sleep most of the way, spin the rest.
const lead = startAt - Date.now();
if (lead > 10) Bun.sleepSync(lead - 10);
while (Date.now() < startAt) { /* spin into the instant */ }

try {
  if (typeof mod.claimNotice !== "function") {
    console.log("ERR: claimNotice is not exported");
  } else {
    const won = mod.claimNotice(env);
    console.log(won === true ? "WIN" : won === false ? "LOSE" : "ERR: non-boolean " + String(won));
  }
} catch (err) {
  console.log("ERR: " + String(err && err.message ? err.message : err));
}
`;

describe("C21 claimNotice under contention (R11.2)", () => {
  test(
    `R11.2 TEST-12: ${RACE_CHILDREN} processes claiming in the same instant, exactly one wins (x${RACE_ROUNDS})`,
    async () => {
      const sb = sandbox();
      const childPath = join(sb.base, "race-child.ts");
      writeFileSync(childPath, RACE_CHILD);
      const libPath = join(import.meta.dir, "lib", "magus-cli-version.ts");

      for (let round = 1; round <= RACE_ROUNDS; round++) {
        const cache = join(sb.base, `race-cache-${round}`);
        const home = join(sb.base, `race-home-${round}`);
        mkdirSync(cache, { recursive: true });
        mkdirSync(home, { recursive: true });

        // Long enough for every child to boot bun and import the library before the instant.
        const startAt = Date.now() + 1500;
        const children = Array.from({ length: RACE_CHILDREN }, () =>
          Bun.spawn({
            cmd: [
              "bun",
              "--env-file=/dev/null",
              "--config=/dev/null",
              childPath,
              String(startAt),
              libPath,
              home,
              cache,
            ],
            cwd: sb.base,
            // Replaced environment: HOME is the temp home AT LAUNCH, so even os.homedir()
            // inside the child cannot reach the real cache.
            env: {
              PATH: process.env.PATH ?? "",
              HOME: home,
              XDG_CACHE_HOME: cache,
              TMPDIR: process.env.TMPDIR ?? "/tmp",
            },
            stdout: "pipe",
            stderr: "pipe",
          }),
        );

        const answers = await Promise.all(
          children.map(async (child) => {
            const [out, err] = await Promise.all([
              new Response(child.stdout).text(),
              new Response(child.stderr).text(),
            ]);
            await child.exited;
            const lines = out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
            const last = lines[lines.length - 1] ?? `ERR: no output (stderr: ${err.trim()})`;
            return last;
          }),
        );

        const errors = answers.filter((a) => a.startsWith("ERR"));
        expect(`round ${round} errors: ${errors.join(" | ")}`).toBe(`round ${round} errors: `);

        const wins = answers.filter((a) => a === "WIN").length;
        const loses = answers.filter((a) => a === "LOSE").length;
        expect(`round ${round}: ${wins} win / ${loses} lose`).toBe(
          `round ${round}: 1 win / ${RACE_CHILDREN - 1} lose`,
        );
      }
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// Marker staleness and the two TTLs
// ---------------------------------------------------------------------------

describe("C21 MARKER_TTL_MS / CACHE_TTL_MS", () => {
  test("R11.2 TEST-13: a marker inside its TTL blocks; one past it is reclaimable", () => {
    const sb = sandbox();
    const ttl = markerTtlMs();
    const t0 = Date.now();

    expect(claim(sb, sb.env, t0)).toBe(true);
    // Half a TTL later the notice has already been printed for this session start.
    expect(claim(sb, sb.env, t0 + Math.floor(ttl / 2))).toBe(false);
    // Past the TTL the marker is stale: the next session prints again.
    const stale = t0 + ttl + 5_000;
    expect(claim(sb, sb.env, stale)).toBe(true);
    // Reclaiming re-stamps the marker, so the callers behind it stay silent.
    expect(claim(sb, sb.env, stale + Math.floor(ttl / 2))).toBe(false);
  });

  test("R11.2 TEST-14: MARKER_TTL_MS is positive and well under CACHE_TTL_MS", () => {
    const marker = markerTtlMs();
    const cache = cacheTtlMs();

    expect(marker).toBeGreaterThan(0);
    expect(marker).toBeLessThan(cache);
    expect(marker).toBeLessThanOrEqual(cache / 100);
  });

  test("R11.3 TEST-15: CACHE_TTL_MS is 24 hours", () => {
    expect(cacheTtlMs()).toBe(24 * HOUR_MS);
  });

  test("R11.2 TEST-16 (assumption A1): MARKER_TTL_MS is seconds, not minutes", () => {
    const marker = markerTtlMs();
    expect(marker).toBeGreaterThanOrEqual(1_000);
    expect(marker).toBeLessThan(60_000);
  });
});

// ---------------------------------------------------------------------------
// Safety net — nothing magus-shaped appeared in the real cache
// ---------------------------------------------------------------------------

/** Names under the real cache roots that a leak would create. Recorded before any test runs. */
function realCacheNames(): string {
  const roots = [process.env.XDG_CACHE_HOME, join(homedir(), ".cache")].filter(
    (r): r is string => typeof r === "string" && r.length > 0 && isAbsolute(r),
  );
  const seen: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      seen.push(`${root}: <absent>`);
      continue;
    }
    let entries: string[] = [];
    try {
      entries = readdirSync(root).filter((name) => name.toLowerCase().startsWith("magus")).sort();
    } catch {
      entries = ["<unreadable>"];
    }
    const detail = entries.map((name) => {
      try {
        return `${name}[${readdirSync(join(root, name)).sort().join(",")}]`;
      } catch {
        return name;
      }
    });
    seen.push(`${root}: ${detail.join(" ")}`);
  }
  return seen.join("\n");
}

const REAL_CACHE_BEFORE = realCacheNames();

describe("user state", () => {
  test("R11.2/R11.3 TEST-17: the real user cache gained nothing during these tests", () => {
    expect(realCacheNames()).toBe(REAL_CACHE_BEFORE);
  });
});
