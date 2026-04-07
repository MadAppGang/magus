/**
 * E2E tests for the Self-Learning Stop Hook pipeline
 *
 * These tests validate the full pipeline from JSONL transcript input
 * through Stage 2 (learning score) → queue file → daemon processing
 * → router → quality gate → pending-learnings.json.
 *
 * Design constraints:
 * - classifySession is always mocked — no real Anthropic API calls
 * - isOnline is always mocked — no network dependency
 * - All file I/O uses mkdtempSync temp directories, cleaned up in afterEach
 * - Analyzer.ts Stage 2 is tested via CLI subprocess (same as analyzer.test.ts)
 * - runDaemon is called directly (not via nohup) for deterministic execution
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
  readdirSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

import { runDaemon } from "./daemon";
import type { ClassifierResult, Learning, QueueEntry } from "./types";

const ANALYZER_PATH = join(import.meta.dir, "../analyzer.ts");
const SESSION_START_HOOK_PATH = join(import.meta.dir, "../../session-start-coaching.sh");
const LEARN_COMMAND_PATH = join(import.meta.dir, "../../../commands/learn.md");
const RULES_PATH = join(import.meta.dir, "../rules.json");

// =============================================================================
// TEST ENVIRONMENT
// =============================================================================

let testDir = "";
let projectDir = "";
let coachingDir = "";
let queueDir = "";
let transcriptsDir = "";

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "e2e-learning-"));
  projectDir = join(testDir, "project");
  coachingDir = join(testDir, "coaching");
  queueDir = join(coachingDir, "learning-queue");
  transcriptsDir = join(testDir, "transcripts");

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(coachingDir, { recursive: true });
  mkdirSync(queueDir, { recursive: true });
  mkdirSync(transcriptsDir, { recursive: true });
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// =============================================================================
// TRANSCRIPT BUILDERS
// =============================================================================

function makeAssistantTool(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name, input }] },
  });
}

function makeHuman(text: string): string {
  return JSON.stringify({
    type: "human",
    message: { content: [{ type: "text", text }] },
  });
}

/**
 * Build a transcript with correction + explicit rule messages for high-signal sessions.
 * Pads with Write tool calls to exceed the 10-call minimum guard.
 * Using Write (not Grep/Glob) avoids triggering grep-instead-of-mnemex rule.
 */
function buildTranscript(opts: {
  corrections?: string[];
  explicitRules?: string[];
  extraToolCount?: number;
}): string {
  const { corrections = [], explicitRules = [], extraToolCount = 0 } = opts;
  const lines: string[] = [];
  // Need at least 10 tool calls to avoid the noise penalty (-10 when toolCallCount < 10)
  // Human messages are NOT tool calls, so we must pad with enough assistant tool_use blocks
  const humanCount = corrections.length + explicitRules.length;
  const padCount = Math.max(0, 12 - extraToolCount);
  for (let i = 0; i < padCount; i++) {
    lines.push(makeAssistantTool("Write", { file_path: `/project/file${i}.ts`, content: "x" }));
  }
  for (let i = 0; i < extraToolCount; i++) {
    lines.push(makeAssistantTool("Bash", { command: `echo extra${i}` }));
  }
  for (const msg of corrections) lines.push(makeHuman(msg));
  for (const msg of explicitRules) lines.push(makeHuman(msg));
  return lines.join("\n") + "\n";
}

/** High-signal transcript with multiple corrections and explicit rules (score >= 5) */
function buildHighSignalTranscript(): string {
  return buildTranscript({
    corrections: [
      "no, wrong — we always use pnpm in this project",
      "no, use the Write tool instead",
    ],
    explicitRules: ["in this project we never use npm install"],
  });
}

/** Low-signal transcript: only tool calls, no corrections */
function buildLowSignalTranscript(): string {
  const lines: string[] = [];
  for (let i = 0; i < 12; i++) {
    lines.push(makeAssistantTool("Write", { file_path: `/project/file${i}.ts`, content: "x" }));
  }
  return lines.join("\n") + "\n";
}

// =============================================================================
// QUEUE ENTRY HELPERS
// =============================================================================

function makeQueueEntry(
  transcriptPath: string,
  cwd: string,
  overrides: Partial<QueueEntry> = {}
): QueueEntry {
  return {
    session_id: "aabbccdd11223344",
    transcript_path: transcriptPath,
    queued_at: new Date().toISOString(),
    cwd,
    tool_call_count: 15,
    rule_based_signals: [],
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

// =============================================================================
// MOCK CLASSIFIER FACTORY
// =============================================================================

function makeClassifierResult(opts: {
  ruleText?: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  type?: ClassifierResult["learnings"][number]["type"];
  isProjectSpecific?: boolean;
  lineCost?: number;
  subsection?: string;
} = {}): ClassifierResult {
  const {
    ruleText = "Use pnpm for package management",
    confidence = "HIGH",
    type = "explicit_rule",
    isProjectSpecific = true,
    lineCost = 1,
    subsection = "Tools & Commands",
  } = opts;

  return {
    learnings: [
      {
        id: "learning-test0001",
        type,
        confidence,
        is_project_specific: isProjectSpecific,
        scope: confidence === "HIGH" && isProjectSpecific ? "claude_md" : "memory",
        rule_text: ruleText,
        evidence: "User said 'we use pnpm' at message 3",
        subsection,
        line_cost: lineCost,
      },
    ],
    session_quality: "high",
    summary: "User established project conventions",
  };
}

const mockClassify = (result: ClassifierResult) => async () => result;
const mockClassifyFail = () => async (): Promise<ClassifierResult> => {
  throw new Error("LLM API timeout");
};

// =============================================================================
// HELPER: RUN ANALYZER CLI (for Stage 2 integration tests)
// =============================================================================

function runAnalyzerWithQueue(
  sessionId: string,
  transcriptPath: string,
  cwd: string,
  queueDirPath: string,
  env?: Record<string, string>
) {
  return spawnSync(
    "bun",
    [
      ANALYZER_PATH,
      "--transcript", transcriptPath,
      "--session-id", sessionId,
      "--rules", RULES_PATH,
      "--state", join(coachingDir, "state.json"),
      "--output", join(coachingDir, "recommendations.md"),
      "--history-dir", join(coachingDir, "history"),
      "--cwd", cwd,
      "--queue-dir", queueDirPath,
    ],
    {
      env: {
        ...process.env,
        WORKFLOW_COACHING: "on",
        WORKFLOW_LEARNING: "on",
        ...env,
      },
      timeout: 30_000,
    }
  );
}

function runSessionStartHook(cwd: string) {
  return spawnSync("bash", [SESSION_START_HOOK_PATH], {
    input: JSON.stringify({ cwd, session_id: "next-session" }),
    env: { ...process.env },
    timeout: 30_000,
  });
}

function parseAdditionalContext(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    return parsed.hookSpecificOutput?.additionalContext ?? "";
  } catch {
    // Hook may output non-JSON (e.g., plain text coaching box)
    return trimmed;
  }
}

// =============================================================================
// E2E-01: Stage 2 writes queue file for high-scoring transcripts
// =============================================================================

describe("E2E-01: Stage 2 writes queue file for high-scoring transcripts", () => {
  it("writes a queue file when session has corrections and explicit rules", () => {
    const transcriptPath = join(transcriptsDir, "session-01.jsonl");
    const sessionId = "aabbccdd11223344";
    writeFileSync(transcriptPath, buildHighSignalTranscript());

    const result = runAnalyzerWithQueue(sessionId, transcriptPath, projectDir, queueDir);
    expect(result.status).toBe(0);

    const queueFile = join(queueDir, `${sessionId}.json`);
    expect(existsSync(queueFile)).toBe(true);

    const entry = JSON.parse(readFileSync(queueFile, "utf-8")) as QueueEntry;
    expect(entry.session_id).toBe(sessionId);
    expect(entry.transcript_path).toBe(transcriptPath);
    expect(entry.learning_score).toBeGreaterThanOrEqual(5);
    expect(typeof entry.queued_at).toBe("string");
    expect(entry.learning_signals).toBeDefined();
    expect(typeof entry.learning_signals.corrections.count).toBe("number");
  });

  it("does NOT write a queue file for a low-signal transcript", () => {
    const transcriptPath = join(transcriptsDir, "session-low.jsonl");
    const sessionId = "00112233aabbccdd";
    writeFileSync(transcriptPath, buildLowSignalTranscript());

    const result = runAnalyzerWithQueue(sessionId, transcriptPath, projectDir, queueDir);
    expect(result.status).toBe(0);

    expect(existsSync(join(queueDir, `${sessionId}.json`))).toBe(false);
  });
});

// =============================================================================
// E2E-02: Full daemon pipeline — queue file → pending-learnings.json
// =============================================================================

describe("E2E-02: Daemon processes queue file → pending-learnings.json written", () => {
  it("writes HIGH-confidence learning to pending-learnings.json and removes queue file", async () => {
    const transcriptPath = join(transcriptsDir, "session-02.jsonl");
    writeFileSync(transcriptPath, buildHighSignalTranscript());
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({
        ruleText: "Use pnpm for package management",
        confidence: "HIGH",
        isProjectSpecific: true,
      })),
      checkOnline: () => true,
    });

    expect(existsSync(join(queueDir, `${entry.session_id}.json`))).toBe(false);

    const pendingPath = join(coachingDir, "pending-learnings.json");
    expect(existsSync(pendingPath)).toBe(true);

    const pending = JSON.parse(readFileSync(pendingPath, "utf-8")) as Array<{
      session_id: string;
      learning: { rule_text: string; confidence: string };
      classified_at: string;
    }>;

    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe(entry.session_id);
    expect(pending[0].learning.rule_text).toBe("Use pnpm for package management");
    expect(pending[0].learning.confidence).toBe("HIGH");
    expect(typeof pending[0].classified_at).toBe("string");
  });

  it("routes all three learning types correctly in one run", async () => {
    const transcriptPath = join(transcriptsDir, "session-mixed.jsonl");
    writeFileSync(transcriptPath, buildHighSignalTranscript());
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    const recsPath = join(coachingDir, "recommendations.md");
    writeFileSync(recsPath, "[human]\n\n[claude]\n\n");

    const mixedResult: ClassifierResult = {
      learnings: [
        {
          id: "learning-h1",
          type: "explicit_rule",
          confidence: "HIGH",
          is_project_specific: true,
          scope: "claude_md",
          rule_text: "Use pnpm for package management",
          evidence: "User explicit rule",
          subsection: "Tools & Commands",
          line_cost: 1,
        },
        {
          id: "learning-m1",
          type: "correction",
          confidence: "MEDIUM",
          is_project_specific: true,
          scope: "memory",
          rule_text: "Prefer Write over shell redirection",
          evidence: "User corrected tool choice",
          subsection: "Workflow",
          line_cost: 1,
        },
        {
          id: "learning-fa1",
          type: "failed_attempt",
          confidence: "MEDIUM",
          is_project_specific: false,
          scope: "coaching",
          rule_text: "Switch tools after a failed shell approach",
          evidence: "Retried with different tool",
          subsection: "Workflow",
          line_cost: 1,
        },
      ],
      session_quality: "high",
      summary: "Multiple learning types",
    };

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(mixedResult),
      checkOnline: () => true,
    });

    // HIGH → pending
    const pending = JSON.parse(
      readFileSync(join(coachingDir, "pending-learnings.json"), "utf-8")
    ) as Array<{ learning: { rule_text: string } }>;
    expect(pending).toHaveLength(1);
    expect(pending[0].learning.rule_text).toBe("Use pnpm for package management");

    // MEDIUM correction → recommendations.md [claude] section
    const recs = readFileSync(recsPath, "utf-8");
    expect(recs).toContain("Prefer Write over shell redirection");

    // failed_attempt (MEDIUM) → recommendations.md [human] section
    expect(recs).toContain("Switch tools after a failed shell approach");

    // MEDIUM correction → feedback file written
    const feedbackDir = join(coachingDir, "feedback");
    expect(existsSync(feedbackDir)).toBe(true);
    expect(readdirSync(feedbackDir).some((f) => f.startsWith("feedback_learned_"))).toBe(true);
  });
});

// =============================================================================
// E2E-03: Dedup across sessions — same learning queued only once in pending
// =============================================================================

describe("E2E-03: Dedup — same learning from two sessions queued only once", () => {
  it("skips a learning already in pending-learnings.json (pendingHashes check)", async () => {
    const ruleText = "Use pnpm for package management";

    const transcriptA = join(transcriptsDir, "session-a.jsonl");
    writeFileSync(transcriptA, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entryA = makeQueueEntry(transcriptA, projectDir, { session_id: "aaaabbbbccccdddd" });
    writeFileSync(join(queueDir, `${entryA.session_id}.json`), JSON.stringify(entryA, null, 2));

    const transcriptB = join(transcriptsDir, "session-b.jsonl");
    writeFileSync(transcriptB, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entryB = makeQueueEntry(transcriptB, projectDir, { session_id: "bbbbccccddddeeee" });
    writeFileSync(join(queueDir, `${entryB.session_id}.json`), JSON.stringify(entryB, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({ ruleText })),
      checkOnline: () => true,
    });

    const pending = JSON.parse(
      readFileSync(join(coachingDir, "pending-learnings.json"), "utf-8")
    ) as Array<{ learning: { rule_text: string } }>;

    // Two sessions produce the same learning → must appear only once
    expect(pending).toHaveLength(1);
    expect(pending[0].learning.rule_text).toBe(ruleText);
  });

  it("skips a learning already staged to CLAUDE.md (isDuplicate check)", async () => {
    const ruleText = "Use pnpm for package management";

    const { hashLearning } = await import("./quality-gate");
    const hash = hashLearning(ruleText);
    writeFileSync(join(coachingDir, "dedup-state.json"), JSON.stringify({
      _session_count: 5,
      learnings: {
        [hash]: {
          rule_text: ruleText,
          first_seen_session: "old-session-1",
          last_reinforced_session: "old-session-1",
          times_seen: 1,
          staged_to_claude_md: true,
          staged_session: "old-session-1",
        },
      },
    }, null, 2));

    const transcriptPath = join(transcriptsDir, "session-dup.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({ ruleText })),
      checkOnline: () => true,
    });

    const pendingPath = join(coachingDir, "pending-learnings.json");
    if (existsSync(pendingPath)) {
      const pending = JSON.parse(readFileSync(pendingPath, "utf-8")) as unknown[];
      expect(pending).toHaveLength(0);
    }
    // If file doesn't exist, duplicate was correctly suppressed
  });
});

// =============================================================================
// E2E-04: Budget enforcement — CLAUDE.md at 200-line limit
// =============================================================================

describe("E2E-04: Budget enforcement — CLAUDE.md at 200-line limit", () => {
  it("does NOT queue a learning when CLAUDE.md Learned Preferences is at budget", async () => {
    const claudeMdPath = join(projectDir, "CLAUDE.md");
    const lines = ["## Learned Preferences"];
    for (let i = 0; i < 200; i++) lines.push(`- Rule ${i}`);
    writeFileSync(claudeMdPath, lines.join("\n") + "\n");

    const transcriptPath = join(transcriptsDir, "session-budget.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({ lineCost: 1 })),
      checkOnline: () => true,
    });

    const pendingPath = join(coachingDir, "pending-learnings.json");
    if (existsSync(pendingPath)) {
      const pending = JSON.parse(readFileSync(pendingPath, "utf-8")) as unknown[];
      expect(pending).toHaveLength(0);
    }
  });

  it("accepts a learning when CLAUDE.md is under the budget", async () => {
    const claudeMdPath = join(projectDir, "CLAUDE.md");
    const lines = ["## Learned Preferences"];
    for (let i = 0; i < 50; i++) lines.push(`- Rule ${i}`);
    writeFileSync(claudeMdPath, lines.join("\n") + "\n");

    const transcriptPath = join(transcriptsDir, "session-under-budget.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({ lineCost: 1 })),
      checkOnline: () => true,
    });

    const pending = JSON.parse(
      readFileSync(join(coachingDir, "pending-learnings.json"), "utf-8")
    ) as unknown[];
    expect(pending).toHaveLength(1);
  });
});

// =============================================================================
// E2E-05: Circuit breaker — 3 failures trip the breaker
// =============================================================================

describe("E2E-05: Circuit breaker — 3 failures trip the breaker", () => {
  it("trips circuit breaker and marks entries .failed after 3 failures", async () => {
    for (let i = 0; i < 4; i++) {
      const transcriptPath = join(transcriptsDir, `session-fail-${i}.jsonl`);
      writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
      const entry = makeQueueEntry(transcriptPath, projectDir, {
        session_id: `fail${String(i).padStart(12, "0")}`,
      });
      writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));
    }

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassifyFail(),
      checkOnline: () => true,
    });

    const state = JSON.parse(
      readFileSync(join(coachingDir, "learning-state.json"), "utf-8")
    ) as { circuit_breaker: { consecutive_failures: number; disabled_until: string | null } };

    expect(state.circuit_breaker.consecutive_failures).toBeGreaterThanOrEqual(3);
    expect(state.circuit_breaker.disabled_until).not.toBeNull();

    const disabledUntil = new Date(state.circuit_breaker.disabled_until as string).getTime();
    expect(disabledUntil).toBeGreaterThan(Date.now());
    expect(disabledUntil).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);

    const failedFiles = readdirSync(queueDir).filter((f) => f.endsWith(".failed"));
    expect(failedFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("exits immediately without processing when circuit breaker is already active", async () => {
    const disabledUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(coachingDir, "learning-state.json"), JSON.stringify({
      circuit_breaker: { consecutive_failures: 3, disabled_until: disabledUntil },
      last_run: null,
      total_processed: 0,
      total_queued_for_approval: 0,
    }, null, 2));

    const transcriptPath = join(transcriptsDir, "session-tripped.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry, null, 2));

    let classifyCalled = false;
    await runDaemon(queueDir, coachingDir, {
      classify: async () => { classifyCalled = true; return makeClassifierResult(); },
      checkOnline: () => true,
    });

    expect(classifyCalled).toBe(false);
    expect(existsSync(queueFilePath)).toBe(true);
    expect(existsSync(join(coachingDir, "pending-learnings.json"))).toBe(false);
  });

  it("auto-resets circuit breaker when disabled_until has expired", async () => {
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeFileSync(join(coachingDir, "learning-state.json"), JSON.stringify({
      circuit_breaker: { consecutive_failures: 3, disabled_until: expiredAt },
      last_run: null,
      total_processed: 0,
      total_queued_for_approval: 0,
    }, null, 2));

    const transcriptPath = join(transcriptsDir, "session-reset.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    let classifyCalled = false;
    await runDaemon(queueDir, coachingDir, {
      classify: async () => { classifyCalled = true; return makeClassifierResult(); },
      checkOnline: () => true,
    });

    expect(classifyCalled).toBe(true);
  });
});

// =============================================================================
// E2E-06: Offline graceful degradation — queue files preserved
// =============================================================================

describe("E2E-06: Offline graceful degradation — queue files preserved", () => {
  it("preserves queue files and does not create pending-learnings.json when offline", async () => {
    const transcriptPath = join(transcriptsDir, "session-offline.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult()),
      checkOnline: () => false,
    });

    expect(existsSync(queueFilePath)).toBe(true);
    expect(existsSync(join(coachingDir, "pending-learnings.json"))).toBe(false);
  });

  it("processes the same queue file once back online", async () => {
    const transcriptPath = join(transcriptsDir, "session-offline2.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry, null, 2));

    // First run: offline
    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult()),
      checkOnline: () => false,
    });
    expect(existsSync(queueFilePath)).toBe(true);

    // Second run: online — queue file processed
    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult()),
      checkOnline: () => true,
    });
    expect(existsSync(queueFilePath)).toBe(false);
    expect(existsSync(join(coachingDir, "pending-learnings.json"))).toBe(true);
  });

  it("does not create .failed files when offline", async () => {
    const transcriptPath = join(transcriptsDir, "session-offline3.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassifyFail(),
      checkOnline: () => false,
    });

    const failedFiles = readdirSync(queueDir).filter((f) => f.endsWith(".failed"));
    expect(failedFiles).toHaveLength(0);
  });
});

// =============================================================================
// E2E-07: WORKFLOW_LEARNING=off — no queue file, Stage 1 output intact
// =============================================================================

describe("E2E-07: WORKFLOW_LEARNING=off — no queue file, Stage 1 output intact", () => {
  it("does not write queue file when WORKFLOW_LEARNING=off", () => {
    const transcriptPath = join(transcriptsDir, "session-learning-off.jsonl");
    const sessionId = "cc00dd11ee22ff33";
    writeFileSync(transcriptPath, buildHighSignalTranscript());

    const result = runAnalyzerWithQueue(sessionId, transcriptPath, projectDir, queueDir, {
      WORKFLOW_LEARNING: "off",
    });
    expect(result.status).toBe(0);

    expect(existsSync(join(queueDir, `${sessionId}.json`))).toBe(false);
  });

  it("still writes recommendations.md (Stage 1) when WORKFLOW_LEARNING=off", () => {
    // Transcript with grep calls to trigger grep-instead-of-mnemex rule in Stage 1
    const lines: string[] = [];
    for (let i = 0; i < 8; i++) {
      lines.push(makeAssistantTool("Write", { file_path: `/project/file${i}.ts`, content: "x" }));
    }
    for (let i = 0; i < 5; i++) {
      lines.push(makeAssistantTool("Bash", { command: `grep pattern /project/file${i}.ts` }));
    }
    const transcriptPath = join(transcriptsDir, "session-stage1.jsonl");
    const sessionId = "aa11bb22cc33dd44";
    writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const result = runAnalyzerWithQueue(sessionId, transcriptPath, projectDir, queueDir, {
      WORKFLOW_LEARNING: "off",
      WORKFLOW_COACHING: "on",
    });
    expect(result.status).toBe(0);

    expect(existsSync(join(coachingDir, "recommendations.md"))).toBe(true);
    expect(existsSync(join(queueDir, `${sessionId}.json`))).toBe(false);
  });
});

// =============================================================================
// E2E-08: pending-learnings.json schema matches session-start-coaching.sh contract
// =============================================================================

describe("E2E-08: pending-learnings.json schema matches session-start-coaching.sh contract", () => {
  it("writes all fields accessed by the session-start jq query", async () => {
    const transcriptPath = join(transcriptsDir, "session-schema.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({
        ruleText: "Use pnpm for package management",
        confidence: "HIGH",
        subsection: "Tools & Commands",
      })),
      checkOnline: () => true,
    });

    const pending = JSON.parse(
      readFileSync(join(coachingDir, "pending-learnings.json"), "utf-8")
    ) as Array<{
      session_id: string;
      learning: { confidence: string; rule_text: string; evidence: string; subsection: string };
      classified_at: string;
    }>;

    expect(Array.isArray(pending)).toBe(true);
    expect(pending.length).toBeGreaterThan(0);

    const pl = pending[0];
    // All fields accessed by session-start-coaching.sh jq query:
    // .value.learning.confidence, .value.learning.rule_text,
    // .value.learning.evidence, .value.learning.subsection
    expect(typeof pl.session_id).toBe("string");
    expect(pl.session_id.length).toBeGreaterThan(0);
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(pl.learning.confidence);
    expect(typeof pl.learning.rule_text).toBe("string");
    expect(pl.learning.rule_text.length).toBeGreaterThan(0);
    expect(typeof pl.learning.evidence).toBe("string");
    expect(typeof pl.learning.subsection).toBe("string");
    expect(typeof pl.classified_at).toBe("string");
    expect(() => new Date(pl.classified_at).toISOString()).not.toThrow();
  });

  it("session-start hook produces approval prompt when pending-learnings.json exists", () => {
    const cwdForSession = join(testDir, "session-project");
    const sessionCoachingDir = join(cwdForSession, ".claude", ".coaching");
    mkdirSync(sessionCoachingDir, { recursive: true });

    // Session-start requires a recommendations.md with at least one item to produce output
    writeFileSync(join(sessionCoachingDir, "recommendations.md"), "[human]\nsession: test1234\ncount: 1\n\n1. Consider using mnemex for code search.\n\n[claude]\ncount: 0\n\n");

    writeFileSync(join(sessionCoachingDir, "pending-learnings.json"), JSON.stringify([
      {
        session_id: "aabbccdd11223344",
        learning: {
          id: "learning-test0001",
          type: "explicit_rule",
          confidence: "HIGH",
          is_project_specific: true,
          scope: "claude_md",
          rule_text: "Use pnpm for package management",
          evidence: "User said 'we use pnpm' at message 3",
          subsection: "Tools & Commands",
          line_cost: 1,
        },
        classified_at: new Date().toISOString(),
      },
    ], null, 2));

    const hookResult = runSessionStartHook(cwdForSession);
    expect(hookResult.status).toBe(0);

    const context = parseAdditionalContext(hookResult.stdout.toString());
    expect(context).toContain("★ Learning Review");
    expect(context).toContain("Use pnpm for package management");
    expect(context).toContain("/dev:learn --apply");
  });

  it("pending-learnings.json is a valid JSON array (jq 'length' must work)", async () => {
    const transcriptPath = join(transcriptsDir, "session-valid-json.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult()),
      checkOnline: () => true,
    });

    const raw = readFileSync(join(coachingDir, "pending-learnings.json"), "utf-8");
    let parsed: unknown;
    expect(() => { parsed = JSON.parse(raw); }).not.toThrow();
    expect(Array.isArray(parsed)).toBe(true);
  });
});

// =============================================================================
// E2E-09: Stale lock — 11-minute-old lock is overridden
// =============================================================================

describe("E2E-09: Stale lock — 11-minute-old lock is overridden", () => {
  it("processes queue despite a stale lock file", async () => {
    const lockPath = join(queueDir, "queue.lock");
    writeFileSync(lockPath, "99999");
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(lockPath, elevenMinutesAgo, elevenMinutesAgo);

    const transcriptPath = join(transcriptsDir, "session-stale-lock.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    let classifyCalled = false;
    await runDaemon(queueDir, coachingDir, {
      classify: async () => { classifyCalled = true; return makeClassifierResult(); },
      checkOnline: () => true,
    });

    expect(classifyCalled).toBe(true);
  });
});

// =============================================================================
// E2E-10: Concurrent daemon — fresh lock prevents double processing
// =============================================================================

describe("E2E-10: Concurrent daemon — fresh lock prevents double processing", () => {
  it("does not process queue files when a fresh lock exists", async () => {
    const lockPath = join(queueDir, "queue.lock");
    writeFileSync(lockPath, "12345"); // fresh (mtime = now)

    const transcriptPath = join(transcriptsDir, "session-fresh-lock.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry, null, 2));

    let classifyCalled = false;
    await runDaemon(queueDir, coachingDir, {
      classify: async () => { classifyCalled = true; return makeClassifierResult(); },
      checkOnline: () => true,
    });

    expect(classifyCalled).toBe(false);
    expect(existsSync(queueFilePath)).toBe(true);
    expect(existsSync(join(coachingDir, "pending-learnings.json"))).toBe(false);
  });
});

// =============================================================================
// E2E-11: appendToRecommendations — format validated against shell parser
// =============================================================================

describe("E2E-11: Coaching augmentation — recommendations.md format", () => {
  it("appends MEDIUM-confidence correction to [claude] section with evidence comment", async () => {
    const recsPath = join(coachingDir, "recommendations.md");
    writeFileSync(recsPath, "[human]\nsession: abcd1234\ncount: 0\n\n[claude]\ncount: 0\n\n");

    const transcriptPath = join(transcriptsDir, "session-coaching.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({
        ruleText: "Always use pnpm, never npm",
        confidence: "MEDIUM",
        isProjectSpecific: true,
        type: "correction",
      })),
      checkOnline: () => true,
    });

    const content = readFileSync(recsPath, "utf-8");
    expect(content).toContain("Always use pnpm, never npm");

    const claudeIdx = content.indexOf("[claude]");
    const ruleIdx = content.indexOf("Always use pnpm, never npm");
    expect(ruleIdx).toBeGreaterThan(claudeIdx);
    expect(content).toContain("<!-- evidence:");
  });

  it("does NOT add HIGH-confidence project-specific learning to recommendations.md", async () => {
    const recsPath = join(coachingDir, "recommendations.md");
    writeFileSync(recsPath, "[human]\n\n[claude]\n\n");

    const transcriptPath = join(transcriptsDir, "session-high-conf.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({
        ruleText: "Use pnpm exclusively",
        confidence: "HIGH",
        isProjectSpecific: true,
        type: "explicit_rule",
      })),
      checkOnline: () => true,
    });

    expect(readFileSync(recsPath, "utf-8")).not.toContain("Use pnpm exclusively");

    const pending = JSON.parse(
      readFileSync(join(coachingDir, "pending-learnings.json"), "utf-8")
    ) as Array<{ learning: { rule_text: string } }>;
    expect(pending[0].learning.rule_text).toBe("Use pnpm exclusively");
  });
});

// =============================================================================
// E2E-12: Orphaned queue entry — missing transcript removed cleanly
// =============================================================================

describe("E2E-12: Orphaned queue entry — missing transcript file removed cleanly", () => {
  it("removes orphaned queue entry when transcript file is missing", async () => {
    const entry = makeQueueEntry(join(transcriptsDir, "gone.jsonl"), projectDir, {
      session_id: "orphan11223344aa",
    });
    const queueFilePath = join(queueDir, `${entry.session_id}.json`);
    writeFileSync(queueFilePath, JSON.stringify(entry, null, 2));

    let classifyCalled = false;
    await runDaemon(queueDir, coachingDir, {
      classify: async () => { classifyCalled = true; return makeClassifierResult(); },
      checkOnline: () => true,
    });

    expect(existsSync(queueFilePath)).toBe(false);
    expect(classifyCalled).toBe(false);
    expect(existsSync(join(coachingDir, "pending-learnings.json"))).toBe(false);
  });

  it("does not crash when queueDir does not exist", async () => {
    // acquireLock will throw when queueDir doesn't exist (can't write lock file)
    // The daemon's top-level catch handles this gracefully
    // When called directly (not via main()), it rejects — which is expected
    // The nohup wrapper in stop-coaching.sh swallows this via >/dev/null 2>&1
    try {
      await runDaemon(join(testDir, "nonexistent-queue"), coachingDir, {
        classify: mockClassify(makeClassifierResult()),
        checkOnline: () => true,
      });
    } catch {
      // Expected: lock file write fails when dir doesn't exist
    }
    // Key assertion: coachingDir state is not corrupted
    expect(existsSync(join(coachingDir, "pending-learnings.json"))).toBe(false);
  });
});

// =============================================================================
// E2E-13: dedup-state.json persistence and reinforcement
// =============================================================================

describe("E2E-13: dedup-state.json persistence and reinforcement", () => {
  it("registers the learning in dedup-state.json after processing", async () => {
    const ruleText = "Use pnpm for package management";
    const transcriptPath = join(transcriptsDir, "session-dedup-persist.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({ ruleText })),
      checkOnline: () => true,
    });

    const { hashLearning } = await import("./quality-gate");
    const hash = hashLearning(ruleText);
    const state = JSON.parse(
      readFileSync(join(coachingDir, "dedup-state.json"), "utf-8")
    ) as {
      learnings: Record<string, {
        staged_to_claude_md: boolean;
        times_seen: number;
        first_seen_session: string;
      }>;
    };

    expect(state.learnings[hash]).toBeDefined();
    expect(state.learnings[hash].staged_to_claude_md).toBe(false);
    expect(state.learnings[hash].times_seen).toBe(1);
    expect(state.learnings[hash].first_seen_session).toBe(entry.session_id);
  });

  it("reinforces (increments times_seen) when same learning seen in a second run", async () => {
    const ruleText = "Use pnpm for package management";
    const { hashLearning } = await import("./quality-gate");
    const hash = hashLearning(ruleText);

    // Pre-populate with first sighting (not yet staged)
    writeFileSync(join(coachingDir, "dedup-state.json"), JSON.stringify({
      _session_count: 1,
      learnings: {
        [hash]: {
          rule_text: ruleText,
          first_seen_session: "session-first",
          last_reinforced_session: "session-first",
          times_seen: 1,
          staged_to_claude_md: false,
          staged_session: null,
        },
      },
    }, null, 2));

    // Pre-populate pending-learnings.json so the learning is already pending
    writeFileSync(join(coachingDir, "pending-learnings.json"), JSON.stringify([
      {
        session_id: "session-first",
        learning: {
          id: "learning-test0001",
          type: "explicit_rule",
          confidence: "HIGH",
          is_project_specific: true,
          scope: "claude_md",
          rule_text: ruleText,
          evidence: "first evidence",
          subsection: "Tools & Commands",
          line_cost: 1,
        },
        classified_at: new Date().toISOString(),
      },
    ], null, 2));

    const transcriptPath = join(transcriptsDir, "session-reinforce.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir, { session_id: "session-second" });
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult({ ruleText })),
      checkOnline: () => true,
    });

    // pending-learnings.json should still have only 1 entry
    const pending = JSON.parse(
      readFileSync(join(coachingDir, "pending-learnings.json"), "utf-8")
    ) as unknown[];
    expect(pending).toHaveLength(1);

    // dedup-state should show times_seen = 2 (reinforcement)
    const updatedState = JSON.parse(
      readFileSync(join(coachingDir, "dedup-state.json"), "utf-8")
    ) as { learnings: Record<string, { times_seen: number }> };
    expect(updatedState.learnings[hash].times_seen).toBe(2);
  });
});

// =============================================================================
// E2E-14: learning-state.json updated correctly after a run
// =============================================================================

describe("E2E-14: learning-state.json updated after a run", () => {
  it("increments total_processed and total_queued_for_approval, writes last_run", async () => {
    const transcriptPath = join(transcriptsDir, "session-state.jsonl");
    writeFileSync(transcriptPath, buildTranscript({ corrections: ["no, use pnpm"] }));
    const entry = makeQueueEntry(transcriptPath, projectDir);
    writeFileSync(join(queueDir, `${entry.session_id}.json`), JSON.stringify(entry, null, 2));

    await runDaemon(queueDir, coachingDir, {
      classify: mockClassify(makeClassifierResult()),
      checkOnline: () => true,
    });

    const state = JSON.parse(
      readFileSync(join(coachingDir, "learning-state.json"), "utf-8")
    ) as {
      total_processed: number;
      total_queued_for_approval: number;
      last_run: string | null;
    };

    expect(state.total_processed).toBe(1);
    expect(state.total_queued_for_approval).toBe(1);
    expect(typeof state.last_run).toBe("string");
    expect(() => new Date(state.last_run as string).toISOString()).not.toThrow();
  });
});
