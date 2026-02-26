/**
 * Black box tests for analyzer.ts
 *
 * Tests are based ONLY on requirements and API contracts.
 * Each test invokes analyzer.ts as a CLI process and asserts on output files.
 *
 * Implementation notes discovered during test analysis:
 * - grep-instead-of-claudemem counts Grep AND Glob native tool calls in addition to
 *   bash grep/rg/ag commands (both are search alternatives to claudemem)
 * - state.json uses structured format: { _session_count, rules: { ruleId: {...} } }
 * - Session ID must match /^[a-f0-9-]+$/i (UUID hex characters)
 * - single-model-critical-review fires on "code review", "architecture review",
 *   "security audit", "code audit" patterns
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ANALYZER_PATH = join(import.meta.dir, "analyzer.ts");
const RULES_PATH = join(import.meta.dir, "rules.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A single tool_use entry inside an assistant message. */
interface ToolCallSpec {
  tool: string;
  input: Record<string, unknown>;
}

/**
 * Generates a valid JSONL transcript string.
 * Each entry becomes a separate `{"type":"assistant","message":{"content":[{...}]}}` line.
 * If `enoughForSignal` is true (default), prepends enough filler Write calls to hit 10+.
 * Uses Write tool for fillers (not Glob/Grep) to avoid triggering search-related rules.
 */
function generateTranscript(toolCalls: ToolCallSpec[], enoughForSignal = true): string {
  const lines: string[] = [];

  // Filler calls so we exceed the 10-call minimum (unless caller doesn't want that)
  // IMPORTANT: Use Write tool (not Glob/Grep) to avoid triggering grep-instead-of-claudemem rule
  const fillerCount = enoughForSignal ? Math.max(0, 10 - toolCalls.length) : 0;
  for (let i = 0; i < fillerCount; i++) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: `/project/filler${i}.ts`, content: "// filler" },
            },
          ],
        },
      })
    );
  }

  for (const tc of toolCalls) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: tc.tool,
              input: tc.input,
            },
          ],
        },
      })
    );
  }

  return lines.join("\n") + "\n";
}

/** Write a transcript string to a temp file and return the path. */
function writeTranscript(dir: string, content: string): string {
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, content);
  return path;
}

/** Run the analyzer CLI and return exit code. */
function runAnalyzer(
  transcriptPath: string,
  sessionId: string,
  stateDir: string,
  env?: Record<string, string>
): { code: number } {
  const statePath = join(stateDir, "state.json");
  const outputPath = join(stateDir, "recommendations.md");
  const historyDir = join(stateDir, "history");

  const result = spawnSync(
    "bun",
    [
      ANALYZER_PATH,
      "--transcript", transcriptPath,
      "--session-id", sessionId,
      "--rules", RULES_PATH,
      "--state", statePath,
      "--output", outputPath,
      "--history-dir", historyDir,
    ],
    {
      env: { ...process.env, ...(env ?? {}) },
      timeout: 30000,
    }
  );

  return { code: result.status ?? 1 };
}

/** Read recommendations.md from state dir; returns null if file absent. */
function readRecommendations(stateDir: string): string | null {
  const path = join(stateDir, "recommendations.md");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

/** Read state.json from state dir; returns null if file absent. */
function readState(stateDir: string): Record<string, unknown> | null {
  const path = join(stateDir, "state.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

let testDir = "";

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "coaching-test-"));
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST GROUP: Transcript Parsing
// ---------------------------------------------------------------------------

describe("Transcript Parsing", () => {
  it("TEST-01: empty transcript file produces no recommendations", () => {
    const transcriptPath = writeTranscript(testDir, "");
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    // Empty transcript => 0 tool calls => low-signal guard fires => no output
    expect(readRecommendations(testDir)).toBeNull();
  });

  it("TEST-02: malformed JSONL lines are skipped, valid ones are processed", () => {
    // Mix valid assistant tool_use lines with garbage; total valid calls < 10 => no output
    const content = [
      "not-valid-json{{{}}}",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/p/a.ts", content: "x" } }] } }),
      "{{broken}}",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/p/b.ts", content: "x" } }] } }),
    ].join("\n");
    const transcriptPath = writeTranscript(testDir, content);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    // 2 valid tool calls < 10 => no recommendations (low-signal guard)
    expect(readRecommendations(testDir)).toBeNull();
  });

  it("TEST-03: only tool_use blocks inside assistant messages are extracted", () => {
    // Add a user message and a result message that also have tool-like structure
    const lines = [
      // user message — must NOT be counted
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "echo hello" } }] } }),
      // result message — must NOT be counted
      JSON.stringify({ type: "result", content: [{ type: "tool_result", content: "ok" }] }),
    ];
    // 9 valid assistant Write blocks => total 9 <10 => no output
    for (let i = 0; i < 9; i++) {
      lines.push(
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/f${i}.ts`, content: "x" } }] } })
      );
    }
    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    // 9 valid assistant calls + user/result don't count => <10 => no output
    expect(readRecommendations(testDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP: Low-Signal Guard
// ---------------------------------------------------------------------------

describe("Low-Signal Guard", () => {
  it("TEST-04: fewer than 10 tool calls produces no output", () => {
    // Generate exactly 9 Write calls (not Glob/Grep to avoid search rule)
    const lines: string[] = [];
    for (let i = 0; i < 9; i++) {
      lines.push(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/f${i}.ts`, content: "x" } }] },
        })
      );
    }
    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    expect(readRecommendations(testDir)).toBeNull();
  });

  it("TEST-05: exactly 10 tool calls causes analysis to run without crashing", () => {
    // Use 10 Write calls (not Glob/Grep) so no rules fire accidentally
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/f${i}.ts`, content: "x" } }] },
        })
      );
    }
    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    const { code } = runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    // Should exit cleanly (0)
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP: Rule Detection
// ---------------------------------------------------------------------------

describe("Rule: grep-instead-of-claudemem", () => {
  it("TEST-06: 3 Bash grep calls triggers the rule", () => {
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "grep -r 'foo' src/" } },
      { tool: "Bash", input: { command: "grep -n 'bar' lib/" } },
      { tool: "Bash", input: { command: "grep 'baz' tests/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("grep");
    expect(recs).toContain("claudemem");
  });

  it("TEST-07: 2 Bash grep calls does NOT trigger the rule", () => {
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "grep -r 'foo' src/" } },
      { tool: "Bash", input: { command: "grep -n 'bar' lib/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    // May be null (no rules fire) or missing grep mention
    if (recs !== null) {
      expect(recs).not.toContain("claudemem");
    }
  });

  it("rg and ag also count for grep-instead-of-claudemem", () => {
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "rg 'foo' src/" } },
      { tool: "Bash", input: { command: "ag 'bar' lib/" } },
      { tool: "Bash", input: { command: "grep 'baz' tests/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("claudemem");
  });
});

describe("Rule: tmp-path-usage", () => {
  it("TEST-08: Bash command containing /tmp/ path triggers the rule", () => {
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "cat /tmp/myfile.txt" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("/tmp/");
  });

  it("Read tool input containing /tmp/ also triggers tmp-path-usage", () => {
    const transcript = generateTranscript([
      { tool: "Read", input: { file_path: "/tmp/some-session-artifact.md" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("/tmp/");
  });
});

describe("Rule: skill-invoked-as-task", () => {
  it("TEST-09: Task with code-analysis:claudemem-search subagent_type triggers rule", () => {
    const transcript = generateTranscript([
      { tool: "Task", input: { subagent_type: "code-analysis:claudemem-search", prompt: "search for auth patterns" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("code-analysis:claudemem-search");
    expect(recs).toContain("Skill");
  });

  it("TEST-10: Task with dev:developer subagent_type does NOT trigger skill rule", () => {
    const transcript = generateTranscript([
      { tool: "Task", input: { subagent_type: "dev:developer", prompt: "implement the feature" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    // Either null or doesn't contain skill-invoked-as-task content
    if (recs !== null) {
      expect(recs).not.toContain("triple failure cascade");
    }
  });

  it("Task with dev:db-branching (known skill) triggers skill-invoked-as-task", () => {
    const transcript = generateTranscript([
      { tool: "Task", input: { subagent_type: "dev:db-branching", prompt: "set up db branching" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("dev:db-branching");
  });
});

describe("Rule: excessive-reads-before-delegation", () => {
  it("TEST-11: 5 Read calls before first Task triggers rule", () => {
    const transcript = generateTranscript(
      [
        { tool: "Read", input: { file_path: "/project/file1.ts" } },
        { tool: "Read", input: { file_path: "/project/file2.ts" } },
        { tool: "Read", input: { file_path: "/project/file3.ts" } },
        { tool: "Read", input: { file_path: "/project/file4.ts" } },
        { tool: "Read", input: { file_path: "/project/file5.ts" } },
        { tool: "Task", input: { subagent_type: "dev:developer", prompt: "implement feature" } },
      ],
      // Use false + manual filler to keep reads BEFORE task
      false
    );

    // Build manually: Write fillers, then 5 Read calls, then Task to hit 10 total
    // Using Write tool for fillers avoids triggering search rules
    const lines: string[] = [];
    const fillerNeeded = Math.max(0, 10 - 6); // 4 fillers to reach 10 total
    for (let i = 0; i < fillerNeeded; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/fill${i}.ts`, content: "x" } }] } }));
    }
    for (let i = 1; i <= 5; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: `/project/file${i}.ts` } }] } }));
    }
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: "implement feature" } }] } }));

    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("pre-digestion");
  });

  it("TEST-12: 4 Read calls before first Task does NOT trigger rule", () => {
    const lines: string[] = [];
    // 6 Write filler + 4 reads + 1 task = 11 total (Write avoids search rule)
    for (let i = 0; i < 6; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/fill${i}.ts`, content: "x" } }] } }));
    }
    for (let i = 1; i <= 4; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: `/project/file${i}.ts` } }] } }));
    }
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: "implement feature" } }] } }));

    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    if (recs !== null) {
      expect(recs).not.toContain("pre-digestion");
    }
  });
});

describe("Rule: wrong-agent-for-task", () => {
  it("TEST-13: Task prompt matching 'research' pattern with non-researcher agent triggers rule", () => {
    const transcript = generateTranscript([
      { tool: "Task", input: { subagent_type: "dev:developer", prompt: "research the best database options and compare them" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("dev:researcher");
  });

  it("Task prompt matching 'implement' pattern with correct dev:developer agent does NOT trigger rule", () => {
    const transcript = generateTranscript([
      { tool: "Task", input: { subagent_type: "dev:developer", prompt: "implement the authentication module" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    // Should not contain wrong-agent suggestion for this case
    if (recs !== null) {
      // recs may have other rules but should not suggest a different agent for implement+dev:developer
      expect(recs).not.toMatch(/Task prompt matched.*implement.*used.*dev:developer/);
    }
  });
});

describe("Rule: single-model-critical-review", () => {
  it("TEST-14: Task with 'code review' prompt without claudish triggers rule", () => {
    const transcript = generateTranscript([
      { tool: "Task", input: { subagent_type: "dev:developer", prompt: "please do a code review of this PR" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("/team");
  });

  it("TEST-15: Task with 'code review' prompt WITH claudish Bash call does NOT trigger rule", () => {
    const transcript = generateTranscript([
      { tool: "Task", input: { subagent_type: "dev:developer", prompt: "please do a code review of this PR" } },
      { tool: "Bash", input: { command: "claudish --model or@anthropic/claude-3-5-sonnet < review-prompt.md" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    if (recs !== null) {
      expect(recs).not.toContain("/team");
    }
  });

  it("Task with 'architecture review' prompt without claudish triggers rule", () => {
    const transcript = generateTranscript([
      { tool: "Task", input: { subagent_type: "dev:developer", prompt: "please do an architecture review of the auth module" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("/team");
  });
});

describe("Rule: plugin-command-gap", () => {
  it("TEST-16: Bash curl github.com command triggers plugin-command-gap rule", () => {
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "curl https://github.com/owner/repo/issues" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("gh CLI");
  });
});

describe("Rule: no-background-tasks", () => {
  it("TEST-17: 3 sequential non-background Task calls trigger rule", () => {
    // Build transcript with 3 consecutive Task calls (no filler between them to keep order adjacent)
    const lines: string[] = [];
    // 7 Write fillers first (Write does not trigger search rules)
    for (let i = 0; i < 7; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/f${i}.ts`, content: "x" } }] } }));
    }
    // 3 consecutive Task calls
    for (let i = 0; i < 3; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: `task ${i}` } }] } }));
    }
    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    expect(recs).toContain("run_in_background");
  });

  it("TEST-18: Task calls with run_in_background: true do NOT trigger no-background-tasks rule", () => {
    const lines: string[] = [];
    // 7 Write fillers (not Glob/Grep to avoid search rules)
    for (let i = 0; i < 7; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/f${i}.ts`, content: "x" } }] } }));
    }
    // 3 consecutive Task calls all with run_in_background
    for (let i = 0; i < 3; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: `task ${i}`, run_in_background: true } }] } }));
    }
    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);
    const recs = readRecommendations(testDir);
    if (recs !== null) {
      // run_in_background suggestion should not be present
      expect(recs).not.toContain("parallelizable");
    }
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP: Suppression
// ---------------------------------------------------------------------------

describe("Suppression", () => {
  it("TEST-19: suppressed rule is not shown even when transcript triggers it", () => {
    // Write a state.json with grep-instead-of-claudemem suppressed
    // session_count will be incremented from 5 to 6; suppress_until_count: 13 > 6, so still suppressed
    // Use the new structured state format: { _session_count, rules: { ruleId: {...} } }
    const statePath = join(testDir, "state.json");
    writeFileSync(statePath, JSON.stringify({
      _session_count: 5,
      rules: {
        "grep-instead-of-claudemem": {
          last_shown_session: 3,
          shown_count: 1,
          suppress_until_count: 13,
        },
      },
    }));

    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "grep -r 'foo' src/" } },
      { tool: "Bash", input: { command: "grep -r 'bar' lib/" } },
      { tool: "Bash", input: { command: "grep -r 'baz' tests/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);

    // Run analyzer pointing to our pre-seeded state
    const outputPath = join(testDir, "recommendations.md");
    const historyDir = join(testDir, "history");
    const result = spawnSync(
      "bun",
      [
        ANALYZER_PATH,
        "--transcript", transcriptPath,
        "--session-id", "aaaabbbbccccdddd",
        "--rules", RULES_PATH,
        "--state", statePath,
        "--output", outputPath,
        "--history-dir", historyDir,
      ],
      { env: { ...process.env }, timeout: 30000 }
    );

    const recs = existsSync(outputPath) ? readFileSync(outputPath, "utf-8") : null;
    // grep rule should be suppressed
    if (recs !== null) {
      expect(recs).not.toContain("claudemem");
    }
  });

  it("TEST-20: after showing a suggestion, state.json contains correct suppress_until_count", () => {
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "grep -r 'foo' src/" } },
      { tool: "Bash", input: { command: "grep -r 'bar' lib/" } },
      { tool: "Bash", input: { command: "grep -r 'baz' tests/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);

    const state = readState(testDir);
    expect(state).not.toBeNull();
    expect(state!._session_count).toBe(1);

    // grep-instead-of-claudemem has suppress_after_sessions: 10
    // So suppress_until_count should be 1 + 10 = 11
    // State uses structured format: { rules: { ruleId: {...} } }
    const rules = state!.rules as Record<string, Record<string, unknown>>;
    expect(rules).toBeDefined();
    const ruleState = rules["grep-instead-of-claudemem"];
    expect(ruleState).toBeDefined();
    expect(ruleState.suppress_until_count).toBe(11);
    expect(ruleState.shown_count).toBe(1);
    expect(ruleState.last_shown_session).toBe(1);
  });

  it("session_count increments on each analyzer run", () => {
    // Use /tmp/ path to trigger a rule (ensures state.json is written each run)
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "cat /tmp/foo.txt" } },
    ]);

    // Use valid hex session IDs
    const sessionIds = ["aabbccdd11223344", "aabbccdd55667788", "aabbccddaabbccdd"];
    for (let run = 1; run <= 3; run++) {
      const transcriptPath = writeTranscript(testDir, transcript);
      runAnalyzer(transcriptPath, sessionIds[run - 1], testDir);
      const state = readState(testDir);
      expect(state).not.toBeNull();
      expect(state!._session_count).toBe(run);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP: Top-3 Cap and Priority Ordering
// ---------------------------------------------------------------------------

describe("Top-3 Cap", () => {
  it("TEST-21: only top 3 suggestions shown when 4+ rules fire", () => {
    // Trigger 4 rules simultaneously:
    // 1. grep-instead-of-claudemem (3 grep calls)
    // 2. tmp-path-usage (/tmp/ path)
    // 3. skill-invoked-as-task (Task with skill subagent_type)
    // 4. no-background-tasks (sequential Tasks, but combined with skill-invoked-as-task we need different Tasks)
    //
    // Build carefully: need 10+ total tool calls

    const lines: string[] = [];

    // 3 grep calls (triggers grep-instead-of-claudemem)
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "grep -r 'foo' src/" } }] } }));
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "grep -n 'bar' lib/" } }] } }));
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "grep 'baz' tests/" } }] } }));

    // /tmp/ path (triggers tmp-path-usage)
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cat /tmp/result.txt" } }] } }));

    // Skill as Task (triggers skill-invoked-as-task)
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "code-analysis:claudemem-search", prompt: "find auth patterns" } }] } }));

    // 3 sequential non-background Tasks (triggers no-background-tasks)
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: "impl task A" } }] } }));
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: "impl task B" } }] } }));
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: "impl task C" } }] } }));

    // 2 more Write filler to reach 10 (Write doesn't trigger search rules)
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/project/a.ts", content: "x" } }] } }));
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/project/b.ts", content: "x" } }] } }));

    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);

    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();

    // Count numbered suggestions: lines matching "^N. " pattern
    const numbered = (recs!.match(/^\d+\. /gm) ?? []).length;
    expect(numbered).toBeLessThanOrEqual(3);
    expect(numbered).toBeGreaterThan(0);
  });
});

describe("Priority Ordering", () => {
  it("TEST-22: priority-1 suggestions appear before priority-4 suggestions", () => {
    // Trigger priority-1 rule (tmp-path-usage) and priority-4 rule (no-background-tasks)
    const lines: string[] = [];

    // /tmp/ path — priority 1
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cat /tmp/artifact.md" } }] } }));

    // 3 sequential Tasks — priority 4
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: "task A" } }] } }));
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: "task B" } }] } }));
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { subagent_type: "dev:developer", prompt: "task C" } }] } }));

    // 6 Write fillers (Write does not trigger search rules)
    for (let i = 0; i < 6; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/f${i}.ts`, content: "x" } }] } }));
    }

    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir);

    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();

    // /tmp/ suggestion should appear before run_in_background suggestion
    const tmpIdx = recs!.indexOf("/tmp/");
    const bgIdx = recs!.indexOf("run_in_background");

    // Both should be present
    expect(tmpIdx).toBeGreaterThan(-1);
    expect(bgIdx).toBeGreaterThan(-1);

    // Priority 1 (/tmp/) must come before priority 4 (run_in_background)
    expect(tmpIdx).toBeLessThan(bgIdx);
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP: Opt-Out
// ---------------------------------------------------------------------------

describe("Opt-Out", () => {
  it("WORKFLOW_COACHING=off produces no recommendations.md", () => {
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "grep -r 'foo' src/" } },
      { tool: "Bash", input: { command: "grep -r 'bar' lib/" } },
      { tool: "Bash", input: { command: "grep -r 'baz' tests/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, "aaaabbbbccccdddd", testDir, { WORKFLOW_COACHING: "off" });
    expect(readRecommendations(testDir)).toBeNull();
  });

  it("WORKFLOW_COACHING=off deletes existing recommendations.md", () => {
    // Pre-create a recommendations.md
    const outputPath = join(testDir, "recommendations.md");
    writeFileSync(outputPath, "# Stale recommendations\n1. Old suggestion\n");

    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "grep -r 'foo' src/" } },
      { tool: "Bash", input: { command: "grep -r 'bar' lib/" } },
      { tool: "Bash", input: { command: "grep -r 'baz' tests/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);

    // Run with WORKFLOW_COACHING=off — should delete existing file
    const statePath = join(testDir, "state.json");
    const historyDir = join(testDir, "history");
    spawnSync(
      "bun",
      [
        ANALYZER_PATH,
        "--transcript", transcriptPath,
        "--session-id", "aaaabbbbccccdddd",
        "--rules", RULES_PATH,
        "--state", statePath,
        "--output", outputPath,
        "--history-dir", historyDir,
      ],
      { env: { ...process.env, WORKFLOW_COACHING: "off" }, timeout: 30000 }
    );

    expect(existsSync(outputPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP: History Archive
// ---------------------------------------------------------------------------

describe("History Archive", () => {
  it("history/session-{id8}.md is written when suggestions are generated", () => {
    // Session ID must match /^[a-f0-9-]+$/i (hex chars and hyphens only)
    const sessionId = "abcd1234abcd5678";
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "grep -r 'foo' src/" } },
      { tool: "Bash", input: { command: "grep -r 'bar' lib/" } },
      { tool: "Bash", input: { command: "grep -r 'baz' tests/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, sessionId, testDir);

    const historyPath = join(testDir, "history", `session-${sessionId.substring(0, 8)}.md`);
    expect(existsSync(historyPath)).toBe(true);
    const historyContent = readFileSync(historyPath, "utf-8");
    expect(historyContent).toContain(sessionId);
  });

  it("no history file written when no suggestions are generated", () => {
    // 9 Write tool calls: low-signal guard fires
    const lines: string[] = [];
    for (let i = 0; i < 9; i++) {
      lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/project/f${i}.ts`, content: "x" } }] } }));
    }
    const transcriptPath = writeTranscript(testDir, lines.join("\n"));
    const sessionId = "abcd1234abcd5678";
    runAnalyzer(transcriptPath, sessionId, testDir);

    const historyPath = join(testDir, "history", `session-${sessionId.substring(0, 8)}.md`);
    expect(existsSync(historyPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP: Session ID in Output
// ---------------------------------------------------------------------------

describe("Session ID in Output", () => {
  it("recommendations.md contains first 8 chars of session ID", () => {
    const sessionId = "abcdef1234567890";
    const transcript = generateTranscript([
      { tool: "Bash", input: { command: "grep -r 'foo' src/" } },
      { tool: "Bash", input: { command: "grep -r 'bar' lib/" } },
      { tool: "Bash", input: { command: "grep -r 'baz' tests/" } },
    ]);
    const transcriptPath = writeTranscript(testDir, transcript);
    runAnalyzer(transcriptPath, sessionId, testDir);

    const recs = readRecommendations(testDir);
    expect(recs).not.toBeNull();
    // Should contain "session abcdef12..."
    expect(recs).toContain("abcdef12");
  });
});
