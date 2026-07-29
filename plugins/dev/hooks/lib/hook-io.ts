/**
 * Hook I/O — the contract between Claude Code and a hook process.
 *
 * Claude Code delivers the hook payload as JSON on **stdin**. Not argv, not an
 * environment variable. Getting this wrong is silent: the hook reads nothing,
 * takes its "no input" branch, exits 0, and appears healthy forever.
 *
 * Exit codes are equally unforgiving:
 *
 *   0  allow (silence is allow)
 *   2  block — stdout is surfaced to the model as the reason
 *   *  anything else is a hook *error*: logged, and the tool runs anyway
 *
 * So `exit 1` fails open when you meant to block. Use {@link deny}.
 *
 * Reference implementation this mirrors: plugins/terminal/hooks/block-tmux-kill.ts
 */
import { readFileSync } from "node:fs";

/** Fields shared across hook events. Event-specific extras live in `raw`. */
export interface HookInput {
  event?: string;
  toolName?: string;
  toolInput: Record<string, unknown>;
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  raw: Record<string, unknown>;
}

/**
 * Read and parse the payload from stdin.
 *
 * Returns `null` when stdin is absent or unparseable. Callers must treat `null`
 * as "allow and exit" — a hook must never block the user because the hook
 * itself is broken.
 */
export function readHookInput(): HookInput | null {
  let raw: Record<string, unknown>;
  try {
    const text = readFileSync("/dev/stdin", "utf-8");
    if (!text.trim()) return null;
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;

  return {
    event: typeof raw.hook_event_name === "string" ? raw.hook_event_name : undefined,
    toolName: typeof raw.tool_name === "string" ? raw.tool_name : undefined,
    toolInput:
      typeof raw.tool_input === "object" && raw.tool_input !== null
        ? (raw.tool_input as Record<string, unknown>)
        : {},
    sessionId: typeof raw.session_id === "string" ? raw.session_id : undefined,
    transcriptPath:
      typeof raw.transcript_path === "string" ? raw.transcript_path : undefined,
    cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
    raw,
  };
}

/** Allow the tool call. Silence is allow, so this simply exits 0. */
export function allow(): never {
  process.exit(0);
}

/**
 * Block the tool call and tell the model why.
 *
 * Exit 2 is the only code that blocks. Do not also emit a `permissionDecision`
 * payload — the two mechanisms are alternatives, and nothing in this repo mixes
 * them.
 */
export function deny(reason: string): never {
  console.log(reason);
  process.exit(2);
}

/**
 * Emit SessionStart context. Plain markdown only — raw ANSI escapes corrupt the
 * transcript. Shape matches plugins/gtd/hooks/session-start-gtd.sh:109-113.
 */
export function additionalContext(text: string): never {
  if (text.trim()) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: text,
        },
      }),
    );
  }
  process.exit(0);
}
