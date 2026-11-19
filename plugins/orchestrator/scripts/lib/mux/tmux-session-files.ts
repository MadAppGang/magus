// The Claude Code session running in one tmux pane, from Claude Code's own
// session files. tmux has no agent detector, so a file stands in for one, but
// only a file tied to this very pane by live process facts:
//
//   - its `tmux` field names the pane id (a cheap prefilter: a pane id is unique
//     only within one tmux server, and every server's sessions share the one
//     sessions directory);
//   - its pid and procStart are a running incarnation, so a stale file or a
//     reused pid never counts;
//   - its pid descends from the pane's own process, which pids being unique
//     machine-wide makes true for exactly one server's pane.
//
// Read only.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ancestry, parsePsTable } from "../../../hooks/lib/mux-core.ts";
import { parseTmuxField } from "../state-core.ts";

/** What a qualifying session file says. */
export interface PaneSessionFile {
  pid: number;
  sessionId: string | null;
  /** Claude Code's own status word: busy, shell, waiting, idle, …; null when absent. */
  status: string | null;
  updatedAt: number;
}

export interface PaneSessionDeps {
  /** `<claude config dir>/sessions`. */
  sessionsDir: string;
  /** The `ps -axo pid=,ppid=` table; null when it could not be read. */
  ps: () => string | null;
  /** Whether `pid` runs and started when `procStart` says. */
  live: (pid: number, procStart: string | null) => boolean;
}

interface Candidate extends PaneSessionFile {
  procStart: string | null;
}

function readCandidate(path: string, pane: string): Candidate | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  if (typeof o.tmux !== "string" || parseTmuxField(o.tmux)?.pane !== pane) return null;
  if (!Number.isInteger(o.pid)) return null;
  return {
    pid: o.pid as number,
    procStart: typeof o.procStart === "string" ? o.procStart : null,
    sessionId: typeof o.sessionId === "string" && o.sessionId !== "" ? o.sessionId : null,
    status: typeof o.status === "string" && o.status !== "" ? o.status : null,
    updatedAt: typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt) ? o.updatedAt : 0,
  };
}

/**
 * The session file bound to tmux pane `pane`, whose own process is `panePid`:
 * the newest by `updatedAt` among the files that pass all three tests above.
 * Null when none does, when the directory cannot be read, or when the process
 * table cannot be read (nothing can then be tied to the pane). Never throws.
 */
export function paneSessionFile(pane: string, panePid: number, deps: PaneSessionDeps): PaneSessionFile | null {
  let names: string[];
  try {
    names = readdirSync(deps.sessionsDir);
  } catch {
    return null;
  }
  const candidates = names.flatMap((name) => {
    if (!/^\d+\.json$/.test(name)) return [];
    const found = readCandidate(join(deps.sessionsDir, name), pane);
    return found === null ? [] : [found];
  });
  if (candidates.length === 0) return null;
  const table = deps.ps();
  if (table === null) return null;
  const parents = parsePsTable(table);
  let best: Candidate | null = null;
  for (const file of candidates) {
    if (!ancestry(parents, file.pid).includes(panePid) || !deps.live(file.pid, file.procStart)) continue;
    if (best === null || file.updatedAt > best.updatedAt) best = file;
  }
  if (best === null) return null;
  const { procStart: _procStart, ...view } = best;
  return view;
}
