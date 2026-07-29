import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeTranscript } from "./summarizer";
import type { QueueEntry } from "./types";

/**
 * Regression cover for the bug that silently disabled the entire Stage-2
 * learning pipeline.
 *
 * Both transcript parsers tested `obj.type === "human"`. Claude Code writes user
 * turns as `type: "user"` — sampling a real transcript shows 57 `user` records
 * and zero `human` ones — so every parser built on that test returned an empty
 * array and the classifier was only ever handed sessions with no user messages
 * in them.
 *
 * The fixtures in the neighbouring suites all emit `"human"`, so they would pass
 * whether or not the bug were fixed. These use the real shape.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "summarizer-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function transcript(records: unknown[]): QueueEntry {
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n"));
  return {
    session_id: "test-session",
    transcript_path: path,
    queued_at: new Date(0).toISOString(),
    cwd: dir,
    tool_call_count: 0,
    rule_based_signals: [],
    learning_signals: [],
    learning_score: 0,
  } as QueueEntry;
}

/** A user turn in the shape Claude Code actually writes. */
function userTurn(text: string) {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
}

describe("summarizeTranscript — real transcript format", () => {
  it("extracts user messages from type:'user' records", () => {
    const summary = summarizeTranscript(
      transcript([userTurn("please use bun, not npm"), userTurn("second message")]),
    );
    expect(summary.user_messages).toHaveLength(2);
    expect(summary.user_messages[0].text).toBe("please use bun, not npm");
  });

  it("still reads the legacy type:'human' shape", () => {
    const summary = summarizeTranscript(
      transcript([
        { type: "human", message: { content: [{ type: "text", text: "legacy" }] } },
      ]),
    );
    expect(summary.user_messages).toHaveLength(1);
  });

  it("accepts a plain string content body", () => {
    const summary = summarizeTranscript(
      transcript([{ type: "user", message: { role: "user", content: "bare string" } }]),
    );
    expect(summary.user_messages[0].text).toBe("bare string");
  });

  it("does not mistake tool results for user speech", () => {
    // Tool results come back as type:"user" too. They carry tool_result blocks
    // and no text block, so they must contribute nothing.
    const summary = summarizeTranscript(
      transcript([
        {
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "exit status 0" }],
          },
        },
        userTurn("an actual instruction"),
      ]),
    );
    expect(summary.user_messages).toHaveLength(1);
    expect(summary.user_messages[0].text).toBe("an actual instruction");
  });

  it("flags corrections and explicit rules in real-format messages", () => {
    const summary = summarizeTranscript(
      transcript([userTurn("no, that's wrong — always use bun for scripts")]),
    );
    expect(summary.user_messages).toHaveLength(1);
    const m = summary.user_messages[0];
    expect(m.has_correction || m.has_explicit_rule).toBe(true);
  });

  it("ignores unparseable lines rather than throwing", () => {
    const entry = transcript([]); // creates the entry (and the file)
    // Overwrite with a mix of garbage and a valid record.
    writeFileSync(
      entry.transcript_path,
      "{not json\n" + JSON.stringify(userTurn("survived")) + "\n",
    );
    expect(summarizeTranscript(entry).user_messages).toHaveLength(1);
  });
});
