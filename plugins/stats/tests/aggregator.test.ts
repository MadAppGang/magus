import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { parseStagingFile, parseTranscript } from "../lib/aggregator.ts";
import { writePreEvent, writePostEvent } from "../lib/collector.ts";

describe("parseStagingFile", () => {
  let tempDir: string;
  let stagingPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `stats-agg-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    stagingPath = join(tempDir, "session.jsonl");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("pairs pre/post events for same tool_name", () => {
    writePreEvent(stagingPath, "Read");
    writePostEvent(stagingPath, "Read", true);

    const results = parseStagingFile(stagingPath);
    expect(results).toHaveLength(1);
    expect(results[0].toolName).toBe("Read");
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(results[0].success).toBe(true);
  });

  test("unpaired pre event gets duration_ms = 0", () => {
    writePreEvent(stagingPath, "Write");
    // No post event written

    const results = parseStagingFile(stagingPath);
    expect(results).toHaveLength(1);
    expect(results[0].toolName).toBe("Write");
    expect(results[0].durationMs).toBe(0);
  });

  test("handles multiple events in sequence", () => {
    writePreEvent(stagingPath, "Read");
    writePostEvent(stagingPath, "Read", true);
    writePreEvent(stagingPath, "Grep");
    writePostEvent(stagingPath, "Grep", true);
    writePreEvent(stagingPath, "Write");
    writePostEvent(stagingPath, "Write", false);

    const results = parseStagingFile(stagingPath);
    expect(results).toHaveLength(3);
    expect(results[0].toolName).toBe("Read");
    expect(results[0].success).toBe(true);
    expect(results[1].toolName).toBe("Grep");
    expect(results[2].toolName).toBe("Write");
    expect(results[2].success).toBe(false);
  });

  test("interleaved same tool_name events pair correctly", () => {
    // Two concurrent Read calls (in practice they don't interleave but test robustness)
    writePreEvent(stagingPath, "Read");
    writePreEvent(stagingPath, "Read");
    writePostEvent(stagingPath, "Read", true);
    writePostEvent(stagingPath, "Read", true);

    const results = parseStagingFile(stagingPath);
    expect(results).toHaveLength(2);
    expect(results[0].toolName).toBe("Read");
    expect(results[1].toolName).toBe("Read");
    // Both should have durations computed (not 0)
    // First pre matches with first post
  });

  test("returns empty array for non-existent file", () => {
    const results = parseStagingFile(join(tempDir, "nonexistent.jsonl"));
    expect(results).toEqual([]);
  });
});

describe("parseTranscript", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `stats-transcript-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function makeTranscriptLine(type: string, timestamp: string, toolName?: string, command?: string): string {
    if (type === "assistant" && toolName) {
      const contentBlock: Record<string, unknown> = { type: "tool_use", name: toolName, input: {} };
      if (toolName === "Bash" && command) {
        contentBlock.input = { command };
      }
      return JSON.stringify({
        type: "assistant",
        timestamp,
        message: {
          content: [contentBlock],
        },
      });
    }
    return JSON.stringify({ type, timestamp, message: { content: [] } });
  }

  test("parses session start/end from assistant messages", () => {
    const transcriptPath = join(tempDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      [
        makeTranscriptLine("assistant", "2026-03-26T10:00:00.000Z", "Read"),
        makeTranscriptLine("assistant", "2026-03-26T10:05:00.000Z", "Write"),
        makeTranscriptLine("assistant", "2026-03-26T10:10:00.000Z", "Grep"),
      ].join("\n")
    );

    const metrics = parseTranscript(transcriptPath);
    expect(metrics.session_start).toBe("2026-03-26T10:00:00.000Z");
    expect(metrics.session_end).toBe("2026-03-26T10:10:00.000Z");
    expect(metrics.duration_sec).toBe(600); // 10 minutes
    expect(metrics.tool_call_count).toBe(3);
  });

  test("extracts bash commands", () => {
    const transcriptPath = join(tempDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      [
        makeTranscriptLine("assistant", "2026-03-26T10:00:00.000Z", "Bash", "bun test"),
        makeTranscriptLine("assistant", "2026-03-26T10:01:00.000Z", "Bash", "ls -la"),
      ].join("\n")
    );

    const metrics = parseTranscript(transcriptPath);
    expect(metrics.bash_commands).toHaveLength(2);
    expect(metrics.bash_commands[0].command).toBe("bun test");
    expect(metrics.bash_commands[1].command).toBe("ls -la");
  });

  test("returns zero metrics for empty transcript", () => {
    const transcriptPath = join(tempDir, "empty.jsonl");
    writeFileSync(transcriptPath, "");

    const metrics = parseTranscript(transcriptPath);
    expect(metrics.duration_sec).toBe(0);
    expect(metrics.tool_call_count).toBe(0);
    expect(metrics.bash_commands).toHaveLength(0);
  });

  test("returns zero metrics for non-existent file", () => {
    const metrics = parseTranscript(join(tempDir, "nonexistent.jsonl"));
    expect(metrics.duration_sec).toBe(0);
    expect(metrics.tool_call_count).toBe(0);
  });

  test("computes inter_message_gap_sec from consecutive assistant messages", () => {
    const transcriptPath = join(tempDir, "transcript.jsonl");
    // Messages 60 seconds apart
    writeFileSync(
      transcriptPath,
      [
        makeTranscriptLine("assistant", "2026-03-26T10:00:00.000Z"),
        makeTranscriptLine("assistant", "2026-03-26T10:01:00.000Z"),
        makeTranscriptLine("assistant", "2026-03-26T10:02:00.000Z"),
      ].join("\n")
    );

    const metrics = parseTranscript(transcriptPath);
    // Two gaps of 60 seconds each = 120 seconds total
    expect(metrics.inter_message_gap_sec).toBe(120);
  });
});
