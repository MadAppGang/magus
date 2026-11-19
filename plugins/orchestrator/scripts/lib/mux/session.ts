// Gathers the facts the multiplexer rules in hooks/lib/mux-core.ts decide on,
// the same way for the hooks and for every script, so they cannot disagree
// about where a session lives.

import { existsSync } from "node:fs";
import {
  type Multiplexer,
  type SessionMux,
  ancestry,
  detectSessionMux,
  herdrEnvPresent,
  herdrHostsSelf,
  parseProcessInfo,
  parsePsTable,
  resolveHerdrBin,
} from "../../../hooks/lib/mux-core.ts";
import { type HerdrRunner, herdrRunner } from "../herdr-cli.ts";
import { type WindowMux, chooseWindowMux } from "../mux-choice.ts";
import type { OrchestratorMux } from "../state-core.ts";
import { readUserConfig } from "../user-config.ts";

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
 * Where this session lives. herdr is asked only when the session claims a
 * herdr pane and either nothing is forced, or a valid force meets both
 * multiplexers' variables, where the answer decides the nesting reported. So a
 * forced session that is not nested pays nothing.
 */
export function sessionMuxNow(env: Env, deps: MuxDeps): SessionMux {
  const forced = env.ORCHESTRATOR_MULTIPLEXER;
  const nestedForce = (forced === "tmux" || forced === "herdr") && Boolean(env.TMUX);
  const probe = herdrEnvPresent(env) && (!forced || nestedForce);
  return detectSessionMux({ env, hostsSelf: probe ? probeHostsSelf(env, env.HERDR_PANE_ID ?? "", deps) : null });
}

/** What a session record stores of `session`: its multiplexer and nesting, or null outside both. */
export function recordMuxOf(session: SessionMux): OrchestratorMux | null {
  return session.ok ? { kind: session.mux, nesting: session.nesting } : null;
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
