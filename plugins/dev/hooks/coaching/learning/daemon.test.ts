/**
 * Tests for the learning daemon pipeline (Phase 2, Stages 3-4)
 *
 * Tests cover:
 * - summarizeTranscript(): user messages, tool counts, truncation, failed sequences
 * - buildClassifierPrompt(): produces valid JSON with embedded system prompt
 * - parseClassifierResponse(): raw JSON, markdown code blocks, SHA-256 IDs
 * - Circuit breaker: consecutive failures trip breaker, 24h timeout, auto-reset
 * - Lock file: acquired when absent, rejected on fresh lock, overridden on stale lock
 * - isOnline(): mock behaviour
 * - Integration: queue file → pending-learnings.json via mocked classifySession
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  utimesSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Modules under test
import { summarizeTranscript } from "./summarizer";
import {
  buildClassifierPrompt,
  parseClassifierResponse,
} from "./classifier";
import {
  acquireLock,
  releaseLock,
  loadDaemonState,
  isCircuitBroken,
  recordFailure,
  recordSuccess,
  loadPendingLearnings,
  atomicWrite,
  runDaemon,
} from "./daemon";
import type { QueueEntry, DaemonState, SessionSummary, ClassifierResult } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir = "";

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "daemon-test-"));
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

/**
 * Builds a JSONL transcript string with the given human and assistant entries.
 */
function buildTranscript(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function assistantToolUse(name: string, input: Record<string, unknown>): object {
  return {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name, input }],
    },
  };
}

function humanMessage(text: string): object {
  return {
    type: "human",
    message: {
      content: [{ type: "text", text }],
    },
  };
}

function humanMessageBlocks(blocks: object[]): object {
  return {
    type: "human",
    message: { content: blocks },
  };
}

function makeQueueEntry(
  transcriptPath: string,
  overrides: Partial<QueueEntry> = {}
): QueueEntry {
  return {
    session_id: "aabbccddee112233",
    transcript_path: transcriptPath,
    queued_at: new Date().toISOString(),
    cwd: "/project",
    tool_call_count: 15,
    rule_based_signals: ["grep-instead-of-mnemex"],
    learning_signals: {
      corrections: { count: 2, phrases: ["no,", "wrong"] },
      explicitRules: { count: 1, phrases: ["we always"] },
      repeatedPatterns: 0,
      failedAttempts: 1,
      messageCount: 20,
      toolCallCount: 15,
    },
    learning_score: 15,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// summarizeTranscript()
// ---------------------------------------------------------------------------

describe("summarizeTranscript()", () => {
  it("extracts user messages with correct index and flags", () => {
    const transcript = buildTranscript([
      humanMessage("we always use pnpm here"),
      humanMessage("no, use the Write tool"),
      assistantToolUse("Write", { file_path: "/x.ts", content: "x" }),
    ]);
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, transcript);

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.user_messages).toHaveLength(2);

    const msg0 = summary.user_messages[0];
    expect(msg0.index).toBe(0);
    expect(msg0.text).toContain("pnpm");
    // "we always" matches both CORRECTION_PATTERN and EXPLICIT_RULE_PATTERN
    expect(msg0.has_correction).toBe(true);
    expect(msg0.has_explicit_rule).toBe(true); // "we always"

    const msg1 = summary.user_messages[1];
    expect(msg1.index).toBe(1);
    expect(msg1.has_correction).toBe(true); // "no,"
    expect(msg1.has_explicit_rule).toBe(false);
  });

  it("truncates user messages at 500 chars and appends '...'", () => {
    const longText = "a".repeat(600);
    const transcript = buildTranscript([humanMessage(longText)]);
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, transcript);

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.user_messages).toHaveLength(1);
    const msg = summary.user_messages[0];
    expect(msg.text).toHaveLength(503); // 500 + "..."
    expect(msg.text.endsWith("...")).toBe(true);
  });

  it("does NOT truncate messages at or under 500 chars", () => {
    const text500 = "b".repeat(500);
    const transcript = buildTranscript([humanMessage(text500)]);
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, transcript);

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.user_messages[0].text).toBe(text500);
    expect(summary.user_messages[0].text.endsWith("...")).toBe(false);
  });

  it("counts tool calls by name in by_tool map", () => {
    const transcript = buildTranscript([
      assistantToolUse("Bash", { command: "ls" }),
      assistantToolUse("Bash", { command: "pwd" }),
      assistantToolUse("Read", { file_path: "/x.ts" }),
      assistantToolUse("Write", { file_path: "/y.ts", content: "x" }),
      assistantToolUse("Write", { file_path: "/z.ts", content: "y" }),
    ]);
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, transcript);

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.tool_call_summary.by_tool["Bash"]).toBe(2);
    expect(summary.tool_call_summary.by_tool["Read"]).toBe(1);
    expect(summary.tool_call_summary.by_tool["Write"]).toBe(2);
    expect(summary.tool_call_summary.total).toBe(5);
  });

  it("detects failed Bash sequences (adjacent calls with different first tokens)", () => {
    const transcript = buildTranscript([
      assistantToolUse("Bash", { command: "grep something /x" }),
      assistantToolUse("Bash", { command: "rg something /x" }),
    ]);
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, transcript);

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.tool_call_summary.failed_sequences).toHaveLength(1);
    expect(summary.tool_call_summary.failed_sequences[0].first_cmd).toBe("grep");
    expect(summary.tool_call_summary.failed_sequences[0].second_cmd).toBe("rg");
  });

  it("does NOT flag Bash sequence when commands are identical", () => {
    const transcript = buildTranscript([
      assistantToolUse("Bash", { command: "ls -la" }),
      assistantToolUse("Bash", { command: "ls -la /tmp" }),
    ]);
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, transcript);

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    // Same first token "ls" → no failed sequence
    expect(summary.tool_call_summary.failed_sequences).toHaveLength(0);
  });

  it("passes through session metadata from queue entry", () => {
    const transcript = buildTranscript([humanMessage("hello")]);
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, transcript);

    const entry = makeQueueEntry(transcriptPath, {
      session_id: "test-session-123",
      cwd: "/my/project",
      learning_score: 42,
      rule_based_signals: ["signal-a", "signal-b"],
    });
    const summary = summarizeTranscript(entry);

    expect(summary.session_id).toBe("test-session-123");
    expect(summary.cwd).toBe("/my/project");
    expect(summary.learning_score).toBe(42);
    expect(summary.rule_based_signals).toEqual(["signal-a", "signal-b"]);
  });

  it("handles human messages with string content (not array)", () => {
    const line = JSON.stringify({
      type: "human",
      message: { content: "we always use tabs here" },
    });
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, line + "\n");

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.user_messages).toHaveLength(1);
    expect(summary.user_messages[0].has_explicit_rule).toBe(true);
  });

  it("skips malformed JSONL lines gracefully", () => {
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(
      transcriptPath,
      "not-json\n" +
        JSON.stringify(humanMessage("in this project we use pnpm")) +
        "\n{broken\n"
    );

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.user_messages).toHaveLength(1);
  });

  it("produces empty messages and tool counts for empty transcript", () => {
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, "");

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.user_messages).toHaveLength(0);
    expect(summary.tool_call_summary.total).toBe(0);
    expect(summary.tool_call_summary.failed_sequences).toHaveLength(0);
  });

  it("handles multiple text blocks in a single human message", () => {
    const line = JSON.stringify(
      humanMessageBlocks([
        { type: "text", text: "in this project" },
        { type: "text", text: " we always use bun" },
      ])
    );
    const transcriptPath = join(testDir, "t.jsonl");
    writeFileSync(transcriptPath, line + "\n");

    const entry = makeQueueEntry(transcriptPath);
    const summary = summarizeTranscript(entry);

    expect(summary.user_messages).toHaveLength(1);
    expect(summary.user_messages[0].text).toContain("in this project");
    expect(summary.user_messages[0].has_explicit_rule).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildClassifierPrompt()
// ---------------------------------------------------------------------------

describe("buildClassifierPrompt()", () => {
  it("produces valid JSON containing the system prompt string", () => {
    const summary: SessionSummary = {
      session_id: "test-123",
      cwd: "/project",
      transcript_path: "/tmp/t.jsonl",
      queued_at: "2026-01-01T00:00:00.000Z",
      learning_score: 10,
      user_messages: [],
      tool_call_summary: { total: 5, by_tool: {}, failed_sequences: [] },
      rule_based_signals: [],
    };

    const prompt = buildClassifierPrompt(summary);

    // Must be valid JSON
    expect(() => JSON.parse(prompt)).not.toThrow();

    const parsed = JSON.parse(prompt) as Record<string, unknown>;

    // Contains system prompt
    expect(typeof parsed.system).toBe("string");
    expect(String(parsed.system)).toContain("session learning classifier");

    // Contains session data
    const session = parsed.session as Record<string, unknown>;
    expect(session.session_id).toBe("test-123");
    expect(session.cwd).toBe("/project");
    expect(session.learning_score).toBe(10);
  });

  it("includes user_messages, tool_call_summary, and rule_based_signals in session", () => {
    const summary: SessionSummary = {
      session_id: "abc",
      cwd: "/x",
      transcript_path: "/t.jsonl",
      queued_at: "2026-01-01T00:00:00.000Z",
      learning_score: 7,
      user_messages: [
        { index: 0, text: "we always use pnpm", has_correction: false, has_explicit_rule: true },
      ],
      tool_call_summary: {
        total: 3,
        by_tool: { Bash: 3 },
        failed_sequences: [{ first_cmd: "npm", second_cmd: "pnpm" }],
      },
      rule_based_signals: ["grep-instead-of-mnemex"],
    };

    const parsed = JSON.parse(buildClassifierPrompt(summary)) as Record<string, unknown>;
    const session = parsed.session as Record<string, unknown>;

    expect(Array.isArray(session.user_messages)).toBe(true);
    expect(session.rule_based_signals).toEqual(["grep-instead-of-mnemex"]);
    expect((session.tool_call_summary as Record<string, unknown>).total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// parseClassifierResponse()
// ---------------------------------------------------------------------------

describe("parseClassifierResponse()", () => {
  const validResponse = JSON.stringify({
    learnings: [
      {
        type: "explicit_rule",
        confidence: "HIGH",
        is_project_specific: true,
        scope: "claude_md",
        rule_text: "Use pnpm for package management",
        evidence: "User said 'we use pnpm' at message 3",
        subsection: "Tools & Commands",
        line_cost: 1,
      },
    ],
    session_quality: "high",
    summary: "User established pnpm as the package manager",
  });

  it("parses raw JSON response", () => {
    const result = parseClassifierResponse(validResponse);

    expect(result.learnings).toHaveLength(1);
    expect(result.session_quality).toBe("high");
    expect(result.summary).toBe("User established pnpm as the package manager");
  });

  it("adds SHA-256-based ID to each learning", () => {
    const result = parseClassifierResponse(validResponse);

    const learning = result.learnings[0];
    expect(learning.id).toMatch(/^learning-[a-f0-9]{8}$/);

    // ID is deterministic: same rule_text → same hash
    const result2 = parseClassifierResponse(validResponse);
    expect(result2.learnings[0].id).toBe(learning.id);
  });

  it("produces different IDs for different rule_text values", () => {
    const resp1 = JSON.stringify({
      learnings: [
        {
          type: "correction",
          confidence: "HIGH",
          is_project_specific: true,
          scope: "claude_md",
          rule_text: "Use pnpm",
          evidence: "e",
          subsection: "Tools & Commands",
          line_cost: 1,
        },
      ],
      session_quality: "medium",
      summary: "s",
    });
    const resp2 = JSON.stringify({
      learnings: [
        {
          type: "correction",
          confidence: "HIGH",
          is_project_specific: true,
          scope: "claude_md",
          rule_text: "Use npm",
          evidence: "e",
          subsection: "Tools & Commands",
          line_cost: 1,
        },
      ],
      session_quality: "medium",
      summary: "s",
    });

    const id1 = parseClassifierResponse(resp1).learnings[0].id;
    const id2 = parseClassifierResponse(resp2).learnings[0].id;
    expect(id1).not.toBe(id2);
  });

  it("strips markdown code blocks (```json ... ```) from response", () => {
    const wrapped = "```json\n" + validResponse + "\n```";
    const result = parseClassifierResponse(wrapped);

    expect(result.learnings).toHaveLength(1);
    expect(result.session_quality).toBe("high");
  });

  it("strips plain ``` code blocks (no language tag)", () => {
    const wrapped = "```\n" + validResponse + "\n```";
    const result = parseClassifierResponse(wrapped);

    expect(result.learnings).toHaveLength(1);
  });

  it("returns empty learnings array when learnings field is absent", () => {
    const resp = JSON.stringify({ session_quality: "low", summary: "nothing" });
    const result = parseClassifierResponse(resp);

    expect(result.learnings).toHaveLength(0);
    expect(result.session_quality).toBe("low");
  });

  it("throws on completely invalid JSON", () => {
    expect(() => parseClassifierResponse("not json at all")).toThrow();
  });

  it("fills in defaults for missing learning fields", () => {
    const minimalResp = JSON.stringify({
      learnings: [{ rule_text: "Do something" }],
      session_quality: "medium",
      summary: "minimal",
    });

    const result = parseClassifierResponse(minimalResp);
    const l = result.learnings[0];

    expect(l.type).toBe("correction");
    expect(l.confidence).toBe("LOW");
    expect(l.is_project_specific).toBe(false);
    expect(l.scope).toBe("discard");
    expect(l.subsection).toBe("Conventions");
    expect(l.line_cost).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

describe("Circuit Breaker", () => {
  it("starts with zero failures and no disabled_until", () => {
    const state = loadDaemonState(join(testDir, "nonexistent.json"));
    expect(state.circuit_breaker.consecutive_failures).toBe(0);
    expect(state.circuit_breaker.disabled_until).toBeNull();
    expect(isCircuitBroken(state)).toBe(false);
  });

  it("circuit is not broken after 1 failure", () => {
    const state = loadDaemonState(join(testDir, "nonexistent.json"));
    recordFailure(state);
    expect(state.circuit_breaker.consecutive_failures).toBe(1);
    expect(isCircuitBroken(state)).toBe(false);
  });

  it("circuit is not broken after 2 failures", () => {
    const state = loadDaemonState(join(testDir, "nonexistent.json"));
    recordFailure(state);
    recordFailure(state);
    expect(state.circuit_breaker.consecutive_failures).toBe(2);
    expect(isCircuitBroken(state)).toBe(false);
  });

  it("circuit trips after 3 consecutive failures and sets disabled_until 24h ahead", () => {
    const before = Date.now();
    const state = loadDaemonState(join(testDir, "nonexistent.json"));
    recordFailure(state);
    recordFailure(state);
    recordFailure(state);

    expect(state.circuit_breaker.consecutive_failures).toBe(3);
    expect(state.circuit_breaker.disabled_until).not.toBeNull();

    const disabledUntil = new Date(state.circuit_breaker.disabled_until!).getTime();
    // Should be approximately 24 hours from now
    expect(disabledUntil).toBeGreaterThanOrEqual(before + 23 * 60 * 60 * 1000);
    expect(disabledUntil).toBeLessThanOrEqual(before + 25 * 60 * 60 * 1000);

    expect(isCircuitBroken(state)).toBe(true);
  });

  it("recordSuccess resets consecutive_failures and clears disabled_until", () => {
    const state = loadDaemonState(join(testDir, "nonexistent.json"));
    recordFailure(state);
    recordFailure(state);
    recordFailure(state);
    expect(isCircuitBroken(state)).toBe(true);

    recordSuccess(state);
    expect(state.circuit_breaker.consecutive_failures).toBe(0);
    expect(state.circuit_breaker.disabled_until).toBeNull();
    expect(isCircuitBroken(state)).toBe(false);
  });

  it("auto-resets when disabled_until timestamp is in the past", () => {
    const state: DaemonState = {
      circuit_breaker: {
        consecutive_failures: 3,
        disabled_until: new Date(Date.now() - 1000).toISOString(), // 1 second in the past
      },
      last_run: null,
      total_processed: 0,
      total_queued_for_approval: 0,
    };

    // isCircuitBroken should return false AND reset the state
    expect(isCircuitBroken(state)).toBe(false);
    expect(state.circuit_breaker.consecutive_failures).toBe(0);
    expect(state.circuit_breaker.disabled_until).toBeNull();
  });

  it("loads and roundtrips state from disk", () => {
    const statePath = join(testDir, "learning-state.json");
    const initial = loadDaemonState(statePath);
    recordFailure(initial);

    atomicWrite(statePath, JSON.stringify(initial, null, 2));

    const loaded = loadDaemonState(statePath);
    expect(loaded.circuit_breaker.consecutive_failures).toBe(1);
  });

  it("returns default state when file is corrupted", () => {
    const statePath = join(testDir, "learning-state.json");
    writeFileSync(statePath, "{ bad json }}}");

    const state = loadDaemonState(statePath);
    expect(state.circuit_breaker.consecutive_failures).toBe(0);
    expect(state.total_processed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lock File
// ---------------------------------------------------------------------------

describe("Lock File", () => {
  it("acquires lock when file does not exist", () => {
    const lockPath = join(testDir, "queue.lock");
    expect(acquireLock(lockPath)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
  });

  it("rejects lock when fresh lock file exists", () => {
    const lockPath = join(testDir, "queue.lock");
    writeFileSync(lockPath, "12345"); // Fresh lock (just written = current mtime)

    expect(acquireLock(lockPath)).toBe(false);
  });

  it("overrides stale lock (mtime > 10 minutes old)", () => {
    const lockPath = join(testDir, "queue.lock");
    writeFileSync(lockPath, "99999");

    // Set mtime to 11 minutes ago
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(lockPath, elevenMinutesAgo, elevenMinutesAgo);

    expect(acquireLock(lockPath)).toBe(true);
    // Lock file now contains current PID
    expect(readFileSync(lockPath, "utf-8")).toBe(String(process.pid));
  });

  it("releaseLock removes the lock file", () => {
    const lockPath = join(testDir, "queue.lock");
    acquireLock(lockPath);
    expect(existsSync(lockPath)).toBe(true);

    releaseLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("releaseLock is idempotent (no throw if file already gone)", () => {
    const lockPath = join(testDir, "queue.lock");
    expect(() => releaseLock(lockPath)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// atomicWrite()
// ---------------------------------------------------------------------------

describe("atomicWrite()", () => {
  it("writes content to the target path", () => {
    const path = join(testDir, "output.json");
    atomicWrite(path, '{"ok":true}');
    expect(readFileSync(path, "utf-8")).toBe('{"ok":true}');
  });

  it("does not leave a .tmp file behind", () => {
    const path = join(testDir, "output.json");
    atomicWrite(path, "data");
    const files = require("fs").readdirSync(testDir) as string[];
    expect(files.filter((f: string) => f.includes(".tmp"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loadPendingLearnings()
// ---------------------------------------------------------------------------

describe("loadPendingLearnings()", () => {
  it("returns empty array when file does not exist", () => {
    const result = loadPendingLearnings(join(testDir, "nonexistent.json"));
    expect(result).toEqual([]);
  });

  it("returns empty array for corrupted file", () => {
    const path = join(testDir, "pending.json");
    writeFileSync(path, "{ corrupted");
    expect(loadPendingLearnings(path)).toEqual([]);
  });

  it("loads existing pending learnings", () => {
    const path = join(testDir, "pending.json");
    const data = [
      {
        session_id: "abc",
        learning: {
          id: "learning-12345678",
          type: "correction",
          confidence: "HIGH",
          is_project_specific: true,
          scope: "claude_md",
          rule_text: "Use pnpm",
          evidence: "message 3",
          subsection: "Tools",
          line_cost: 1,
        },
        classified_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    writeFileSync(path, JSON.stringify(data));
    const loaded = loadPendingLearnings(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].session_id).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// Integration: runDaemon()
// ---------------------------------------------------------------------------

describe("runDaemon() integration", () => {
  function makeTranscriptFile(): string {
    const transcript = buildTranscript([
      humanMessage("we always use pnpm, not npm"),
      assistantToolUse("Bash", { command: "pnpm install" }),
      assistantToolUse("Write", { file_path: "/src/index.ts", content: "x" }),
    ]);
    const path = join(testDir, "transcript.jsonl");
    writeFileSync(path, transcript);
    return path;
  }

  const mockResult: ClassifierResult = {
    learnings: [
      {
        id: "learning-abcd1234",
        type: "explicit_rule",
        confidence: "HIGH",
        is_project_specific: true,
        scope: "claude_md",
        rule_text: "Use pnpm for package management",
        evidence: "User said 'we always use pnpm' at message 0",
        subsection: "Tools & Commands",
        line_cost: 1,
      },
    ],
    session_quality: "high",
    summary: "User prefers pnpm over npm",
  };

  it("processes queue files and writes pending-learnings.json", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    const transcriptPath = makeTranscriptFile();
    const entry = makeQueueEntry(transcriptPath);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry));

    await runDaemon(queueDir, coachingDir, {
      classify: async () => mockResult,
      checkOnline: () => true,
    });

    // Queue file should be removed
    expect(existsSync(join(queueDir, `${entry.session_id}.json`))).toBe(false);

    // pending-learnings.json should be written
    const pendingPath = join(coachingDir, "pending-learnings.json");
    expect(existsSync(pendingPath)).toBe(true);
    const pending = JSON.parse(readFileSync(pendingPath, "utf-8")) as Array<{
      session_id: string;
      learning: { rule_text: string };
    }>;
    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe(entry.session_id);
    expect(pending[0].learning.rule_text).toBe("Use pnpm for package management");
  });

  it("does NOT write pending-learnings.json for non-claude_md learnings", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    const transcriptPath = makeTranscriptFile();
    const entry = makeQueueEntry(transcriptPath);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry));

    const memoryOnlyResult: ClassifierResult = {
      learnings: [
        {
          id: "learning-eeee1234",
          type: "failed_attempt",
          confidence: "MEDIUM",
          is_project_specific: false,
          scope: "memory",
          rule_text: "Try mnemex instead of grep",
          evidence: "switched tools",
          subsection: "Workflow",
          line_cost: 1,
        },
      ],
      session_quality: "medium",
      summary: "Tool switching observed",
    };

    await runDaemon(queueDir, coachingDir, {
      classify: async () => memoryOnlyResult,
      checkOnline: () => true,
    });

    // No pending-learnings.json for non-claude_md scope
    expect(existsSync(join(coachingDir, "pending-learnings.json"))).toBe(false);
  });

  it("skips processing when offline", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    const transcriptPath = makeTranscriptFile();
    const entry = makeQueueEntry(transcriptPath);
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry));

    let classifyCalled = false;
    await runDaemon(queueDir, coachingDir, {
      classify: async () => { classifyCalled = true; return mockResult; },
      checkOnline: () => false,
    });

    // Queue file should still exist (not processed)
    expect(existsSync(queueFilePath)).toBe(true);
    expect(classifyCalled).toBe(false);
  });

  it("skips processing when circuit breaker is active", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    // Write a tripped circuit breaker state
    const brokenState: DaemonState = {
      circuit_breaker: {
        consecutive_failures: 3,
        disabled_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      last_run: null,
      total_processed: 0,
      total_queued_for_approval: 0,
    };
    writeFileSync(
      join(coachingDir, "learning-state.json"),
      JSON.stringify(brokenState)
    );

    const transcriptPath = makeTranscriptFile();
    const entry = makeQueueEntry(transcriptPath);
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry));

    let classifyCalled = false;
    await runDaemon(queueDir, coachingDir, {
      classify: async () => { classifyCalled = true; return mockResult; },
      checkOnline: () => true,
    });

    // Queue file untouched, classify never called
    expect(existsSync(queueFilePath)).toBe(true);
    expect(classifyCalled).toBe(false);
  });

  it("marks queue file as .failed when classify throws", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    const transcriptPath = makeTranscriptFile();
    const entry = makeQueueEntry(transcriptPath);
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry));

    await runDaemon(queueDir, coachingDir, {
      classify: async () => { throw new Error("API timeout"); },
      checkOnline: () => true,
    });

    // Original queue file removed; .failed marker written
    expect(existsSync(queueFilePath)).toBe(false);
    const failedPath = join(queueDir, `${entry.session_id}.failed`);
    expect(existsSync(failedPath)).toBe(true);
    const failed = JSON.parse(readFileSync(failedPath, "utf-8")) as Record<string, string>;
    expect(failed.error).toContain("API timeout");
  });

  it("removes orphaned queue entry when transcript file is missing", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    const entry = makeQueueEntry("/nonexistent/transcript.jsonl");
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry));

    await runDaemon(queueDir, coachingDir, {
      classify: async () => mockResult,
      checkOnline: () => true,
    });

    // Orphaned queue file should be removed
    expect(existsSync(queueFilePath)).toBe(false);
  });

  it("exits early when another daemon holds the lock", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    // Write a fresh lock (just created = current time)
    writeFileSync(join(queueDir, "queue.lock"), "99999");

    const transcriptPath = makeTranscriptFile();
    const entry = makeQueueEntry(transcriptPath);
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry));

    let classifyCalled = false;
    await runDaemon(queueDir, coachingDir, {
      classify: async () => { classifyCalled = true; return mockResult; },
      checkOnline: () => true,
    });

    // Lock held by another process — queue file untouched
    expect(existsSync(queueFilePath)).toBe(true);
    expect(classifyCalled).toBe(false);
  });

  it("writes learning-state.json with updated counters after processing", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    const transcriptPath = makeTranscriptFile();
    const entry = makeQueueEntry(transcriptPath);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry));

    await runDaemon(queueDir, coachingDir, {
      classify: async () => mockResult,
      checkOnline: () => true,
    });

    const statePath = join(coachingDir, "learning-state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf-8")) as DaemonState;
    expect(state.total_processed).toBe(1);
    expect(state.total_queued_for_approval).toBe(1);
    expect(state.last_run).not.toBeNull();
    expect(state.circuit_breaker.consecutive_failures).toBe(0);
  });

  it("deduplicates pending learnings across multiple runs (same rule_text)", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    const transcriptPath = makeTranscriptFile();

    // First run — queues the learning
    const entry1 = makeQueueEntry(transcriptPath, { session_id: "session001" });
    writeFileSync(join(queueDir, "session001.json"), JSON.stringify(entry1));

    await runDaemon(queueDir, coachingDir, {
      classify: async () => mockResult,
      checkOnline: () => true,
    });

    // Second run — same rule_text, should be deduped (already pending approval)
    const entry2 = makeQueueEntry(transcriptPath, { session_id: "session002" });
    writeFileSync(join(queueDir, "session002.json"), JSON.stringify(entry2));

    await runDaemon(queueDir, coachingDir, {
      classify: async () => mockResult,
      checkOnline: () => true,
    });

    const pendingPath = join(coachingDir, "pending-learnings.json");
    const pending = JSON.parse(readFileSync(pendingPath, "utf-8")) as Array<{
      session_id: string;
    }>;
    // Only 1 entry: duplicate same rule_text from session002 is suppressed
    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe("session001");
  });

  it("accumulates distinct pending learnings across multiple runs", async () => {
    const queueDir = join(testDir, "queue");
    const coachingDir = join(testDir, "coaching");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(coachingDir, { recursive: true });

    const transcriptPath = makeTranscriptFile();

    const result1: ClassifierResult = {
      learnings: [
        {
          id: "learning-aaaa1111",
          type: "explicit_rule",
          confidence: "HIGH",
          is_project_specific: true,
          scope: "claude_md",
          rule_text: "Use pnpm for package management",
          evidence: "session 1 evidence",
          subsection: "Tools & Commands",
          line_cost: 1,
        },
      ],
      session_quality: "high",
      summary: "session 1",
    };

    const result2: ClassifierResult = {
      learnings: [
        {
          id: "learning-bbbb2222",
          type: "explicit_rule",
          confidence: "HIGH",
          is_project_specific: true,
          scope: "claude_md",
          rule_text: "API routes go under /api/v1",
          evidence: "session 2 evidence",
          subsection: "Conventions",
          line_cost: 1,
        },
      ],
      session_quality: "high",
      summary: "session 2",
    };

    // First run
    const entry1 = makeQueueEntry(transcriptPath, { session_id: "session001" });
    writeFileSync(join(queueDir, "session001.json"), JSON.stringify(entry1));
    await runDaemon(queueDir, coachingDir, {
      classify: async () => result1,
      checkOnline: () => true,
    });

    // Second run with different learning
    const entry2 = makeQueueEntry(transcriptPath, { session_id: "session002" });
    writeFileSync(join(queueDir, "session002.json"), JSON.stringify(entry2));
    await runDaemon(queueDir, coachingDir, {
      classify: async () => result2,
      checkOnline: () => true,
    });

    const pendingPath = join(coachingDir, "pending-learnings.json");
    const pending = JSON.parse(readFileSync(pendingPath, "utf-8")) as Array<{
      session_id: string;
    }>;
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.session_id)).toContain("session001");
    expect(pending.map((p) => p.session_id)).toContain("session002");
  });
});
