/**
 * Extract session facts from a Claude Code transcript (`~/.claude/projects/<slug>/<id>.jsonl`).
 *
 * WHY THE TRANSCRIPT. Compaction replaces the model's context with a summary whose
 * sections are fixed (accomplished, in progress, files, next steps, constraints). Decisions,
 * verification outcomes, blockers and plan changes have no slot there, so they are the first
 * things lost. The file on disk is not compacted: Claude Code appends a `user` record flagged
 * `isCompactSummary` and keeps every earlier line. So the facts are still here after the
 * model has forgotten them.
 *
 * WHY THIS IS DEFENSIVE. The docs say the entry format "is internal to Claude Code and
 * changes between versions". Every record type this reads was measured against Claude Code
 * 2.1.263 on 2026-09-08 (see the test data). Unknown types are skipped, malformed lines are
 * skipped, and a missing or oversized file yields `parsed: false` with a reason rather than
 * an exception — the command and the hook must both degrade to git-only, never crash.
 *
 * Record shapes relied on:
 *   user       message.content is a string (a prompt) or tool_result blocks; a prompt that
 *              came from a slash command is wrapped in <command-message>/<command-name>/
 *              <command-args>; `isCompactSummary: true` marks the compaction summary;
 *              `toolUseResult` carries AskUserQuestion's structured `answers`.
 *   assistant  message.content blocks: text | thinking | tool_use{id,name,input}.
 *   attachment attachment.type === "plan_mode" carries `planFilePath`.
 *   worktree-state, pr-link, ai-title, cost-state — native records, flat.
 */
import { readFileSync, statSync } from "node:fs";
import type {
  Decision,
  Friction,
  PlanEvent,
  TranscriptFacts,
  Turn,
  VerificationEvent,
  VerificationKind,
} from "./types.ts";

/** Same ceiling as plugins/dev/hooks/coaching/analyzer.ts. */
export const MAX_TRANSCRIPT_BYTES = 50 * 1024 * 1024;

const FIRST_PROMPT_CAP = 1_500;
const TURN_CAP = 400;
const QUESTION_CAP = 240;
const SUMMARY_CAP = 700;
const ERROR_CAP = 240;
const ASSISTANT_CAP = 600;

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Anchored at the START of a shell segment, never matched anywhere in the text: a
 * `sed -n 1,60p scripts/check-types.ts` is a file read, not a typecheck, and the live
 * transcript of this very feature classified it as one before the anchor was added.
 */
const VERIFICATION_PATTERNS: Array<[VerificationKind, RegExp]> = [
  ["push", /^git\s+push\b/],
  ["commit", /^git\s+commit\b/],
  ["pr", /^gh\s+pr\s+(create|merge|checks|view)\b/],
  ["typecheck", /^((npx|bunx)\s+)?tsc\b|^(bun|npm|pnpm|yarn)\s+run\s+check:types\b|^bun\s+scripts\/check-types\.ts|^(mypy|pyright)\b/],
  ["check", /^(bun|npm|pnpm|yarn)\s+run\s+check\b|^bun\s+scripts\/check-[\w-]+\.ts|^node\s+scripts\/validate-[\w-]+\.js/],
  ["test", /^(bun|npm|pnpm|yarn)\s+(run\s+)?test\b|^((npx|bunx)\s+)?(vitest|jest)\b|^pytest\b|^(go|cargo|swift)\s+test\b/],
  ["lint", /^((npx|bunx)\s+)?eslint\b|^biome\s+(check|lint)\b|^ruff\b|^golangci-lint\b|^(bun|npm|pnpm|yarn)\s+run\s+lint\b/],
  ["build", /^(bun|npm|pnpm|yarn)\s+run\s+build\b|^(go|cargo)\s+build\b|^xcodebuild\b|^docker\s+build\b/],
];

/** Split a command line into the simple commands it runs, stripping the wrappers that
 *  precede an executable (`time`, `env`, `FOO=bar`, `cd x &&` is its own segment). */
export function commandSegments(command: string): string[] {
  return command
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim().replace(/^(?:(?:time|sudo|nohup|env|exec)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ""))
    .filter(Boolean);
}

export function classifyCommand(command: string): VerificationKind | null {
  for (const seg of commandSegments(command))
    for (const [kind, rx] of VERIFICATION_PATTERNS) if (rx.test(seg)) return kind;
  return null;
}

/** Decide pass/fail from a tool result. `is_error` wins; otherwise the text is read for
 *  the usual failure markers. A result with no marker either way is a pass — the command
 *  returned normally and said nothing alarming. */
export function judgeResult(isError: boolean, text: string): { ok: boolean; detail?: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // `FAIL` is matched case-sensitively on purpose: ` 0 fail` is a pass line.
  const failLine = lines.find(
    (l) => /\b[1-9]\d*\s+fail(ed|ing|ures?)?\b/i.test(l) || /\bFAIL\b/.test(l) || /error TS\d+/.test(l) || /\bexit code [1-9]/i.test(l),
  );
  const passLine = lines.find((l) => /\b\d+\s+pass(ed|ing)?\b|\bPASS\b|\bpassed\b/i.test(l));
  const failed = isError || !!failLine;
  const detailLine = failed ? failLine ?? passLine ?? lines[0] : passLine ?? failLine;
  return { ok: !failed, detail: detailLine ? clip(detailLine, 160) : undefined };
}

function resultText(block: Rec): string {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => (isRec(b) && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Turn a user prompt string into a turn, or null for records that are not the user talking. */
export function turnFromPrompt(text: string, at: string): Turn | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith("<local-command") || t.startsWith("[Request interrupted")) return null;
  if (t.startsWith("<command-message>")) {
    // The tag carries the slash already (`<command-name>/investigate</command-name>`).
    const name = t.match(/<command-name>([^<]*)<\/command-name>/)?.[1]?.trim().replace(/^\//, "");
    const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
    return { at, kind: "command", command: name, text: clip(args, TURN_CAP) };
  }
  return { at, kind: "prompt", text: clip(t, TURN_CAP) };
}

interface PendingAsk {
  at: string;
  header?: string;
  question: string;
  options: string[];
}
interface PendingVerify {
  at: string;
  kind: VerificationKind;
  command: string;
}

export function emptyFacts(path: string): TranscriptFacts {
  return {
    path,
    sizeBytes: 0,
    parsed: false,
    turns: [],
    decisions: [],
    planEvents: [],
    compactions: [],
    verifications: [],
    friction: [],
    delegations: [],
    sessionDirs: [],
  };
}

export function parseTranscriptText(text: string, path: string): TranscriptFacts {
  const facts = emptyFacts(path);
  facts.parsed = true;
  facts.sizeBytes = Buffer.byteLength(text);

  const pendingAsks = new Map<string, PendingAsk>();
  const pendingVerify = new Map<string, PendingVerify>();
  const pendingTools = new Map<string, string>(); // id → tool name, for friction
  const sessionDirs = new Set<string>();
  let firstPromptSeen = false;

  const noteSessionDir = (filePath: string | undefined) => {
    if (!filePath) return;
    const m = filePath.match(/(?:^|\/)ai-docs\/sessions\/([^/]+)\//);
    if (m) sessionDirs.add(`ai-docs/sessions/${m[1]}`);
  };

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec: Rec;
    try {
      rec = JSON.parse(line) as Rec;
    } catch {
      continue;
    }
    if (!isRec(rec)) continue;
    const type = str(rec.type);
    const at = str(rec.timestamp) ?? facts.lastAt ?? "";
    if (str(rec.timestamp)) {
      facts.startedAt ??= at;
      facts.lastAt = at;
    }
    facts.sessionId ??= str(rec.sessionId);

    switch (type) {
      case "ai-title":
        facts.title = str(rec.aiTitle);
        break;
      case "pr-link": {
        const n = num(rec.prNumber);
        if (n !== undefined)
          facts.prLink = { number: n, url: str(rec.prUrl) ?? "", repository: str(rec.prRepository) ?? "" };
        break;
      }
      case "worktree-state": {
        const w = rec.worktreeSession;
        if (isRec(w))
          facts.worktree = {
            path: str(w.worktreePath) ?? "",
            name: str(w.worktreeName) ?? "",
            branch: str(w.worktreeBranch) ?? "",
            originalBranch: str(w.originalBranch) ?? "",
            baseCommit: str(w.originalHeadCommit) ?? "",
          };
        break;
      }
      case "queue-operation": {
        // A message the user typed while a turn was running is queued, not sent as a
        // `user` record. `enqueue` carries the text; task notifications and other system
        // payloads arrive the same way and start with a tag.
        const content = str(rec.content);
        if (rec.operation === "enqueue" && content && !content.trimStart().startsWith("<")) {
          const turn = turnFromPrompt(content, at);
          if (turn) facts.turns.push(turn);
        }
        break;
      }
      case "cost-state":
        facts.cost = {
          totalCostUSD: num(rec.totalCostUSD),
          linesAdded: num(rec.totalLinesAdded),
          linesRemoved: num(rec.totalLinesRemoved),
          durationMs: num(rec.totalDuration),
        };
        break;
      case "attachment": {
        const a = rec.attachment;
        if (isRec(a) && a.type === "plan_mode" && str(a.planFilePath)) {
          const p = str(a.planFilePath)!;
          if (facts.planFile !== p) {
            facts.planFile = p;
            facts.planEvents.push({ at, kind: "file", path: p });
          }
        }
        break;
      }
      case "user": {
        if (rec.isSidechain === true) break;
        const msg = rec.message;
        if (!isRec(msg)) break;
        const content = msg.content;
        if (typeof content === "string") {
          if (rec.isCompactSummary === true) {
            facts.compactions.push({ at, summary: clip(content.trim(), SUMMARY_CAP) });
            break;
          }
          if (rec.isMeta === true) break;
          const turn = turnFromPrompt(content, at);
          if (!turn) break;
          facts.turns.push(turn);
          if (!firstPromptSeen) {
            firstPromptSeen = true;
            facts.firstPrompt =
              turn.kind === "command"
                ? clip(`/${turn.command ?? ""} ${content.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? ""}`.trim(), FIRST_PROMPT_CAP)
                : clip(content.trim(), FIRST_PROMPT_CAP);
          }
          break;
        }
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (!isRec(block) || block.type !== "tool_result") continue;
          const id = str(block.tool_use_id) ?? "";
          const isError = block.is_error === true;
          const textOut = resultText(block);

          const ask = pendingAsks.get(id);
          if (ask) {
            pendingAsks.delete(id);
            const tur = rec.toolUseResult;
            let chosen: string | undefined;
            if (isRec(tur) && isRec(tur.answers)) {
              const answers = Object.values(tur.answers).filter((v): v is string => typeof v === "string");
              chosen = answers[0];
            }
            if (!chosen) {
              const m = textOut.match(/answered:\s*"?([\s\S]*?)"?\s*(?:\.|$)/);
              chosen = clip((m?.[1] ?? textOut).trim(), 300);
            }
            if (isError) chosen = `(not answered: ${clip(textOut.trim(), 120)})`;
            facts.decisions.push({
              at,
              header: ask.header,
              question: ask.question,
              chosen,
              rejected: ask.options.filter((o) => o !== chosen),
            });
            continue;
          }

          const verify = pendingVerify.get(id);
          if (verify) {
            pendingVerify.delete(id);
            const j = judgeResult(isError, textOut);
            facts.verifications.push({ at: verify.at, kind: verify.kind, command: verify.command, ok: j.ok, detail: j.detail });
          }

          if (isError) {
            facts.friction.push({
              at,
              tool: pendingTools.get(id) ?? "unknown",
              error: clip(textOut.trim().split("\n")[0] ?? "", ERROR_CAP),
            });
          }
          pendingTools.delete(id);
        }
        break;
      }
      case "assistant": {
        if (rec.isSidechain === true) break;
        const msg = rec.message;
        if (!isRec(msg) || !Array.isArray(msg.content)) break;
        for (const block of msg.content) {
          if (!isRec(block)) continue;
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            facts.lastAssistantText = clip(block.text.trim(), ASSISTANT_CAP);
            continue;
          }
          if (block.type !== "tool_use") continue;
          const id = str(block.id) ?? "";
          const name = str(block.name) ?? "";
          const input = isRec(block.input) ? block.input : {};
          pendingTools.set(id, name);
          switch (name) {
            case "AskUserQuestion": {
              const qs = Array.isArray(input.questions) ? input.questions : [];
              const q = isRec(qs[0]) ? qs[0] : {};
              const options = Array.isArray(q.options)
                ? q.options.map((o) => (isRec(o) ? str(o.label) ?? "" : "")).filter(Boolean)
                : [];
              const question = (str(q.question) ?? "").split("\n")[0] ?? "";
              pendingAsks.set(id, { at, header: str(q.header), question: clip(question, QUESTION_CAP), options });
              break;
            }
            case "ExitPlanMode":
              facts.planEvents.push({ at, kind: "approved", path: str(input.planFilePath) ?? facts.planFile });
              break;
            case "Write":
            case "Edit":
            case "MultiEdit":
            case "NotebookEdit": {
              const fp = str(input.file_path) ?? str(input.notebook_path);
              if (fp && /\/\.claude\/plans\/[^/]+\.md$/.test(fp)) facts.planEvents.push({ at, kind: "edit", path: fp });
              noteSessionDir(fp);
              break;
            }
            case "Bash": {
              const command = str(input.command) ?? "";
              const kind = classifyCommand(command);
              if (kind) pendingVerify.set(id, { at, kind, command: clip(command.split("\n")[0] ?? command, 200) });
              noteSessionDir(command.match(/ai-docs\/sessions\/[^\s/"']+\//)?.[0]);
              break;
            }
            case "Agent":
            case "Task":
              facts.delegations.push({
                at,
                agent: str(input.subagent_type) ?? "general-purpose",
                description: clip(str(input.description) ?? "", 120),
              });
              break;
            default:
              break;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // A verification with no recorded result: the call was cut off or is the very last thing.
  for (const v of pendingVerify.values())
    facts.verifications.push({ at: v.at, kind: v.kind, command: v.command, ok: null });
  facts.sessionDirs = [...sessionDirs];
  return facts;
}

export function parseTranscript(path: string): TranscriptFacts {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    const f = emptyFacts(path);
    f.skippedReason = "transcript not found";
    return f;
  }
  if (size > MAX_TRANSCRIPT_BYTES) {
    const f = emptyFacts(path);
    f.sizeBytes = size;
    f.skippedReason = `transcript is ${Math.round(size / 1024 / 1024)} MB, over the ${MAX_TRANSCRIPT_BYTES / 1024 / 1024} MB ceiling`;
    return f;
  }
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (e) {
    const f = emptyFacts(path);
    f.skippedReason = `transcript unreadable: ${(e as Error).message}`;
    return f;
  }
  return parseTranscriptText(text, path);
}
