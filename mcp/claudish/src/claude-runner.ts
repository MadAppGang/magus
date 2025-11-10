import type { Subprocess } from "bun";
import type { ClaudishConfig } from "./types.js";

/**
 * Run Claude Code CLI with the proxy server
 */
export async function runClaudeWithProxy(
  config: ClaudishConfig,
  proxyUrl: string
): Promise<number> {
  // Build claude arguments
  const claudeArgs: string[] = [];

  // Interactive mode - no automatic arguments
  if (config.interactive) {
    // In interactive mode, add permission skip if enabled
    if (config.autoApprove) {
      claudeArgs.push("--dangerously-skip-permissions");
    }
    if (config.dangerous) {
      claudeArgs.push("--dangerouslyDisableSandbox");
    }
  } else {
    // Single-shot mode - add all arguments
    if (config.autoApprove) {
      claudeArgs.push("--dangerously-skip-permissions");
    }
    if (config.dangerous) {
      claudeArgs.push("--dangerouslyDisableSandbox");
    }
    // Add user-provided args (including prompt)
    claudeArgs.push(...config.claudeArgs);
  }

  // Get model display name
  const modelDisplay = getModelDisplayName(config.model || "unknown");

  // Environment variables for Claude Code
  const env = {
    ...process.env,
    // Point Claude Code to our local proxy
    ANTHROPIC_BASE_URL: proxyUrl,
    // Use a valid-looking key that won't trigger "custom key" detection
    // Real auth happens in proxy with OPENROUTER_API_KEY
    ANTHROPIC_API_KEY: "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    // Disable API key validation prompts
    CLAUDE_NO_API_KEY_PROMPT: "1",
    CLAUDE_SKIP_API_KEY_CHECK: "1",
    // Show model in status line
    CLAUDE_STATUS_SUFFIX: `via ${modelDisplay}`,
  };

  if (config.interactive) {
    console.log(`\n[claudish] Starting Claude Code in INTERACTIVE mode`);
    console.log(`[claudish] Model: ${config.model} (${modelDisplay})`);
    console.log(`[claudish] Proxy URL: ${proxyUrl}`);
    console.log(`[claudish] Status line will show: "via ${modelDisplay}"`);
    console.log(`[claudish] You can now interact with Claude Code directly`);
    console.log(`[claudish] Press Ctrl+C or type 'exit' to quit\n`);
  } else {
    console.log(`\n[claudish] Starting Claude Code with ${config.model} (${modelDisplay})`);
    console.log(`[claudish] Proxy URL: ${proxyUrl}`);
    console.log(`[claudish] Arguments: ${claudeArgs.join(" ")}\n`);
  }

  // Spawn claude CLI process
  const proc = Bun.spawn(["claude", ...claudeArgs], {
    env,
    stdout: "inherit", // Stream to parent stdout
    stderr: "inherit", // Stream to parent stderr
    stdin: "inherit", // Allow user input
  });

  // Handle process termination signals
  setupSignalHandlers(proc);

  // Wait for claude to exit
  const exitCode = await proc.exited;

  return exitCode;
}

/**
 * Setup signal handlers to gracefully shutdown
 */
function setupSignalHandlers(proc: Subprocess): void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

  for (const signal of signals) {
    process.on(signal, () => {
      console.log(`\n[claudish] Received ${signal}, shutting down...`);
      proc.kill();
      process.exit(0);
    });
  }
}

/**
 * Get display name for model (short version for status line)
 */
function getModelDisplayName(model: string): string {
  // Extract provider and model name
  const parts = model.split("/");
  if (parts.length === 2) {
    const [provider, modelName] = parts;

    // Shorten common providers
    const providerMap: Record<string, string> = {
      "x-ai": "xAI",
      "openai": "OpenAI",
      "anthropic": "Anthropic",
      "minimax": "MiniMax",
      "z-ai": "Zhipu",
      "qwen": "Qwen",
    };

    const shortProvider = providerMap[provider] || provider;

    // Shorten model names
    const shortModel = modelName
      .replace("grok-code-fast-", "Grok-")
      .replace("gpt-5-codex", "GPT-5")
      .replace("gpt-4", "GPT-4")
      .replace("minimax-m2", "M2")
      .replace("glm-4.6", "GLM-4.6")
      .replace("qwen3-vl-235b-a22b-instruct", "Qwen3-VL")
      .replace("claude-sonnet-4.5", "Sonnet-4.5");

    return `${shortProvider}/${shortModel}`;
  }

  return model;
}

/**
 * Check if Claude Code CLI is installed
 */
export async function checkClaudeInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "claude"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}
