/**
 * port.ts — the real `GrepPort`: the oracle spawn, candidate reads, realpath, the clock;
 * and `resolveOracleBin`, which picks the oracle's binary once at startup (D13).
 *
 * Everything `service.ts` needs from the operating system, and nothing it decides. The
 * engine search is injected by the composition root, because only `server.ts` may know
 * which engine is active and how to reach it.
 *
 * A CLAUDE ORACLE IS SPAWNED WITH `spawn` AND `argv0: "rg"`, NEVER `execFile`. Claude
 * Code's binary runs its embedded ripgrep only when its argv[0] is `rg`. Measured under
 * Bun 1.4.0 (2026-10-02): `spawn` and `Bun.spawn` honour `argv0`; `execFile` silently
 * ignores it and runs Claude Code itself, which exits 0 with its version string, so an
 * `execFile` oracle would fail without an error.
 */

import { spawn } from "node:child_process";
import { accessSync, closeSync, constants as fsConstants, openSync, readSync, realpathSync, statSync } from "node:fs";
import { lstat, open, realpath as fsRealpath, stat } from "node:fs/promises";

/** `lstat` from `node:fs/promises`, injectable so a test can stall one call (review round 6). */
type Lstat = typeof lstat;
import type { Stats } from "node:fs";
import {
  ORACLE_MAX_PATHS,
  RECENT_MTIME_MS,
  type EngineSearchResult,
  type FileId,
  type GrepPort,
  type OracleBin,
  type ReadResult,
  type WalkResult,
} from "./service";

// ---------------------------------------------------------------------------
// The oracle binary (D13)
// ---------------------------------------------------------------------------

/** What `resolveOracleBin` found, and every candidate it looked at, for the one startup
 *  log line (`oracle unavailable: <tried>`) and for setup's report. */
export interface OracleResolution {
  bin: OracleBin | undefined;
  tried: string[];
}

/** Regular (symlinks followed), executable by this process, and not a `#!` script. */
function nativeExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    const fd = openSync(path, "r");
    try {
      const head = Buffer.alloc(2);
      const n = readSync(fd, head, 0, 2, 0);
      return !(n === 2 && head[0] === 0x23 && head[1] === 0x21);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** Revision 5's name rule: `…/claude`, `…/claude.exe` or `…/claude/versions/<v>`. */
function claudeNamed(path: string): boolean {
  return /\/claude(?:\.exe)?$/u.test(path) || /\/claude\/versions\/[^/]+$/u.test(path);
}

/** The native rule for a claude candidate. The name may hold on the path itself or on
 *  its realpath: `~/.local/bin/claude` is a symlink into `…/claude/versions/<v>`. */
function nativeClaude(path: string): boolean {
  if (!path.startsWith("/") || !nativeExecutable(path)) return false;
  if (claudeNamed(path)) return true;
  try {
    return claudeNamed(realpathSync(path));
  } catch {
    return false;
  }
}

/** The first absolute PATH entry holding an executable file named `name`, in PATH order,
 *  optionally skipping entries `accept` refuses. */
function onPath(pathVar: string | undefined, name: string, accept?: (p: string) => boolean): string[] {
  const found: string[] = [];
  for (const dir of (pathVar ?? "").split(":")) {
    if (!dir.startsWith("/")) continue;
    const path = `${dir.replace(/\/+$/u, "")}/${name}`;
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, fsConstants.X_OK);
    } catch {
      continue;
    }
    found.push(path);
    if (accept === undefined || accept(path)) break;
  }
  return found;
}

/**
 * D13, in order; the first that passes wins:
 *   1. `$HOME/.local/bin/claude` (skipped when HOME is unset or empty);
 *   2. the first `claude` on PATH;
 *   3. the first `rg` on PATH whose first two bytes are not `#!`, spawned plainly.
 * Claude candidates must pass the native rule and are spawned with `argv0: "rg"`. No
 * FFI and no lookup of the parent process: the plain candidates cover the native
 * installer and PATH installs, and a claude build other than the parent's only scopes
 * the search, so a difference can cost recall, never a wrong extra (D8).
 */
export function resolveOracleBin(env: Readonly<Record<string, string | undefined>>): OracleResolution {
  const tried: string[] = [];
  const home = env["HOME"];
  if (home !== undefined && home !== "") {
    const local = `${home.replace(/\/+$/u, "")}/.local/bin/claude`;
    tried.push(local);
    if (nativeClaude(local)) return { bin: { path: local, argv0: "rg" }, tried };
  } else {
    tried.push("$HOME/.local/bin/claude (HOME unset)");
  }

  const [claude] = onPath(env["PATH"], "claude");
  if (claude !== undefined) {
    tried.push(claude);
    if (nativeClaude(claude)) return { bin: { path: claude, argv0: "rg" }, tried };
  } else {
    tried.push("claude on PATH (none)");
  }

  const rgs = onPath(env["PATH"], "rg", nativeExecutable);
  tried.push(...(rgs.length > 0 ? rgs : ["rg on PATH (none)"]));
  const rg = rgs.at(-1);
  if (rg !== undefined && nativeExecutable(rg)) return { bin: { path: rg }, tried };
  return { bin: undefined, tried };
}

/** Bytes per read; a candidate is at most `MAX_FILE_BYTES`, so a handful of reads. */
const READ_CHUNK = 256 * 1024;

const pathDecoder = new TextDecoder("utf-8", { fatal: true });

function fileId(s: Stats): FileId {
  return { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs };
}

/**
 * `rg --files --null` output to paths, without the leading "./". A path that is not
 * valid UTF-8 is skipped: an engine path is a JS string, so it could never equal one,
 * and decoding it lossily could make it equal a different file's name.
 */
function splitPaths(chunks: readonly Uint8Array[], total: number): string[] {
  const all = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const paths: string[] = [];
  let start = 0;
  for (let i = 0; i < all.length; i += 1) {
    if (all[i] !== 0) continue;
    if (i > start) {
      try {
        const path = pathDecoder.decode(all.subarray(start, i));
        paths.push(path.startsWith("./") ? path.slice(2) : path);
      } catch {
        // Not UTF-8: see above.
      }
    }
    start = i + 1;
  }
  return paths;
}

/**
 * A candidate's path, pinned: every directory from the project root down to the file's
 * parent (dev, ino and change time, to the nanosecond) and the file's own dev:ino.
 *
 * WHY. A containment check by path (`realpath` under the root) and the `open` after it
 * resolve the path twice. If a directory on the way is swapped for a symlink in between,
 * the open lands outside the project while the check said inside; O_NOFOLLOW guards the
 * last component only. Node has no `openat`, so the open cannot be made relative to a
 * pinned directory. Instead the read is bound after the fact:
 *   1. pin: each directory is lstat'ed (a symlink is not a directory: refused), and its
 *      change time must be at least RECENT_MTIME_MS old;
 *   2. the opened file's inode must be the pinned file's;
 *   3. after the read, every pin is taken again and must be identical.
 * Any rename, link, unlink or symlink creation inside a directory moves that directory's
 * change time, and the kernel sets it to "now", which a stable pin is older than by more
 * than any timestamp granularity. So if step 3 holds, no directory on the path changed
 * between step 1 and step 3, the open in between resolved through the very directories
 * pinned in step 1, and step 2 confirms it reached the pinned file. The root is pinned like
 * every other directory on the path (the loop below starts at it). A directory changed in
 * the last two seconds costs a missed extra for its files, never a wrong one.
 */
interface Pin {
  dirs: { path: string; id: string }[];
  file: string;
}

async function pinChain(
  root: string,
  absPath: string,
  now: number,
  signal: AbortSignal,
  lstat: Lstat,
): Promise<Pin | undefined> {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!absPath.startsWith(prefix)) return undefined;
  const parts = absPath.slice(prefix.length).split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return undefined;
  const dirs: Pin["dirs"] = [];
  let path = root;
  try {
    for (const part of parts) {
      // A request past its deadline starts no further lstat (review rounds 5 and 6): the
      // signal is read before each call and again after each await, since the deadline
      // may pass while one is pending.
      if (signal.aborted) return undefined;
      // The root, then each directory below it; the last step leaves `path` at the file.
      const s = await lstat(path, { bigint: true });
      if (signal.aborted) return undefined;
      if (!s.isDirectory() || Number(s.ctimeMs) >= now - RECENT_MTIME_MS) return undefined;
      dirs.push({ path, id: `${s.dev}:${s.ino}:${s.ctimeNs}` });
      path = `${path === "/" ? "" : path}/${part}`;
    }
    if (signal.aborted) return undefined;
    const f = await lstat(absPath, { bigint: true });
    if (!f.isFile()) return undefined;
    return { dirs, file: `${f.dev}:${f.ino}` };
  } catch {
    return undefined;
  }
}

async function pinHolds(pin: Pin, absPath: string, signal: AbortSignal, lstat: Lstat): Promise<boolean> {
  try {
    // As in `pinChain`: no lstat starts once the signal has aborted (review round 6).
    for (const dir of pin.dirs) {
      if (signal.aborted) return false;
      const s = await lstat(dir.path, { bigint: true });
      if (signal.aborted) return false;
      if (!s.isDirectory() || `${s.dev}:${s.ino}:${s.ctimeNs}` !== dir.id) return false;
    }
    if (signal.aborted) return false;
    const f = await lstat(absPath, { bigint: true });
    return f.isFile() && `${f.dev}:${f.ino}` === pin.file;
  } catch {
    return false;
  }
}

export function makeGrepPort(deps: {
  engineSearch(q: { pattern: string; limit: number; glob?: string }): Promise<EngineSearchResult>;
  env?: NodeJS.ProcessEnv;
  /** The project's real path: `readCandidate` reads only files it can bind under it. */
  root: string;
  /** Test seam: the `lstat` the candidate pinning uses. Production passes nothing. */
  fs?: { lstat?: Lstat };
}): GrepPort {
  const fsLstat: Lstat = deps.fs?.lstat ?? lstat;
  return {
    engineSearch: deps.engineSearch,

    walk({ bin, cwd, args, roots, signal }): Promise<WalkResult> {
      return new Promise<WalkResult>((resolve) => {
        const started = Date.now();
        if (signal.aborted) {
          resolve({ kind: "killed", elapsedMs: 0 });
          return;
        }
        let child: ReturnType<typeof spawn>;
        try {
          // `--no-config`, so no `RIPGREP_CONFIG_PATH` file can make the walk list a
          // different set than the route's flags say. The args keep their order: rg's
          // glob precedence is positional. `--` keeps a root from reading as a flag.
          child = spawn(bin.path, ["--no-config", "--files", "--null", ...args, "--", ...roots], {
            ...(bin.argv0 === undefined ? {} : { argv0: bin.argv0 }),
            cwd,
            env: deps.env ?? process.env,
            stdio: ["ignore", "pipe", "ignore"],
          });
        } catch {
          resolve({ kind: "failed" });
          return;
        }

        const chunks: Uint8Array[] = [];
        let total = 0;
        let count = 0;
        let capped = false;
        let settled = false;
        const finish = (result: WalkResult): void => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const kill = (): void => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already gone.
          }
        };
        const onAbort = (): void => {
          kill();
          finish({ kind: "killed", elapsedMs: Date.now() - started });
        };
        signal.addEventListener("abort", onAbort, { once: true });

        child.stdout?.on("data", (chunk: Uint8Array) => {
          if (capped) return;
          chunks.push(chunk);
          total += chunk.length;
          for (const byte of chunk) if (byte === 0) count += 1;
          // Past the cap the tree is slow by definition. Stopping here bounds memory;
          // the partial list can only lose extras (a candidate missing from it is
          // dropped), and the count over the cap is what marks the key slow.
          if (count > ORACLE_MAX_PATHS) {
            capped = true;
            kill();
            finish({ kind: "done", paths: splitPaths(chunks, total), elapsedMs: Date.now() - started });
          }
        });
        child.once("error", () => finish({ kind: "failed" }));
        child.once("close", (code: number | null) => {
          const elapsedMs = Date.now() - started;
          // 0: files listed. 1: nothing to list. 2 with output: rg met an error on the
          // way (one unreadable dir, a broken symlink under --follow) and the paths it
          // did list were walked, so they vouch for candidates (review round 1, internal
          // L5); a candidate it never reached is simply not listed. 2 with nothing listed,
          // anything else, or a signal we did not send: no known set to vouch with.
          if (code === 0 || code === 1 || (code === 2 && total > 0)) {
            finish({ kind: "done", paths: splitPaths(chunks, total), elapsedMs });
          } else finish({ kind: "failed" });
        });
      });
    },

    async readCandidate(absPath, maxBytes, signal): Promise<ReadResult> {
      if (signal.aborted) return { kind: "aborted" };
      // Bind the file this read opens to the project (see `pinChain`): pinned before the
      // open, the opened inode must be the pinned one, and the pin must still hold after
      // the read. Anything else is "missing": a dropped extra, never outside bytes.
      const pin = await pinChain(deps.root, absPath, Date.now(), signal, fsLstat);
      if (signal.aborted) return { kind: "aborted" };
      if (pin === undefined) return { kind: "missing" };
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        // O_NOFOLLOW: the oracle never lists a symlink, so a link here was swapped in
        // after the walk, and is not the file rg searched.
        handle = await open(absPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      } catch {
        return { kind: "missing" };
      }
      try {
        if (signal.aborted) return { kind: "aborted" };
        const before = await handle.stat();
        if (!before.isFile()) return { kind: "missing" };
        if (`${before.dev}:${before.ino}` !== pin.file) return { kind: "missing" };
        if (before.size > maxBytes) return { kind: "too-big" };
        const buffer = new Uint8Array(Math.min(maxBytes + 1, Math.max(before.size + 1, 1)));
        let filled = 0;
        for (;;) {
          if (signal.aborted) return { kind: "aborted" };
          const room = buffer.length - filled;
          if (room === 0) return { kind: "too-big" }; // grew past the snapshot: not the file rg read
          const { bytesRead } = await handle.read(buffer, filled, Math.min(room, READ_CHUNK), filled);
          if (bytesRead === 0) break;
          filled += bytesRead;
          if (filled > maxBytes) return { kind: "too-big" };
        }
        if (signal.aborted) return { kind: "aborted" };
        let after: Stats;
        try {
          after = await fsLstat(absPath);
        } catch {
          return { kind: "missing" };
        }
        if (!(await pinHolds(pin, absPath, signal, fsLstat))) return { kind: signal.aborted ? "aborted" : "missing" };
        return { kind: "ok", bytes: buffer.subarray(0, filled), before: fileId(before), after: fileId(after) };
      } catch {
        return { kind: "missing" };
      } finally {
        await handle.close().catch(() => undefined);
      }
    },

    async realpath(p) {
      try {
        return await fsRealpath(p);
      } catch {
        return undefined;
      }
    },

    async statBin(p) {
      try {
        const s = await stat(p);
        return { regular: s.isFile(), executable: (s.mode & 0o111) !== 0, uid: s.uid };
      } catch {
        return undefined;
      }
    },

    // Read live on every call: Bun's process.ppid changes to 1 when the parent dies
    // (measured under Bun 1.4.0: it read 1 within 304 ms of the parent exiting), which is
    // what ends a dead session's identity.
    ppid: () => process.ppid,
    uid: () => (typeof process.getuid === "function" ? process.getuid() : -1),
    now: () => Date.now(),

    sleep(ms, signal) {
      return new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        const timer = setTimeout(done, Math.max(0, ms));
        // Every timer here is unref'd: a pending Grep deadline must never hold the
        // server open after its stdin has closed.
        (timer as { unref?: () => void }).unref?.();
        function done(): void {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          resolve();
        }
        signal?.addEventListener("abort", done, { once: true });
      });
    },
  };
}
