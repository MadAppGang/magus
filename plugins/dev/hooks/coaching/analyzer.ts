#!/usr/bin/env bun
/**
 * Workflow Coaching Analyzer
 *
 * Parses a Claude Code session transcript (JSONL), applies 8 rule-based
 * detectors, and writes top-3 coaching suggestions to the output file.
 *
 * Usage:
 *   bun analyzer.ts \
 *     --transcript /path/to/transcript.jsonl \
 *     --session-id <uuid> \
 *     --rules /path/to/rules.json \
 *     --state /path/to/state.json \
 *     --output /path/to/recommendations.md \
 *     --history-dir /path/to/history/
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from "fs";
import { join } from "path";

// =============================================================================
// TYPES
// =============================================================================

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  order: number;
}

interface RuleSignal {
  tool?: string;
  command_pattern?: string;
  min_count?: number;
  any_tool?: boolean;
  content_pattern?: string;
  input_key?: string;
  value_in?: string[];
  min_count_before_first_task?: number;
  prompt_patterns?: Record<string, string>;
  prompt_pattern?: string;
  no_bash_pattern?: string;
  bash_patterns?: Array<{ pattern: string; plugin: string; command: string }>;
  min_sequential?: number;
}

interface Rule {
  id: string;
  signal: RuleSignal;
  category: string;
  priority: number;
  suggestion: string;
  suppress_after_sessions: number;
}

interface RuleState {
  last_shown_session?: number;
  shown_count?: number;
  suppress_until_count?: number;
}

// Fix 8: Separate _session_count from rules record for type safety
interface CoachingState {
  _session_count: number;
  rules: Record<string, RuleState>;
}

interface MatchedSuggestion {
  id: string;
  category: string;
  priority: number;
  suggestion: string;
  suppress_after_sessions: number;
}

// =============================================================================
// ATOMIC WRITES (Fix 1)
// =============================================================================

function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, filePath); // Atomic on POSIX
}

// =============================================================================
// TRANSCRIPT PARSING
// =============================================================================

function parseToolCalls(transcriptPath: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  const content = readFileSync(transcriptPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type !== "assistant") continue;

    const message = obj.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const contentBlocks = message.content as
      | Array<Record<string, unknown>>
      | undefined;
    if (!Array.isArray(contentBlocks)) continue;

    for (const block of contentBlocks) {
      if (block.type === "tool_use") {
        toolCalls.push({
          tool: (block.name as string) || "",
          input: (block.input as Record<string, unknown>) || {},
          order: toolCalls.length,
        });
      }
    }
  }

  return toolCalls;
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

function loadState(statePath: string): CoachingState {
  if (!existsSync(statePath)) return { _session_count: 0, rules: {} };
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf-8")) as Record<
      string,
      unknown
    >;
    // Support both new format (Fix 8) and legacy flat format
    if (raw.rules && typeof raw.rules === "object") {
      return raw as unknown as CoachingState;
    }
    // Migrate legacy flat format
    const { _session_count, ...rest } = raw;
    return {
      _session_count: ((_session_count as number) ?? 0),
      rules: rest as Record<string, RuleState>,
    };
  } catch {
    return { _session_count: 0, rules: {} };
  }
}

function saveState(statePath: string, state: CoachingState): void {
  atomicWriteFileSync(statePath, JSON.stringify(state, null, 2));
}

function isSuppressed(ruleId: string, state: CoachingState): boolean {
  const ruleState = state.rules[ruleId];
  if (!ruleState) return false;
  const suppressUntil = ruleState.suppress_until_count ?? 0;
  const currentCount = state._session_count;
  return currentCount < suppressUntil;
}

// =============================================================================
// RULE ENGINE
// =============================================================================

function applyRules(
  toolCalls: ToolCall[],
  rules: Rule[],
  state: CoachingState
): MatchedSuggestion[] {
  // Low-signal session guard
  if (toolCalls.length < 10) return [];

  const results: MatchedSuggestion[] = [];

  // Pre-computed aggregates
  const bashCalls = toolCalls.filter((tc) => tc.tool === "Bash");
  const taskCalls = toolCalls.filter((tc) => tc.tool === "Task");
  const readCalls = toolCalls.filter((tc) => tc.tool === "Read");

  const sortedRules = [...rules].sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99)
  );

  for (const rule of sortedRules) {
    if (isSuppressed(rule.id, state)) continue;

    let matched = false;
    const substitutions: Record<string, string> = {};
    const signal = rule.signal;

    switch (rule.id) {
      case "grep-instead-of-claudemem": {
        const grepPattern = /\b(grep|rg|ag|ack)\b/;
        const bashGrepCalls = bashCalls.filter((c) =>
          grepPattern.test(String(c.input.command ?? ""))
        );
        const nativeSearchCalls = toolCalls.filter(
          (tc) => tc.tool === "Grep" || tc.tool === "Glob"
        );
        const totalSearchCalls = bashGrepCalls.length + nativeSearchCalls.length;
        if (totalSearchCalls >= (signal.min_count ?? 3)) {
          matched = true;
          substitutions.count = String(totalSearchCalls);
        }
        break;
      }

      case "tmp-path-usage": {
        const tmpCalls = toolCalls.filter((tc) =>
          JSON.stringify(tc.input).includes("/tmp/")
        );
        if (tmpCalls.length > 0) matched = true;
        break;
      }

      case "skill-invoked-as-task": {
        const knownSkills = signal.value_in ?? [];
        const badTasks = taskCalls.filter((tc) =>
          knownSkills.includes(String(tc.input.subagent_type ?? ""))
        );
        if (badTasks.length > 0) {
          matched = true;
          substitutions.subagent_type = String(
            badTasks[0].input.subagent_type ?? ""
          );
        }
        break;
      }

      case "excessive-reads-before-delegation": {
        const firstTaskOrder =
          taskCalls.length > 0 ? taskCalls[0].order : Infinity;
        const readsBeforeTask = readCalls.filter(
          (r) => r.order < firstTaskOrder
        );
        const minCount = signal.min_count_before_first_task ?? 5;
        if (readsBeforeTask.length >= minCount) {
          matched = true;
          substitutions.count = String(readsBeforeTask.length);
        }
        break;
      }

      case "wrong-agent-for-task": {
        // Fix 2: Add ambiguity check — only fire when exactly ONE pattern matches
        const routing = signal.prompt_patterns ?? {};
        for (const task of taskCalls) {
          const prompt = String(task.input.prompt ?? "").toLowerCase();
          const actual = String(task.input.subagent_type ?? "");

          // Count how many patterns match this prompt
          const matches: Array<{ pattern: string; recommended: string }> = [];
          for (const [patternStr, recommended] of Object.entries(routing)) {
            const patterns = patternStr.split("|");
            if (patterns.some((p) => prompt.includes(p))) {
              matches.push({ pattern: patternStr, recommended });
            }
          }

          // Only fire if exactly ONE pattern matches (unambiguous) and agent differs
          if (matches.length === 1 && actual !== matches[0].recommended) {
            matched = true;
            substitutions.pattern = matches[0].pattern;
            substitutions.actual = actual;
            substitutions.recommended = matches[0].recommended;
            break;
          }
        }
        break;
      }

      case "single-model-critical-review": {
        // Fix 5: Require "code review" or "audit" (not just "review") to avoid false positives
        const reviewPattern =
          /\b(code\s+review|architecture\s+review|security\s+audit|code\s+audit)\b/i;
        const reviewTasks = taskCalls.filter((tc) =>
          reviewPattern.test(String(tc.input.prompt ?? ""))
        );
        const claudishCalls = bashCalls.filter((c) =>
          String(c.input.command ?? "").includes("claudish")
        );
        if (reviewTasks.length > 0 && claudishCalls.length === 0) {
          matched = true;
        }
        break;
      }

      case "plugin-command-gap": {
        const bashPatterns = signal.bash_patterns ?? [];
        outerLoop: for (const c of bashCalls) {
          const cmd = String(c.input.command ?? "");
          for (const pat of bashPatterns) {
            if (new RegExp(pat.pattern).test(cmd)) {
              matched = true;
              substitutions.plugin = pat.plugin;
              substitutions.command = pat.command;
              break outerLoop;
            }
          }
        }
        break;
      }

      case "skipped-multi-model-review": {
        // Detect /dev:feature sessions that skipped multi-model review.
        // Signal: has dev:architect AND dev:developer Task calls (feature session)
        // but NO AskUserQuestion calls AND NO claudish Bash calls.
        const architectTasks = taskCalls.filter(
          (tc) => String(tc.input.subagent_type ?? "") === "dev:architect"
        );
        const developerTasks = taskCalls.filter(
          (tc) => String(tc.input.subagent_type ?? "") === "dev:developer"
        );
        const askUserCalls = toolCalls.filter(
          (tc) => tc.tool === "AskUserQuestion"
        );
        const claudishReviewCalls = bashCalls.filter((c) =>
          String(c.input.command ?? "").includes("claudish")
        );

        // Only fire if this looks like a /dev:feature session (both agents present)
        // AND the user was never asked about model selection
        // AND no claudish calls were made for external reviews
        if (
          architectTasks.length > 0 &&
          developerTasks.length > 0 &&
          askUserCalls.length === 0 &&
          claudishReviewCalls.length === 0
        ) {
          matched = true;
        }
        break;
      }

      case "no-background-tasks": {
        let sequential = 0;
        for (let i = 0; i < taskCalls.length - 1; i++) {
          const a = taskCalls[i];
          const b = taskCalls[i + 1];
          if (
            !a.input.run_in_background &&
            !b.input.run_in_background &&
            b.order - a.order <= 2
          ) {
            sequential++;
          }
        }
        if (sequential >= (signal.min_sequential ?? 2)) {
          matched = true;
          substitutions.count = String(sequential + 1);
        }
        break;
      }
    }

    if (matched) {
      // Apply substitutions to suggestion template
      let suggestionText = rule.suggestion;
      for (const [key, val] of Object.entries(substitutions)) {
        suggestionText = suggestionText.replaceAll(`{${key}}`, val);
      }
      results.push({
        id: rule.id,
        category: rule.category,
        priority: rule.priority ?? 99,
        suggestion: suggestionText,
        suppress_after_sessions: rule.suppress_after_sessions,
      });
    }
  }

  return results;
}

// =============================================================================
// OUTPUT FORMATTING
// =============================================================================

function formatRecommendations(
  suggestions: MatchedSuggestion[],
  sessionId: string
): string {
  if (suggestions.length === 0) return "";

  const lines: string[] = [
    "",
    "---",
    "## Workflow Coaching (from previous session)",
    "",
    `*Analyzed: session ${sessionId.substring(0, 8)}...*`,
    "",
  ];

  for (let i = 0; i < suggestions.length; i++) {
    lines.push(`${i + 1}. ${suggestions[i].suggestion}`);
    lines.push("");
  }

  lines.push(
    "*To disable: set `WORKFLOW_COACHING=off` in your environment.*"
  );
  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

// =============================================================================
// ARGUMENT PARSING
// =============================================================================

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

// =============================================================================
// MAIN
// =============================================================================

function main(): void {
  const args = parseArgs(process.argv);

  const transcriptPath = args.transcript;
  const sessionId = args["session-id"];
  const rulesPath = args.rules;
  const statePath = args.state;
  const outputPath = args.output;
  const historyDir = args["history-dir"];

  // Validate required args
  const missing: string[] = [];
  if (!transcriptPath) missing.push("--transcript");
  if (!sessionId) missing.push("--session-id");
  if (!rulesPath) missing.push("--rules");
  if (!statePath) missing.push("--state");
  if (!outputPath) missing.push("--output");
  if (missing.length > 0) {
    process.stderr.write(`Missing required arguments: ${missing.join(", ")}\n`);
    process.exit(1);
  }

  // Validate sessionId format (defense-in-depth: Claude Code generates UUIDs)
  if (sessionId && !/^[a-f0-9-]+$/i.test(sessionId)) {
    process.stderr.write("Invalid session ID format\n");
    process.exit(1);
  }

  // Opt-out check (also checked in shell, but defense in depth)
  const coachingEnv = (process.env.WORKFLOW_COACHING ?? "on").toLowerCase();
  if (["off", "false", "0", "disabled"].includes(coachingEnv)) {
    if (existsSync(outputPath)) rmSync(outputPath);
    process.exit(0);
  }

  // Fix 6: File size guard — skip transcripts > 50MB to prevent memory issues
  const stats = statSync(transcriptPath);
  if (stats.size > 50 * 1024 * 1024) {
    process.stderr.write(
      `Transcript too large (${Math.round(stats.size / 1024 / 1024)}MB > 50MB), skipping\n`
    );
    process.exit(0);
  }

  // Load rules
  let rules: Rule[];
  try {
    rules = JSON.parse(readFileSync(rulesPath, "utf-8")) as Rule[];
  } catch (e) {
    process.stderr.write(`Failed to load rules: ${e}\n`);
    process.exit(1);
  }

  // Load state (Fix 8: uses structured CoachingState)
  const state = loadState(statePath);
  const sessionCount = state._session_count + 1;
  state._session_count = sessionCount;

  // Parse transcript
  let toolCalls: ToolCall[];
  try {
    toolCalls = parseToolCalls(transcriptPath);
  } catch (e) {
    process.stderr.write(`Failed to parse transcript: ${e}\n`);
    process.exit(0); // Non-fatal: transcript parse failure -> silent exit
  }

  // Low-signal session guard: skip analysis entirely for short sessions.
  // Preserves existing recommendations from previous high-signal sessions.
  if (toolCalls.length < 10) {
    saveState(statePath, state); // Still increment session count
    process.exit(0);
  }

  // Session deduplication guard: if this session was already analyzed, skip.
  // Prevents double processing when hooks fire twice (settings.json + plugin hooks.json).
  if (historyDir) {
    const historyFile = join(historyDir, `session-${sessionId.substring(0, 8)}.md`);
    if (existsSync(historyFile)) {
      saveState(statePath, state); // Still increment session count
      process.exit(0);
    }
  }

  // Apply rules
  const suggestions = applyRules(toolCalls, rules, state);

  // Take top 3 by priority
  const top3 = suggestions.sort((a, b) => a.priority - b.priority).slice(0, 3);

  // Update suppression state for shown suggestions (Fix 8: use state.rules[])
  for (const s of top3) {
    const ruleState: RuleState = state.rules[s.id] ?? {};
    ruleState.last_shown_session = sessionCount;
    ruleState.shown_count = (ruleState.shown_count ?? 0) + 1;
    ruleState.suppress_until_count = sessionCount + s.suppress_after_sessions;
    state.rules[s.id] = ruleState;
  }

  saveState(statePath, state);

  // Format and write recommendations
  const content = formatRecommendations(top3, sessionId);

  if (content) {
    atomicWriteFileSync(outputPath, content); // Fix 1: atomic write

    // Archive to history directory (optional)
    if (historyDir) {
      mkdirSync(historyDir, { recursive: true });
      const historyPath = join(
        historyDir,
        `session-${sessionId.substring(0, 8)}.md`
      );
      const historyContent =
        `# Session ${sessionId}\n\nDate: ${new Date().toISOString()}\n\n` +
        content;
      atomicWriteFileSync(historyPath, historyContent); // Fix 1: atomic write

      // History TTL cleanup — keep last 50 files, sorted by modification time
      try {
        const files = readdirSync(historyDir)
          .filter((f) => f.startsWith("session-"))
          .map((f) => ({
            name: f,
            mtime: statSync(join(historyDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);
        for (const f of files.slice(50)) {
          unlinkSync(join(historyDir, f.name));
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    // No new suggestions — preserve existing recommendations.
    // Deleting here would cause a race condition if the hook fires twice
    // (e.g., from dual registration in settings.json + plugin hooks.json).
  }
}

main();
