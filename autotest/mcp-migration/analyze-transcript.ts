#!/usr/bin/env bun
/**
 * Analyze JSONL transcripts for MCP migration regression: verify that /team and
 * /delegate commands use claudish MCP tools and NEVER fall back to Bash+claudish CLI.
 *
 * Usage: bun autotest/mcp-migration/analyze-transcript.ts <transcript.jsonl> <checks_json>
 *
 * v1.0.0: Initial analyzer for MCP migration regression tests.
 *
 * Available checks:
 *
 *   // Negative checks (absence of CLI patterns)
 *   "no_bash_claudish_cli": true,          // NO Bash call contains "claudish --model"
 *   "no_exit_code_capture": true,          // NO "echo $? > *.exit" pattern in Bash calls
 *   "no_stderr_redirect": true,            // NO "2>*.log" redirect in claudish Bash calls
 *   "no_stdin_redirect": true,             // NO "< *.md" stdin redirect in claudish Bash calls
 *   "no_stdout_redirect": true,            // NO "> *.md" stdout redirect in claudish Bash calls
 *   "no_bash_claudish_run_prompt": true,   // NO Bash call contains "claudish run_prompt"
 *
 *   // Positive checks (MCP tools used correctly)
 *   "mcp_tool_called": "team",             // At least one MCP tool call matching suffix
 *   "internal_uses_task": true,            // At least one Task/Agent call (for internal model)
 *   "mcp_team_has_claude_flags": "--effort", // team MCP call has claude_flags containing string
 *
 * Returns JSON: {"passed": true/false, "checks": [...], "summary": {...}}
 */

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  order: number;
}

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

interface TranscriptData {
  toolCalls: ToolCall[];
  taskCalls: ToolCall[];
  agentCalls: ToolCall[];
  bashCalls: ToolCall[];
  mcpCalls: ToolCall[];
}

type ChecksConfig = Record<string, unknown>;

async function parseTranscript(filepath: string): Promise<TranscriptData> {
  const toolCalls: ToolCall[] = [];
  const taskCalls: ToolCall[] = [];
  const agentCalls: ToolCall[] = [];
  const bashCalls: ToolCall[] = [];
  const mcpCalls: ToolCall[] = [];

  const content = await Bun.file(filepath).text();
  const lines = content.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj["type"] !== "assistant") continue;

    const message = obj["message"] as Record<string, unknown> | undefined;
    if (!message) continue;

    const contentBlocks = message["content"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(contentBlocks)) continue;

    for (const block of contentBlocks) {
      if (block["type"] !== "tool_use") continue;

      const name = (block["name"] as string) ?? "";
      const inp = (block["input"] as Record<string, unknown>) ?? {};
      const entry: ToolCall = {
        tool: name,
        input: inp,
        order: toolCalls.length,
      };

      toolCalls.push(entry);

      if (name === "Task") taskCalls.push(entry);
      else if (name === "Agent") agentCalls.push(entry);
      else if (name === "Bash") bashCalls.push(entry);
      else if (name.startsWith("mcp__")) mcpCalls.push(entry);
    }
  }

  return { toolCalls, taskCalls, agentCalls, bashCalls, mcpCalls };
}

/**
 * Filter bash calls to only actual claudish model invocations.
 * Matches commands with --model flag (real invocations), excluding diagnostics
 * like `which claudish`, `claudish --version`, etc.
 */
function getClaudishBashCalls(bashCalls: ToolCall[]): ToolCall[] {
  return bashCalls.filter((bc) => {
    const cmd = (bc.input["command"] as string) ?? "";
    return cmd.toLowerCase().includes("claudish") && cmd.includes("--model");
  });
}

/**
 * Return MCP calls whose tool name ends with the given suffix (case-insensitive).
 */
function getMcpCallsBySuffix(mcpCalls: ToolCall[], suffix: string): ToolCall[] {
  const lower = suffix.toLowerCase();
  return mcpCalls.filter(
    (mc) =>
      mc.tool.toLowerCase().endsWith(`__${lower}`) ||
      mc.tool.toLowerCase() === lower
  );
}

function runChecks(
  checks: ChecksConfig,
  { toolCalls, taskCalls, agentCalls, bashCalls, mcpCalls }: TranscriptData
): CheckResult[] {
  const results: CheckResult[] = [];
  const claudishCalls = getClaudishBashCalls(bashCalls);

  // ========================================================
  // NEGATIVE CHECKS — absence of Bash+claudish CLI patterns
  // ========================================================

  // Check: no_bash_claudish_cli
  // The PRIMARY regression check. Fails if ANY Bash call invokes claudish with --model.
  if (checks["no_bash_claudish_cli"]) {
    const violations: string[] = [];
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      // Truncate for readability
      violations.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
    }
    const passed = violations.length === 0;
    results.push({
      check: "no_bash_claudish_cli",
      passed,
      detail: passed
        ? "No Bash+claudish CLI invocations found (correct — MCP tools should be used)"
        : `REGRESSION: ${violations.length} Bash+claudish CLI call(s) found:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
    });
  }

  // Check: no_exit_code_capture
  // Detects `echo $? > *.exit` pattern — a hallmark of the old CLI approach.
  if (checks["no_exit_code_capture"]) {
    const violations: string[] = [];
    for (const bc of bashCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      if (/echo\s+\$\?\s*>\s*\S+\.exit/.test(cmd)) {
        violations.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
      }
    }
    const passed = violations.length === 0;
    results.push({
      check: "no_exit_code_capture",
      passed,
      detail: passed
        ? "No exit code capture patterns (echo $? > .exit) found"
        : `REGRESSION: ${violations.length} exit code capture pattern(s) found:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
    });
  }

  // Check: no_stderr_redirect
  // Detects `2>*.log` or `2>*.stderr` in claudish-related Bash calls.
  if (checks["no_stderr_redirect"]) {
    const violations: string[] = [];
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      if (/2>\s*\S+\.(log|stderr|txt)/.test(cmd)) {
        violations.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
      }
    }
    const passed = violations.length === 0;
    results.push({
      check: "no_stderr_redirect",
      passed,
      detail: passed
        ? "No stderr redirect (2>*.log) in claudish Bash calls"
        : `REGRESSION: ${violations.length} stderr redirect(s) in claudish calls:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
    });
  }

  // Check: no_stdin_redirect
  // Detects `< *.md` stdin piping in claudish-related Bash calls.
  if (checks["no_stdin_redirect"]) {
    const violations: string[] = [];
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      if (/<\s*\S+\.md/.test(cmd)) {
        violations.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
      }
    }
    const passed = violations.length === 0;
    results.push({
      check: "no_stdin_redirect",
      passed,
      detail: passed
        ? "No stdin redirect (< *.md) in claudish Bash calls"
        : `REGRESSION: ${violations.length} stdin redirect(s) in claudish calls:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
    });
  }

  // Check: no_stdout_redirect
  // Detects `> *.md` stdout piping in claudish-related Bash calls.
  if (checks["no_stdout_redirect"]) {
    const violations: string[] = [];
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      // Match > redirect but not 2> (stderr)
      if (/[^2]>\s*\S+\.md/.test(cmd) || /^>\s*\S+\.md/.test(cmd)) {
        violations.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
      }
    }
    const passed = violations.length === 0;
    results.push({
      check: "no_stdout_redirect",
      passed,
      detail: passed
        ? "No stdout redirect (> *.md) in claudish Bash calls"
        : `REGRESSION: ${violations.length} stdout redirect(s) in claudish calls:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
    });
  }

  // Check: no_bash_claudish_run_prompt
  // Detects `claudish run_prompt` or similar invocations via Bash (should use MCP tool).
  if (checks["no_bash_claudish_run_prompt"]) {
    const violations: string[] = [];
    for (const bc of bashCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      if (cmd.toLowerCase().includes("claudish") && cmd.toLowerCase().includes("run_prompt")) {
        violations.push(cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
      }
    }
    const passed = violations.length === 0;
    results.push({
      check: "no_bash_claudish_run_prompt",
      passed,
      detail: passed
        ? "No Bash calls to claudish run_prompt (correct — use MCP run_prompt tool)"
        : `REGRESSION: ${violations.length} Bash claudish run_prompt call(s) found`,
    });
  }

  // ========================================================
  // POSITIVE CHECKS — MCP tools used correctly
  // ========================================================

  // Check: mcp_tool_called
  // At least one MCP tool call matching the given suffix was made.
  if ("mcp_tool_called" in checks) {
    const suffix = checks["mcp_tool_called"] as string;
    const matching = getMcpCallsBySuffix(mcpCalls, suffix);
    const passed = matching.length > 0;
    results.push({
      check: "mcp_tool_called",
      passed,
      detail: passed
        ? `${matching.length} MCP call(s) matching "${suffix}" found (e.g. ${matching[0].tool})`
        : `No MCP tool call matching suffix "${suffix}" found. Available MCP tools: ${[...new Set(mcpCalls.map((m) => m.tool))].join(", ") || "none"}`,
    });
  }

  // Check: internal_uses_task
  // At least one Task or Agent call exists (for internal model).
  if (checks["internal_uses_task"]) {
    const hasTask = taskCalls.length > 0 || agentCalls.length > 0;
    results.push({
      check: "internal_uses_task",
      passed: hasTask,
      detail: hasTask
        ? `${taskCalls.length + agentCalls.length} Task/Agent calls found (for internal model)`
        : "No Task or Agent calls found (internal model should use Task or Agent)",
    });
  }

  // Check: mcp_team_has_claude_flags
  // The team MCP tool call has claude_flags param containing the expected string.
  if ("mcp_team_has_claude_flags" in checks) {
    const expected = checks["mcp_team_has_claude_flags"] as string;
    const teamCalls = getMcpCallsBySuffix(mcpCalls, "team");
    let found = false;
    let detail = "";

    for (const tc of teamCalls) {
      const flags = (tc.input["claude_flags"] as string) ?? "";
      if (flags.includes(expected)) {
        found = true;
        detail = `team MCP call has claude_flags containing "${expected}": "${flags}"`;
        break;
      }
    }

    if (!found) {
      if (teamCalls.length === 0) {
        detail = `No team MCP calls found (expected claude_flags containing "${expected}")`;
      } else {
        const allFlags = teamCalls.map((tc) => (tc.input["claude_flags"] as string) ?? "(empty)");
        detail = `team MCP call claude_flags does not contain "${expected}". Actual: ${JSON.stringify(allFlags)}`;
      }
    }

    results.push({
      check: "mcp_team_has_claude_flags",
      passed: found,
      detail,
    });
  }

  return results;
}

async function main() {
  if (process.argv.length < 4) {
    console.error("Usage: bun autotest/mcp-migration/analyze-transcript.ts <transcript.jsonl> <checks_json>");
    process.exit(1);
  }

  const transcriptPath = process.argv[2];
  const checks: ChecksConfig = JSON.parse(process.argv[3]);

  const data = await parseTranscript(transcriptPath);
  const results = runChecks(checks, data);
  const allPassed = results.every((r) => r.passed);

  const claudishCalls = getClaudishBashCalls(data.bashCalls);

  const output = {
    passed: allPassed,
    checks: results,
    summary: {
      total_checks: results.length,
      passed_checks: results.filter((r) => r.passed).length,
      failed_checks: results.filter((r) => !r.passed).length,
      total_tool_calls: data.toolCalls.length,
      task_calls: data.taskCalls.length,
      agent_calls: data.agentCalls.length,
      bash_calls: data.bashCalls.length,
      claudish_bash_calls: claudishCalls.length,
      mcp_calls: data.mcpCalls.length,
      mcp_team_calls: getMcpCallsBySuffix(data.mcpCalls, "team").length,
      mcp_create_session_calls: getMcpCallsBySuffix(data.mcpCalls, "create_session").length,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(allPassed ? 0 : 1);
}

main();
