#!/usr/bin/env bun
/**
 * Analyze a model-aliases system JSONL transcript for correct alias resolution behavior.
 *
 * Usage: bun autotest/model-aliases/analyze-transcript.ts <transcript.jsonl> <checks_json>
 *
 * v2.0.0: Added exact-match and stale-detection checks. runChecks is now async (reads
 *   shared/model-aliases.json at check time for exact ID verification).
 *   New checks:
 *   - mcp_team_models_exact_from_file: team MCP call used exact model ID from shortAliases
 *   - mcp_create_session_model_exact_from_file: create_session used exact model ID from shortAliases
 *   - response_mentions_available_aliases: assistant listed ≥2 known aliases (unknown-alias handling)
 *   - no_invented_model_id: no MCP model values outside knownModels / shortAliases
 *   - model_not_stale: resolved model is not one of the known stale IDs
 *   - reads_model_aliases_file_or_prefs: Read used on model-aliases.json OR multimodel-team.json
 *
 * v1.0.0: Initial analyzer for model-aliases test suite. Covers:
 *   - reads_model_aliases_file: Read tool targets shared/model-aliases.json
 *   - no_hardcoded_alias_resolution: No literal alias→ID tables in assistant messages
 *   - no_training_data_models: Resolved model IDs not hallucinated from training data
 *   - bash_contains_curl: Any Bash call contains "curl"
 *   - bash_curl_url_contains: Bash curl command contains a URL substring
 *   - writes_model_aliases_file: Write tool targets model-aliases.json
 *   - mentions_update_models: Any assistant message mentions "/update-models"
 *   - no_hardcoded_team_defaults: No literal hardcoded default model lists in task prompts
 *   - response_mentions_aliases_file: Any assistant message mentions "model-aliases.json"
 *   - mcp_tool_called: At least one MCP tool call matching the given suffix
 *   - mcp_team_models_contain: The MCP team tool models param contains a substring
 *   - mcp_create_session_model_contains: The create_session model param contains a substring
 *   - no_provider_prefix_in_model: No provider/ or shortcut@ prefix in model values
 *
 * Checks JSON format:
 * {
 *   // Model aliases file checks
 *   "reads_model_aliases_file": true,          // Read tool used on shared/model-aliases.json
 *   "reads_model_aliases_file_or_prefs": true, // Read on model-aliases.json OR multimodel-team.json
 *   "no_hardcoded_alias_resolution": true,     // No literal alias→ID table in assistant messages
 *   "no_training_data_models": true,           // No hallucinated model IDs from training data
 *   "writes_model_aliases_file": true,         // Write tool used on model-aliases.json
 *   "mentions_update_models": true,            // Assistant message mentions "/update-models"
 *   "no_hardcoded_team_defaults": true,        // No hardcoded default model lists in task prompts
 *   "response_mentions_aliases_file": true,    // Assistant message mentions "model-aliases.json"
 *   "response_mentions_available_aliases": true, // Assistant listed ≥2 known aliases
 *   "no_invented_model_id": true,              // No MCP model values outside knownModels/shortAliases
 *
 *   // Exact-match checks (reads shared/model-aliases.json at check time)
 *   "mcp_team_models_exact_from_file": { "alias": "grok", "file_key": "shortAliases" },
 *   "mcp_create_session_model_exact_from_file": { "alias": "gemini", "file_key": "shortAliases" },
 *   "model_not_stale": { "alias": "grok", "stale_values": ["grok-code-fast-1", "grok-3-mini"] },
 *
 *   // Bash checks
 *   "bash_contains_curl": true,                // At least one Bash call contains "curl"
 *   "bash_curl_url_contains": "queryPlugin",   // Bash curl command contains this URL substring
 *
 *   // MCP channel tool checks (shared with team/delegate)
 *   "mcp_tool_called": "team",                 // At least one MCP tool call matching this suffix
 *   "mcp_team_models_contain": "grok",         // team MCP call models param contains keyword
 *   "mcp_create_session_model_contains": "gemini", // create_session model param contains keyword
 *   "no_provider_prefix_in_model": true,       // No provider/ or shortcut@ prefix in model values
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

interface AssistantMessage {
  text: string;
  order: number;
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
  assistantMessages: AssistantMessage[];
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
  const assistantMessages: AssistantMessage[] = [];

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
      // Collect text blocks for content checks
      if (block["type"] === "text") {
        const text = (block["text"] as string) ?? "";
        if (text) {
          assistantMessages.push({ text, order: toolCalls.length });
        }
        continue;
      }

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

  return {
    toolCalls,
    taskCalls,
    agentCalls,
    bashCalls,
    writeCalls,
    readCalls,
    skillCalls,
    mcpCalls,
    assistantMessages,
  };
}

/**
 * Return MCP calls whose tool name ends with the given suffix (case-insensitive).
 * For example, getMcpCallsBySuffix(mcpCalls, "create_session") matches
 * mcp__plugin_dev_claudish__create_session.
 */
function getMcpCallsBySuffix(mcpCalls: ToolCall[], suffix: string): ToolCall[] {
  const lower = suffix.toLowerCase();
  return mcpCalls.filter(
    (mc) =>
      mc.tool.toLowerCase().endsWith(`__${lower}`) ||
      mc.tool.toLowerCase() === lower
  );
}

/**
 * Extract model values from MCP create_session calls.
 */
function extractMcpCreateSessionModels(mcpCalls: ToolCall[]): string[] {
  const createSessionCalls = getMcpCallsBySuffix(mcpCalls, "create_session");
  const models: string[] = [];
  for (const mc of createSessionCalls) {
    const model = mc.input["model"] as string | undefined;
    if (model) models.push(model);
  }
  return models;
}

/**
 * Extract model values from MCP team calls.
 * The team MCP tool accepts a "models" parameter (string or array).
 */
function extractMcpTeamModels(mcpCalls: ToolCall[]): string[] {
  const teamCalls = getMcpCallsBySuffix(mcpCalls, "team");
  const models: string[] = [];
  for (const mc of teamCalls) {
    const modelsParam = mc.input["models"];
    if (typeof modelsParam === "string") {
      // Comma-separated or single model ID
      models.push(...modelsParam.split(",").map((m) => m.trim()).filter(Boolean));
    } else if (Array.isArray(modelsParam)) {
      for (const m of modelsParam) {
        if (typeof m === "string") models.push(m.trim());
      }
    }
  }
  return models;
}

async function runChecks(
  checks: ChecksConfig,
  { toolCalls, taskCalls, agentCalls, bashCalls, writeCalls, readCalls, skillCalls, mcpCalls, assistantMessages }: TranscriptData
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ---- Model aliases file checks ----

  // Check: reads_model_aliases_file
  // PASS if any Read tool call targets a path containing "model-aliases.json"
  if (checks["reads_model_aliases_file"]) {
    const found = readCalls.some((rc) => {
      const filePath = (rc.input["file_path"] as string) ?? "";
      return filePath.includes("model-aliases.json");
    });
    results.push({
      check: "reads_model_aliases_file",
      passed: found,
      detail: found
        ? "model-aliases.json read via Read tool"
        : "model-aliases.json was not read — command should Read the aliases file before resolving models",
    });
  }

  // Check: no_hardcoded_alias_resolution
  // PASS if no evidence of hardcoded alias tables in assistant messages.
  // Looks for patterns like "grok → grok-code-fast-1" that indicate inline tables.
  if (checks["no_hardcoded_alias_resolution"]) {
    // Patterns that suggest a hardcoded alias table in assistant text:
    // - "grok → " or "grok -> " (arrow-style mapping)
    // - "grok: grok-code-fast-1" (colon mapping, very specific known IDs)
    const hardcodedPatterns = [
      /\bgrok\s*[→\->]+\s*grok-code/i,
      /\bgemini\s*[→\->]+\s*gemini-/i,
      /\bgpt-4\s*[→\->]+\s*gpt-/i,
      /\bdeepseek\s*[→\->]+\s*deepseek-/i,
    ];
    const violations: string[] = [];
    for (const msg of assistantMessages) {
      for (const pattern of hardcodedPatterns) {
        if (pattern.test(msg.text)) {
          violations.push(`assistant text matched pattern: ${pattern.source}`);
          break;
        }
      }
    }
    // Also check task prompts
    for (const tc of [...taskCalls, ...agentCalls]) {
      const prompt = (tc.input["prompt"] as string) ?? "";
      for (const pattern of hardcodedPatterns) {
        if (pattern.test(prompt)) {
          violations.push(`task prompt matched pattern: ${pattern.source}`);
          break;
        }
      }
    }
    const passed = violations.length === 0;
    results.push({
      check: "no_hardcoded_alias_resolution",
      passed,
      detail: passed
        ? "No hardcoded alias table patterns detected"
        : `Hardcoded alias resolution patterns found: ${JSON.stringify(violations)}`,
    });
  }

  // Check: no_training_data_models
  // PASS if the MCP tool calls don't contain model IDs that look hallucinated
  // (i.e., contain provider-style prefixes that wouldn't come from the aliases file).
  // This is a soft check — we look for known hallucination patterns.
  if (checks["no_training_data_models"]) {
    // Models that look like they came from training data rather than the aliases file:
    // - OpenRouter format: "x-ai/grok-2", "google/gemini-2.5-pro", "anthropic/claude-3.5"
    // - Full provider prefixes that wouldn't be in a clean aliases file
    const trainingDataPatterns = [
      /^x-ai\//i,
      /^google\//i,
      /^anthropic\//i,
      /^openai\//i,
      /^meta-llama\//i,
      /^mistralai\//i,
      /^deepseek\//i,
      /^qwen\//i,
    ];

    const allModelValues = [
      ...extractMcpTeamModels(mcpCalls),
      ...extractMcpCreateSessionModels(mcpCalls),
    ];

    const violations: string[] = [];
    for (const modelId of allModelValues) {
      for (const pattern of trainingDataPatterns) {
        if (pattern.test(modelId)) {
          violations.push(`${modelId} (matches training-data pattern ${pattern.source})`);
          break;
        }
      }
    }

    const passed = violations.length === 0;
    results.push({
      check: "no_training_data_models",
      passed,
      detail: passed
        ? allModelValues.length > 0
          ? `All ${allModelValues.length} model values appear clean (no training-data provider prefixes): ${JSON.stringify(allModelValues)}`
          : "No model values found in MCP calls (cannot verify)"
        : `Training-data-style model IDs found: ${JSON.stringify(violations)}`,
    });
  }

  // Check: writes_model_aliases_file
  // PASS if any Write tool call targets a path containing "model-aliases.json"
  if (checks["writes_model_aliases_file"]) {
    const found = writeCalls.some((wc) => {
      const filePath = (wc.input["file_path"] as string) ?? "";
      return filePath.includes("model-aliases.json");
    });
    results.push({
      check: "writes_model_aliases_file",
      passed: found,
      detail: found
        ? "model-aliases.json written via Write tool"
        : "model-aliases.json was not written — /update-models should write the fetched data to the file",
    });
  }

  // Check: mentions_update_models
  // PASS if any assistant text message mentions "/update-models"
  if (checks["mentions_update_models"]) {
    const found = assistantMessages.some((msg) =>
      msg.text.includes("/update-models")
    );
    results.push({
      check: "mentions_update_models",
      passed: found,
      detail: found
        ? "Assistant mentioned /update-models in response"
        : "Assistant did not mention /update-models — should direct user to run /update-models when aliases file is missing",
    });
  }

  // Check: no_hardcoded_team_defaults
  // PASS if there's no evidence of hardcoded default model lists in task prompts.
  // Looks for literal known model ID lists that match old hardcoded team default patterns.
  if (checks["no_hardcoded_team_defaults"]) {
    // Known patterns from old hardcoded defaults — if these exact strings appear in
    // a task prompt, the command is using hardcoded values rather than reading the file.
    const hardcodedDefaultPatterns = [
      /grok-code-fast-1.*gemini.*gpt/i,
      /gemini.*grok.*chatgpt/i,
      /"models":\s*\["grok/i,
    ];
    const violations: string[] = [];
    for (const tc of [...taskCalls, ...agentCalls]) {
      const prompt = (tc.input["prompt"] as string) ?? "";
      for (const pattern of hardcodedDefaultPatterns) {
        if (pattern.test(prompt)) {
          violations.push(`task prompt matched hardcoded defaults pattern: ${pattern.source}`);
          break;
        }
      }
    }
    const passed = violations.length === 0;
    results.push({
      check: "no_hardcoded_team_defaults",
      passed,
      detail: passed
        ? "No hardcoded team default model lists detected"
        : `Hardcoded team defaults found in task prompts: ${JSON.stringify(violations)}`,
    });
  }

  // Check: response_mentions_aliases_file
  // PASS if any assistant message mentions the aliases file (various phrasings)
  if (checks["response_mentions_aliases_file"]) {
    const patterns = [
      "model-aliases.json",
      "model aliases",
      "aliases file",
      "shortAliases",
      "shared/model-aliases",
    ];
    const found = assistantMessages.some((msg) =>
      patterns.some((p) => msg.text.toLowerCase().includes(p.toLowerCase()))
    );
    results.push({
      check: "response_mentions_aliases_file",
      passed: found,
      detail: found
        ? "Assistant referenced the model aliases system in response"
        : "Assistant did not reference model-aliases.json or model aliases — should reference the aliases file when listing available models",
    });
  }

  // ---- Bash checks ----

  // Check: bash_contains_curl
  // PASS if any Bash tool call contains "curl"
  if (checks["bash_contains_curl"]) {
    const found = bashCalls.some((bc) => {
      const cmd = (bc.input["command"] as string) ?? "";
      return cmd.includes("curl");
    });
    results.push({
      check: "bash_contains_curl",
      passed: found,
      detail: found
        ? "Bash call with curl found"
        : "No Bash calls containing curl — /update-models should use curl to fetch from the API",
    });
  }

  // Check: bash_curl_url_contains
  // PASS if any Bash curl command contains the specified URL substring
  if ("bash_curl_url_contains" in checks) {
    const urlSubstring = checks["bash_curl_url_contains"] as string;
    const curlCalls = bashCalls.filter((bc) => {
      const cmd = (bc.input["command"] as string) ?? "";
      return cmd.includes("curl");
    });
    const found = curlCalls.some((bc) => {
      const cmd = (bc.input["command"] as string) ?? "";
      return cmd.includes(urlSubstring);
    });
    results.push({
      check: "bash_curl_url_contains",
      passed: found,
      detail: found
        ? `Bash curl command containing "${urlSubstring}" found`
        : curlCalls.length > 0
          ? `Curl calls found but none contain "${urlSubstring}". Commands: ${curlCalls.map((bc) => (bc.input["command"] as string).slice(0, 100)).join("; ")}`
          : `No curl calls found (expected URL containing "${urlSubstring}")`,
    });
  }

  // ---- MCP channel tool checks (shared with team/delegate) ----

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

  // Check: mcp_team_models_contain
  // PASS if the team MCP tool models param contains the specified substring
  if ("mcp_team_models_contain" in checks) {
    const keyword = checks["mcp_team_models_contain"] as string;
    const allModels = extractMcpTeamModels(mcpCalls);
    const found = allModels.some((m) => m.toLowerCase().includes(keyword.toLowerCase()));
    results.push({
      check: "mcp_team_models_contain",
      passed: found,
      detail: found
        ? `team MCP call models param contains "${keyword}": ${JSON.stringify(allModels)}`
        : allModels.length > 0
          ? `team MCP call models found but none contain "${keyword}". Actual models: ${JSON.stringify(allModels)}`
          : `No team MCP calls with a models parameter found (expected to contain "${keyword}")`,
    });
  }

  // Check: mcp_create_session_model_contains
  // PASS if any create_session call has a model param containing the given keyword
  if ("mcp_create_session_model_contains" in checks) {
    const keyword = checks["mcp_create_session_model_contains"] as string;
    const allModels = extractMcpCreateSessionModels(mcpCalls);
    const found = allModels.some((m) => m.toLowerCase().includes(keyword.toLowerCase()));
    results.push({
      check: "mcp_create_session_model_contains",
      passed: found,
      detail: found
        ? `create_session called with model containing "${keyword}": ${JSON.stringify(allModels)}`
        : allModels.length > 0
          ? `create_session called but no model contains "${keyword}". Actual models: ${JSON.stringify(allModels)}`
          : `No create_session calls with a model parameter found (expected to contain "${keyword}")`,
    });
  }

  // ---- Exact-match and file-sourced checks (async — read shared/model-aliases.json) ----

  // Check: mcp_team_models_exact_from_file
  // PASS if the team MCP call models param contains the EXACT model ID that
  // shared/model-aliases.json maps the given alias to.
  if (checks["mcp_team_models_exact_from_file"]) {
    const config = checks["mcp_team_models_exact_from_file"] as { alias: string; file_key: string };
    let expectedModelId: string | null = null;
    let fileReadError: string | null = null;

    try {
      const aliasesPath = `${process.cwd()}/shared/model-aliases.json`;
      const aliasesData = JSON.parse(await Bun.file(aliasesPath).text());
      const section = aliasesData[config.file_key] as Record<string, string> | undefined;
      expectedModelId = section?.[config.alias] ?? null;
    } catch (e) {
      fileReadError = String(e);
    }

    if (fileReadError) {
      results.push({
        check: "mcp_team_models_exact_from_file",
        passed: false,
        detail: `Could not read shared/model-aliases.json: ${fileReadError}`,
      });
    } else if (!expectedModelId) {
      results.push({
        check: "mcp_team_models_exact_from_file",
        passed: false,
        detail: `Alias "${config.alias}" not found in ${config.file_key} section of model-aliases.json`,
      });
    } else {
      const allModels = extractMcpTeamModels(mcpCalls);
      const found = allModels.some((m) => m === expectedModelId);
      results.push({
        check: "mcp_team_models_exact_from_file",
        passed: found,
        detail: found
          ? `team MCP call used exact model "${expectedModelId}" (resolved from alias "${config.alias}")`
          : allModels.length > 0
            ? `team MCP call used ${JSON.stringify(allModels)} but expected "${expectedModelId}" (from alias "${config.alias}" in ${config.file_key})`
            : `No team MCP calls with models found — expected "${expectedModelId}" from alias "${config.alias}"`,
      });
    }
  }

  // Check: mcp_create_session_model_exact_from_file
  // Same pattern but for create_session.
  if (checks["mcp_create_session_model_exact_from_file"]) {
    const config = checks["mcp_create_session_model_exact_from_file"] as { alias: string; file_key: string };
    let expectedModelId: string | null = null;
    let fileReadError: string | null = null;

    try {
      const aliasesPath = `${process.cwd()}/shared/model-aliases.json`;
      const aliasesData = JSON.parse(await Bun.file(aliasesPath).text());
      const section = aliasesData[config.file_key] as Record<string, string> | undefined;
      expectedModelId = section?.[config.alias] ?? null;
    } catch (e) {
      fileReadError = String(e);
    }

    if (fileReadError) {
      results.push({
        check: "mcp_create_session_model_exact_from_file",
        passed: false,
        detail: `Could not read shared/model-aliases.json: ${fileReadError}`,
      });
    } else if (!expectedModelId) {
      results.push({
        check: "mcp_create_session_model_exact_from_file",
        passed: false,
        detail: `Alias "${config.alias}" not found in ${config.file_key} section of model-aliases.json`,
      });
    } else {
      const allModels = extractMcpCreateSessionModels(mcpCalls);
      const found = allModels.some((m) => m === expectedModelId);
      results.push({
        check: "mcp_create_session_model_exact_from_file",
        passed: found,
        detail: found
          ? `create_session used exact model "${expectedModelId}" (resolved from alias "${config.alias}")`
          : allModels.length > 0
            ? `create_session used ${JSON.stringify(allModels)} but expected "${expectedModelId}" (from alias "${config.alias}")`
            : `No create_session calls found — expected "${expectedModelId}" from alias "${config.alias}"`,
      });
    }
  }

  // Check: response_mentions_available_aliases
  // PASS if assistant text mentions at least 2 aliases from model-aliases.json
  // (indicating it listed available aliases rather than inventing one).
  if (checks["response_mentions_available_aliases"]) {
    let knownAliases: string[] = [];
    try {
      const aliasesPath = `${process.cwd()}/shared/model-aliases.json`;
      const aliasesData = JSON.parse(await Bun.file(aliasesPath).text());
      knownAliases = Object.keys(aliasesData.shortAliases ?? {});
    } catch {}

    const mentionCount = knownAliases.filter((alias) =>
      assistantMessages.some((msg) => msg.text.toLowerCase().includes(alias.toLowerCase()))
    ).length;

    const passed = mentionCount >= 2;
    results.push({
      check: "response_mentions_available_aliases",
      passed,
      detail: passed
        ? `Assistant mentioned ${mentionCount} known aliases in response (listing available options)`
        : `Assistant mentioned only ${mentionCount} known aliases — should list available aliases when requested model is unknown`,
    });
  }

  // Check: no_invented_model_id
  // PASS if no MCP tool call was made with a model ID that doesn't exist in knownModels or shortAliases.
  // If no MCP calls were made (model correctly refused to proceed), that is also a pass.
  if (checks["no_invented_model_id"]) {
    let knownIds = new Set<string>();
    try {
      const aliasesPath = `${process.cwd()}/shared/model-aliases.json`;
      const aliasesData = JSON.parse(await Bun.file(aliasesPath).text());
      for (const v of Object.values(aliasesData.shortAliases ?? {})) knownIds.add(v as string);
      for (const v of Object.keys(aliasesData.knownModels ?? {})) knownIds.add(v);
    } catch {}

    const allModelValues = [
      ...extractMcpTeamModels(mcpCalls),
      ...extractMcpCreateSessionModels(mcpCalls),
    ];

    if (allModelValues.length === 0) {
      results.push({
        check: "no_invented_model_id",
        passed: true,
        detail: "No MCP model calls made — model correctly avoided inventing a model ID",
      });
    } else {
      const invented = allModelValues.filter((m) => !knownIds.has(m));
      const passed = invented.length === 0;
      results.push({
        check: "no_invented_model_id",
        passed,
        detail: passed
          ? `All ${allModelValues.length} model IDs are in knownModels: ${JSON.stringify(allModelValues)}`
          : `Invented model IDs found (not in model-aliases.json): ${JSON.stringify(invented)}`,
      });
    }
  }

  // Check: model_not_stale
  // PASS if the resolved model ID for a given alias is NOT one of the known stale values.
  if (checks["model_not_stale"]) {
    const config = checks["model_not_stale"] as { alias: string; stale_values: string[] };
    const allModels = [
      ...extractMcpTeamModels(mcpCalls),
      ...extractMcpCreateSessionModels(mcpCalls),
    ];

    const staleFound = allModels.filter((m) => config.stale_values.includes(m));
    const passed = staleFound.length === 0;
    results.push({
      check: "model_not_stale",
      passed,
      detail: passed
        ? allModels.length > 0
          ? `Resolved models ${JSON.stringify(allModels)} are not stale (checked against: ${JSON.stringify(config.stale_values)})`
          : `No model calls found (cannot verify staleness)`
        : `STALE model detected! Alias "${config.alias}" resolved to ${JSON.stringify(staleFound)} which is a known outdated ID. Expected the current value from model-aliases.json.`,
    });
  }

  // Check: reads_model_aliases_file_or_prefs
  // PASS if Read tool was used on either model-aliases.json OR multimodel-team.json
  // (both are acceptable sources for model defaults).
  if (checks["reads_model_aliases_file_or_prefs"]) {
    const found = readCalls.some((rc) => {
      const filePath = (rc.input["file_path"] as string) ?? "";
      return filePath.includes("model-aliases.json") || filePath.includes("multimodel-team.json");
    });
    results.push({
      check: "reads_model_aliases_file_or_prefs",
      passed: found,
      detail: found
        ? "Read tool used on model-aliases.json or multimodel-team.json for defaults"
        : "Neither model-aliases.json nor multimodel-team.json was read — defaults should come from a file, not training data",
    });
  }

  // ---- MCP provider prefix check ----

  // Check: no_provider_prefix_in_model
  // PASS if no model values contain provider/ or shortcut@ prefixes
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

    const allModelValues = [
      ...extractMcpTeamModels(mcpCalls),
      ...extractMcpCreateSessionModels(mcpCalls),
    ];

    for (const modelId of allModelValues) {
      const slashViolation = forbiddenSlashPrefixes.find((p) => modelId.startsWith(p));
      if (slashViolation) {
        violations.push(`${modelId} (slash prefix "${slashViolation}")`);
      } else {
        const shortcutViolation = forbiddenShortcutPrefixes.find((p) => modelId.startsWith(p));
        if (shortcutViolation) {
          violations.push(`${modelId} (shortcut prefix "${shortcutViolation}")`);
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

  return results;
}

async function main() {
  if (process.argv.length < 4) {
    console.error("Usage: bun autotest/model-aliases/analyze-transcript.ts <transcript.jsonl> <checks_json>");
    process.exit(1);
  }

  const transcriptPath = process.argv[2];
  const checks: ChecksConfig = JSON.parse(process.argv[3]);

  const data = await parseTranscript(transcriptPath);
  const results = await runChecks(checks, data);
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
      mcp_calls: data.mcpCalls.length,
      mcp_team_calls: getMcpCallsBySuffix(data.mcpCalls, "team").length,
      mcp_create_session_calls: getMcpCallsBySuffix(data.mcpCalls, "create_session").length,
      write_calls: data.writeCalls.length,
      read_calls: data.readCalls.length,
      skill_calls: data.skillCalls.length,
      assistant_messages: data.assistantMessages.length,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(allPassed ? 0 : 1);
}

main();
