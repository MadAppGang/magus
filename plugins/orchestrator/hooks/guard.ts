#!/usr/bin/env bun
// PreToolUse gatekeeper: keeps tickets and ticket sessions with triage. For a
// session whose orchestration record makes it a manager or a child, it denies
// starting ticket sessions, tracker creates, scope and description edits, and
// every label change; a manager may still set its own ticket's state and
// assignee, comment on it and attach links or files (scripts/lib/guard-core.ts
// holds the rules).
//
// The role comes only from the record this session owns: `by-session/<id>`
// names a record whose `sessionId` is this session's id. The environment is
// never read for it, so a nested session that inherited a launch variable is
// unbound and passes. Triage and unbound sessions pass.
//
// Stdin: the PreToolUse payload { session_id, tool_name, tool_input }. On deny
// it prints the hookSpecificOutput deny JSON, whose reason the model reads; on
// allow it prints nothing. Exits 0 on every path. An unreadable payload, a
// missing or unreadable record, any thrown error and the 3 s watchdog all
// allow: a guard that fails closed would break every tool call.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isSessionId } from "../scripts/lib/state-core.ts";
import { stateDir } from "../scripts/lib/window.ts";

const WATCHDOG_MS = 3_000;

type Payload = { session_id?: unknown; tool_name?: unknown; tool_input?: unknown };

async function main(): Promise<string | null> {
  const payload = JSON.parse(await Bun.stdin.text()) as Payload;
  const sessionId = payload.session_id;
  const toolName = payload.tool_name;
  if (typeof sessionId !== "string" || !isSessionId(sessionId) || typeof toolName !== "string") return null;

  const home = process.env.HOME || homedir();
  const dir = stateDir(process.env, home);
  // Fast path: a session that was never bound has no alias. One stat, no further imports.
  if (!existsSync(join(dir, "by-session", sessionId))) return null;

  const store = await import("../scripts/lib/record-store.ts");
  const ctx = { stateDir: dir, claudeConfigDir: store.claudeConfigDirOf(process.env, home) };
  const key = store.ownedKey(ctx, sessionId);
  if (key === null) return null;
  const record = store.readRecord(ctx, key);
  if (record === null) return null;

  const { decide, ownTicketOf } = await import("../scripts/lib/guard-core.ts");
  const decision = decide({ role: record.role, own: ownTicketOf(record.ticket), toolName, toolInput: payload.tool_input });
  if (decision.kind !== "deny") return null;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decision.reason },
  });
}

setTimeout(() => process.exit(0), WATCHDOG_MS);
let out: string | null = null;
try {
  out = await main();
} catch {
  out = null;
}
if (out !== null) await Bun.write(Bun.stdout, `${out}\n`);
process.exit(0);
