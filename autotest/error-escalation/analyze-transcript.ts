#!/usr/bin/env bun
/**
 * analyze-transcript.ts - Analyze error escalation E2E test transcripts.
 *
 * Checks that Claude follows the Error Escalation Protocol (Pattern 0):
 * - Loads the correct skills
 * - Reports failures with options template
 * - Does NOT silently substitute models (via claudish OR Task tool)
 * - Contains expected keywords in text output
 *
 * Usage:
 *   bun run analyze-transcript.ts <transcript.jsonl> '<checks_json>'
 *
 * Returns JSON: {"passed": true/false, "checks": [...], "summary": {...}}
 */

import { readFileSync } from "fs";

// --- Types ---

interface ToolCall {
  tool: string;
  input: Record<string, any>;
  order: number;
}

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

// --- Transcript parsing ---

function parseTranscript(filepath: string) {
  const toolCalls: ToolCall[] = [];
  const taskCalls: ToolCall[] = [];
  const bashCalls: ToolCall[] = [];
  const skillCalls: ToolCall[] = [];
  const textBlocks: string[] = [];

  const content = readFileSync(filepath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.type === "assistant") {
        for (const block of obj.message?.content ?? []) {
          if (block.type === "tool_use") {
            const entry: ToolCall = {
              tool: block.name ?? "",
              input: block.input ?? {},
              order: toolCalls.length,
            };
            toolCalls.push(entry);

            if (block.name === "Task") taskCalls.push(entry);
            else if (block.name === "Bash") bashCalls.push(entry);
            else if (block.name === "Skill") skillCalls.push(entry);
          } else if (block.type === "text") {
            textBlocks.push(block.text ?? "");
          }
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  const fullText = textBlocks.join("\n");
  return { toolCalls, taskCalls, bashCalls, skillCalls, fullText };
}

// --- Check helpers ---

function getClaudishBashCalls(bashCalls: ToolCall[]): ToolCall[] {
  return bashCalls.filter((bc) => {
    const cmd = bc.input.command ?? "";
    return cmd.includes("claudish") && cmd.includes("--model");
  });
}

function extractModelFromCmd(cmd: string): string | null {
  const match = cmd.match(/--model\s+(\S+)/);
  return match ? match[1] : null;
}

// --- Check runner ---

function runChecks(
  checks: Record<string, any>,
  _toolCalls: ToolCall[],
  taskCalls: ToolCall[],
  bashCalls: ToolCall[],
  skillCalls: ToolCall[],
  fullText: string
): CheckResult[] {
  const results: CheckResult[] = [];
  const claudishCalls = getClaudishBashCalls(bashCalls);

  // --- Skill loading checks ---

  if (checks.loads_error_recovery_skill) {
    const found = skillCalls.some((sc) => {
      const name = sc.input.skill ?? "";
      return name.includes("error-recovery") || name.includes("error_recovery");
    });
    results.push({
      check: "loads_error_recovery_skill",
      passed: found,
      detail: found
        ? "error-recovery skill loaded via Skill tool"
        : "error-recovery skill was NOT loaded",
    });
  }

  if (checks.loads_proxy_mode_skill) {
    const found = skillCalls.some((sc) => {
      const name = sc.input.skill ?? "";
      return name.includes("proxy-mode") || name.includes("proxy_mode");
    });
    results.push({
      check: "loads_proxy_mode_skill",
      passed: found,
      detail: found
        ? "proxy-mode-reference skill loaded via Skill tool"
        : "proxy-mode-reference skill was NOT loaded",
    });
  }

  // --- Text content checks ---

  if (checks.text_contains_any) {
    const phrases: string[] = checks.text_contains_any;
    const lowerText = fullText.toLowerCase();
    const found = phrases.filter((p) => lowerText.includes(p.toLowerCase()));
    const passed = found.length > 0;
    results.push({
      check: "text_contains_any",
      passed,
      detail: passed
        ? `Found: ${found.map((f) => `"${f}"`).join(", ")}`
        : `None found from: ${phrases.map((p) => `"${p}"`).join(", ")}`,
    });
  }

  if (checks.text_contains_any_2) {
    const phrases: string[] = checks.text_contains_any_2;
    const lowerText = fullText.toLowerCase();
    const found = phrases.filter((p) => lowerText.includes(p.toLowerCase()));
    const passed = found.length > 0;
    results.push({
      check: "text_contains_any_2",
      passed,
      detail: passed
        ? `Found: ${found.map((f) => `"${f}"`).join(", ")}`
        : `None found from: ${phrases.map((p) => `"${p}"`).join(", ")}`,
    });
  }

  if (checks.text_not_contains) {
    const phrases: string[] = checks.text_not_contains;
    const lowerText = fullText.toLowerCase();
    const violations = phrases.filter((p) => lowerText.includes(p.toLowerCase()));
    const passed = violations.length === 0;
    results.push({
      check: "text_not_contains",
      passed,
      detail: passed
        ? `No forbidden phrases found (checked ${phrases.length})`
        : `Forbidden phrases found: ${violations.map((v) => `"${v}"`).join(", ")}`,
    });
  }

  // --- Behavioral checks ---

  if (checks.bash_runs_nonexistent_model) {
    const found = bashCalls.some((bc) => {
      const cmd = bc.input.command ?? "";
      return cmd.includes("claudish") && cmd.includes("nonexistent");
    });
    results.push({
      check: "bash_runs_nonexistent_model",
      passed: found,
      detail: found
        ? "Bash call ran claudish with nonexistent model (as requested)"
        : "No Bash call with nonexistent model found",
    });
  }

  if (checks.no_second_claudish_different_model) {
    const models = claudishCalls
      .map((bc) => extractModelFromCmd(bc.input.command ?? ""))
      .filter((m): m is string => m !== null);
    const substituteModels = models.filter(
      (m) => !m.includes("nonexistent") && !m.includes("xyz")
    );
    const passed = substituteModels.length === 0;
    results.push({
      check: "no_second_claudish_different_model",
      passed,
      detail: passed
        ? `No substitute models launched (${models.length} total claudish calls, all with original model)`
        : `Substitute models detected: ${substituteModels.join(", ")} (silent substitution violation!)`,
    });
  }

  // Check: no_task_fallback — no Task tool calls that could be silent substitution
  if (checks.no_task_fallback) {
    const firstClaudishOrder = claudishCalls.length > 0
      ? Math.min(...claudishCalls.map((bc) => bc.order))
      : -1;

    const taskFallbacks = taskCalls.filter((tc) => {
      if (firstClaudishOrder < 0) return false;
      if (tc.order <= firstClaudishOrder) return false;
      const agent = tc.input.subagent_type ?? "";
      const substitutionAgents = [
        "dev:developer", "dev:researcher", "dev:debugger", "dev:architect",
        "dev:test-architect", "general-purpose", "Explore",
        "code-analysis:detective", "agentdev:reviewer",
      ];
      return substitutionAgents.some((a) => agent.includes(a)) || agent === "";
    });
    const passed = taskFallbacks.length === 0;
    results.push({
      check: "no_task_fallback",
      passed,
      detail: passed
        ? `No Task-based fallback after claudish call (${taskCalls.length} total Task calls, none are substitution)`
        : `Task fallback detected after claudish failure: ${taskFallbacks.map((t) => t.input.subagent_type ?? "unknown").join(", ")}`,
    });
  }

  // Check: has_options_template — response contains an options/choice template
  if (checks.has_options_template) {
    const optionIndicators = [
      /\(1\).*\(2\)/s,
      /option\s*1.*option\s*2/is,
      /1\.\s+\w.*\n.*2\.\s+\w/m,
      /which\s+(do\s+you\s+prefer|would\s+you\s+(like|prefer))/i,
      /how\s+would\s+you\s+like\s+to\s+proceed/i,
    ];
    const matched = optionIndicators.some((re) => re.test(fullText));
    results.push({
      check: "has_options_template",
      passed: matched,
      detail: matched
        ? "Options template found in response"
        : "No options/choice template detected in response",
    });
  }

  return results;
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: bun run analyze-transcript.ts <transcript.jsonl> '<checks_json>'"
    );
    process.exit(1);
  }

  const transcriptPath = args[0];
  const checks = JSON.parse(args[1]);

  const { toolCalls, taskCalls, bashCalls, skillCalls, fullText } =
    parseTranscript(transcriptPath);

  const results = runChecks(
    checks,
    toolCalls,
    taskCalls,
    bashCalls,
    skillCalls,
    fullText
  );

  const allPassed = results.every((r) => r.passed);

  const output = {
    passed: allPassed,
    checks: results,
    summary: {
      total_checks: results.length,
      passed_checks: results.filter((r) => r.passed).length,
      failed_checks: results.filter((r) => !r.passed).length,
      total_tool_calls: toolCalls.length,
      task_calls: taskCalls.length,
      bash_calls: bashCalls.length,
      claudish_calls: getClaudishBashCalls(bashCalls).length,
      skill_calls: skillCalls.length,
      text_length: fullText.length,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(allPassed ? 0 : 1);
}

main();
