/**
 * io.ts — the ONE injected IO surface of the setup CLI.
 *
 * Every file write, process, fetch and line of output goes through `SetupIo`, so a test
 * can run any subcommand against a temp HOME with a fake that throws on `run` and prove
 * nothing was installed. The read half is `CheckIo` from `mcp/setup/check.ts`, shared
 * with the SessionStart hook and the MCP server.
 *
 * Processes run with NO SHELL: `spawn(argv[0], argv.slice(1))`. An install command is
 * data from the catalog, never a string a shell gets to reinterpret, and nothing here
 * pipes a download into an interpreter.
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";

import type { CheckIo, RunOptions, RunResult } from "../../mcp/setup/check";
import { makeNodeCheckIo } from "../../mcp/setup/node-io";
import {
  makeMcpClient,
  type McpClient,
  type McpClientOptions,
  type McpClientSpec,
} from "../../mcp/transport/mcp-stdio-client";

export type EntryKind = "missing" | "file" | "directory" | "symlink" | "other";

/** Where a subcommand acts. Resolved once by `setup.ts`, passed to every handler. */
export interface SetupContext {
  /** This plugin's root: the directory holding `scripts/`, `mcp/`, `assets/`. */
  pluginRoot: string;
  projectDir: string;
  home: string;
}

export interface SetupIo extends CheckIo {
  run(argv: readonly string[], opts: RunOptions): Promise<RunResult>;
  fetchText(url: string, timeoutMs: number): Promise<string | undefined>;
  cwd(): string;
  /** The runtime executing this script, used to start the plugin's own MCP server. */
  execPath: string;
  stdout(text: string): void;
  stderr(text: string): void;
  /** What is at `path` itself, NOT following a symlink. */
  lstatKind(path: string): EntryKind;
  /** Permission bits of the file `path` resolves to, or undefined. */
  modeOf(path: string): number | undefined;
  mkdirp(dir: string): void;
  /** Creates `path` exclusively (fails if it exists), writes `data`, sets `mode` exactly. */
  writeNew(path: string, data: string | Uint8Array, mode: number): void;
  rename(from: string, to: string): void;
  /** Never throws: a temp file that is already gone is the outcome wanted. */
  removeQuietly(path: string): void;
  /** A suffix unique enough for a temp file name in a shared directory. */
  uniqueSuffix(): string;
  /** An MCP client over stdio. `verify` starts the plugin's own server through it. */
  connect(spec: McpClientSpec, opts: McpClientOptions): McpClient;
}

/** Bytes kept from each child stream. Enough for the last 20 stderr lines of an install. */
const STREAM_KEEP = 64 * 1024;
/** Grace between SIGTERM and SIGKILL once a deadline passes. */
const KILL_GRACE_MS = 2_000;

export function makeNodeSetupIo(env: Readonly<Record<string, string | undefined>> = process.env): SetupIo {
  const read = makeNodeCheckIo(env);
  let counter = 0;

  return {
    ...read,
    run(argv: readonly string[], opts: RunOptions): Promise<RunResult> {
      return runProcess(argv, opts, env);
    },
    async fetchText(url: string, timeoutMs: number): Promise<string | undefined> {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return response.ok ? await response.text() : undefined;
      } catch {
        return undefined;
      }
    },
    cwd: () => process.cwd(),
    execPath: process.execPath,
    stdout(text: string): void {
      process.stdout.write(text);
    },
    stderr(text: string): void {
      process.stderr.write(text);
    },
    lstatKind(path: string): EntryKind {
      try {
        const stats = lstatSync(path);
        if (stats.isSymbolicLink()) return "symlink";
        if (stats.isFile()) return "file";
        if (stats.isDirectory()) return "directory";
        return "other";
      } catch {
        return "missing";
      }
    },
    modeOf(path: string): number | undefined {
      try {
        return statSync(path).mode & 0o7777;
      } catch {
        return undefined;
      }
    },
    mkdirp(dir: string): void {
      mkdirSync(dir, { recursive: true });
    },
    writeNew(path: string, data: string | Uint8Array, mode: number): void {
      const fd = openSync(path, "wx", mode);
      try {
        const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
        let offset = 0;
        while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
        // The umask applies to openSync's mode; the copied mode must hold exactly.
        fchmodSync(fd, mode);
      } finally {
        closeSync(fd);
      }
    },
    rename(from: string, to: string): void {
      renameSync(from, to);
    },
    removeQuietly(path: string): void {
      try {
        unlinkSync(path);
      } catch {
        // Already gone.
      }
    },
    uniqueSuffix(): string {
      counter += 1;
      return `${process.pid}.${Date.now().toString(36)}.${counter}`;
    },
    connect(spec: McpClientSpec, opts: McpClientOptions): McpClient {
      return makeMcpClient(spec, opts);
    },
  };
}

function runProcess(
  argv: readonly string[],
  opts: RunOptions,
  parentEnv: Readonly<Record<string, string | undefined>>,
): Promise<RunResult> {
  const [command, ...args] = argv;
  if (command === undefined) {
    return Promise.resolve({
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      spawnError: "empty argv",
    });
  }

  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const keep = (buffer: string, chunk: Buffer): string => {
      const next = buffer + chunk.toString("utf8");
      return next.length > STREAM_KEEP ? next.slice(next.length - STREAM_KEEP) : next;
    };

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...parentEnv, ...(opts.env ?? {}) })) {
      if (value !== undefined) env[key] = value;
    }

    let child;
    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        env,
        // No stdin: an install that wants to prompt gets EOF instead of hanging the CLI.
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (error) {
      resolvePromise({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(killer);
      resolvePromise(result);
    };

    let killer: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, opts.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = keep(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = keep(stderr, chunk);
    });
    child.on("error", (error: Error) => {
      finish({ exitCode: null, signal: null, stdout, stderr, timedOut, spawnError: error.message });
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      finish({ exitCode: code, signal, stdout, stderr, timedOut });
    });
  });
}
