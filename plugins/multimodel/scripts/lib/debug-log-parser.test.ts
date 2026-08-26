import { describe, expect, test } from "bun:test";
import { parseDebugLogContent } from "./debug-log-parser";

// ---------------------------------------------------------------------------
// Fixture builders — every line shape below is one the regexes in
// debug-log-parser.ts commit to. Times are relative to T0 so durations are
// exact integers rather than wall-clock noise.
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-08-22T10:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

/** `[ts] <body>` — the prefix every real claudish debug line carries. */
function line(offsetMs: number, body: string): string {
  return `[${at(offsetMs)}] ${body}`;
}

function request(
  offsetMs: number,
  fields: Record<string, string | number> = {},
): string {
  const json = { targetModel: "glm-5.2", messageCount: 1, toolCount: 0, ...fields };
  const body = Object.entries(json)
    .map(([k, v]) => `"${k}": ${typeof v === "number" ? v : `"${v}"`}`)
    .join(", ");
  return line(offsetMs, `[OpenRouter Request] { ${body} }`);
}

function log(...lines: string[]): string {
  return lines.join("\n") + "\n";
}

/** One old-format turn: request at `startMs`, completion at `startMs + 1000`. */
function completedTurn(startMs: number, extra: string[] = []): string[] {
  return [
    request(startMs),
    ...extra,
    line(startMs + 1000, "[OpenRouter] Stream complete: success"),
  ];
}

describe("empty input", () => {
  test("an empty log is reported as empty, not as a zeroed session", () => {
    // monitor.ts polls a log that may not have been written to yet. Returning
    // totals here would let a not-yet-started model report 0 turns as fact.
    const r = parseDebugLogContent("");
    expect(r.turns).toEqual([]);
    expect(r.totals).toBeNull();
    expect(r.error).toBe("empty debug log");
  });

  test("whitespace-only content is treated as empty", () => {
    const r = parseDebugLogContent("  \n\t\n   ");
    expect(r.turns).toEqual([]);
    expect(r.totals).toBeNull();
    expect(r.error).toBe("empty debug log");
  });
});

describe("old format — [OpenRouter] Stream complete", () => {
  test("a request followed by a stream completion is one completed turn", () => {
    const r = parseDebugLogContent(log(...completedTurn(0)));
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].turn_number).toBe(1);
    expect(r.turns[0].retry).toBe(false);
    expect(r.turns[0].stream_status).toBe("success");
    expect(r.totals!.total_turns).toBe(1);
    expect(r.totals!.total_retries).toBe(0);
  });

  test("duration is the request-to-completion gap, and totals sum it", () => {
    const r = parseDebugLogContent(
      log(...completedTurn(0), ...completedTurn(5_000)),
    );
    expect(r.turns.map((t) => t.duration_ms)).toEqual([1000, 1000]);
    expect(r.totals!.total_time_ms).toBe(2000);
  });

  test("message_count is carried through from the request JSON", () => {
    const r = parseDebugLogContent(
      log(request(0, { messageCount: 17 }), line(1000, "[OpenRouter] Stream complete: success")),
    );
    expect(r.turns[0].message_count).toBe(17);
  });

  test("token usage is attributed to the turn and summed across turns", () => {
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0, [line(500, "[OpenRouter] Usage: prompt=1000, completion=250, total=1250")]),
        ...completedTurn(5_000, [line(5_500, "[OpenRouter] Usage: prompt=500, completion=150, total=650")]),
      ),
    );
    expect(r.turns[0].tokens).toEqual({ prompt: 1000, completion: 250, total: 1250 });
    expect(r.totals!.total_tokens).toEqual({ prompt: 1500, completion: 400, total: 1900 });
  });

  test("a turn with no usage line reports null tokens rather than zeros", () => {
    const r = parseDebugLogContent(log(...completedTurn(0)));
    expect(r.turns[0].tokens).toBeNull();
    expect(r.totals!.total_tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
  });
});

describe("tool call extraction", () => {
  test("names are captured in call order, and the unique set is deduped and sorted", () => {
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0, [
          line(500, "[OpenRouter] Tool calls: Read(120 chars), Grep(30 chars), Read(9 chars)"),
        ]),
      ),
    );
    expect(r.turns[0].tool_calls).toEqual(["Read", "Grep", "Read"]);
    expect(r.totals!.tool_call_sequence).toEqual(["Read", "Grep", "Read"]);
    expect(r.totals!.unique_tools).toEqual(["Grep", "Read"]);
  });

  test("MCP tool names survive — they carry the __server__tool separator", () => {
    // mcp__claudish__list_models is the shape every claudish MCP call logs.
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0, [
          line(500, "[OpenRouter] Tool calls: mcp__claudish__list_models(12 chars), my-tool(4 chars)"),
        ]),
      ),
    );
    expect(r.turns[0].tool_calls).toEqual(["mcp__claudish__list_models", "my-tool"]);
  });

  test("a single-character payload logs 'char', not 'chars', and still counts", () => {
    const r = parseDebugLogContent(
      log(...completedTurn(0, [line(500, "[OpenRouter] Tool calls: Read(1 char)")])),
    );
    expect(r.turns[0].tool_calls).toEqual(["Read"]);
  });

  test("only tools from completed turns reach the totals", () => {
    // A retry's tools were never executed — counting them would inflate the
    // tool sequence monitor.ts reports as work done.
    const r = parseDebugLogContent(
      log(
        request(0),
        line(500, "[OpenRouter] Tool calls: Bash(5 chars)"),
        ...completedTurn(5_000, [line(5_500, "[OpenRouter] Tool calls: Read(5 chars)")]),
      ),
    );
    expect(r.turns[0].retry).toBe(true);
    expect(r.turns[0].tool_calls).toEqual(["Bash"]);
    expect(r.totals!.tool_call_sequence).toEqual(["Read"]);
  });

  test("a turn with no tool line reports an empty list", () => {
    const r = parseDebugLogContent(log(...completedTurn(0)));
    expect(r.turns[0].tool_calls).toEqual([]);
    expect(r.totals!.unique_tools).toEqual([]);
  });

  test("a second tool-calls line in one turn adds to the first, never replaces it", () => {
    // A model that calls Read, reads the result and then calls Bash logs two
    // [OpenRouter] Tool calls: lines against the same request. Assigning the
    // second over the first erased Read from the record of what the model did.
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0, [
          line(300, "[OpenRouter] Tool calls: Read(10 chars)"),
          line(600, "[OpenRouter] Tool calls: Bash(20 chars)"),
        ]),
      ),
    );
    expect(r.turns[0].tool_calls).toEqual(["Read", "Bash"]);
    expect(r.totals!.tool_call_sequence).toEqual(["Read", "Bash"]);
    expect(r.totals!.unique_tools).toEqual(["Bash", "Read"]);
  });

  test("accumulating across lines keeps call order while unique_tools stays deduped", () => {
    // The two fields answer different questions: the sequence is what happened
    // in order, the unique set is which tools were touched at all.
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0, [
          line(200, "[OpenRouter] Tool calls: Read(10 chars), Grep(5 chars)"),
          line(400, "[OpenRouter] Tool calls: Read(7 chars)"),
          line(600, "[OpenRouter] Tool calls: Bash(1 char)"),
        ]),
      ),
    );
    expect(r.turns[0].tool_calls).toEqual(["Read", "Grep", "Read", "Bash"]);
    expect(r.totals!.tool_call_sequence).toEqual(["Read", "Grep", "Read", "Bash"]);
    expect(r.totals!.unique_tools).toEqual(["Bash", "Grep", "Read"]);
  });
});

describe("new format — [Streaming] (claudish v5.3.0+)", () => {
  test("finish_reason=stop completes the turn, and usage logged after it still lands on that turn", () => {
    // In the streaming format the usage frame arrives *after* the finish
    // chunk, so the turn must stay open until the next request or EOF.
    const r = parseDebugLogContent(
      log(
        request(0),
        line(900, "[Streaming] Chunk: index=3 finish_reason=stop"),
        line(1000, "[Streaming] Usage data received: prompt=100, completion=20, total=120"),
      ),
    );
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].retry).toBe(false);
    expect(r.turns[0].stream_status).toBe("stop");
    expect(r.turns[0].duration_ms).toBe(900);
    expect(r.turns[0].tokens).toEqual({ prompt: 100, completion: 20, total: 120 });
    expect(r.totals!.total_turns).toBe(1);
  });

  test("'Final usage' carries no total, so the total is derived from prompt + completion", () => {
    const r = parseDebugLogContent(
      log(
        request(0),
        line(900, "[Streaming] Chunk: index=3 finish_reason=stop"),
        line(1000, "[Streaming] Final usage: prompt=7, completion=3"),
      ),
    );
    expect(r.turns[0].tokens).toEqual({ prompt: 7, completion: 3, total: 10 });
  });

  test("the old [OpenRouter] Usage line wins over a later [Streaming] one", () => {
    // Both formats can appear in one log during a claudish version straddle.
    // The old line is authoritative because it reports a real total.
    const r = parseDebugLogContent(
      log(
        request(0),
        line(800, "[OpenRouter] Usage: prompt=1, completion=2, total=3"),
        line(900, "[Streaming] Usage data received: prompt=100, completion=20, total=120"),
        line(1000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.turns[0].tokens).toEqual({ prompt: 1, completion: 2, total: 3 });
  });

  test("a zero-total usage line is replaced by a later real one", () => {
    const r = parseDebugLogContent(
      log(
        request(0),
        line(800, "[Streaming] Usage data received: prompt=0, completion=0, total=0"),
        line(900, "[Streaming] Usage data received: prompt=100, completion=20, total=120"),
        line(1000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.turns[0].tokens).toEqual({ prompt: 100, completion: 20, total: 120 });
  });

  test("a streaming chunk that is not the finish chunk does not complete the turn", () => {
    const r = parseDebugLogContent(
      log(request(0), line(900, "[Streaming] Chunk: index=3 finish_reason=null")),
    );
    expect(r.turns[0].retry).toBe(true);
    expect(r.totals!.total_turns).toBe(0);
  });
});

describe("retries — an unfinished request is not a completed turn", () => {
  test("a request with no completion is a retry and is excluded from total_turns", () => {
    const r = parseDebugLogContent(log(request(0)));
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].retry).toBe(true);
    expect(r.turns[0].stream_status).toBeUndefined();
    expect(r.totals!.total_turns).toBe(0);
    expect(r.totals!.total_retries).toBe(1);
  });

  test("three consecutive unfinished requests count as three retries", () => {
    // This is exactly the run monitor.ts treats as a stall (RETRY_STALL_COUNT).
    const r = parseDebugLogContent(log(request(0), request(1_000), request(2_000)));
    expect(r.turns.map((t) => t.retry)).toEqual([true, true, true]);
    expect(r.totals!.total_retries).toBe(3);
    expect(r.totals!.total_turns).toBe(0);
  });

  test("a retry's tokens are kept on the turn but excluded from the session totals", () => {
    const r = parseDebugLogContent(
      log(
        request(0),
        line(500, "[OpenRouter] Usage: prompt=500, completion=500, total=1000"),
        ...completedTurn(2_000, [
          line(2_500, "[OpenRouter] Usage: prompt=1, completion=2, total=3"),
        ]),
      ),
    );
    expect(r.turns[0].tokens).toEqual({ prompt: 500, completion: 500, total: 1000 });
    expect(r.totals!.total_tokens).toEqual({ prompt: 1, completion: 2, total: 3 });
  });

  test("turn numbers stay sequential across a mix of retries and completions", () => {
    const r = parseDebugLogContent(
      log(...completedTurn(0), request(5_000), ...completedTurn(9_000)),
    );
    expect(r.turns.map((t) => t.turn_number)).toEqual([1, 2, 3]);
    expect(r.turns.map((t) => t.retry)).toEqual([false, true, false]);
    expect(r.totals!.total_turns).toBe(2);
    expect(r.totals!.total_retries).toBe(1);
  });
});

describe("session-level aggregates", () => {
  test("wall time spans the first and last timestamped line, not just the turns", () => {
    const r = parseDebugLogContent(
      log(
        line(0, "[Proxy] Server started on port 41234"),
        ...completedTurn(1_000),
        line(9_000, "[Cost Tracker] Total cost: $0.004"),
      ),
    );
    expect(r.totals!.wall_time_ms).toBe(9000);
    expect(r.totals!.total_time_ms).toBe(1000); // API time only
  });

  test("wall time is null — not zero — when nothing in the log is timestamped", () => {
    const r = parseDebugLogContent(
      log(
        '[OpenRouter Request] { "targetModel": "glm-5.2", "messageCount": 1, "toolCount": 0 }',
        "[OpenRouter] Stream complete: success",
      ),
    );
    expect(r.totals!.wall_time_ms).toBeNull();
    expect(r.totals!.total_turns).toBe(1);
  });

  test("cost is a running total, so the last Cost Tracker line wins", () => {
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0),
        line(1_100, "[Cost Tracker] Total cost: $0.001"),
        line(2_000, "[Cost Tracker] Total cost: 0.009"), // the $ is optional
      ),
    );
    expect(r.totals!.cost_usd).toBeCloseTo(0.009, 6);
  });

  test("cost is null when the log never reports one", () => {
    expect(parseDebugLogContent(log(...completedTurn(0))).totals!.cost_usd).toBeNull();
  });

  test("the model is the one the session opened with, not the last seen", () => {
    // A mid-session targetModel change is a claudish fallback, not a new
    // session — the reported model must stay the one that was dispatched.
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0),
        request(5_000, { targetModel: "kimi-k3" }),
        line(6_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.totals!.model).toBe("glm-5.2");
  });

  test("the model is null when no request was ever logged", () => {
    const r = parseDebugLogContent(log(line(0, "[Proxy] Server started on port 41234")));
    expect(r.totals!.model).toBeNull();
  });

  test("time to first tool is null when the session never called a tool", () => {
    const r = parseDebugLogContent(log(...completedTurn(0), ...completedTurn(5_000)));
    expect(r.totals!.time_to_first_tool_ms).toBeNull();
  });
});

describe("time to first tool — elapsed from session start", () => {
  test("it is measured from the first log line, not from the turn's own duration", () => {
    // The first tool lands in turn 3, 13s after the session's first log line.
    // That turn itself took 1s. Reporting 1000 answers "how long was the turn
    // that happened to contain the first tool?" — a question nobody asked, and
    // not the one the field name and its comment promise.
    const r = parseDebugLogContent(
      log(
        line(0, "[Proxy] Server started on port 41234"),
        ...completedTurn(2_000),
        ...completedTurn(7_000),
        ...completedTurn(12_500, [line(13_000, "[OpenRouter] Tool calls: Read(5 chars)")]),
      ),
    );
    expect(r.totals!.time_to_first_tool_ms).toBe(13_000);
    expect(r.turns[2].duration_ms).toBe(1000); // the turn's own duration, unchanged
  });

  test("the FIRST tool line of a turn sets the clock, not the last", () => {
    const r = parseDebugLogContent(
      log(
        line(0, "[Proxy] Server started on port 41234"),
        ...completedTurn(1_000, [
          line(1_200, "[OpenRouter] Tool calls: Read(5 chars)"),
          line(1_800, "[OpenRouter] Tool calls: Bash(5 chars)"),
        ]),
      ),
    );
    expect(r.totals!.time_to_first_tool_ms).toBe(1_200);
  });

  test("a tool called only in a retry does not set it — retries reach no other total either", () => {
    // tool_call_sequence already excludes a retry's tools because they were
    // never executed. Time-to-first-tool has to agree with the sequence it is
    // describing, or the two fields answer about different tool calls.
    const r = parseDebugLogContent(
      log(
        line(0, "[Proxy] Server started on port 41234"),
        request(1_000),
        line(1_500, "[OpenRouter] Tool calls: Bash(5 chars)"),
        ...completedTurn(5_000, [line(5_400, "[OpenRouter] Tool calls: Read(5 chars)")]),
      ),
    );
    expect(r.totals!.tool_call_sequence).toEqual(["Read"]);
    expect(r.totals!.time_to_first_tool_ms).toBe(5_400);
  });

  test("it is null — not a guess — when the tool line carries no timestamp", () => {
    const r = parseDebugLogContent(
      log(
        line(0, "[Proxy] Server started on port 41234"),
        request(1_000),
        "[OpenRouter] Tool calls: Read(5 chars)",
        line(2_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.totals!.tool_call_sequence).toEqual(["Read"]);
    expect(r.totals!.time_to_first_tool_ms).toBeNull();
  });
});

describe("clock skew — a negative elapsed time is not a measurement", () => {
  test("a clean log reports no inconsistencies", () => {
    const r = parseDebugLogContent(log(...completedTurn(0), ...completedTurn(5_000)));
    expect(r.totals!.clock_inconsistencies).toBe(0);
  });

  test("a completion stamped before its request yields a null duration, not -1000", () => {
    const r = parseDebugLogContent(
      log(
        line(0, "[Proxy] Server started on port 41234"),
        request(5_000),
        line(4_000, "[OpenRouter] Stream complete: success"),
        line(9_000, "[Cost Tracker] Total cost: $0.001"),
      ),
    );
    expect(r.turns[0].duration_ms).toBeNull();
    expect(r.totals!.total_time_ms).toBe(0);
    expect(r.totals!.wall_time_ms).toBe(9_000);
    expect(r.totals!.clock_inconsistencies).toBe(1);
  });

  test("one skewed turn does not cancel out a good one in total_time_ms", () => {
    // Summed unguarded, +1000 and -1000 report a two-second session as 0ms.
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0),
        request(10_000),
        line(9_000, "[OpenRouter] Stream complete: success"),
        line(20_000, "[Cost Tracker] Total cost: $0.001"),
      ),
    );
    expect(r.turns.map((t) => t.duration_ms)).toEqual([1000, null]);
    expect(r.totals!.total_time_ms).toBe(1000);
    expect(r.totals!.clock_inconsistencies).toBe(1);
  });

  test("wall time is null, not negative, when the last line predates the first", () => {
    const r = parseDebugLogContent(
      log(line(9_000, "[Proxy] Server started on port 41234"), ...completedTurn(0)),
    );
    expect(r.totals!.wall_time_ms).toBeNull();
    expect(r.totals!.clock_inconsistencies).toBe(1);
  });

  test("a tool call stamped before the session start does not become a negative TTFT", () => {
    const r = parseDebugLogContent(
      log(
        line(9_000, "[Proxy] Server started on port 41234"),
        ...completedTurn(0, [line(500, "[OpenRouter] Tool calls: Read(5 chars)")]),
      ),
    );
    expect(r.totals!.time_to_first_tool_ms).toBeNull();
    expect(r.totals!.clock_inconsistencies).toBeGreaterThanOrEqual(1);
  });

  test("a same-millisecond turn is 0ms and is a real measurement, not an inconsistency", () => {
    const r = parseDebugLogContent(
      log(request(0), line(0, "[OpenRouter] Stream complete: success")),
    );
    expect(r.turns[0].duration_ms).toBe(0);
    expect(r.totals!.total_time_ms).toBe(0);
    expect(r.totals!.clock_inconsistencies).toBe(0);
  });
});

describe("malformed input degrades, never throws", () => {
  test("a request block truncated mid-write yields no turn and no throw", () => {
    // monitor.ts reads a log the writer still has open, so a half-written
    // JSON block is a normal read, not a corruption.
    let r!: ReturnType<typeof parseDebugLogContent>;
    expect(() => {
      r = parseDebugLogContent('[' + at(0) + '] [OpenRouter Request] {\n  "targetModel": "glm-5.2",\n');
    }).not.toThrow();
    expect(r.turns).toEqual([]);
    expect(r.totals!.total_turns).toBe(0);
  });

  test("a completion with no preceding request does not fabricate a turn", () => {
    const r = parseDebugLogContent(
      log(
        line(0, "[OpenRouter] Stream complete: success"),
        line(100, "[OpenRouter] Usage: prompt=9, completion=9, total=18"),
        line(200, "[OpenRouter] Tool calls: Read(5 chars)"),
      ),
    );
    expect(r.turns).toEqual([]);
    expect(r.totals!.total_tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
  });

  test("lines that are not log lines at all are ignored", () => {
    const r = parseDebugLogContent(
      log(
        "not a log line at all",
        "[garbled",
        "}",
        ...completedTurn(1_000),
        "   ",
      ),
    );
    expect(r.totals!.total_turns).toBe(1);
  });

  test("CRLF line endings parse identically to LF", () => {
    const lf = log(...completedTurn(0, [line(500, "[OpenRouter] Usage: prompt=10, completion=5, total=15")]));
    const crlf = lf.replace(/\n/g, "\r\n");
    const r = parseDebugLogContent(crlf);
    expect(r.totals!.total_turns).toBe(1);
    expect(r.turns[0].tokens).toEqual({ prompt: 10, completion: 5, total: 15 });
    expect(r).toEqual(parseDebugLogContent(lf));
  });

  test("non-ASCII content in a log line does not disturb the surrounding turn", () => {
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0, [line(500, "[OpenRouter] Tool calls: Read(5 chars)")]),
        line(1_100, "assistant said: 🚀 ünïcödé — こんにちは"),
      ),
    );
    expect(r.totals!.total_turns).toBe(1);
    expect(r.totals!.unique_tools).toEqual(["Read"]);
  });

  test("a pathologically long line is handled without stalling the parse", () => {
    const r = parseDebugLogContent(
      log(...completedTurn(0), line(1_100, "junk " + "x".repeat(200_000))),
    );
    expect(r.totals!.total_turns).toBe(1);
  });

  test("an unparseable timestamp leaves the turn countable with a null timestamp", () => {
    const r = parseDebugLogContent(
      log(
        '[9999-99-99T99:99:99.999Z] [OpenRouter Request] { "targetModel": "glm-5.2", "messageCount": 1, "toolCount": 0 }',
        line(1_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.turns[0].timestamp).toBeNull();
    expect(r.turns[0].duration_ms).toBeNull();
    expect(r.totals!.total_turns).toBe(1);
  });

  test("unexpected fields in the request JSON are ignored, not fatal", () => {
    const r = parseDebugLogContent(
      log(
        request(0, { provider: "cerebras", stream: 1, unknownFutureField: "x" }),
        line(1_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.totals!.total_turns).toBe(1);
    expect(r.totals!.model).toBe("glm-5.2");
  });

  test("a request pretty-printed across several lines is still one turn", () => {
    const r = parseDebugLogContent(
      log(
        `[${at(0)}] [OpenRouter Request] {`,
        '  "targetModel": "glm-5.2",',
        '  "messageCount": 4,',
        '  "toolCount": 2',
        "}",
        line(1_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].message_count).toBe(4);
    expect(r.totals!.model).toBe("glm-5.2");
  });
});

describe("multi-line JSON joining — the block ends where the JSON ends", () => {
  test("fields after a nested object survive", () => {
    // A nested block pretty-printed by JSON.stringify puts its inner closing
    // brace alone on a line. Ending the join at the first such line ends it
    // inside the JSON, and every field after it is silently dropped.
    const r = parseDebugLogContent(
      log(
        `[${at(0)}] [OpenRouter Request] {`,
        '  "targetModel": "glm-5.2",',
        '  "routing": {',
        '    "provider": {',
        '      "name": "cerebras"',
        "    }",
        "  },",
        '  "messageCount": 4,',
        '  "toolCount": 7',
        "}",
        line(1_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].message_count).toBe(4);
    expect(r.totals!.model).toBe("glm-5.2");
    expect(r.totals!.total_turns).toBe(1);
  });

  test("fields after an array of objects survive", () => {
    // The tool schema list is the block that actually appears in these logs,
    // and toolCount — the field describing it — sits right after it.
    const r = parseDebugLogContent(
      log(
        `[${at(0)}] [OpenRouter Request] {`,
        '  "targetModel": "glm-5.2",',
        '  "tools": [',
        "    {",
        '      "name": "Read"',
        "    },",
        "    {",
        '      "name": "Bash"',
        "    }",
        "  ],",
        '  "messageCount": 9',
        "}",
        line(1_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.turns[0].message_count).toBe(9);
    expect(r.totals!.total_turns).toBe(1);
  });

  test("a brace inside a JSON string does not close the block", () => {
    // Guards the depth counter itself: counting braces without tracking string
    // literals would trade this bug for its mirror image.
    const r = parseDebugLogContent(
      log(
        `[${at(0)}] [OpenRouter Request] {`,
        '  "targetModel": "glm-5.2",',
        '  "systemPrompt": "emit JSON like {\\"a\\": 1} when asked",',
        '  "messageCount": 3',
        "}",
        line(1_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.turns[0].message_count).toBe(3);
  });

  test("the line after a joined block is still parsed on its own", () => {
    // The join must consume the block and nothing more; swallowing the next
    // line would lose a turn's tools or its completion.
    const r = parseDebugLogContent(
      log(
        `[${at(0)}] [OpenRouter Request] {`,
        '  "targetModel": "glm-5.2",',
        '  "routing": {',
        '    "provider": "cerebras"',
        "  },",
        '  "messageCount": 2',
        "}",
        line(500, "[OpenRouter] Tool calls: Read(5 chars)"),
        line(1_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.turns[0].message_count).toBe(2);
    expect(r.turns[0].tool_calls).toEqual(["Read"]);
    expect(r.turns[0].duration_ms).toBe(1000);
  });

  test("a block that never closes is dropped, and the rest of the log still parses", () => {
    // An unclosed block is not a block. Consuming to EOF on the strength of one
    // opening brace loses every turn after it — a whole session's metrics
    // deleted by one malformed line.
    const r = parseDebugLogContent(
      log(
        `[${at(0)}] [OpenRouter Request] {`,
        '  "targetModel": "glm-5.2",',
        '  "routing": {',
        ...completedTurn(5_000),
      ),
    );
    expect(r.totals!.total_turns).toBe(1);
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].retry).toBe(false);
  });

  test("a stray unclosed brace later in the log does not invalidate the blocks before it", () => {
    // Block detection is a depth calculation over the whole file, so it has to
    // ask "does the depth come back down anywhere after this line?" — not
    // "where does the file end up?". The second question retroactively voids
    // every well-formed block whenever one bad line appears after them.
    const r = parseDebugLogContent(
      log(
        `[${at(0)}] [OpenRouter Request] {`,
        '  "targetModel": "glm-5.2",',
        '  "messageCount": 11',
        "}",
        line(500, "[Assistant] here is a { stray brace"),
        line(1_000, "[OpenRouter] Stream complete: success"),
      ),
    );
    expect(r.totals!.total_turns).toBe(1);
    expect(r.turns[0].message_count).toBe(11);
  });

  test("20k lines that look like block openers parse in linear time", () => {
    // A debug log carries model output, so a line ending in `] {` is
    // producible by the model. Rescanning to EOF from each one is quadratic:
    // this input took 33 SECONDS that way, on a parse monitor.ts re-runs every
    // three. The ceiling is loose on purpose — it is here to catch a return to
    // quadratic, not to measure speed.
    const openers: string[] = [];
    for (let i = 0; i < 20_000; i++) openers.push(line(i, "[Assistant] {"));
    const started = performance.now();
    const r = parseDebugLogContent(log(...openers));
    const tookMs = performance.now() - started;
    expect(r.totals!.total_turns).toBe(0);
    expect(tookMs).toBeLessThan(5_000);
  }, 30_000);

  test("a half-written block at EOF is still not counted as a turn", () => {
    // The same rule read from the other side: monitor.ts polls a log the writer
    // holds open, so the last block is routinely incomplete. It is in flight,
    // not a turn, and not a retry either.
    const r = parseDebugLogContent(
      log(
        ...completedTurn(0),
        `[${at(5_000)}] [OpenRouter Request] {`,
        '  "targetModel": "glm-5.2",',
      ),
    );
    expect(r.totals!.total_turns).toBe(1);
    expect(r.totals!.total_retries).toBe(0);
  });
});

describe("statefulness across lines — why the monitor must not feed slices", () => {
  // A turn is a request line plus a later completion line, so this parser is
  // stateful across lines and half a turn parses as half a turn: the request
  // half reads as a retry, the completion half as nothing at all. That is the
  // contract, and these two tests pin it.
  //
  // It is also why monitor.ts re-parses the whole log on every poll instead of
  // the slice that arrived since the last one. Feeding slices and accumulating
  // the results under-counted turns, tokens and tools, and three turns that
  // happened to straddle a poll boundary tripped RETRY_STALL_COUNT and
  // reported a healthy model as STALLED. See applyLogSnapshot in monitor.ts
  // and "a turn split across polls counts once" in monitor.test.ts.

  test("a request whose completion lands in the next chunk reads as a retry", () => {
    const chunkA = log(request(0));
    const r = parseDebugLogContent(chunkA);
    expect(r.turns[0].retry).toBe(true);
    expect(r.totals!.total_retries).toBe(1);
  });

  test("the completion chunk on its own carries no turn and no tokens", () => {
    const chunkB = log(
      line(500, "[OpenRouter] Usage: prompt=10, completion=5, total=15"),
      line(1_000, "[OpenRouter] Stream complete: success"),
    );
    const r = parseDebugLogContent(chunkB);
    expect(r.turns).toEqual([]);
    expect(r.totals!.total_turns).toBe(0);
    expect(r.totals!.total_tokens.completion).toBe(0);
  });
});
