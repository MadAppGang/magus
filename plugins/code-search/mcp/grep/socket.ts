/**
 * socket.ts — the search merge's one driving adapter: a unix-socket HTTP listener beside
 * the untouched stdio JSON-RPC server. Two clients reach it: the Bash `grep` wrapper
 * (curl) and the Grep tool's PostToolUse hook (fetch).
 *
 * Wire format (P4). Requests are NUL-separated fields, each followed by a NUL:
 *   POST /merge  `CSM1\0G\0<ppid>\0<caller pid>\0<cwd>\0<argc>\0<arg>\0…`   (Bash route)
 *   POST /merge  `CSM1\0T\0<ppid>\0<caller pid>\0<cwd>\0<tool_input JSON>\0` (Grep tool)
 *   POST /ping   `CSM1\0P\0<ppid>\0`, answered `CSMP <ppid> <startedAtMs> <pid>\n`
 * A merge is answered `CSM1 <n>\n` + n block bytes, or `CSM1 0\n`. Every response is 200,
 * `Connection: close`, with `Content-Length`. A body over 64 KiB, or not complete within
 * 200 ms, gets `CSM1 0\n` (merge) or an empty body (ping). A ping is answered whatever
 * ppid it carries: it discloses no project content (P4, R9).
 *
 * WHERE: `<first qualifying base of $TMPDIR, $XDG_RUNTIME_DIR>/code-search-<uid>/<ppid>.sock`.
 * The ppid is Claude Code's pid, which the wrapper reads as its own `$PPID` and the hook
 * as its `process.ppid`; that shared pid is the whole rendezvous. A base qualifies when
 * the socket path fits 100 bytes (macOS `sun_path` is 104), counted in bytes, exactly as
 * the wrapper counts under `LC_ALL=C`.
 *
 * The wrapper's temp files `<ppid>.<shell pid>.<counter>.{req,out}` live in the same dir; the
 * sweep removes them once either pid is dead.
 *
 * WHY THE SOCKET IS BOUND UNDER A PRIVATE NAME AND HARD-LINKED INTO PLACE. Bun's
 * `server.close()` unlinks the path it bound, without checking what is there now.
 * Measured (Bun 1.4.0): server A binds `x.sock`, `x.sock` is unlinked, server B binds
 * `x.sock`, A closes, and B's socket file is gone. That would let an old server, taken
 * over by a newer one, delete its successor on the way out. So the listener binds
 * `<ppid>.<pid>.<random digits>.lsock` (server-side only; the wrapper's files use a per-shell
 * counter instead), is `link()`ed to `<ppid>.sock` (which, like `listen`,
 * refuses an existing name), and the private name is unlinked at once. Close then
 * unlinks a name that no longer exists, and the public name is removed only by the
 * inode-guarded unlink here. Measured: connect through the link works, `link` gives
 * EEXIST over a live socket, and closing either server leaves the other's name alone.
 *
 * Every timer is unref'd: nothing here may hold the server open after stdin closes.
 */

import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Stats } from "node:fs";
import { linkSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import { chmod, link, lstat, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { frame } from "./block";
import type { GrepRequest, makeGrepService } from "./service";

/** macOS `sun_path` is 104 bytes; the margin keeps a NUL and any platform slack. */
export const SOCKET_PATH_MAX = 100;
export const BODY_LIMIT = 64 * 1024;
export const BODY_WINDOW_MS = 200;
export const PING_TIMEOUT_MS = 200;
export const BIND_RETRY_MS = 2_000;
export const BIND_RETRIES = 15;
export const TICK_MS = 600_000;

const EMPTY = new Uint8Array(0);
const fatal = new TextDecoder("utf-8", { fatal: true });

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

/**
 * The first base, in order `$TMPDIR` then `$XDG_RUNTIME_DIR`, that is absolute and whose
 * socket path fits `SOCKET_PATH_MAX` bytes. There is no literal fallback: a machine with
 * neither has no merge, which is a lost extra and nothing worse.
 *
 * The trailing-slash rule is the wrapper's `${base%/}` exactly: ONE trailing `/` is removed.
 */
export function chooseSocketDir(
  env: { TMPDIR?: string; XDG_RUNTIME_DIR?: string },
  uid: number,
  ppid: number,
): { dir: string; sock: string } | undefined {
  for (const base of [env.TMPDIR, env.XDG_RUNTIME_DIR]) {
    if (base === undefined || !base.startsWith("/")) continue;
    const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
    const dir = `${trimmed}/code-search-${uid}`;
    const sock = `${dir}/${ppid}.sock`;
    if (Buffer.byteLength(sock) <= SOCKET_PATH_MAX) return { dir, sock };
  }
  return undefined;
}

/**
 * The one rule for trusting a session socket dir (review round 1, Codex C6): a real
 * directory (lstat: never a symlink), owned by `uid`, mode exactly 0700. The server binds
 * only into such a dir; the Grep-tool hook and the redirect hook use only a socket in one.
 * The shell wrapper applies the same rule as far as builtins reach (see
 * assets/grep-merge-body.sh, `__cs_gm_sockok`).
 */
export function dirQualifies(st: Pick<Stats, "isDirectory" | "isSymbolicLink" | "uid" | "mode">, uid: number): boolean {
  return st.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o777) === 0o700;
}

/** The socket half of the rule: a real socket (lstat), owned by `uid`. */
export function socketQualifies(st: Pick<Stats, "isSocket" | "isSymbolicLink" | "uid">, uid: number): boolean {
  return st.isSocket() && !st.isSymbolicLink() && st.uid === uid;
}

/**
 * This session's socket path when the rule holds for it, else `undefined`. Synchronous
 * and side-effect free: two lstats. Any error (missing, unreadable) is `undefined`, so a
 * caller fails silently on every mismatch.
 */
export function sessionSocket(
  env: { TMPDIR?: string; XDG_RUNTIME_DIR?: string },
  uid: number,
  ppid: number,
): string | undefined {
  const choice = chooseSocketDir(env, uid, ppid);
  if (choice === undefined) return undefined;
  try {
    if (!dirQualifies(lstatSync(choice.dir), uid)) return undefined;
    if (!socketQualifies(lstatSync(choice.sock), uid)) return undefined;
  } catch {
    return undefined;
  }
  return choice.sock;
}

/**
 * The claude pid a hook works for (review round 2). The hooks.json launcher runs bun
 * without `exec`, so bun's parent is the launcher shell, not Claude Code; the launcher
 * passes its own `$PPID` (Claude Code) in `CODE_SEARCH_SESSION_PID`. A value that is not a
 * plain decimal above 1 falls back to `fallback` (a hook's `process.ppid`).
 */
export function sessionPid(env: Readonly<Record<string, string | undefined>>, fallback: number): number {
  const passed = env["CODE_SEARCH_SESSION_PID"];
  if (passed !== undefined && /^[1-9][0-9]{0,9}$/u.test(passed)) {
    const pid = Number(passed);
    if (pid > 1) return pid;
  }
  return fallback;
}

/** A decimal as the wrapper prints `$PPID`, `$$` and `$#`: no sign, no leading zero. */
function decimal(text: string | undefined): number | undefined {
  if (text === undefined || !/^(?:0|[1-9][0-9]{0,9})$/u.test(text)) return undefined;
  return Number(text);
}

export type ParsedBody =
  | { kind: "merge"; ppid: number; callerPid: number; cwd: string; input: GrepRequest["input"] }
  | { kind: "ping"; ppid: number };

/**
 * A request body, or `undefined` when it is not exactly one well-formed request.
 *
 * The argc field (G) or the single JSON field (T) fixes the field count, so a body with
 * anything after its last field does not parse: the listener parses only once the request
 * has ended. Not UTF-8 is a decline: a path or pattern that does not decode cannot be
 * compared with anything the engine says. A T body whose JSON does not parse declines too.
 */
export function parseBody(body: Uint8Array): ParsedBody | undefined {
  let text: string;
  try {
    text = fatal.decode(body);
  } catch {
    return undefined;
  }
  if (!text.endsWith("\0")) return undefined;
  const fields = text.slice(0, -1).split("\0");
  if (fields[0] !== "CSM1") return undefined;

  const ppid = decimal(fields[2]);
  if (ppid === undefined) return undefined;
  if (fields[1] === "P") return fields.length === 3 ? { kind: "ping", ppid } : undefined;

  const callerPid = decimal(fields[3]);
  const cwd = fields[4];
  if (callerPid === undefined || cwd === undefined) return undefined;

  if (fields[1] === "G") {
    const argc = decimal(fields[5]);
    if (argc === undefined || fields.length !== 6 + argc) return undefined;
    return { kind: "merge", ppid, callerPid, cwd, input: { kind: "bash", argv: fields.slice(6) } };
  }
  if (fields[1] === "T") {
    if (fields.length !== 6) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(fields[5] ?? "");
    } catch {
      return undefined;
    }
    return { kind: "merge", ppid, callerPid, cwd, input: { kind: "tool", json } };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

interface Inode {
  dev: number;
  ino: number;
}

function inodeOf(s: Stats): Inode {
  return { dev: s.dev, ino: s.ino };
}

function errCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

/**
 * Unlink `path` only if it is still the inode we recorded, with no check-then-unlink
 * window. POSIX has no conditional unlink, and a plain `lstat` then `unlink` lets a
 * successor publish its socket in between and lose it to us. So the name is first renamed
 * to a private name only this process uses: the rename is atomic, so whatever was at
 * `path` at that instant is what moved. The moved entry is then checked where nobody
 * else can touch it. Ours: unlinked. Not ours: linked back under `path` (the same inode,
 * so its owner's own inode guard still matches) and the private name dropped.
 *
 * Residual, by design: for the microseconds the entry is aside, a client finds no socket
 * and gets grep's output alone (a lost block, nothing worse). If a third binder publishes
 * `path` in that instant, the link back fails and the moved entry stays under its private
 * name, which the sweep removes once this process is gone; its owner notices the missing
 * name on its next tick and binds again. Nothing that is not ours is ever unlinked.
 */
function asideName(path: string): string {
  const slash = path.lastIndexOf("/");
  // The sweep's `N.S.R` shape, with this process in both pid fields on purpose: an aside
  // entry belongs to no session, only to the process that moved it, and the sweep removes
  // it once either named pid is dead.
  return `${path.slice(0, slash + 1)}${process.pid}.${process.pid}.${randomDigits()}.qtmp`;
}

function sameInode(s: Stats, id: Inode): boolean {
  return s.dev === id.dev && s.ino === id.ino;
}

async function guardedUnlink(path: string, id: Inode): Promise<boolean> {
  const first = await lstatOrUndefined(path);
  if (first === undefined || !sameInode(first, id)) return false;
  const aside = asideName(path);
  try {
    await rename(path, aside);
  } catch {
    return false;
  }
  const moved = await lstatOrUndefined(aside);
  if (moved !== undefined && sameInode(moved, id)) {
    await unlink(aside).catch(() => undefined);
    return true;
  }
  try {
    await link(aside, path);
    await unlink(aside);
  } catch {
    // The link back lost to a newer binder: the moved entry stays aside (see above).
  }
  return false;
}

function guardedUnlinkSync(path: string, id: Inode): void {
  try {
    if (!sameInode(lstatSync(path), id)) return;
    const aside = asideName(path);
    renameSync(path, aside);
    if (sameInode(lstatSync(aside), id)) {
      unlinkSync(aside);
      return;
    }
    linkSync(aside, path);
    unlinkSync(aside);
  } catch {
    // Already gone, not ours to remove, or left aside for the sweep.
  }
}

/** Alive unless the kernel says no such process. EPERM is someone else's live process.
 *  Pids 0 and 1 are never "dead": `kill(0, …)` addresses our own process group. */
function dead(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return errCode(error) === "ESRCH";
  }
}

function unref<T>(timer: T): T {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

/** Digits only, like the wrapper's per-shell counter, so one sweep pattern covers both sides. */
function randomDigits(): string {
  return String(Math.floor(Math.random() * 1_000_000_000));
}

// ---------------------------------------------------------------------------
// Ping client
// ---------------------------------------------------------------------------

type PingReply =
  | { kind: "reply"; ppid: number; startedAtMs: number; pid: number }
  | { kind: "refused" }
  | { kind: "invalid" };

function ping(sock: string, ownPpid: number): Promise<PingReply> {
  return new Promise<PingReply>((resolve) => {
    let settled = false;
    const finish = (reply: PingReply): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reply);
    };
    const body = Buffer.from(`CSM1\0P\0${ownPpid}\0`);
    const req = request(
      {
        socketPath: sock,
        method: "POST",
        path: "/ping",
        headers: { "Content-Length": body.length, Connection: "close" },
      },
      (res: IncomingMessage) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.length > 256) finish({ kind: "invalid" });
        });
        res.on("end", () => {
          const m = /^CSMP ([0-9]{1,10}) ([0-9]{1,16}) ([0-9]{1,10})\n$/u.exec(text);
          if (m === null) finish({ kind: "invalid" });
          else finish({ kind: "reply", ppid: Number(m[1]), startedAtMs: Number(m[2]), pid: Number(m[3]) });
        });
        res.on("error", () => finish({ kind: "invalid" }));
      },
    );
    // No answer in time is NOT stale: a listener that is alive but slow may be a newer
    // duplicate, and stealing from it would be the one irreversible mistake here.
    const timer = unref(
      setTimeout(() => {
        finish({ kind: "invalid" });
        req.destroy();
      }, PING_TIMEOUT_MS),
    );
    req.on("error", (error: unknown) => {
      const code = errCode(error);
      finish(code === "ECONNREFUSED" || code === "ENOENT" ? { kind: "refused" } : { kind: "invalid" });
    });
    req.end(body);
  });
}

// ---------------------------------------------------------------------------
// The listener
// ---------------------------------------------------------------------------

export function startGrepSocket(deps: {
  env: NodeJS.ProcessEnv;
  uid: number;
  ppid: () => number;
  startedAtMs: number;
  service: Pick<ReturnType<typeof makeGrepService>, "handle">;
  log: (s: string) => void;
}): { stop(): Promise<void>; bound(): string | undefined } {
  let server: Server | undefined;
  let boundSock: string | undefined;
  let boundId: Inode | undefined;
  let boundDir: string | undefined;

  let stopped = false;
  let binding: Promise<void> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retriesLeft = BIND_RETRIES;
  let lastRefusal = "";

  /** One line per distinct refusal, so a gate that fails on every tick logs once. */
  function refuse(why: string): void {
    if (why === lastRefusal) return;
    lastRefusal = why;
    deps.log(`merge socket: not bound (${why})`);
  }

  // ------------------------------------------------------------- requests

  function send(res: ServerResponse, bytes: Uint8Array): void {
    try {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": bytes.length,
        Connection: "close",
      });
      res.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    } catch {
      // The client gave up (curl's --max-time, the hook's abort); it appends nothing.
    }
  }

  function onRequest(req: IncomingMessage, res: ServerResponse): void {
    const receivedAt = Date.now();
    const route = req.method === "POST" ? req.url : undefined;
    const isMerge = route === "/merge";
    const isPing = route === "/ping";
    const chunks: Uint8Array[] = [];
    let size = 0;
    let answered = false;

    const decline = (): void => {
      if (answered) return;
      answered = true;
      clearTimeout(window);
      send(res, isMerge ? frame(EMPTY) : EMPTY);
    };
    const window = unref(setTimeout(decline, BODY_WINDOW_MS));

    // Decided at the request's end only (HTTP framing: Content-Length or curl's final
    // chunk), so the body must be EXACTLY one request: trailing bytes after a well-formed
    // prefix make it unparseable, never ignored.
    const complete = (): void => {
      if (answered) return;
      const body = Buffer.concat(chunks);
      const parsed = parseBody(body);
      if (parsed === undefined) {
        decline();
        return;
      }
      answered = true;
      clearTimeout(window);
      if (parsed.kind === "ping" && isPing) {
        // The listener's LIVE parent: an orphan answers 1, which is how a binder tells a
        // dead session's leftover from a live duplicate. Answered for any ppid: a ping
        // discloses no project content.
        send(res, Buffer.from(`CSMP ${deps.ppid()} ${deps.startedAtMs} ${process.pid}\n`));
        return;
      }
      if (parsed.kind === "merge" && isMerge) {
        const { ppid, callerPid, cwd, input } = parsed;
        deps.service
          .handle({ ppid, callerPid, cwd, input, receivedAt })
          .then((result) => send(res, frame(result.payload)))
          .catch((error: unknown) => {
            deps.log(`merge socket: request failed: ${String(error)}`);
            send(res, frame(EMPTY));
          });
        return;
      }
      send(res, isMerge ? frame(EMPTY) : EMPTY);
    };

    req.on("data", (chunk: Uint8Array) => {
      if (answered) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        decline();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", complete);
    req.on("error", decline);
  }

  // ------------------------------------------------------------- dir, sweep

  /**
   * The 0700 dir is the trust boundary (same uid only). Created 0700; an existing one is
   * used only if it is a real directory (not a symlink) owned by the uid, and is then
   * chmod'ed to 0700. Anything else refuses to bind (P4).
   */
  async function usableDir(dir: string): Promise<boolean> {
    try {
      await mkdir(dir, { mode: 0o700 });
    } catch (error) {
      if (errCode(error) !== "EEXIST") return false;
    }
    const st = await lstatOrUndefined(dir);
    if (st === undefined || !st.isDirectory() || st.isSymbolicLink() || st.uid !== deps.uid) return false;
    if (dirQualifies(st, deps.uid)) return true;
    try {
      await chmod(dir, 0o700);
    } catch {
      return false;
    }
    // Re-checked after the chmod: the name may have been swapped in between, and a mode
    // set on something else proves nothing about this dir.
    const after = await lstatOrUndefined(dir);
    return after !== undefined && dirQualifies(after, deps.uid) && after.dev === st.dev && after.ino === st.ino;
  }

  /**
   * Remove what a dead process left behind. Never follows a symlink and touches only
   * uid-owned entries.
   *   - `N.sock`: N (a claude pid) is dead.
   *   - `N.S.R.{req,out}` (the wrapper's files) and `N.S.R.{lsock,qtmp}` (this module's
   *     private names): N or S is dead. A live call keeps both its claude and its shell
   *     alive, and the wrapper removes its own files before it returns.
   */
  async function sweep(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const session = /^([0-9]{1,10})\.sock$/u.exec(name);
      const call = /^([0-9]{1,10})\.([0-9]{1,10})\.([0-9]{1,10})\.(?:req|out|lsock|qtmp)$/u.exec(name);
      if (session === null && call === null) continue;
      const path = `${dir}/${name}`;
      const st = await lstatOrUndefined(path);
      if (st === undefined || st.uid !== deps.uid || st.isDirectory()) continue;
      let remove = false;
      if (session !== null) remove = dead(Number(session[1]));
      else if (call !== null) remove = dead(Number(call[1])) || dead(Number(call[2]));
      if (remove) await guardedUnlink(path, inodeOf(st));
    }
  }

  // ------------------------------------------------------------- bind

  type Verdict = "free" | "foreign" | "wait";

  /** Who holds `<ppid>.sock`, and may we replace it. */
  async function arbitrate(sock: string, ppid: number): Promise<Verdict> {
    let st: Stats;
    try {
      st = await lstat(sock);
    } catch (error) {
      return errCode(error) === "ENOENT" ? "free" : "foreign";
    }
    // Not a socket, or not ours: never deleted.
    if (!socketQualifies(st, deps.uid)) return "foreign";

    const reply = await ping(sock, ppid);
    if (reply.kind === "refused") {
      // Nobody listening: a crashed server's leftover.
      return (await guardedUnlink(sock, inodeOf(st))) ? "free" : "wait";
    }
    if (reply.kind === "invalid") return "wait";
    if (reply.ppid !== ppid) {
      // An orphan of a dead session (its parent is now 1), or a pid-reuse leftover.
      return (await guardedUnlink(sock, inodeOf(st))) ? "free" : "wait";
    }
    // A live same-parent listener: a /mcp reconnect overlap or a --plugin-dir copy.
    // NEWEST START WINS: the newer process read the settings last, so it holds the
    // current values. Compared as a pair, so two starts in the same millisecond still
    // order deterministically.
    const older =
      reply.startedAtMs < deps.startedAtMs ||
      (reply.startedAtMs === deps.startedAtMs && reply.pid < process.pid);
    // Never our own listener: arbitration runs only while this instance is unbound.
    if (older) return (await guardedUnlink(sock, inodeOf(st))) ? "free" : "wait";
    return "wait";
  }

  type Published = "bound" | "exists" | "failed";

  async function publish(dir: string, sock: string, ppid: number): Promise<Published> {
    const tmp = `${dir}/${ppid}.${process.pid}.${randomDigits()}.lsock`;
    const candidate = createServer(onRequest);
    try {
      await new Promise<void>((resolve, reject) => {
        candidate.once("error", reject);
        candidate.listen(tmp, () => {
          candidate.removeListener("error", reject);
          resolve();
        });
      });
    } catch (error) {
      deps.log(`merge socket: listen failed: ${String(error)}`);
      return "failed";
    }
    candidate.on("error", (error: unknown) => deps.log(`merge socket: ${String(error)}`));
    unref(candidate);

    let tmpId: Inode | undefined;
    try {
      await chmod(tmp, 0o600);
      tmpId = inodeOf(await lstat(tmp));
      await link(tmp, sock);
    } catch (error) {
      await closeServer(candidate);
      if (tmpId !== undefined) await guardedUnlink(tmp, tmpId);
      return errCode(error) === "EEXIST" ? "exists" : "failed";
    }
    await guardedUnlink(tmp, tmpId);

    server = candidate;
    boundSock = sock;
    boundId = tmpId;
    boundDir = dir;
    retriesLeft = BIND_RETRIES;
    lastRefusal = "";
    // The resolved base is logged so a real session can confirm its clients and this
    // server chose the same one; an interactive session is the check that matters.
    deps.log(
      `merge socket: bound ${sock} (TMPDIR=${deps.env["TMPDIR"] ?? "-"} XDG_RUNTIME_DIR=${deps.env["XDG_RUNTIME_DIR"] ?? "-"})`,
    );
    return "bound";
  }

  function scheduleRetry(): void {
    if (stopped || retryTimer !== undefined) return;
    if (retriesLeft <= 0) return; // left to the tick
    retriesLeft -= 1;
    retryTimer = unref(
      setTimeout(() => {
        retryTimer = undefined;
        void bind();
      }, BIND_RETRY_MS),
    );
  }

  async function bindOnce(): Promise<void> {
    if (stopped || server !== undefined) return;
    const ppid = deps.ppid();
    if (ppid <= 1) return refuse("no parent");
    const choice = chooseSocketDir(deps.env, deps.uid, ppid);
    if (choice === undefined) return refuse(`no base: TMPDIR/XDG_RUNTIME_DIR absent, relative, or path over ${SOCKET_PATH_MAX} bytes`);
    if (!(await usableDir(choice.dir))) return refuse(`dir unusable: ${choice.dir}`);
    await sweep(choice.dir);

    // Listen refusing an existing name sends us back to arbitration once, as EADDRINUSE
    // would: another binder won the race between our lstat and our link.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (stopped) return;
      const verdict = await arbitrate(choice.sock, ppid);
      if (verdict === "foreign") return refuse(`foreign file at ${choice.sock}`);
      if (verdict === "wait") {
        scheduleRetry();
        return;
      }
      const published = await publish(choice.dir, choice.sock, ppid);
      if (published === "bound") {
        if (stopped) await release();
        return;
      }
      if (published === "failed") return refuse("listen failed");
    }
    scheduleRetry();
  }

  /** One bind at a time: the tick, a retry and the start can all ask for one. */
  function bind(): Promise<void> {
    if (binding !== undefined) return binding;
    const attempt = bindOnce()
      .catch((error: unknown) => deps.log(`merge socket: bind failed: ${String(error)}`))
      .finally(() => {
        if (binding === attempt) binding = undefined;
      });
    binding = attempt;
    return attempt;
  }

  // ------------------------------------------------------------- close

  function closeServer(s: Server): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = unref(setTimeout(resolve, 500));
      try {
        s.close(() => {
          clearTimeout(done);
          resolve();
        });
        (s as { closeAllConnections?: () => void }).closeAllConnections?.();
      } catch {
        clearTimeout(done);
        resolve();
      }
    });
  }

  /** Close the listener and drop our names, each only while it is still our inode. */
  async function release(): Promise<void> {
    const s = server;
    server = undefined;
    if (s !== undefined) await closeServer(s);
    if (boundSock !== undefined && boundId !== undefined) await guardedUnlink(boundSock, boundId);
    boundSock = undefined;
    boundId = undefined;
  }

  /** Sync and best effort: an `exit` handler cannot await. */
  function releaseSync(): void {
    if (boundSock !== undefined && boundId !== undefined) guardedUnlinkSync(boundSock, boundId);
  }

  // ------------------------------------------------------------- tick

  async function tick(): Promise<void> {
    if (stopped) return;
    // 1. Sweep, bound or not.
    const ppid = deps.ppid();
    const dir = boundDir ?? (ppid > 1 ? chooseSocketDir(deps.env, deps.uid, ppid)?.dir : undefined);
    if (dir !== undefined && (await usableDir(dir))) await sweep(dir);

    // 2. Bound, but the name is no longer our inode: the OS temp cleaner removed it, or
    //    a newer same-parent server took it over. Close WITHOUT unlinking (it is not
    //    ours any more), then bind, which pings and waits if the newer one is alive.
    if (server !== undefined && boundSock !== undefined && boundId !== undefined) {
      const now = await lstatOrUndefined(boundSock);
      if (now === undefined || now.dev !== boundId.dev || now.ino !== boundId.ino) {
        const s = server;
        server = undefined;
        boundSock = undefined;
        boundId = undefined;
        await closeServer(s);
        retriesLeft = BIND_RETRIES;
        await bind();
        return;
      }
      return;
    }
    // 3. Unbound: try again.
    retriesLeft = BIND_RETRIES;
    await bind();
  }

  const tickTimer = unref(setInterval(() => void tick().catch(() => undefined), TICK_MS));
  process.on("exit", releaseSync);
  void bind();

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(tickTimer);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      if (binding !== undefined) await binding;
      await release();
      process.removeListener("exit", releaseSync);
    },
    bound: () => (server !== undefined ? boundSock : undefined),
  };
}
