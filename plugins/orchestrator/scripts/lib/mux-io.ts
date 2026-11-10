// Gathers the facts the multiplexer rules in mux-choice.ts decide on, the same
// way for the hook and for every script, so they cannot disagree about where a
// session lives.

import { existsSync } from "node:fs";
import { type HerdrRunner, herdrRunner, resolveHerdrBin } from "./herdr-cli.ts";
import {
  type Multiplexer,
  type SessionMux,
  type WindowMux,
  ancestry,
  chooseWindowMux,
  detectSessionMux,
  herdrHostsSelf,
  parseProcessInfo,
  parsePsTable,
} from "./mux-choice.ts";
import { readUserConfig } from "./user-config.ts";

export interface MuxDeps {
  /** Default: a runner for the resolved herdr binary. */
  run?: HerdrRunner;
  /** The `ps -axo pid=,ppid=` table, or null when it could not be read. */
  ps?: () => string | null;
  /** Default: this process. */
  pid?: number;
  home: string;
  stateDir: string;
}

export interface MuxResolution {
  session: SessionMux;
  windows: WindowMux;
  stored: Multiplexer | null;
  storedError: string | null;
  herdrInstalled: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const PROBE_TIMEOUT_MS = 1_000;

function readPsTable(): string | null {
  try {
    const p = Bun.spawnSync(["ps", "-axo", "pid=,ppid="], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: PROBE_TIMEOUT_MS });
    return p.exitCode === 0 ? p.stdout.toString() : null;
  } catch {
    return null;
  }
}

function runnerFor(env: Env, deps: MuxDeps): HerdrRunner {
  return deps.run ?? herdrRunner(resolveHerdrBin(env, deps.home) ?? "herdr");
}

/** Whether the herdr pane this session claims hosts it; null when that could not be established. */
function probeHostsSelf(env: Env, pane: string, deps: MuxDeps): boolean | null {
  const answer = runnerFor(env, deps)(["pane", "process-info", "--pane", pane], PROBE_TIMEOUT_MS);
  // herdr prints its error bodies on stderr.
  const probe = parseProcessInfo(answer.stdout.trim() !== "" ? answer.stdout : answer.stderr, answer.exitCode);
  if (probe === null || typeof probe === "string") {
    const socket = env.HERDR_SOCKET_PATH;
    return herdrHostsSelf(probe, null, probe === "no-server" && Boolean(socket) && !existsSync(socket ?? ""));
  }
  const table = (deps.ps ?? readPsTable)();
  const ancestors = table === null ? null : ancestry(parsePsTable(table), deps.pid ?? process.pid);
  return herdrHostsSelf(probe, ancestors, false);
}

/**
 * Where this session lives. herdr is asked only when nothing is forced and the
 * session claims a herdr pane.
 */
export function sessionMuxNow(env: Env, deps: MuxDeps): SessionMux {
  const pane = env.HERDR_PANE_ID;
  const claimsHerdr = !env.ORCHESTRATOR_MULTIPLEXER && env.HERDR_ENV === "1" && Boolean(pane);
  return detectSessionMux({ env, hostsSelf: claimsHerdr ? probeHostsSelf(env, pane ?? "", deps) : null });
}

/** The session's multiplexer and where new ticket windows open. */
export function resolveMux(env: Env, deps: MuxDeps): MuxResolution {
  const session = sessionMuxNow(env, deps);
  const config = readUserConfig(deps.stateDir);
  const stored = config.ok ? config.config.multiplexer : null;
  const herdrInstalled = resolveHerdrBin(env, deps.home) !== null;
  return {
    session,
    windows: chooseWindowMux({ env, session, stored, herdrInstalled }),
    stored,
    storedError: config.ok ? null : config.error,
    herdrInstalled,
  };
}
