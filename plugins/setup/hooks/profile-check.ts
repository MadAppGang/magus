#!/usr/bin/env bun
/**
 * SessionStart (matcher `startup|resume`) — say so when this folder's magus profile is
 * not set up, because Claude Code started inside it loads only the plugins installed at
 * USER scope.
 *
 * Why here: a git worktree of a profiled project starts with no magus setup. The project
 * settings magus generates are git-ignored, so git never gives them to a worktree, and
 * Claude Code reads only the settings of the folder it starts in. `setup@magus` is the
 * magus plugin users install at USER scope, so it is the one that still loads there and
 * can point at the fix: `magus update` in that folder.
 *
 * The condition, checked in the project folder only (never its parents — a subfolder
 * without its own manifest is a deliberate choice):
 *   1. `.claude/profiles.json` exists and is a regular file;
 *   2. `.claude/profiles/active.json` does not exist;
 *   3. `.claude/_profiles/.active` does not exist (an earlier magus layout: set up, old).
 *
 * Project folder: `CLAUDE_PROJECT_DIR`, else the stdin payload's `cwd`, else the process
 * cwd. `resume` is in the matcher because resuming is how the failure is usually hit;
 * `clear` and `compact` do not reload plugins.
 *
 * Pure filesystem: no git, no network, no child processes. Silent with exit 0 when the
 * folder is set up, and on ANY error — a session-start hook must never block or add
 * noise to a session.
 */

import { lstatSync, statSync } from "node:fs";
import { join } from "node:path";

/** Stdin is the SessionStart payload, which the host closes at once. Never wait past this. */
const STDIN_WAIT_MS = 1_000;
/** Inside the 5 s hooks.json timeout, so a stall ends in silence, not a hook error. */
const WATCHDOG_MS = 4_000;

// Claude Code started inside this folder reads only its settings and loads only USER plugins.
// Started at the repo root with --worktree (measured on 2.1.299) it loads the root's commands
// and skills but this folder's agents and /plugin view, so a delegating command fails partway.
// The hook cannot tell the two launches apart (same project dir, cwd and stdin), so the message
// states the folder's state and never claims what this session loaded.
const SYSTEM_MESSAGE =
  "This project's plugins are not set up in this folder. Claude Code started inside it gets only " +
  "your USER plugins. Run `magus update` in this folder to set them up.";

const ADDITIONAL_CONTEXT =
  "This folder declares magus profiles, but none is set up in it, so this project's plugins are " +
  "not enabled here. In this session some of the project's commands and skills may still appear " +
  "while its agents and MCP tools are missing (Claude Code started at the repository root with " +
  "--worktree behaves this way), so a delegating command can fail partway. Before starting any " +
  "command that delegates to a plugin agent, check that the agent type it needs is available. If a " +
  "magus agent, skill, command or MCP tool is not found or answers `Unknown skill`, this is the " +
  "cause: do not search for it or work around it. Tell the user to run `magus update` in this " +
  "folder, then restart Claude Code here.";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

/** Whether anything is at `path` (a dangling symlink counts). Throws on errors other than absence. */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/**
 * What to tell the user and the model about `projectDir`, or null to say nothing.
 * Never throws: an unreadable folder is treated as nothing to say.
 */
export function profileCheck(projectDir: string): { systemMessage: string; additionalContext: string } | null {
  try {
    if (typeof projectDir !== "string" || projectDir === "") return null;
    const claudeDir = join(projectDir, ".claude");
    if (!statSync(join(claudeDir, "profiles.json")).isFile()) return null;
    if (present(join(claudeDir, "profiles", "active.json"))) return null;
    if (present(join(claudeDir, "_profiles", ".active"))) return null;
    return { systemMessage: SYSTEM_MESSAGE, additionalContext: ADDITIONAL_CONTEXT };
  } catch {
    return null;
  }
}

function cwdOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const cwd = (payload as Record<string, unknown>)["cwd"];
  return typeof cwd === "string" && cwd !== "" ? cwd : undefined;
}

async function readPayload(): Promise<unknown> {
  if (process.stdin.isTTY === true) return undefined;
  const text = await new Promise<string>((done) => {
    let data = "";
    const finish = (): void => {
      clearTimeout(timer);
      done(data);
    };
    const timer = setTimeout(finish, STDIN_WAIT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
  try {
    return text.trim() === "" ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function quiet(): never {
  process.exit(0);
}

async function main(): Promise<void> {
  process.on("uncaughtException", quiet);
  process.on("unhandledRejection", quiet);
  setTimeout(quiet, WATCHDOG_MS).unref();

  try {
    const declared = process.env["CLAUDE_PROJECT_DIR"];
    const projectDir =
      declared !== undefined && declared !== "" ? declared : (cwdOf(await readPayload()) ?? process.cwd());
    const result = profileCheck(projectDir);
    if (result !== null) {
      const out = JSON.stringify({
        systemMessage: result.systemMessage,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: result.additionalContext,
        },
      });
      await new Promise<void>((done) => process.stdout.write(`${out}\n`, () => done()));
    }
  } catch {
    // Silent by design: see the header.
  }
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
