/**
 * Which session is this, where is its transcript, and who else is working in this cwd.
 *
 * Session identity, most reliable first:
 *   1. `--session <id>`                        the caller knows
 *   2. `$CLAUDE_CODE_SESSION_ID`               set in the Bash environment of Claude Code
 *                                              2.1.263 (measured 2026-09-08; the documented
 *                                              `CLAUDE_SESSION_ID` is NOT set there)
 *   3. `~/.claude/sessions/$CLAUDE_PID.json`   the live-session record, keyed by pid
 *   4. the newest transcript in the project dir  last resort, can be wrong with two sessions
 *
 * Transcripts live at `<config>/projects/<slug>/<id>.jsonl`, where `<slug>` is the cwd with
 * every non-alphanumeric character replaced by `-` (so `/a/b.c` → `-a-b-c`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LiveSession } from "./types.ts";

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
}

export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readSessionFile(path: string): LiveSession | null {
  try {
    const j = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    if (typeof j.pid !== "number" || typeof j.sessionId !== "string" || typeof j.cwd !== "string") return null;
    return {
      pid: j.pid,
      sessionId: j.sessionId,
      cwd: j.cwd,
      name: typeof j.name === "string" ? j.name : undefined,
      status: typeof j.status === "string" ? j.status : undefined,
      startedAt: typeof j.startedAt === "number" ? j.startedAt : undefined,
    };
  } catch {
    return null;
  }
}

export interface SessionResolution {
  id?: string;
  source?: "argument" | "env" | "sessions-file" | "newest-transcript";
  transcriptPath?: string;
}

export function resolveSession(opts: {
  explicit?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  configDir?: string;
}): SessionResolution {
  const env = opts.env ?? process.env;
  const config = opts.configDir ?? claudeConfigDir(env);
  const projectDir = join(config, "projects", projectSlug(opts.cwd));
  const out: SessionResolution = {};

  if (opts.explicit) {
    out.id = opts.explicit;
    out.source = "argument";
  } else if (env.CLAUDE_CODE_SESSION_ID?.trim() || env.CLAUDE_SESSION_ID?.trim()) {
    out.id = (env.CLAUDE_CODE_SESSION_ID ?? env.CLAUDE_SESSION_ID)!.trim();
    out.source = "env";
  } else if (env.CLAUDE_PID?.trim()) {
    const live = readSessionFile(join(config, "sessions", `${env.CLAUDE_PID.trim()}.json`));
    if (live) {
      out.id = live.sessionId;
      out.source = "sessions-file";
    }
  }
  if (!out.id && existsSync(projectDir)) {
    let newest: { path: string; mtime: number } | undefined;
    for (const f of readdirSync(projectDir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(projectDir, f);
      const m = statSync(p).mtimeMs;
      if (!newest || m > newest.mtime) newest = { path: p, mtime: m };
    }
    if (newest) {
      out.id = newest.path.split("/").pop()!.replace(/\.jsonl$/, "");
      out.source = "newest-transcript";
    }
  }
  if (!out.id) return out;

  const direct = join(projectDir, `${out.id}.jsonl`);
  if (existsSync(direct)) out.transcriptPath = direct;
  else {
    // A session moved with /cd or started elsewhere is stored under another project dir.
    const projects = join(config, "projects");
    try {
      for (const d of readdirSync(projects)) {
        const p = join(projects, d, `${out.id}.jsonl`);
        if (existsSync(p)) {
          out.transcriptPath = p;
          break;
        }
      }
    } catch {
      // no projects dir: nothing to find
    }
  }
  return out;
}

/** Other live Claude Code sessions whose cwd is this directory (or inside it). */
export function liveSessionsIn(cwd: string, selfSessionId: string | undefined, configDir = claudeConfigDir()): LiveSession[] {
  const dir = join(configDir, "sessions");
  if (!existsSync(dir)) return [];
  const out: LiveSession[] = [];
  const norm = cwd.replace(/\/+$/, "");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const s = readSessionFile(join(dir, f));
    if (!s) continue;
    if (s.sessionId === selfSessionId) continue;
    const sc = s.cwd.replace(/\/+$/, "");
    if (sc !== norm && !sc.startsWith(`${norm}/`)) continue;
    if (!isPidAlive(s.pid)) continue;
    out.push(s);
  }
  return out;
}
