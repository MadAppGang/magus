#!/usr/bin/env bun
/**
 * Analyze a /multimodel:delegate command JSONL transcript for orchestration correctness.
 *
 * Usage: bun autotest/delegate/analyze-transcript.ts <transcript.jsonl> <checks_json>
 *
 * v2.0.0: MCP channel migration — replaced Bash+claudish CLI checks with MCP channel tool
 * checks. The /delegate command now uses mcp__plugin_dev_claudish__create_session instead of
 * Bash(claudish ...). Added mcp_tool_called, mcp_create_session_model,
 * no_capability_discovery_subagent checks. Updated no_predigest, no_provider_prefix_in_model,
 * no_shortcut_prefix_in_model, and no_top_models_discovery to inspect MCP tool parameters
 * instead of Bash command strings. Bash+claudish checks retained for /team compatibility
 * but not referenced by delegate test cases.
 *
 * v1.2.0: Added no_top_models_discovery, bash_claudish_model_exact,
 * bash_claudish_all_models_in checks.
 * v1.1.0: Added no_shortcut_prefix_in_model, loads_claudish_skill checks.
 * v1.0.0: Initial analyzer for delegate command.
 *
 * Checks JSON format:
 * {
 *   // MCP channel tool checks (delegate v2.0.0+)
 *   "mcp_tool_called": "create_session",     // At least one MCP tool call matching this suffix
 *   "mcp_create_session_model": "grok-code-fast-1", // model param in create_session call
 *   "mcp_tool_called_send_input": true,      // send_input was called (interactive sessions)
 *   "mcp_tool_called_get_output": true,      // get_output was called (completion)
 *   "no_capability_discovery_subagent": true, // NO Task/Agent call to dev:researcher exists
 *
 *   // Task checks (internal model / /team)
 *   "task_agent_is": "dev:researcher",       // All Task calls use this agent
 *   "task_min_count": 2,                     // Minimum number of Task calls
 *   "run_in_background": true,               // Task calls use run_in_background
 *   "has_vote_template": true,               // Task prompt contains vote template text
 *   "has_vote_format": true,                 // Task prompt contains vote format block
 *   "no_predigest": true,                    // No Read/Grep/Glob/WebSearch before first model call
 *
 *   // Bash+claudish checks (retained for /team compatibility)
 *   "bash_has_claudish": true,               // At least one Bash call contains "claudish"
 *   "bash_min_count": 2,                     // Minimum Bash claudish calls
 *   "bash_claudish_model_contains": "grok",  // --model flag contains keyword
 *   "bash_claudish_has_stdin": true,         // --stdin flag present
 *   "bash_claudish_has_output_redirect": true, // > redirect to session dir
 *   "bash_claudish_captures_exit": true,     // echo $? > .exit pattern
 *   "bash_run_in_background": true,          // Bash claudish calls use run_in_background
 *
 *   // Provider prefix checks (checked in both Bash and MCP params)
 *   "no_provider_prefix_in_model": true,     // No provider/ or shortcut@ prefix in model values
 *   "no_shortcut_prefix_in_model": true,     // No mm@/g@/oai@/kimi@/glm@/or@/litellm@ in model values
 *   "reads_preferences_file": true,          // Read tool used on multimodel-team.json
 *
 *   // Skill loading checks
 *   "loads_claudish_skill": true,            // Skill tool invoked for claudish-usage
 *
 *   // Flag passthrough checks (claudish v5.3.0+)
 *   "bash_claudish_has_passthrough_flags": "--effort",  // Claudish cmd contains this flag
 *   "bash_claudish_no_passthrough_flags": true,          // No passthrough flags (regression)
 *
 *   // Verification checks
 *   "vote_prompt_file_written": true,        // Write tool creates vote-prompt.md
 *   "has_post_verification_reads": true,     // Read tool checks .exit/.result files after models
 *
 *   // Session checks (retained for /team; not used by delegate v2.0.0+)
 *   "session_dir_pattern": "ai-docs/sessions/", // Bash mkdir uses this pattern
 *   "no_tmp_dir": true,                      // No /tmp/ in Bash mkdir calls
 *
 *   // Model discovery checks
 *   "no_top_models_discovery": true,         // No claudish --top-models/--free/--list-models
 *   "bash_claudish_model_exact": "x-ai/grok-2", // Exact model ID in --model flag (bash)
 *   "bash_claudish_all_models_in": ["model-a", "model-b"] // All --model values in set
 * }
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
  writeCalls: ToolCall[];
  readCalls: ToolCall[];
  skillCalls: ToolCall[];
  mcpCalls: ToolCall[];
}

type ChecksConfig = Record<string, unknown>;

async function parseTranscript(filepath: string): Promise<TranscriptData> {
  const toolCalls: ToolCall[] = [];
  const taskCalls: ToolCall[] = [];
  const agentCalls: ToolCall[] = [];
  const bashCalls: ToolCall[] = [];
  const writeCalls: ToolCall[] = [];
  const readCalls: ToolCall[] = [];
  const skillCalls: ToolCall[] = [];
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
      else if (name === "Write") writeCalls.push(entry);
      else if (name === "Read") readCalls.push(entry);
      else if (name === "Skill") skillCalls.push(entry);
      else if (name.startsWith("mcp__")) mcpCalls.push(entry);
    }
  }

  return { toolCalls, taskCalls, agentCalls, bashCalls, writeCalls, readCalls, skillCalls, mcpCalls };
}

/**
 * Return MCP calls whose tool name ends with the given suffix (case-insensitive).
 * For example, getMcpCallsBySuffix(mcpCalls, "create_session") matches
 * mcp__plugin_dev_claudish__create_session and
 * mcp__plugin_code-analysis_claudish__create_session.
 */
function getMcpCallsBySuffix(mcpCalls: ToolCall[], suffix: string): ToolCall[] {
  const lower = suffix.toLowerCase();
  return mcpCalls.filter(
    (mc) =>
      mc.tool.toLowerCase().endsWith(`__${lower}`) ||
      mc.tool.toLowerCase() === lower
  );
}

function getClaudishBashCalls(bashCalls: ToolCall[]): ToolCall[] {
  /**
   * Filter bash calls to only actual claudish model invocations.
   *
   * Only includes commands that have --model flag, which indicates a real
   * model invocation. Excludes diagnostic calls like:
   * - which claudish, command -v claudish, type claudish
   * - claudish --help, claudish --version
   * - npx claudish --help
   * - cat "$(which claudish ...)"
   */
  return bashCalls.filter((bc) => {
    const cmd = (bc.input["command"] as string) ?? "";
    return cmd.toLowerCase().includes("claudish") && cmd.includes("--model");
  });
}

function extractModelValues(claudishCalls: ToolCall[]): string[] {
  const models: string[] = [];
  for (const bc of claudishCalls) {
    const cmd = (bc.input["command"] as string) ?? "";
    const match = cmd.match(/--model\s+(\S+)/);
    if (match) {
      models.push(match[1]);
    }
  }
  return models;
}

function extractMcpCreateSessionModels(mcpCalls: ToolCall[]): string[] {
  const createSessionCalls = getMcpCallsBySuffix(mcpCalls, "create_session");
  const models: string[] = [];
  for (const mc of createSessionCalls) {
    const model = mc.input["model"] as string | undefined;
    if (model) models.push(model);
  }
  return models;
}

function runChecks(
  checks: ChecksConfig,
  { toolCalls, taskCalls, agentCalls, bashCalls, writeCalls, readCalls, skillCalls, mcpCalls }: TranscriptData
): CheckResult[] {
  const results: CheckResult[] = [];
  const claudishCalls = getClaudishBashCalls(bashCalls);

  // ---- MCP channel tool checks (delegate v2.0.0+) ----

  // Check: mcp_tool_called
  // Checks that at least one MCP tool call matching the given suffix was made.
  if ("mcp_tool_called" in checks) {
    const suffix = checks["mcp_tool_called"] as string;
    const matching = getMcpCallsBySuffix(mcpCalls, suffix);
    const passed = matching.length > 0;
    results.push({
      check: "mcp_tool_called",
      passed,
      detail: passed
        ? `${matching.length} MCP call(s) matching "${suffix}" found (e.g. ${matching[0].tool})`
        : `No MCP tool call matching suffix "${suffix}" found in transcript. Available MCP tools: ${[...new Set(mcpCalls.map((m) => m.tool))].join(", ") || "none"}`,
    });
  }

  // Check: mcp_create_session_model
  // Checks that a create_session call was made with the exact model parameter specified.
  if ("mcp_create_session_model" in checks) {
    const expectedModel = checks["mcp_create_session_model"] as string;
    const allModels = extractMcpCreateSessionModels(mcpCalls);
    const found = allModels.some((m) => m === expectedModel);
    results.push({
      check: "mcp_create_session_model",
      passed: found,
      detail: found
        ? `create_session called with exact model "${expectedModel}"`
        : allModels.length > 0
          ? `Expected model "${expectedModel}" not found in create_session calls. Actual models: ${JSON.stringify(allModels)}`
          : `Expected model "${expectedModel}" not found. No create_session calls with a model parameter found.`,
    });
  }

  // Check: mcp_tool_called_send_input
  // Checks that send_input was called at least once (for interactive session tests).
  if (checks["mcp_tool_called_send_input"]) {
    const matching = getMcpCallsBySuffix(mcpCalls, "send_input");
    const passed = matching.length > 0;
    results.push({
      check: "mcp_tool_called_send_input",
      passed,
      detail: passed
        ? `${matching.length} send_input MCP call(s) found`
        : "No send_input MCP tool call found",
    });
  }

  // Check: mcp_tool_called_get_output
  // Checks that get_output was called at least once (for session completion tests).
  if (checks["mcp_tool_called_get_output"]) {
    const matching = getMcpCallsBySuffix(mcpCalls, "get_output");
    const passed = matching.length > 0;
    results.push({
      check: "mcp_tool_called_get_output",
      passed,
      detail: passed
        ? `${matching.length} get_output MCP call(s) found`
        : "No get_output MCP tool call found",
    });
  }

  // Check: no_capability_discovery_subagent
  // Checks that NO Task/Agent call to dev:researcher exists (capability discovery removed).
  if (checks["no_capability_discovery_subagent"]) {
    const allSubagentCalls = [...taskCalls, ...agentCalls];
    const discoveryAgents: string[] = [];
    for (const tc of allSubagentCalls) {
      const agent = (tc.input["subagent_type"] as string) ?? "";
      if (agent === "dev:researcher") {
        discoveryAgents.push(agent);
      }
    }
    const passed = discoveryAgents.length === 0;
    results.push({
      check: "no_capability_discovery_subagent",
      passed,
      detail: passed
        ? "No capability discovery subagent calls (dev:researcher) found"
        : `Found ${discoveryAgents.length} dev:researcher Task/Agent call(s) — capability discovery should be removed`,
    });
  }

  // ---- Task checks (internal model / /team) ----

  // Check: task_agent_is
  if ("task_agent_is" in checks) {
    const expectedAgent = checks["task_agent_is"] as string;
    const allSubagentCalls = [...taskCalls, ...agentCalls];
    if (allSubagentCalls.length === 0) {
      results.push({
        check: "task_agent_is",
        passed: false,
        detail: `No Task or Agent calls found (expected agent: ${expectedAgent})`,
      });
    } else {
      const wrongAgents: string[] = [];
      for (const tc of allSubagentCalls) {
        const agent = (tc.input["subagent_type"] as string) ?? "MISSING";
        if (agent !== expectedAgent) {
          wrongAgents.push(agent);
        }
      }
      if (wrongAgents.length > 0) {
        results.push({
          check: "task_agent_is",
          passed: false,
          detail: `Wrong agents used: ${JSON.stringify(wrongAgents)} (expected: ${expectedAgent})`,
        });
      } else {
        results.push({
          check: "task_agent_is",
          passed: true,
          detail: `All ${allSubagentCalls.length} Task/Agent calls use ${expectedAgent}`,
        });
      }
    }
  }

  // Check: task_min_count
  if ("task_min_count" in checks) {
    const minCount = checks["task_min_count"] as number;
    const actual = taskCalls.length + agentCalls.length;
    const passed = actual >= minCount;
    results.push({
      check: "task_min_count",
      passed,
      detail: `${actual} Task/Agent calls (${taskCalls.length} Task + ${agentCalls.length} Agent, minimum: ${minCount})`,
    });
  }

  // Check: run_in_background (for Task and Agent calls)
  if (checks["run_in_background"]) {
    const allSubagentCalls = [...taskCalls, ...agentCalls];
    let allBg = true;
    for (const tc of allSubagentCalls) {
      if (!tc.input["run_in_background"]) {
        allBg = false;
        break;
      }
    }
    results.push({
      check: "run_in_background",
      passed: allBg,
      detail: allBg
        ? `All ${allSubagentCalls.length} Task/Agent calls use run_in_background`
        : "Some Task/Agent calls missing run_in_background=true",
    });
  }

  // Check: has_vote_template
  if (checks["has_vote_template"]) {
    let found = false;
    for (const tc of [...taskCalls, ...agentCalls]) {
      const prompt = (tc.input["prompt"] as string) ?? "";
      if (prompt.includes("Team Vote") || prompt.includes("Independent Review")) {
        found = true;
        break;
      }
    }
    if (!found) {
      for (const wc of writeCalls) {
        const content = (wc.input["content"] as string) ?? "";
        if (content.includes("Team Vote") || content.includes("Independent Review")) {
          found = true;
          break;
        }
      }
    }
    results.push({
      check: "has_vote_template",
      passed: found,
      detail: found
        ? "Vote template found"
        : "No vote template text found in Task/Agent prompts or Write calls",
    });
  }

  // Check: has_vote_format
  if (checks["has_vote_format"]) {
    let found = false;
    for (const tc of taskCalls) {
      const prompt = (tc.input["prompt"] as string) ?? "";
      if (prompt.includes("VERDICT") && (prompt.includes("APPROVE") || prompt.includes("REJECT"))) {
        found = true;
        break;
      }
    }
    if (!found) {
      for (const wc of writeCalls) {
        const content = (wc.input["content"] as string) ?? "";
        if (
          content.includes("VERDICT") &&
          (content.includes("APPROVE") || content.includes("REJECT"))
        ) {
          found = true;
          break;
        }
      }
    }
    results.push({
      check: "has_vote_format",
      passed: found,
      detail: found ? "Vote format block found" : "No VERDICT/APPROVE/REJECT format found",
    });
  }

  // Check: no_predigest
  // No Read/Grep/Glob/WebSearch on project files before the first model call.
  // First model call is: first create_session MCP call, first Task/Agent call, or first
  // Bash claudish call — whichever appears earliest.
  if (checks["no_predigest"]) {
    let firstModelOrder = 999999;

    // MCP create_session calls (delegate v2.0.0+)
    const createSessionCalls = getMcpCallsBySuffix(mcpCalls, "create_session");
    if (createSessionCalls.length > 0) {
      firstModelOrder = Math.min(firstModelOrder, createSessionCalls[0].order);
    }

    // Task/Agent calls (internal model / /team)
    if (taskCalls.length > 0) {
      firstModelOrder = Math.min(firstModelOrder, taskCalls[0].order);
    }

    // Bash claudish calls (legacy / /team)
    if (claudishCalls.length > 0) {
      firstModelOrder = Math.min(firstModelOrder, claudishCalls[0].order);
    }

    const investigationTools = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch"]);
    const setupPatterns = ["multimodel-team.json", "settings.json"];
    const predigestCalls: string[] = [];

    for (const tc of toolCalls) {
      if (tc.order < firstModelOrder && investigationTools.has(tc.tool)) {
        const filePath = (tc.input["file_path"] as string) ?? "";
        const isSetup = setupPatterns.some((pat) => filePath.includes(pat));
        if (!isSetup) {
          predigestCalls.push(tc.tool);
        }
      }
    }

    const passed = predigestCalls.length === 0;
    results.push({
      check: "no_predigest",
      passed,
      detail: passed
        ? "No pre-digestion tools before model calls"
        : `Pre-digestion detected: ${JSON.stringify(predigestCalls)} called before first model call`,
    });
  }

  // ---- Bash+claudish checks (retained for /team compatibility) ----

  // Check: bash_has_claudish
  if (checks["bash_has_claudish"]) {
    const found = claudishCalls.length > 0;
    results.push({
      check: "bash_has_claudish",
      passed: found,
      detail: found
        ? `${claudishCalls.length} Bash claudish calls found`
        : 'No Bash calls containing "claudish" found',
    });
  }

  // Check: bash_min_count
  if ("bash_min_count" in checks) {
    const minCount = checks["bash_min_count"] as number;
    const actual = claudishCalls.length;
    const passed = actual >= minCount;
    results.push({
      check: "bash_min_count",
      passed,
      detail: `${actual} Bash claudish calls (minimum: ${minCount})`,
    });
  }

  // Check: bash_claudish_model_contains
  if ("bash_claudish_model_contains" in checks) {
    const keyword = checks["bash_claudish_model_contains"] as string;
    let found = false;
    let detail = "";
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      if (cmd.toLowerCase().includes(keyword.toLowerCase())) {
        const modelMatch = cmd.match(/--model\s+(\S+)/);
        if (modelMatch) {
          found = true;
          detail = `Found: --model ${modelMatch[1]}`;
          break;
        } else {
          found = true;
          detail = `Found "${keyword}" in claudish command`;
          break;
        }
      }
    }
    if (!found) {
      detail = `No claudish command containing "${keyword}" in --model`;
    }
    results.push({
      check: "bash_claudish_model_contains",
      passed: found,
      detail,
    });
  }

  // Check: bash_claudish_has_stdin
  if (checks["bash_claudish_has_stdin"]) {
    const anyHaveStdin = claudishCalls.some((bc) =>
      ((bc.input["command"] as string) ?? "").includes("--stdin")
    );
    results.push({
      check: "bash_claudish_has_stdin",
      passed: anyHaveStdin,
      detail: anyHaveStdin
        ? `At least one claudish call has --stdin (${claudishCalls.length} total)`
        : claudishCalls.length > 0
          ? "Missing --stdin in all claudish calls"
          : "No claudish calls found",
    });
  }

  // Check: bash_claudish_has_output_redirect
  if (checks["bash_claudish_has_output_redirect"]) {
    const anyHaveRedirect = claudishCalls.some((bc) => {
      const cmd = (bc.input["command"] as string) ?? "";
      return /[^2]>\s*\S+\.md/.test(cmd) || /^>\s*\S+\.md/.test(cmd);
    });
    results.push({
      check: "bash_claudish_has_output_redirect",
      passed: anyHaveRedirect,
      detail: anyHaveRedirect
        ? "At least one claudish call redirects output to .md"
        : claudishCalls.length > 0
          ? "Missing output redirect in all claudish calls"
          : "No claudish calls found",
    });
  }

  // Check: bash_claudish_captures_exit
  if (checks["bash_claudish_captures_exit"]) {
    const anyCaptureExit = claudishCalls.some((bc) => {
      const cmd = (bc.input["command"] as string) ?? "";
      return /echo\s+\$\?\s*>\s*\S+\.exit/.test(cmd);
    });
    results.push({
      check: "bash_claudish_captures_exit",
      passed: anyCaptureExit,
      detail: anyCaptureExit
        ? "At least one claudish call captures exit code"
        : claudishCalls.length > 0
          ? "Missing exit code capture (echo $? > .exit)"
          : "No claudish calls found",
    });
  }

  // Check: bash_run_in_background
  if (checks["bash_run_in_background"]) {
    const anyBg = claudishCalls.some((bc) => bc.input["run_in_background"] === true);
    results.push({
      check: "bash_run_in_background",
      passed: anyBg,
      detail: anyBg
        ? `At least one claudish Bash call uses run_in_background (${claudishCalls.length} total)`
        : claudishCalls.length > 0
          ? "No claudish Bash calls have run_in_background=true"
          : "No claudish calls found",
    });
  }

  // ---- Provider prefix checks ----
  // These checks inspect both Bash --model values and MCP create_session model params.

  // Check: no_provider_prefix_in_model
  if (checks["no_provider_prefix_in_model"]) {
    const forbiddenSlashPrefixes = [
      "minimax/", "openai/", "google/", "x-ai/", "z-ai/",
      "moonshotai/", "deepseek/", "anthropic/", "meta-llama/",
      "mistralai/", "qwen/",
    ];
    const forbiddenShortcutPrefixes = [
      "mm@", "mmax@", "oai@", "openai@", "g@", "gemini@", "google@",
      "kimi@", "moon@", "glm@", "zhipu@", "or@", "openrouter@",
      "litellm@", "ollama@", "lmstudio@", "vllm@", "mlx@",
    ];
    const violations: string[] = [];

    // Check Bash --model values
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      const modelMatch = cmd.match(/--model\s+(\S+)/);
      if (modelMatch) {
        const modelId = modelMatch[1];
        const slashViolation = forbiddenSlashPrefixes.find((p) => modelId.startsWith(p));
        if (slashViolation) {
          violations.push(`${modelId} (bash: slash prefix "${slashViolation}")`);
        } else {
          const shortcutViolation = forbiddenShortcutPrefixes.find((p) => modelId.startsWith(p));
          if (shortcutViolation) {
            violations.push(`${modelId} (bash: shortcut prefix "${shortcutViolation}")`);
          }
        }
      }
    }

    // Check MCP create_session model params
    for (const modelId of extractMcpCreateSessionModels(mcpCalls)) {
      const slashViolation = forbiddenSlashPrefixes.find((p) => modelId.startsWith(p));
      if (slashViolation) {
        violations.push(`${modelId} (mcp: slash prefix "${slashViolation}")`);
      } else {
        const shortcutViolation = forbiddenShortcutPrefixes.find((p) => modelId.startsWith(p));
        if (shortcutViolation) {
          violations.push(`${modelId} (mcp: shortcut prefix "${shortcutViolation}")`);
        }
      }
    }

    const passed = violations.length === 0;
    results.push({
      check: "no_provider_prefix_in_model",
      passed,
      detail: passed
        ? "No provider prefixes (slash or shortcut) in model values"
        : `Provider prefixes found: ${JSON.stringify(violations)}`,
    });
  }

  // Check: no_shortcut_prefix_in_model (focused check for shortcut-style only)
  if (checks["no_shortcut_prefix_in_model"]) {
    const forbiddenShortcuts = [
      "mm@", "mmax@", "oai@", "openai@", "g@", "gemini@", "google@",
      "kimi@", "moon@", "glm@", "zhipu@", "or@", "openrouter@",
      "litellm@", "ollama@", "lmstudio@", "vllm@", "mlx@",
    ];
    const violations: string[] = [];

    // Check Bash --model values
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      const modelMatch = cmd.match(/--model\s+(\S+)/);
      if (modelMatch) {
        const modelId = modelMatch[1];
        const violation = forbiddenShortcuts.find((p) => modelId.startsWith(p));
        if (violation) {
          violations.push(`${modelId} (bash: shortcut prefix "${violation}")`);
        }
      }
    }

    // Check MCP create_session model params
    for (const modelId of extractMcpCreateSessionModels(mcpCalls)) {
      const violation = forbiddenShortcuts.find((p) => modelId.startsWith(p));
      if (violation) {
        violations.push(`${modelId} (mcp: shortcut prefix "${violation}")`);
      }
    }

    const passed = violations.length === 0;
    results.push({
      check: "no_shortcut_prefix_in_model",
      passed,
      detail: passed
        ? "No shortcut prefixes (mm@, g@, oai@, etc.) in model values"
        : `Shortcut prefixes found: ${JSON.stringify(violations)}`,
    });
  }

  // ---- Preferences file read check ----

  // Check: reads_preferences_file
  if (checks["reads_preferences_file"]) {
    const found = readCalls.some((rc) => {
      const filePath = (rc.input["file_path"] as string) ?? "";
      return filePath.includes("multimodel-team.json");
    });
    results.push({
      check: "reads_preferences_file",
      passed: found,
      detail: found
        ? "multimodel-team.json read via Read tool"
        : "Preferences file not read (multimodel-team.json)",
    });
  }

  // ---- Flag passthrough checks (claudish v5.3.0+) ----

  // Check: bash_claudish_has_passthrough_flags
  if ("bash_claudish_has_passthrough_flags" in checks) {
    const expectedFlag = checks["bash_claudish_has_passthrough_flags"] as string;
    let found = false;
    let detail = "";
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      if (cmd.includes(expectedFlag)) {
        found = true;
        detail = `Found passthrough flag "${expectedFlag}" in claudish command`;
        break;
      }
    }
    if (!found) {
      detail = `Passthrough flag "${expectedFlag}" not found in any claudish command`;
    }
    results.push({
      check: "bash_claudish_has_passthrough_flags",
      passed: found,
      detail,
    });
  }

  // Check: bash_claudish_no_passthrough_flags (regression check — no flags when none configured)
  if (checks["bash_claudish_no_passthrough_flags"]) {
    const knownPassthroughFlags = [
      "--effort", "--permission-mode", "--max-budget-usd",
      "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools",
      "--system-prompt", "--append-system-prompt", "--agent",
    ];
    const violations: string[] = [];
    for (const bc of claudishCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      for (const flag of knownPassthroughFlags) {
        if (cmd.includes(flag)) {
          violations.push(flag);
        }
      }
    }
    const passed = violations.length === 0;
    results.push({
      check: "bash_claudish_no_passthrough_flags",
      passed,
      detail: passed
        ? "No passthrough flags in claudish commands (correct for no claudeFlags config)"
        : `Unexpected passthrough flags found: ${JSON.stringify(violations)}`,
    });
  }

  // ---- Negative checks (PROXY_MODE completely gone) ----

  // Check: no_proxy_mode_in_tasks
  if (checks["no_proxy_mode_in_tasks"]) {
    const hasProxy = taskCalls.some((tc) => {
      const prompt = (tc.input["prompt"] as string) ?? "";
      return prompt.includes("PROXY_MODE");
    });
    results.push({
      check: "no_proxy_mode_in_tasks",
      passed: !hasProxy,
      detail: !hasProxy
        ? "No PROXY_MODE in any Task prompts"
        : "Found PROXY_MODE in Task prompt (should be removed)",
    });
  }

  // Check: no_proxy_mode_in_bash
  if (checks["no_proxy_mode_in_bash"]) {
    const hasProxy = bashCalls.some((bc) => {
      const cmd = (bc.input["command"] as string) ?? "";
      return cmd.includes("PROXY_MODE");
    });
    results.push({
      check: "no_proxy_mode_in_bash",
      passed: !hasProxy,
      detail: !hasProxy
        ? "No PROXY_MODE in any Bash commands"
        : "Found PROXY_MODE in Bash command (should be removed)",
    });
  }

  // ---- Mixed model checks ----

  // Check: internal_uses_task
  if (checks["internal_uses_task"]) {
    const hasTask = taskCalls.length > 0 || agentCalls.length > 0;
    results.push({
      check: "internal_uses_task",
      passed: hasTask,
      detail: hasTask
        ? `${taskCalls.length + agentCalls.length} Task/Agent calls found (${taskCalls.length} Task + ${agentCalls.length} Agent, for internal model)`
        : "No Task or Agent calls found (internal model should use Task or Agent)",
    });
  }

  // Check: external_uses_bash
  if (checks["external_uses_bash"]) {
    const hasClaudish = claudishCalls.length > 0;
    results.push({
      check: "external_uses_bash",
      passed: hasClaudish,
      detail: hasClaudish
        ? `${claudishCalls.length} Bash claudish calls found (for external models)`
        : "No Bash claudish calls found (external models should use Bash+claudish)",
    });
  }

  // ---- Verification checks ----

  // Check: vote_prompt_file_written
  if (checks["vote_prompt_file_written"]) {
    const found = writeCalls.some((wc) => {
      const filePath = (wc.input["file_path"] as string) ?? "";
      return filePath.includes("vote-prompt") || filePath.includes("vote_prompt");
    });
    results.push({
      check: "vote_prompt_file_written",
      passed: found,
      detail: found
        ? "vote-prompt file written via Write tool"
        : "No Write call for vote-prompt file found",
    });
  }

  // Check: has_post_verification_reads
  if (checks["has_post_verification_reads"]) {
    let lastModelOrder = 0;
    for (const tc of taskCalls) {
      lastModelOrder = Math.max(lastModelOrder, tc.order);
    }
    for (const bc of claudishCalls) {
      lastModelOrder = Math.max(lastModelOrder, bc.order);
    }

    const postReads: string[] = [];
    for (const rc of readCalls) {
      if (rc.order > lastModelOrder) {
        const filePath = (rc.input["file_path"] as string) ?? "";
        if (
          filePath.includes(".exit") ||
          filePath.includes("result") ||
          filePath.includes("stderr")
        ) {
          postReads.push(filePath);
        }
      }
    }

    const passed = postReads.length > 0;
    results.push({
      check: "has_post_verification_reads",
      passed,
      detail: passed
        ? `${postReads.length} verification reads after model calls`
        : "No verification reads (.exit/.result files) found after model calls",
    });
  }

  // ---- Skill loading checks ----

  // Check: loads_claudish_skill
  if (checks["loads_claudish_skill"]) {
    let claudishSkillLoaded = false;
    let claudishSkillOrder = Infinity;

    for (const sc of skillCalls) {
      const skillName = (sc.input["skill"] as string) ?? "";
      if (skillName.toLowerCase().includes("claudish")) {
        claudishSkillLoaded = true;
        claudishSkillOrder = sc.order;
        break;
      }
    }

    if (claudishSkillLoaded && claudishCalls.length > 0) {
      const firstClaudishOrder = Math.min(...claudishCalls.map((bc) => bc.order));
      const loadedBefore = claudishSkillOrder < firstClaudishOrder;
      results.push({
        check: "loads_claudish_skill",
        passed: loadedBefore,
        detail: loadedBefore
          ? `claudish-usage skill loaded (order ${claudishSkillOrder}) before first claudish command (order ${firstClaudishOrder})`
          : `claudish-usage skill loaded AFTER first claudish command (skill: ${claudishSkillOrder}, claudish: ${firstClaudishOrder})`,
      });
    } else if (claudishSkillLoaded) {
      results.push({
        check: "loads_claudish_skill",
        passed: true,
        detail: "claudish-usage skill loaded (no claudish commands found to verify ordering)",
      });
    } else {
      results.push({
        check: "loads_claudish_skill",
        passed: false,
        detail: "claudish-usage skill was NOT loaded via Skill tool",
      });
    }
  }

  // ---- Session checks (retained for /team; not used by delegate v2.0.0+) ----

  // Check: session_dir_pattern
  if ("session_dir_pattern" in checks) {
    const pattern = checks["session_dir_pattern"] as string;
    const found = bashCalls.some((bc) => {
      const cmd = (bc.input["command"] as string) ?? "";
      return cmd.includes("mkdir") && cmd.includes(pattern);
    });
    results.push({
      check: "session_dir_pattern",
      passed: found,
      detail: found
        ? `Session dir with "${pattern}" found in mkdir`
        : `No mkdir with "${pattern}" found in Bash calls`,
    });
  }

  // Check: no_tmp_dir
  if (checks["no_tmp_dir"]) {
    let hasTmp = bashCalls.some((bc) => {
      const cmd = (bc.input["command"] as string) ?? "";
      return cmd.includes("mkdir") && cmd.includes("/tmp/");
    });
    if (!hasTmp) {
      hasTmp = taskCalls.some((tc) => {
        const prompt = (tc.input["prompt"] as string) ?? "";
        return prompt.includes("/tmp/");
      });
    }
    results.push({
      check: "no_tmp_dir",
      passed: !hasTmp,
      detail: !hasTmp
        ? "No /tmp/ paths found"
        : "Found /tmp/ path in Bash mkdir or Task prompt",
    });
  }

  // ---- Model discovery checks ----

  // Check: no_top_models_discovery
  // Checks both Bash claudish discovery flags and MCP list_models calls.
  if (checks["no_top_models_discovery"]) {
    const violations: string[] = [];

    // Check Bash claudish discovery flags
    const discoveryPattern = /claudish\s+.*--(top-models|free|list-models)/;
    for (const bc of bashCalls) {
      const cmd = (bc.input["command"] as string) ?? "";
      if (discoveryPattern.test(cmd)) {
        const match = cmd.match(discoveryPattern);
        violations.push(`bash: "--${match?.[1]}" in: ${cmd.slice(0, 100)}`);
      }
    }

    // Check MCP list_models calls
    const listModelsCalls = getMcpCallsBySuffix(mcpCalls, "list_models");
    for (const mc of listModelsCalls) {
      violations.push(`mcp: ${mc.tool} called`);
    }

    const passed = violations.length === 0;
    results.push({
      check: "no_top_models_discovery",
      passed,
      detail: passed
        ? "No model discovery commands (claudish --top-models/--free/--list-models or MCP list_models) found"
        : `Model discovery commands found: ${JSON.stringify(violations)}`,
    });
  }

  // Check: bash_claudish_model_exact
  if ("bash_claudish_model_exact" in checks) {
    const expectedModel = checks["bash_claudish_model_exact"] as string;
    const allModelValues = extractModelValues(claudishCalls);
    const found = allModelValues.some((m) => m === expectedModel);
    results.push({
      check: "bash_claudish_model_exact",
      passed: found,
      detail: found
        ? `Exact model "${expectedModel}" found in --model flag`
        : allModelValues.length > 0
          ? `Expected exact model "${expectedModel}" not found. Actual models: ${JSON.stringify(allModelValues)}`
          : `Expected exact model "${expectedModel}" not found. No claudish --model calls found.`,
    });
  }

  // Check: bash_claudish_all_models_in
  if ("bash_claudish_all_models_in" in checks) {
    const allowedModels = checks["bash_claudish_all_models_in"] as string[];
    const allowedSet = new Set(allowedModels);
    const allModelValues = extractModelValues(claudishCalls);
    const violations = allModelValues.filter((m) => !allowedSet.has(m));
    if (allModelValues.length === 0) {
      results.push({
        check: "bash_claudish_all_models_in",
        passed: false,
        detail: `No claudish --model calls found (expected: ${JSON.stringify(allowedModels)})`,
      });
    } else if (violations.length > 0) {
      results.push({
        check: "bash_claudish_all_models_in",
        passed: false,
        detail: `Models not in allowed set: ${JSON.stringify(violations)} (allowed: ${JSON.stringify(allowedModels)})`,
      });
    } else {
      results.push({
        check: "bash_claudish_all_models_in",
        passed: true,
        detail: `All ${allModelValues.length} --model values are from expected set: ${JSON.stringify(allowedModels)}`,
      });
    }
  }

  return results;
}

async function main() {
  if (process.argv.length < 4) {
    console.error("Usage: bun autotest/delegate/analyze-transcript.ts <transcript.jsonl> <checks_json>");
    process.exit(1);
  }

  const transcriptPath = process.argv[2];
  const checks: ChecksConfig = JSON.parse(process.argv[3]);

  const data = await parseTranscript(transcriptPath);
  const results = runChecks(checks, data);
  const allPassed = results.every((r) => r.passed);

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
      claudish_calls: getClaudishBashCalls(data.bashCalls).length,
      mcp_calls: data.mcpCalls.length,
      mcp_create_session_calls: getMcpCallsBySuffix(data.mcpCalls, "create_session").length,
      mcp_send_input_calls: getMcpCallsBySuffix(data.mcpCalls, "send_input").length,
      mcp_get_output_calls: getMcpCallsBySuffix(data.mcpCalls, "get_output").length,
      write_calls: data.writeCalls.length,
      read_calls: data.readCalls.length,
      skill_calls: data.skillCalls.length,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(allPassed ? 0 : 1);
}

main();
