#!/usr/bin/env bun
// SessionStart and SessionEnd hook: binds an orchestrated session to its state
// record, keeps the record's process and herdr ids current, and clears the
// session's herdr title and labels when it ends.
//
// SessionStart (startup, resume, clear): the session binds by one of the
// store's routes. It already owns its record (a refresh), its id names a
// record whose session is gone (resume), ORCHESTRATOR_CLAIM names an unbound
// claim (claim), or a /clear left this very process's record on the old id
// (clear). A nested session that inherited ORCHESTRATOR_CLAIM meets none of
// them and binds nothing. After a bind the record is published to herdr and
// records gone for 7 days are pruned.
//
// SessionEnd (any reason but clear, whose SessionStart follows at once): when
// this session owns its record and this process holds it (not a second
// process that resumed the same id while the first runs), the herdr title and
// labels are cleared.
//
// Stdin: { session_id, hook_event_name, source?, reason?, cwd }. Prints
// nothing and exits 0 on every path, within a 3 s watchdog. Writes only the
// identity file, never the progress file.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { herdrIdsOf } from "../scripts/lib/herdr-meta.ts";
import { clearRecord, publishRecord } from "../scripts/lib/herdr-publish.ts";
import {
  type StoreContext,
  aliasPath,
  bindSession,
  claudeConfigDirOf,
  ownPid,
  prune,
  readRecord,
  safeCwd,
  writableKey,
} from "../scripts/lib/record-store.ts";
import { isSessionId } from "../scripts/lib/state-core.ts";
import { stateDir } from "../scripts/lib/window.ts";

const WATCHDOG_MS = 3_000;
const PRUNE_DAYS = 7;

type HookPayload = { session_id?: unknown; hook_event_name?: unknown; source?: unknown; reason?: unknown; cwd?: unknown };

function storeContext(env: NodeJS.ProcessEnv): StoreContext {
  const home = env.HOME || homedir();
  return { stateDir: stateDir(env, home), claudeConfigDir: claudeConfigDirOf(env, home) };
}

function sessionStart(ctx: StoreContext, sessionId: string, payload: HookPayload, env: NodeJS.ProcessEnv): void {
  const source = typeof payload.source === "string" ? payload.source : "";
  const claimId = env.ORCHESTRATOR_CLAIM?.trim() || null;
  // A plain session: no alias to resume, no claim, not a /clear. Nothing to bind.
  if (claimId === null && source !== "clear" && !existsSync(aliasPath(ctx, sessionId))) return;

  const now = Date.now();
  const bound = bindSession(ctx, {
    sessionId,
    claimId,
    cwd: typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : safeCwd(env, env.HOME || homedir()),
    herdr: herdrIdsOf(env),
    now,
    self: ownPid(ctx.claudeConfigDir),
    allowClear: source === "clear",
  });
  if (!bound.ok) return;

  const record = readRecord(ctx, bound.key);
  if (record !== null) publishRecord(record, env);
  prune(ctx, { days: PRUNE_DAYS, now });
}

function sessionEnd(ctx: StoreContext, sessionId: string, payload: HookPayload, env: NodeJS.ProcessEnv): void {
  if (payload.reason === "clear") return;
  if (!existsSync(aliasPath(ctx, sessionId))) return;
  // Only the process that holds the record clears it: a second process on the same id leaves it alone.
  const owned = writableKey(ctx, sessionId, ownPid(ctx.claudeConfigDir));
  if (!owned.ok) return;
  const record = readRecord(ctx, owned.key);
  if (record !== null) clearRecord(record, env, Date.now());
}

async function main(): Promise<void> {
  const payload = JSON.parse(await Bun.stdin.text()) as HookPayload;
  const sessionId = payload.session_id;
  if (typeof sessionId !== "string" || !isSessionId(sessionId)) return;
  const ctx = storeContext(process.env);
  if (payload.hook_event_name === "SessionStart") sessionStart(ctx, sessionId, payload, process.env);
  else if (payload.hook_event_name === "SessionEnd") sessionEnd(ctx, sessionId, payload, process.env);
}

setTimeout(() => process.exit(0), WATCHDOG_MS);
try {
  await main();
} catch {
  // A record that cannot be written must never block the session.
}
process.exit(0);
