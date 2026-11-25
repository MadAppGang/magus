import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { closeSync, constants, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitFrame } from "./wire.ts";

const originalLauncher = join(import.meta.dir, "../bin/launch.sh");
const fake = join(import.meta.dir, "fake-lsp.ts");
export const dash = Bun.which("dash");
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const realBun = quote(process.execPath);
const command = realBun + " --env-file=/dev/null --config=/dev/null " + quote(fake);

type Event = { event: string; pid: number; shared: boolean; method?: string; id?: number; descendant?: number; dotenv?: string };
type Status = { code: number | null; signal: NodeJS.Signals | null };
export function alive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid === 0 || pid === -1) throw new Error("Unsafe test PID " + pid);
  try { process.kill(pid, 0); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM" && pid < 0) {
      // A denied probe is not proof that a group is empty.
      const ps = Bun.spawnSync(["ps", "-axo", "pgid="]);
      const rows = ps.stdout.toString().trim().split(/\s+/);
      if (ps.exitCode === 0 && rows.every(row => /^\d+$/.test(row)) &&
          !rows.some(row => Number(row) === -pid)) return false;
    }
    throw error;
  }
}
function stopProcess(pid: number) {
  if (!alive(pid)) return;
  try { process.kill(pid, "SIGKILL"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
export async function until<T>(get: () => T | undefined | null | false, label: string, timeout = 3500): Promise<T> {
  const end = performance.now() + timeout;
  do {
    const value = get();
    if (value !== undefined && value !== null && value !== false) return value;
    await Bun.sleep(5);
  } while (performance.now() < end);
  throw new Error("Timed out: " + label);
}
export async function bounded<T>(op: Promise<T>, label: string, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([op, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out: " + label)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

function openClientPipe(path: string) {
  const result = Bun.spawnSync(["mkfifo", "-m", "600", path], { stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("mkfifo failed: " + result.stderr.toString());
  // A temporary reader lets us open the writer without blocking before spawn.
  const opener = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const writeFd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
    try {
      return { readFd: openSync(path, constants.O_RDONLY), writeFd };
    } catch (error) {
      closeSync(writeFd);
      throw error;
    }
  } finally {
    closeSync(opener);
  }
}

export class Peer {
  readonly proc: ChildProcessByStdio<Writable | null, Readable, Readable>;
  readonly pid: number;
  readonly status: Promise<Status>;
  private readonly closed: Promise<void>;
  private rawWriter?: number;
  private chunks: Buffer[] = [];
  private stderr: Buffer[] = [];
  private offset = 0;
  stopped = false;
  stdinError?: NodeJS.ErrnoException;
  constructor(
    argv: string[], cwd: string, env: NodeJS.ProcessEnv, readOutput: boolean,
    input?: { readFd: number; writeFd: number },
  ) {
    const options = { cwd, env, detached: true };
    this.proc = input
      ? spawn(argv[0], argv.slice(1), { ...options, stdio: [input.readFd, "pipe", "pipe"] })
      : spawn(argv[0], argv.slice(1), { ...options, stdio: "pipe" });
    this.rawWriter = input?.writeFd;
    this.pid = this.proc.pid ?? 0;
    this.proc.stdin?.on("error", error => { this.stdinError = error; });
    this.proc.stderr.on("data", data => this.stderr.push(data));
    if (readOutput) this.proc.stdout.on("data", data => this.chunks.push(data));
    this.status = new Promise<Status>((resolve, reject) => {
      this.proc.once("error", reject);
      this.proc.once("exit", (code, signal) => {
        this.stopped = true;
        resolve({ code, signal });
      });
    });
    void this.status.catch(() => {});
    this.closed = new Promise(resolve => { this.proc.once("close", () => resolve()); });
  }
  output() { return Buffer.concat(this.chunks); }
  notes() { return Buffer.concat(this.stderr).toString(); }
  send(bytes: Buffer) {
    const stdin = this.proc.stdin;
    if (!stdin) throw new Error("Peer has no client input stream");
    return new Promise<void>((resolve, reject) => stdin.write(bytes, error => error ? reject(error) : resolve()));
  }
  writeRaw(bytes: Buffer) {
    if (this.rawWriter === undefined) throw new Error("Peer has no raw client writer");
    // The stream callback can report success for a small write rejected by the kernel.
    let written: number;
    try {
      written = writeSync(this.rawWriter, bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPIPE") return "EPIPE";
      throw error;
    }
    if (written !== bytes.length) throw new Error(`Short client write: ${written} of ${bytes.length} bytes`);
    return "written";
  }
  private closeRawWriter() {
    if (this.rawWriter === undefined) return;
    const fd = this.rawWriter;
    this.rawWriter = undefined;
    closeSync(fd);
  }
  eof() { this.closeRawWriter(); this.proc.stdin?.end(); }
  destroyInput() { this.closeRawWriter(); this.proc.stdin?.destroy(); }
  signal(signal: NodeJS.Signals) { this.proc.kill(signal); }
  async end(timeout = 8000) {
    return bounded(this.status, "exit; stderr: " + this.notes(), timeout);
  }
  async endAndDrain() {
    const status = await this.end();
    await bounded(this.closed, "drain client stdout and stderr", 2000);
    return status;
  }
  async response(timeout = 3500) {
    const next = await until(() => splitFrame(this.output().subarray(this.offset)), "LSP frame; stderr: " + this.notes(), timeout);
    this.offset += next.end;
    return next.message;
  }
}

export class TestLaunch {
  readonly root = mkdtempSync(join(tmpdir(), "lp-"));
  readonly cwd = join(this.root, "project with spaces");
  readonly bin = join(this.root, "bin");
  readonly log = join(this.root, "events");
  readonly raw = join(this.root, "stdin");
  readonly env: NodeJS.ProcessEnv;
  readonly peers: Peer[] = [];
  readonly afterPeers: Array<() => Promise<void>> = [];
  launcher = originalLauncher;

  constructor() {
    mkdirSync(this.cwd);
    writeFileSync(join(this.cwd, ".git"), "gitdir: unused\n");
    mkdirSync(this.bin);
    this.env = {
      ...process.env, XDG_RUNTIME_DIR: this.root, TMPDIR: this.root, USER: "l",
      PATH: this.bin + ":" + (process.env.PATH || ""),
      FAKE_LOG: this.log, FAKE_BINARY: join(this.bin, "gopls"), MAGUS_LSP_IDLE_MINUTES: "0",
    };
    for (const key of ["FAKE_PLAIN", "FAKE_SHARED", "FAKE_EXIT_CODE", "FAKE_EOF_CODE", "FAKE_EOF_DELAY", "FAKE_RAW"]) delete this.env[key];
    for (const name of ["gopls", "typescript-language-server"]) this.script(name, "exec " + command + ' "$@"');
    symlinkSync(process.execPath, join(this.bin, "bun"));
  }

  script(name: string, body: string) {
    const path = join(this.bin, name);
    rmSync(path, { force: true });
    writeFileSync(path, "#!/bin/sh\n" + body + "\n", { mode: 0o700 });
  }
  sleepCheck() { this.script("bun", "exec " + command + " # check double"); this.env.FAKE_PLAIN = "check"; }
  async checkDouble(kind: "hang" | "failed" | "unrunnable" | "missing" | "remove") {
    const path = join(this.bin, "bun");
    if (kind === "hang") {
      this.script("bun", "FAKE_PLAIN=check exec " + command);
    } else if (kind === "failed") {
      this.script("bun", "printf 'check failed\\n' >&2; exit 7");
    } else if (kind === "remove") {
      this.script("bun", realBun + ' "$@" || exit $?\nrm -f "$FAKE_BINARY"');
    } else {
      rmSync(path);
      if (kind === "unrunnable") writeFileSync(path, "not executable");
      // Keep ordinary shell utilities available without picking up host Bun.
      for (const name of ["dirname", "sleep", "kill", "rm", "env", "sh"]) {
        const utility = Bun.which(name, { PATH: this.env.PATH });
        if (utility) symlinkSync(utility, join(this.bin, name));
      }
      this.env.PATH = this.bin;
    }
  }
  breakRelayModule() {
    const plugin = join(this.root, "plugin");
    mkdirSync(join(plugin, "bin"), { recursive: true });
    this.launcher = join(plugin, "bin", "launch.sh");
    cpSync(originalLauncher, this.launcher);
    cpSync(join(import.meta.dir, "../src"), join(plugin, "src"), { recursive: true });
    writeFileSync(join(plugin, "src/relay.ts"), "export {\n");
  }
  start({ shared = false, shell = "sh", readOutput = true, rawInput = false, argv }: {
    shared?: boolean; shell?: string; readOutput?: boolean; rawInput?: boolean; argv?: string[];
  } = {}) {
    const args = argv ?? (shared ? ["gopls"] : ["typescript-language-server", "--stdio"]);
    const input = rawInput ? openClientPipe(join(this.root, "client-" + this.peers.length)) : undefined;
    try {
      const peer = new Peer([shell, this.launcher, ...args], this.cwd, this.env, readOutput, input);
      this.peers.push(peer);
      return peer;
    } catch (error) {
      if (input) closeSync(input.writeFd);
      throw error;
    } finally {
      // Only the launched wrapper keeps a read end. The test owns the writer even after exit.
      if (input) closeSync(input.readFd);
    }
  }
  events(): Event[] {
    let lines: string;
    try { lines = readFileSync(this.log, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    return lines.split("\n").filter(Boolean).map(line => JSON.parse(line));
  }
  event(name: string, filter: (event: Event) => boolean = () => true) {
    return until(() => this.events().find(event => event.event === name && filter(event)), "server event " + name);
  }
  async clean() {
    const groupIds = () => new Set([
      ...this.peers.map(p => p.pid).filter(Boolean),
      ...this.events().filter(e => e.event === "start").map(e => e.pid),
    ]);
    // The preflight double records a PID, not a new process group.
    const checkPids = () => this.events().filter(e => e.event === "check").map(e => e.pid);
    const stopOwned = () => {
      for (const pid of groupIds()) stopProcess(-pid);
      for (const pid of checkPids()) stopProcess(pid);
    };
    try {
      stopOwned();
      for (const p of this.peers) {
        p.destroyInput();
        p.proc.stdout.destroy();
        try {
          await bounded(p.status.catch(() => null), "reap test launcher", 5000);
        } finally {
          p.proc.stderr.destroy();
        }
      }
      await until(() => {
        stopOwned();
        return [...groupIds()].every(pid => !alive(-pid)) &&
          checkPids().every(pid => !alive(pid)) &&
          this.events().every(e => e.event !== "spawned-grandchild" || !e.descendant || !alive(e.descendant));
      }, "remove test-owned groups", 5000);
    } finally {
      try {
        for (const cleanup of this.afterPeers) await cleanup();
      } finally {
        rmSync(this.root, { recursive: true, force: true });
      }
    }
  }
}

export async function inLaunch(run: (lab: TestLaunch) => Promise<void>) {
  const lab = new TestLaunch();
  try {
    await run(lab);
  } catch (testError) {
    try {
      await lab.clean();
    } catch (cleanupError) {
      throw new AggregateError([testError, cleanupError], "Scenario and teardown both failed");
    }
    throw testError;
  }
  await lab.clean();
}
