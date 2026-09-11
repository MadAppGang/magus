#!/usr/bin/env bun
/**
 * Stop hook — refuse to end the turn while a dispatched `madbench:operator` has not
 * reported back.
 *
 * THE FAILURE IT CATCHES. In this Claude Code build every `Agent` call is asynchronous.
 * It returns "Async agent launched successfully… agentId: <id>" immediately and the
 * parent is told a `<task-notification>` will arrive later. If the parent replies before
 * that notification, the session closes and the operator is killed mid-run — after
 * reading its skill, before opening the pane the user asked to watch.
 *
 * WHY A HOOK AND NOT MORE WORDING. `commands/bench.md` says three times to block on
 * `TaskOutput(task_id, block: true, timeout: 600000)`. Measured on the MBN-1 bench,
 * `--repeat 5` twice: parents that actually waited were 3/5, then 2/5. Wording is roughly
 * a coin flip; a Stop hook is a mechanism.
 *
 * WHAT IT DOES. Reads the transcript, finds the most recent `madbench:operator` dispatch,
 * and asks whether anything since then says that operator finished. If not, it answers
 * `{"decision":"block","reason":…}` and names the exact call to make. Otherwise it is
 * silent.
 *
 * WHY BLOCKING IS SAFE HERE, WHEN IT WAS NOT FOR THE dev PHASE GATE. That gate had to
 * guess whether half-written artifacts meant "in progress" or "abandoned" — information
 * that is simply absent at Stop time. This one asks a question the transcript answers
 * outright: is there a terminal notification for this task id, yes or no. The uncertain
 * paths below all allow.
 *
 * EVERY ESCAPE HATCH IS DELIBERATE. A Stop hook that can trap a session is worse than no
 * hook at all, so it gives up whenever it might be wrong:
 *
 *   - no transcript, unreadable transcript, or a parse failure   -> allow, silently
 *   - no `madbench:operator` dispatch in the transcript at all   -> allow (the common case,
 *                                                                   and the early exit)
 *   - a dispatch whose tool result carries no agentId            -> allow (nothing to name,
 *                                                                   and a synchronous agent
 *                                                                   has already reported)
 *   - a dispatch older than 45 minutes with no report            -> allow (operator is dead)
 *   - 6 consecutive blocks already issued for this task id       -> allow (the parent is
 *                                                                   not going to comply,
 *                                                                   or the id is a ghost)
 *
 * `stop_hook_active` is true when the model is already continuing from one of our blocks.
 * That is not a reason to stop blocking — the operator is still unreported — so the loop
 * is bounded by the block cap instead, counted from two independent places so that
 * neither one alone can lose count.
 *
 * Dependency-free: Bun and node built-ins only. The plugin ships no package.json.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const OPERATOR = "madbench:operator";

/** Stamped into every block reason so a later invocation can count its own prior blocks. */
export const SENTINEL = "madbench-stop-wait";

/** Consecutive blocks allowed for one task id before the hook gives up and lets the turn end. */
export const MAX_BLOCKS = 6;

/** A dispatch this old with no report is treated as dead, not as work in flight. */
export const STALE_AFTER_MS = 45 * 60 * 1000;

/** Bigger than this and the hook declines to read it. A Stop hook must not stall a turn. */
const MAX_TRANSCRIPT_BYTES = 256 * 1024 * 1024;

/** Statuses that mean the task is still going. Anything else in a notification is terminal. */
const LIVE_STATUSES = new Set(["running", "in_progress", "pending", "queued", "started"]);

/** A TaskOutput result saying "not finished yet" rather than carrying the operator's report. */
const STILL_RUNNING =
  /still\s+running|still\s+in\s+progress|not\s+(yet\s+)?(finished|completed|done)|timed?\s*out\s+waiting|no\s+output\s+yet/i;

export interface StopInput {
  transcript_path?: string;
  session_id?: string;
  stop_hook_active?: boolean;
  cwd?: string;
}

interface Dispatch {
  /** The `Agent` tool_use id, which is how its tool result is found. */
  toolUseId: string;
  /** Line index of the dispatch. Only records after it can report it. */
  index: number;
  /** The async agentId parsed out of the tool result, when there is one. */
  agentId?: string;
  /** ISO timestamp of the dispatch record, when the record carries one. */
  at?: number;
}

interface ToolResult {
  toolUseId: string;
  index: number;
  text: string;
}

interface Analysis {
  dispatches: Dispatch[];
  /** Terminal `<task-notification>` task ids, with the line index they landed on. */
  terminal: { taskId: string; index: number }[];
  /** TaskOutput calls that came back with something other than "still running". */
  taskOutputDone: { taskId: string; index: number }[];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("\n");
}

function isOperatorDispatch(input: Record<string, unknown>): boolean {
  // subagent_type is the authority; the text fields are the fallback for a dispatch that
  // named the operator in prose (a command variant, or a re-dispatch written by hand).
  if (input.subagent_type === OPERATOR) return true;
  if (typeof input.subagent_type === "string") return false;
  for (const key of ["prompt", "description"]) {
    const value = input[key];
    if (typeof value === "string" && value.includes(OPERATOR)) return true;
  }
  return false;
}

/**
 * Read the transcript into the three lists the decision needs.
 *
 * Raw-line scanning does the notifications, because a `<task-notification>` reaches the
 * transcript in three different record shapes (`queue-operation` enqueue, its `remove`,
 * and a `queued_command` attachment) and the text is identical in all of them. Matching
 * the text once is both cheaper and less brittle than modelling three record types.
 */
export function analyse(text: string): Analysis {
  const lines = text.split("\n");
  const dispatches: Dispatch[] = [];
  const results: ToolResult[] = [];
  const taskOutputCalls = new Map<string, string>(); // tool_use id -> task id
  const terminal: { taskId: string; index: number }[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;

    if (line.includes("<task-notification>")) {
      const pattern = /<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>/g;
      let hit: RegExpExecArray | null;
      while ((hit = pattern.exec(line)) !== null) {
        const taskId = (hit[1] ?? "").trim();
        const status = (hit[2] ?? "").trim().toLowerCase();
        if (taskId && !LIVE_STATUSES.has(status)) terminal.push({ taskId, index });
      }
    }

    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;

    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a truncated or partial line is not a reason to block
    }
    const message = (record as { message?: { content?: unknown } }).message;
    const parts = message?.content;
    if (!Array.isArray(parts)) continue;
    const stamp = Date.parse((record as { timestamp?: string }).timestamp ?? "");
    const at = Number.isNaN(stamp) ? undefined : stamp;

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const item = part as {
        type?: string;
        name?: string;
        id?: string;
        tool_use_id?: string;
        input?: Record<string, unknown>;
        content?: unknown;
      };

      if (item.type === "tool_use" && item.name === "Agent" && item.id) {
        if (isOperatorDispatch(item.input ?? {})) {
          dispatches.push({ toolUseId: item.id, index, at });
        }
        continue;
      }

      if (item.type === "tool_use" && item.name === "TaskOutput" && item.id) {
        const taskId = item.input?.task_id;
        if (typeof taskId === "string") taskOutputCalls.set(item.id, taskId);
        continue;
      }

      if (item.type === "tool_result" && item.tool_use_id) {
        results.push({ toolUseId: item.tool_use_id, index, text: textOf(item.content) });
      }
    }
  }

  const byToolUse = new Map<string, ToolResult>();
  for (const result of results) if (!byToolUse.has(result.toolUseId)) byToolUse.set(result.toolUseId, result);

  for (const dispatch of dispatches) {
    const result = byToolUse.get(dispatch.toolUseId);
    const agentId = result?.text.match(/agentId:\s*([A-Za-z0-9_-]+)/)?.[1];
    if (agentId) dispatch.agentId = agentId;
  }

  const taskOutputDone: { taskId: string; index: number }[] = [];
  for (const [toolUseId, taskId] of taskOutputCalls) {
    const result = byToolUse.get(toolUseId);
    if (!result) continue; // the call is still open; it proves nothing yet
    if (STILL_RUNNING.test(result.text)) continue;
    taskOutputDone.push({ taskId, index: result.index });
  }

  return { dispatches, terminal, taskOutputDone };
}

/** Has anything after `dispatch` said that this operator finished? */
function hasReported(analysis: Analysis, dispatch: Dispatch): boolean {
  const id = dispatch.agentId;
  if (!id) return true; // unnamed: nothing to wait on, nothing to instruct
  const after = (entry: { taskId: string; index: number }) =>
    entry.taskId === id && entry.index > dispatch.index;
  return analysis.terminal.some(after) || analysis.taskOutputDone.some(after);
}

export function blockReason(taskId: string): string {
  return [
    `The madbench operator you dispatched (task ${taskId}) has not reported back. Do not reply. ` +
      `Call TaskOutput(task_id: "${taskId}", block: true, timeout: 600000) now and repeat it until ` +
      `the result says the operator completed; then write the Step 3 reply from its report. ` +
      // Measured: a parent that was blocked went looking for TaskOutput with ToolSearch, got an
      // empty result, and the session ended 15 s later. Say how to load it before saying to call it.
      `If TaskOutput is not in your tool list, load it first with ToolSearch("select:TaskOutput") — ` +
      `it is a deferred tool — and then call it. Do not end your turn without it.`,
    `[${SENTINEL} ${taskId}]`,
  ].join("\n");
}

/** How many blocks this hook has already issued for `taskId`, read back out of the transcript. */
export function priorBlocksInTranscript(text: string, taskId: string): number {
  const needle = `[${SENTINEL} ${taskId}]`;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

export interface DecideOptions {
  now: number;
  /** Blocks already issued for this id from a source other than the transcript. */
  extraBlocks?: (taskId: string) => number;
}

/**
 * The whole decision, as a pure function of the transcript text.
 *
 * Returns the task id to block on, or null to allow the turn to end.
 */
export function decide(text: string, options: DecideOptions): { taskId: string; reason: string } | null {
  if (!text.includes(OPERATOR)) return null;

  const analysis = analyse(text);
  const latest = analysis.dispatches.at(-1);
  if (!latest) return null;
  if (!latest.agentId) return null;
  if (hasReported(analysis, latest)) return null;
  if (latest.at !== undefined && options.now - latest.at > STALE_AFTER_MS) return null;

  const taskId = latest.agentId;
  const blocks = Math.max(
    priorBlocksInTranscript(text, taskId),
    options.extraBlocks?.(taskId) ?? 0,
  );
  if (blocks >= MAX_BLOCKS) return null;

  return { taskId, reason: blockReason(taskId) };
}

/**
 * Per-session block tally on disk.
 *
 * The transcript count is the primary source, but a block reason is not guaranteed to be
 * written back into the transcript in every build. If it is not, the transcript count
 * stays at zero forever and the cap never fires — which is the one way this hook could
 * trap a session. The file is the independent second count that makes the cap hold.
 */
function counterPath(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return join(tmpdir(), "madbench-stop-wait", `${safe}.json`);
}

export function readCounter(sessionId: string): { taskId: string; blocks: number } | null {
  try {
    const parsed = JSON.parse(readFileSync(counterPath(sessionId), "utf-8")) as {
      taskId?: unknown;
      blocks?: unknown;
    };
    if (typeof parsed.taskId !== "string" || typeof parsed.blocks !== "number") return null;
    return { taskId: parsed.taskId, blocks: parsed.blocks };
  } catch {
    return null;
  }
}

export function bumpCounter(sessionId: string, taskId: string): void {
  try {
    const current = readCounter(sessionId);
    const blocks = current && current.taskId === taskId ? current.blocks + 1 : 1;
    const path = counterPath(sessionId);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({ taskId, blocks }));
  } catch {
    // A tally we cannot persist costs us one of six attempts, not correctness.
  }
}

/** Read the transcript, or null for any reason at all. Never throws. */
export function readTranscript(path: string | undefined): string | null {
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    if (statSync(path).size > MAX_TRANSCRIPT_BYTES) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<void> {
  let input: StopInput = {};
  try {
    input = JSON.parse(await readStdin()) as StopInput;
  } catch {
    process.exit(0); // no parseable input -> nothing to judge
  }

  const text = readTranscript(input.transcript_path);
  if (text === null) process.exit(0);

  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  let verdict: { taskId: string; reason: string } | null = null;
  try {
    verdict = decide(text, {
      now: Date.now(),
      extraBlocks: (taskId) => {
        const counter = sessionId ? readCounter(sessionId) : null;
        return counter && counter.taskId === taskId ? counter.blocks : 0;
      },
    });
  } catch {
    process.exit(0); // an internal error must never hold a turn hostage
  }

  if (!verdict) process.exit(0);

  if (sessionId) bumpCounter(sessionId, verdict.taskId);
  process.stdout.write(JSON.stringify({ decision: "block", reason: verdict.reason }));
  process.exit(0);
}

// Run only when executed directly, so the test file can import the pure parts.
if (import.meta.main) void main();
