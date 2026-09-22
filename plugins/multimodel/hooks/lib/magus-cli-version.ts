#!/usr/bin/env bun
/**
 * The magus version check behind the SessionStart (matcher `startup`) hook
 * hooks/magus-version-check.ts, which relaunches this file with Bun's transpiler cache
 * off and `--config=/dev/null` (the entry point explains both). Run directly, it behaves
 * the same, except that Bun may cache this file's transpiled output and, without that
 * flag, runs the cwd's bunfig.toml `preload` first.
 *
 * WHY IT LIVES IN A PLUGIN. magus 7.0.0 through 7.3.0 ask npm about the bare
 * `magus` package, an unrelated project whose name we do not own. Their update banner
 * never fires and `magus upgrade` installs the wrong package, and an installed copy runs
 * its own old code, so it can never discover or install the release that fixes it. A
 * plugin updates from our marketplace independently of the magus version, which makes a
 * plugin hook the one channel that reaches those installs. The check itself is
 * version-agnostic — "the installed magus CLI is behind npm" — not a special case for 7.x.
 *
 * WHY EVERY HOOK-CARRYING PLUGIN HAS ITS OWN COPY. A plugin root must be self-contained:
 * the plugins install and update independently, so `code-search` cannot import out of
 * `dev`'s tree at runtime. Each of the six therefore carries this file verbatim, and
 * `scripts/check-hook-copies.ts` fails the build the moment two copies differ by a byte.
 *
 * ONE NOTICE AND ONE REQUEST, HOWEVER MANY COPIES ARE INSTALLED. All of them read and
 * write ONE shared cache directory, and the first to claim the marker is the only one
 * that does any work at all — see claimNotice, and the entry point that calls it before
 * anything else. The rest exit silently in milliseconds, having made no registry request.
 *
 * INPUTS ARE THE ENVIRONMENT ONLY. `PATH` finds `magus`, `npm_config_registry` names the
 * registry, `XDG_CACHE_HOME` (else `$HOME/.cache`) roots the cache. Stdin is never read:
 * the matcher already restricts this to `startup`, and a launcher that leaves stdin open
 * would otherwise hang the hook until the watchdog fires.
 *
 * INSTALLED VERSION. The npm/bun layout is `…/magus-cli/bin/magus.js`, so the manifest
 * two directories above the real path is authoritative when it names `magus-cli`. Only
 * without one does it run `magus --version`, which costs a process start.
 *
 * NEVER IN THE WAY. Exit 0 on every path and nothing on stderr. Each external call — the
 * registry fetch and `magus --version` — gets its own 1.5 s deadline, the two run
 * concurrently, and a watchdog exits silently at 2.4 s whatever is still pending, inside
 * the entry point's own 2.7 s. The only files it writes are the shared cache, and only
 * after a successful fetch, and the claim marker.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const NPM_PACKAGE = "magus-cli";
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
/** Per external call. The registry fetch and `magus --version` each get this long. */
export const CALL_TIMEOUT_MS = 1_500;
/** A successful registry answer is reused for this long without contacting the registry. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
/** Whole-process ceiling. The entry point's is 2.7 s, and the hook promises 3 s. */
const WATCHDOG_MS = 2_400;

type Env = Record<string, string | undefined>;

// ── Versions ────────────────────────────────────────────────────────────────

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a release. */
  prerelease: string[];
}

const FULL_SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A whole string that is one semver version (a manifest or registry field), else null. */
export function parseVersion(text: string): Version | null {
  const m = FULL_SEMVER.exec(text.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

/** The first `X.Y.Z` anywhere in command output: `magus v7.1.0` → 7.1.0. */
export function firstVersionIn(output: string): Version | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: [] };
}

export function formatVersion(v: Version): string {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease.length > 0 ? `${core}-${v.prerelease.join(".")}` : core;
}

/** Semver precedence (build metadata ignored). Negative when `a` is older than `b`. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  // A release outranks any prerelease of the same core version.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  const n = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) < Number(y) ? -1 : 1;
    if (xNum !== yNum) return xNum ? -1 : 1; // numeric identifiers sort first
    return x < y ? -1 : 1;
  }
  return a.prerelease.length - b.prerelease.length;
}

// ── What to tell the user ───────────────────────────────────────────────────

/**
 * The install command for the package manager that owns the install, judged by where
 * `magus` really lives. First match wins.
 *
 * It must be the owner's command. Any other one installs a second copy, the stale one
 * stays first on PATH, and this notice comes back every session. Bun's global layout is
 * `<BUN_INSTALL>/install/global/node_modules/…` under any BUN_INSTALL, and resolving the
 * `bin/magus` symlink drops the `bin` segment, so `/.bun/` alone misses a Bun that lives
 * elsewhere. npm's global layout is `lib/node_modules`, which never matches that.
 */
export function upgradeCommand(realBin: string): string {
  const viaBun = ["/.bun/", "bun/bin", "/install/global/node_modules/"].some((s) => realBin.includes(s));
  if (viaBun) return `bun add -g ${NPM_PACKAGE}@latest`;
  if (realBin.includes("/pnpm/")) return `pnpm add -g ${NPM_PACKAGE}@latest`;
  return `npm install -g ${NPM_PACKAGE}@latest`;
}

/**
 * The notice, shown to the user as `systemMessage` and to the model as context.
 *
 * It names only the package-qualified install command. The bare name must never appear
 * after `-g` or before `@latest`: that is precisely the command that installs the
 * unrelated package.
 */
export function composeNotice(installed: string, latest: string, command: string): string {
  return [
    `magus ${installed} is out of date; the latest magus-cli release is ${latest}.`,
    `"magus upgrade" is not enough on older versions: they ask npm about the wrong package and never install the update.`,
    `Update with: ${command}`,
  ].join(" ");
}

// ── Environment ─────────────────────────────────────────────────────────────

/** `<registry>/magus-cli/latest`, tolerating a trailing slash on the registry. */
export function registryLatestUrl(env: Env): string {
  const base = env.npm_config_registry?.trim() || DEFAULT_REGISTRY;
  return `${base.replace(/\/+$/, "")}/${NPM_PACKAGE}/latest`;
}

/**
 * `<XDG_CACHE_HOME or $HOME/.cache>/magus`, or null with neither.
 *
 * ONE DIRECTORY FOR EVERY COPY, deliberately. Six plugins carry this check; a directory
 * named after one of them would mean six registry requests a day instead of one, and six
 * independent claims of a notice that must print once.
 */
function sharedCacheDir(env: Env): string | null {
  const xdg = env.XDG_CACHE_HOME?.trim();
  const home = env.HOME?.trim();
  // The XDG spec says a relative value is invalid and must be ignored.
  const root = xdg && isAbsolute(xdg) ? xdg : home ? join(home, ".cache") : null;
  return root ? join(root, "magus") : null;
}

/** `<shared cache dir>/magus-version-check.json`, or null without a cache root. */
export function cacheFilePath(env: Env): string | null {
  const dir = sharedCacheDir(env);
  return dir ? join(dir, "magus-version-check.json") : null;
}

/** `<shared cache dir>/magus-version-notice.log`, or null without a cache root. */
export function markerFilePath(env: Env): string | null {
  const dir = sharedCacheDir(env);
  return dir ? join(dir, "magus-version-notice.log") : null;
}

// ── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  latest: string;
  /** Epoch ms of the fetch that produced `latest`. */
  checkedAt: number;
}

/**
 * The cached registry answer, or null when absent, unreadable or older than 24 hours.
 *
 * Age is judged by BOTH the recorded time and the file's mtime, whichever is older, so
 * an entry cannot outlive its TTL by being rewritten with a stale body or by having its
 * timestamp backdated. A timestamp in the future means the clock moved; distrust it.
 */
export function readCachedLatest(file: string, now: number): Version | null {
  try {
    const mtime = statSync(file).mtimeMs;
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<CacheEntry> | null;
    if (!data || typeof data.latest !== "string" || typeof data.checkedAt !== "number") return null;
    if (data.checkedAt > now) return null;
    if (now - Math.min(data.checkedAt, mtime) >= CACHE_TTL_MS) return null;
    return parseVersion(data.latest);
  } catch {
    return null;
  }
}

/** Best effort: a cache that cannot be written only costs the next session one fetch. */
function writeCachedLatest(file: string, latest: Version, now: number): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const entry: CacheEntry = { latest: formatVersion(latest), checkedAt: now };
    writeFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // Read-only or missing home: nothing to do.
  }
}

// ── One notice per session start ────────────────────────────────────────────

/**
 * How long a won claim holds.
 *
 * Every copy of this hook starts within a few hundred milliseconds of the others at one
 * session start, and the ones that lose exit immediately, so a handful of seconds covers
 * the spread with room to spare. It stays well short of a minute on purpose: this marker
 * is the only thing standing between two REAL session starts and a notice that prints
 * for just one of them.
 */
export const MARKER_TTL_MS = 15_000;

/**
 * How long an unwon bid holds anyone up.
 *
 * A bid is live only between the instant a caller appends it and the instant that same
 * caller reads the file back — microseconds of work, so seconds of grace are already
 * generous. It must stay far below MARKER_TTL_MS: a bid that LOST has no claim on
 * anything, and treating a stale one as though it did would silence the next session
 * start for no reason.
 */
const BID_TTL_MS = 2_000;

/** A marker this large was not written by this code; it is reset rather than parsed. */
const MARKER_MAX_BYTES = 64 * 1_024;

interface ClaimRecord {
  /** The `now` of the bid. Age is judged from this and nothing else. */
  t: number;
  /** Unique per call, so a caller can find its own record among the others. */
  id: string;
  /** 1 once the record's owner has established that it won. Absent on a bare bid. */
  w?: 1;
}

let claimSeq = 0;

function claimRecordId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${process.pid.toString(36)}-${(claimSeq++).toString(36)}-${rand}`;
}

function parseClaimRecord(line: string): ClaimRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const data = JSON.parse(trimmed) as Partial<ClaimRecord> | null;
    if (!data || typeof data.t !== "number" || typeof data.id !== "string") return null;
    return data.w === 1 ? { t: data.t, id: data.id, w: 1 } : { t: data.t, id: data.id };
  } catch {
    // A line we cannot read carries no claim, so it holds nobody up. That also means a
    // marker filled with junk heals on the next claim instead of silencing the notice
    // for as long as the junk sits there.
    return null;
  }
}

/** A record still worth respecting: a won claim for its TTL, a bare bid for far less. */
function blocking(record: ClaimRecord, now: number): boolean {
  return now - record.t < (record.w === 1 ? MARKER_TTL_MS : BID_TTL_MS);
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Claim the right to print for this session start: true for exactly one caller, and
 * false for every other one while that claim is fresh. A claim older than MARKER_TTL_MS
 * is stale, and the next session start reclaims it.
 *
 * ATOMICITY, AND WHY NOT AN EXCLUSIVE CREATE. Every caller appends a BID to the marker
 * and reads the file back; the caller whose bid sits at the lowest offset with nothing
 * live in front of it has won, and rewrites the file to that one record, marked. A small
 * O_APPEND write lands whole and at the end, so the kernel — not this code — orders
 * concurrent callers, and each of them sees every record that landed before its own.
 * Whoever appended first therefore wins and everybody else loses, with no window between
 * a test and a create for two callers to slip through.
 *
 * An exclusive create (`wx`) is atomic too, but only while the marker is absent.
 * Reclaiming a STALE marker with it takes an unlink and then a create, and the six hooks
 * of one session start all meet the same stale marker left by the previous session: they
 * can interleave those two steps so that more than one ends up holding a fresh marker.
 * Here that is the ordinary case, not an exotic one.
 *
 * WHY A BID AND A CLAIM AND NOT ONE KIND OF RECORD. A bid that lost is not evidence that
 * anything was printed, and it must not act like it. With one kind of record a loser's
 * bid outlives the winner's — it was written later — and goes on blocking claims after
 * the real one has expired, so the session that should print again stays silent.
 *
 * Age is judged from the RECORDED timestamp alone, never the file's mtime, so a caller
 * passing `now` explicitly gets the same answer whatever the wall clock reads. A record
 * stamped ahead of `now` blocks: two callers can compute their `now` in one order and
 * land their writes in the other, and the one that landed second must still lose.
 *
 * Nowhere to write means no coordination is possible, and that answers true — a
 * duplicated notice is a far smaller failure than a stranded install never hearing that
 * a fix exists.
 */
export function claimNotice(env: Env, now: number = Date.now()): boolean {
  const file = markerFilePath(env);
  if (!file) return true; // No cache root: no coordination, so do not suppress.

  const id = claimRecordId();
  const bid = `${JSON.stringify({ t: now, id })}\n`;
  const claim = `${JSON.stringify({ t: now, id, w: 1 })}\n`;

  try {
    mkdirSync(dirname(file), { recursive: true });
    if (fileSize(file) > MARKER_MAX_BYTES) {
      writeFileSync(file, claim);
      return true;
    }
    appendFileSync(file, bid);
  } catch {
    return true; // An unwritable cache root: same as having nowhere to write.
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // The bid is in but cannot be read back: another caller may hold the claim already.
    return false;
  }

  for (const entry of text.split("\n")) {
    const other = parseClaimRecord(entry);
    if (!other) continue;
    if (other.id !== id) {
      if (blocking(other, now)) return false;
      continue;
    }
    // Our own bid, with nothing live in front of it. Recording the win also compacts the
    // marker: a caller whose bid this truncates finds the fresh claim instead and loses,
    // which is the answer it was going to get anyway.
    try {
      writeFileSync(file, claim);
    } catch {
      // The win stands; only the record of it is missing.
    }
    return true;
  }
  // Our own bid is gone: a winner rewrote the file out from under us.
  return false;
}

// ── External calls, each under its own deadline ─────────────────────────────

/** Settle with `fallback` on rejection or after `ms`, calling `onTimeout` to stop the work. */
function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => void, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        // The work is abandoned either way.
      }
      resolve(fallback);
    }, ms);
  });
  return Promise.race([work.catch(() => fallback), deadline]).finally(() => clearTimeout(timer));
}

/** The registry's `latest` for magus-cli, or null on any failure, non-2xx or timeout. */
async function fetchLatest(url: string): Promise<Version | null> {
  const controller = new AbortController();
  const work = (async () => {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const version = body && typeof body === "object" ? (body as { version?: unknown }).version : undefined;
    return typeof version === "string" ? parseVersion(version) : null;
  })();
  return withDeadline(work, CALL_TIMEOUT_MS, () => controller.abort(), null);
}

/** Cached if fresh; otherwise fetched, and cached only when the fetch succeeded. */
async function latestVersion(env: Env, now: number): Promise<Version | null> {
  const file = cacheFilePath(env);
  const cached = file ? readCachedLatest(file, now) : null;
  if (cached) return cached;
  const fetched = await fetchLatest(registryLatestUrl(env));
  if (fetched && file) writeCachedLatest(file, fetched, now);
  return fetched;
}

type ManifestResult = { kind: "manifest"; version: Version | null } | { kind: "none" };

/** `…/magus-cli/bin/magus.js` → `…/magus-cli/package.json`, when that manifest names magus-cli. */
function versionFromManifest(realBin: string): ManifestResult {
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(join(dirname(dirname(realBin)), "package.json"), "utf8"));
  } catch {
    return { kind: "none" };
  }
  if (!pkg || typeof pkg !== "object") return { kind: "none" };
  const { name, version } = pkg as { name?: unknown; version?: unknown };
  if (name !== NPM_PACKAGE) return { kind: "none" };
  return { kind: "manifest", version: typeof version === "string" ? parseVersion(version) : null };
}

/**
 * `magus --version`, parsed. Racing the stdout read against the deadline matters: killing
 * a wrapper script leaves its children holding the pipe, so waiting for EOF could hang.
 *
 * It runs from `/`, not the user's project. `magus` may itself be a `#!/usr/bin/env bun`
 * script, and that bun would run the project's bunfig.toml `preload` and read its `.env`:
 * a preload that prints `9.9.9` became the installed version, and one that fails or sleeps
 * lost the notice. Only root can put a bunfig.toml in `/`, and Bun does not search parent
 * directories for one. The path is made absolute first, since a relative PATH entry would
 * otherwise resolve against `/`.
 */
async function versionFromCommand(bin: string): Promise<Version | null> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([resolve(bin), "--version"], { cwd: "/", stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch {
    return null;
  }
  const stdout = proc.stdout;
  if (!(stdout instanceof ReadableStream)) return null;
  const text = await withDeadline(new Response(stdout).text(), CALL_TIMEOUT_MS, () => proc.kill("SIGKILL"), null);
  return text === null ? null : firstVersionIn(text);
}

function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** The hook's stdout payload when magus is behind npm, else null. */
export async function check(env: Env, now: number): Promise<string | null> {
  const bin = Bun.which("magus", { PATH: env.PATH ?? "" });
  if (!bin) return null;
  const realBin = realPathOf(bin);

  const manifest = versionFromManifest(realBin);
  if (manifest.kind === "manifest" && !manifest.version) return null; // unparseable

  const [installed, latest] = await Promise.all([
    manifest.kind === "manifest" ? Promise.resolve(manifest.version) : versionFromCommand(bin),
    latestVersion(env, now),
  ]);
  if (!installed || !latest || compareVersions(installed, latest) >= 0) return null;

  const message = composeNotice(formatVersion(installed), formatVersion(latest), upgradeCommand(realBin));
  return JSON.stringify({
    systemMessage: message,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: message },
  });
}

if (import.meta.main) {
  const silentExit = (): never => process.exit(0);
  // A broken hook must never cost the user their session, or print a stack trace into it.
  process.on("uncaughtException", silentExit);
  process.on("unhandledRejection", silentExit);
  setTimeout(silentExit, WATCHDOG_MS).unref();

  try {
    const now = Date.now();
    // The claim comes FIRST, before any work. Losing it means another installed copy is
    // already handling this session start, so this one makes no registry request, spawns
    // no `magus --version`, writes no cache and prints nothing: R11.3's single request
    // per 24 hours holds even on the cold cache of the day, when all six would otherwise
    // fetch at once.
    if (claimNotice(process.env, now)) {
      const payload = await check(process.env, now);
      if (payload) await new Promise<void>((resolve) => process.stdout.write(payload, () => resolve()));
    }
  } catch {
    // Silence is the only failure mode this hook has.
  }
  process.exit(0);
}
