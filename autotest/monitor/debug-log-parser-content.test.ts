/**
 * Tests A01–A12: parseDebugLogContent() function
 *
 * Validates the new parseDebugLogContent(content: string): Metrics function
 * that parses raw debug log strings without requiring a file on disk.
 */

import { describe, it, expect } from "bun:test";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseDebugLogContent,
  parseDebugLog,
} from "../../autotest/framework/parsers/debug-log-parser.ts";
import type { Metrics } from "../../autotest/framework/types.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeTurn(
  turnNum: number,
  opts: {
    tools?: string[];
    tokens?: { prompt: number; completion: number; total: number };
    cost?: number;
    retry?: boolean;
    noStreamComplete?: boolean;
  } = {}
): string {
  const ts1 = makeTimestamp(turnNum * 1000);
  const ts2 = makeTimestamp(turnNum * 1000 + 500);
  const lines: string[] = [];

  lines.push(
    `[${ts1}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 5, "toolCount": 0 }`
  );

  if (opts.tools && opts.tools.length > 0) {
    const toolStr = opts.tools.map((t) => `${t}(100 chars)`).join(", ");
    lines.push(`[${ts2}] [OpenRouter] Tool calls: ${toolStr}`);
  }

  if (opts.tokens) {
    lines.push(
      `[${ts2}] [OpenRouter] Usage: prompt=${opts.tokens.prompt}, completion=${opts.tokens.completion}, total=${opts.tokens.total}`
    );
  }

  if (!opts.noStreamComplete && !opts.retry) {
    lines.push(`[${ts2}] [OpenRouter] Stream complete: success`);
  }

  if (opts.cost !== undefined) {
    lines.push(`[${ts2}] [Cost Tracker] Total cost: $${opts.cost}`);
  }

  return lines.join("\n") + "\n";
}

function makeRetryTurn(turnNum: number): string {
  const ts1 = makeTimestamp(turnNum * 1000);
  // An incomplete turn (has request but no stream complete) = retry
  return `[${ts1}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 3, "toolCount": 0 }\n`;
}

// ---------------------------------------------------------------------------
// TEST-A01: Empty string input
// ---------------------------------------------------------------------------

describe("TEST-A01: Empty string input returns empty Metrics", () => {
  it("returns { turns: [], totals: null } for empty string", () => {
    const result: Metrics = parseDebugLogContent("");
    expect(result.turns).toEqual([]);
    expect(result.totals).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TEST-A02: Whitespace-only input
// ---------------------------------------------------------------------------

describe("TEST-A02: Whitespace-only input returns empty Metrics", () => {
  it("returns { turns: [], totals: null } for whitespace-only string", () => {
    const result: Metrics = parseDebugLogContent("   \n\t\n   ");
    expect(result.turns).toEqual([]);
    expect(result.totals).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TEST-A03: Single complete turn
// ---------------------------------------------------------------------------

describe("TEST-A03: Single complete turn returns one OutputTurn", () => {
  it("parses one turn correctly", () => {
    const content = makeTurn(1);
    const result = parseDebugLogContent(content);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].turn_number).toBe(1);
    expect(result.turns[0].retry).toBe(false);
    expect(result.totals).not.toBeNull();
    expect(result.totals!.total_turns).toBe(1);
    expect(result.totals!.total_retries).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-A04: Multiple complete turns
// ---------------------------------------------------------------------------

describe("TEST-A04: Multiple complete turns returns all OutputTurns", () => {
  it("parses 3 turns correctly", () => {
    const content = makeTurn(1) + makeTurn(2) + makeTurn(3);
    const result = parseDebugLogContent(content);
    expect(result.turns).toHaveLength(3);
    expect(result.turns[0].turn_number).toBe(1);
    expect(result.turns[1].turn_number).toBe(2);
    expect(result.turns[2].turn_number).toBe(3);
    expect(result.totals!.total_turns).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// TEST-A05: Turn with tool calls captures tool names
// ---------------------------------------------------------------------------

describe("TEST-A05: Turn with tool calls captures tool names", () => {
  it("extracts tool names from turn", () => {
    const content = makeTurn(1, { tools: ["Read", "Grep", "Bash"] });
    const result = parseDebugLogContent(content);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].tool_calls).toEqual(
      expect.arrayContaining(["Read", "Grep", "Bash"])
    );
    expect(result.totals!.tool_call_sequence).toEqual(
      expect.arrayContaining(["Read", "Grep", "Bash"])
    );
    expect(result.totals!.unique_tools).toEqual(
      expect.arrayContaining(["Bash", "Grep", "Read"])
    );
  });
});

// ---------------------------------------------------------------------------
// TEST-A06: Turn with token counts
// ---------------------------------------------------------------------------

describe("TEST-A06: Turn with token counts parses tokens correctly", () => {
  it("parses token usage from turn", () => {
    const tokens = { prompt: 1000, completion: 250, total: 1250 };
    const content = makeTurn(1, { tokens });
    const result = parseDebugLogContent(content);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].tokens).not.toBeNull();
    expect(result.turns[0].tokens!.prompt).toBe(1000);
    expect(result.turns[0].tokens!.completion).toBe(250);
    expect(result.turns[0].tokens!.total).toBe(1250);
    expect(result.totals!.total_tokens.total).toBe(1250);
  });

  it("sums tokens across multiple turns", () => {
    const content =
      makeTurn(1, { tokens: { prompt: 1000, completion: 250, total: 1250 } }) +
      makeTurn(2, { tokens: { prompt: 500, completion: 150, total: 650 } });
    const result = parseDebugLogContent(content);
    expect(result.totals!.total_tokens.total).toBe(1900);
    expect(result.totals!.total_tokens.prompt).toBe(1500);
    expect(result.totals!.total_tokens.completion).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// TEST-A07: Turn with cost
// ---------------------------------------------------------------------------

describe("TEST-A07: Turn with cost parses cost_usd correctly", () => {
  it("parses cost from Cost Tracker line", () => {
    const content = makeTurn(1, { cost: 0.0042 });
    const result = parseDebugLogContent(content);
    expect(result.totals).not.toBeNull();
    expect(result.totals!.cost_usd).toBeCloseTo(0.0042, 5);
  });
});

// ---------------------------------------------------------------------------
// TEST-A08: Single retry turn
// ---------------------------------------------------------------------------

describe("TEST-A08: Single retry turn marked with retry=true", () => {
  it("marks incomplete request as retry", () => {
    // A complete turn followed by an incomplete (retry) turn
    const content = makeTurn(1) + makeRetryTurn(2);
    const result = parseDebugLogContent(content);

    // The retry turn is always pushed when a new request starts
    const retryTurns = result.turns.filter((t) => t.retry);
    expect(retryTurns.length).toBeGreaterThanOrEqual(1);
    expect(result.totals!.total_retries).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// TEST-A09: Three consecutive retries
// ---------------------------------------------------------------------------

describe("TEST-A09: Three consecutive retries detected in totals", () => {
  it("counts 3 consecutive retry turns", () => {
    // Three consecutive incomplete requests = 3 retries
    const content =
      makeRetryTurn(1) + makeRetryTurn(2) + makeRetryTurn(3);
    const result = parseDebugLogContent(content);

    const retryTurns = result.turns.filter((t) => t.retry);
    expect(retryTurns.length).toBe(3);
    expect(result.totals!.total_retries).toBe(3);
    for (const turn of retryTurns) {
      expect(turn.retry).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-A10: Incomplete turn (no Stream complete)
// ---------------------------------------------------------------------------

describe("TEST-A10: Incomplete turn returns partial Metrics without throwing", () => {
  it("handles incomplete turn (no stream complete) gracefully", () => {
    const content = makeTurn(1, { noStreamComplete: true });
    // Should not throw
    let result: Metrics | null = null;
    expect(() => {
      result = parseDebugLogContent(content);
    }).not.toThrow();
    expect(result).not.toBeNull();
    // totals may be null (no completed turns)
    // turns may be empty or have partial turn — no error
  });
});

// ---------------------------------------------------------------------------
// TEST-A11: Import does not trigger process.exit
// ---------------------------------------------------------------------------

describe("TEST-A11: Importing parseDebugLogContent does not trigger process.exit", () => {
  it("parseDebugLogContent is callable after import", () => {
    // The fact that this test runs means the import succeeded without process.exit
    expect(typeof parseDebugLogContent).toBe("function");
    // Call it to confirm it works
    const result = parseDebugLogContent("");
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TEST-A12: parseDebugLogContent and parseDebugLog return equivalent results
// ---------------------------------------------------------------------------

describe("TEST-A12: parseDebugLogContent and parseDebugLog return equivalent results", () => {
  it("both functions return structurally equivalent Metrics for same content", () => {
    const content =
      makeTurn(1, {
        tools: ["Read", "Grep"],
        tokens: { prompt: 800, completion: 200, total: 1000 },
      }) +
      makeTurn(2, {
        tools: ["Bash"],
        tokens: { prompt: 600, completion: 150, total: 750 },
      });

    // Write content to temp file
    const tmpDir = tmpdir();
    const tmpFile = join(tmpDir, `test-debug-${Date.now()}.log`);
    writeFileSync(tmpFile, content);

    const fileResult = parseDebugLog(tmpFile);
    const contentResult = parseDebugLogContent(content);

    // Structural equivalence
    expect(contentResult.turns.length).toBe(fileResult.turns.length);
    expect(contentResult.totals!.total_turns).toBe(
      fileResult.totals!.total_turns
    );
    expect(contentResult.totals!.total_retries).toBe(
      fileResult.totals!.total_retries
    );
    expect(contentResult.totals!.total_tokens).toEqual(
      fileResult.totals!.total_tokens
    );
    expect(contentResult.totals!.unique_tools).toEqual(
      fileResult.totals!.unique_tools
    );

    for (let i = 0; i < contentResult.turns.length; i++) {
      expect(contentResult.turns[i].turn_number).toBe(
        fileResult.turns[i].turn_number
      );
      expect(contentResult.turns[i].tool_calls).toEqual(
        fileResult.turns[i].tool_calls
      );
      expect(contentResult.turns[i].tokens).toEqual(
        fileResult.turns[i].tokens
      );
      expect(contentResult.turns[i].retry).toBe(fileResult.turns[i].retry);
    }
  });
});
