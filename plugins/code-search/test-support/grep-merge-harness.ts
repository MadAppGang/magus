/**
 * grep-merge-harness.ts — what the Bash `grep` merge tests share: the shells to run, a
 * temp world (a copy of both asset files, a short TMPDIR with the socket dir, a project
 * cwd), a fake `node:http` server on the session's unix socket, and a spawn helper.
 *
 * Every shell is spawned DIRECTLY by this test process, so its `$PPID` is
 * `process.pid`: the socket the wrapper looks for is `<TMPDIR>/code-search-<uid>/<process.pid>.sock`,
 * the same rendezvous a real session has with Claude Code's pid.
 *
 * The spawn is asynchronous on purpose. The fake server lives in this process; a
 * synchronous spawn would block its event loop, and every merge would time out.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { envLineBytes } from "../hooks/grep-merge-env";

export const ASSETS_DIR = join(import.meta.dir, "..", "assets");
export const MAIN_NAME = "grep-merge.sh";
export const BODY_NAME = "grep-merge-body.sh";

export interface Shell {
  /** `bash3`, `bash5`, `zsh` — the label rows are reported under. */
  name: string;
  path: string;
  kind: "bash" | "zsh";
  /** bash's major version; 5 for zsh (it takes the `exec {fd}>&1` branch, as bash ≥ 4.1). */
  major: number;
}

function bashMajor(path: string): number | undefined {
  const r = spawnSync(path, ["-c", 'builtin printf %s "${BASH_VERSINFO[0]}"'], { encoding: "utf8" });
  const n = Number(r.stdout);
  return r.status === 0 && Number.isInteger(n) && n > 0 ? n : undefined;
}

export interface Captured {
  rc: number;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Runs a program to completion, asynchronously, with `input` on stdin. */
export function capture(
  file: string,
  args: readonly string[],
  o: { cwd?: string; env: Record<string, string>; input?: string },
): Promise<Captured> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: o.cwd, env: o.env, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        rc: code ?? -1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        ms: performance.now() - started,
      }),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(o.input ?? "");
  });
}

/** A synchronous run, for rows that need no server. */
export function captureSync(file: string, args: readonly string[], env?: Record<string, string>): { rc: number; stdout: string; stderr: string } {
  const r = spawnSync(file, args, { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  return { rc: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** Every distinct bash and zsh on this machine, by real path. */
export function findShells(): Shell[] {
  const shells: Shell[] = [];
  const seen = new Set<string>();
  const add = (path: string, kind: "bash" | "zsh"): void => {
    if (!existsSync(path)) return;
    const real = realpathSync(path);
    if (seen.has(real)) return;
    seen.add(real);
    if (kind === "zsh") {
      shells.push({ name: "zsh", path, kind, major: 5 });
      return;
    }
    const major = bashMajor(path);
    if (major === undefined) return;
    shells.push({ name: major < 4 ? `bash${major}` : `bash${major}`, path, kind, major });
  };
  for (const p of ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/opt/homebrew/bin/bash"]) add(p, "bash");
  for (const p of ["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh", "/opt/homebrew/bin/zsh"]) add(p, "zsh");
  return shells;
}

/** True on a CI runner (GitHub Actions sets `CI=true`). */
export const IN_CI = (process.env["CI"] ?? "") !== "" && process.env["CI"] !== "false";

/**
 * The shells the wrapper contract needs on this platform that `shells` lacks. macOS ships
 * bash 3.2 (the `9→3` fd probe) and zsh; Linux ships bash ≥ 4.1 (the `exec {fd}>&1`
 * branch) and installs zsh. Each is a separate code path, so a missing one is a gap.
 */
export function missingRequiredShells(shells: readonly Shell[], platform: string = process.platform): string[] {
  const missing: string[] = [];
  const hasBash = (ok: (major: number) => boolean): boolean => shells.some((s) => s.kind === "bash" && ok(s.major));
  if (platform === "darwin" && !hasBash((m) => m < 4)) missing.push("bash 3.2");
  if (platform !== "darwin" && !hasBash((m) => m >= 4)) missing.push("bash >= 4.1");
  if (!shells.some((s) => s.kind === "zsh")) missing.push("zsh");
  return missing;
}

/** A shell word for any string: single quotes, with `'` spelled `'\''`. */
export function sq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export interface World {
  root: string;
  /** The copied assets dir; its main file is what the line sources. */
  assets: string;
  main: string;
  body: string;
  /** The TMPDIR handed to every shell, and the socket dir and path under it. */
  tmp: string;
  sockDir: string;
  sock: string;
  /** The project the commands run in, holding `src/`. */
  cwd: string;
  home: string;
  log: string;
  cleanup(): void;
}

/** A fresh temp world under a short root, so the socket path stays far below 100 bytes. */
export function makeWorld(): World {
  const base = existsSync("/tmp") ? "/tmp" : realpathSync(process.env["TMPDIR"] ?? "/tmp");
  const root = realpathSync(mkdtempSync(join(base, "csgm-")));
  const assets = join(root, "plugin", "assets");
  mkdirSync(assets, { recursive: true });
  copyFileSync(join(ASSETS_DIR, MAIN_NAME), join(assets, MAIN_NAME));
  copyFileSync(join(ASSETS_DIR, BODY_NAME), join(assets, BODY_NAME));
  const tmp = join(root, "t");
  const uid = process.getuid?.() ?? 0;
  const sockDir = join(tmp, `code-search-${uid}`);
  mkdirSync(sockDir, { recursive: true, mode: 0o700 });
  chmodSync(sockDir, 0o700);
  const cwd = join(root, "w");
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src", "a.ts"), "export const fetchUserProfile = 1;\n");
  const home = join(root, "home");
  mkdirSync(home);
  return {
    root,
    assets,
    main: join(assets, MAIN_NAME),
    body: join(assets, BODY_NAME),
    tmp,
    sockDir,
    sock: join(sockDir, `${process.pid}.sock`),
    cwd,
    home,
    log: join(root, "merge.log"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** The P7 source line for a main file: exactly what the SessionStart hook writes, trimmed
 *  as Claude Code trims it. */
export function sourceLine(main: string): string {
  const bytes = envLineBytes(main);
  if (bytes === undefined) throw new Error(`no env line for ${main}`);
  return bytes.trim();
}

/**
 * A stand-in for Claude Code's snapshot `grep` function. It prints its argc and argv on
 * stdout, one line on stderr, and returns `$STANDIN_RC` (default 0). Set
 * `STANDIN_SLEEP` to make it slow (it runs `command sleep`).
 *
 * The stdout line is built first and written by ONE printf, so under `set -x` no trace
 * line can land in the middle of it.
 */
export const STANDIN = [
  "function grep {",
  "  local __standin_s=\"standin:$#\" __standin_a=",
  '  for __standin_a in "$@"; do __standin_s="$__standin_s <$__standin_a>"; done',
  "  builtin printf '%s\\n' \"$__standin_s\"",
  "  builtin printf 'standin-stderr\\n' >&2",
  '  if [[ -n ${STANDIN_SLEEP-} ]]; then command sleep "$STANDIN_SLEEP"; fi',
  '  return "${STANDIN_RC:-0}"',
  "}",
].join("\n");

/** What the stand-in writes, stdout then stderr, for an argv. */
export function standinBytes(argv: readonly string[]): string {
  return `standin:${argv.length}${argv.map((a) => ` <${a}>`).join("")}\nstandin-stderr\n`;
}

export interface Run {
  rc: number;
  /** stdout and stderr, one file, in write order. */
  out: string;
  ms: number;
}

/**
 * `<shell> -c <script>` from `cwd`, with stdout and stderr on ONE open file description,
 * as Claude Code's Bash tool captures a call.
 */
export async function runShell(
  shell: Shell,
  script: string,
  o: { cwd: string; env: Record<string, string>; outFile: string },
): Promise<Run> {
  const fd = openSync(o.outFile, "w");
  const started = performance.now();
  try {
    const rc = await new Promise<number>((resolve, reject) => {
      const child = spawn(shell.path, ["-c", script], { cwd: o.cwd, env: o.env, stdio: ["ignore", fd, fd] });
      child.on("error", reject);
      // `exit`, not `close`: a background job the script left running may hold the file.
      child.on("exit", (code) => resolve(code ?? -1));
    });
    return { rc, out: readFileSync(o.outFile, "utf8"), ms: performance.now() - started };
  } finally {
    closeSync(fd);
  }
}

/** The base environment every row starts from. */
export function baseEnv(w: World, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: "/usr/bin:/bin",
    HOME: w.home,
    TMPDIR: w.tmp,
    LANG: "en_US.UTF-8",
    CODE_SEARCH_MERGE_LOG: w.log,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The fake server
// ---------------------------------------------------------------------------

export type Answer = Uint8Array | string | "hang";

export interface FakeServer {
  requests: Buffer[];
  close(): Promise<void>;
}

/** A `node:http` server on the unix socket `sock`, answering each POST with `answer(body)`. */
export async function startFakeServer(sock: string, answer: (body: Buffer) => Answer): Promise<FakeServer> {
  const requests: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push(body);
      const a = answer(body);
      if (a === "hang") return;
      const bytes = typeof a === "string" ? Buffer.from(a) : Buffer.from(a);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length, Connection: "close" });
      res.end(bytes);
    });
  });
  server.on("connection", (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sock, () => resolve());
  });
  return {
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
        rmSync(sock, { force: true });
      }),
  };
}

/** A well-formed block naming one extra, and its frame. */
export function blockText(pattern = "fetchUserProfile", line = "src/b.ts:7: const extra = 1;"): string {
  return `--- code-search: 1 related location from the code index; none of these lines contains "${pattern}" ---\n${line}\n--- end code-search ---\n`;
}

export function frameOf(block: string, n = Buffer.byteLength(block)): Buffer {
  return Buffer.concat([Buffer.from(`CSM1 ${n}\n`), Buffer.from(block)]);
}

/** The NUL-separated fields of a request body, without the trailing empty one. */
export function fields(body: Buffer): string[] {
  const parts = body.toString("utf8").split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}
