#!/usr/bin/env bun
/**
 * =============================================================================
 * UNIFIED HOOK HANDLER - TypeScript replacement for bash scripts (v1.0.0)
 * =============================================================================
 * Handles all Claude Code hook events for the code-analysis plugin.
 * Replaces: session-start.sh, intercept-*.sh, auto-reindex.sh
 *
 * Usage: bun handler.ts < stdin.json
 * Output: JSON to fd 3 (or stdout if fd 3 not available)
 * =============================================================================
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "fs";
import { join, extname } from "path";

// =============================================================================
// TYPES
// =============================================================================

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: "default" | "plan" | "bypasspermissions";
  hook_event_name: "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop";
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  tool_use_id?: string;
}

interface HookOutput {
  additionalContext?: string;
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
  };
}

// =============================================================================
// UTILITIES
// =============================================================================

function runCommand(cmd: string, args: string[], cwd?: string): string | null {
  try {
    const result = spawnSync(cmd, args, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    });
    if (result.status === 0) {
      return result.stdout?.trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}

function getClaudemimVersion(): string | null {
  const output = runCommand("claudemem", ["--version"]);
  if (!output) return null;
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function isIndexed(cwd: string): { indexed: boolean; symbolCount?: string } {
  const status = runCommand("claudemem", ["status"], cwd);
  if (!status) return { indexed: false };

  const match = status.match(/(\d+)\s+(chunks|symbols)/);
  if (match) {
    return { indexed: true, symbolCount: match[0] };
  }
  return { indexed: false };
}

function versionGte(version: string, required: string): boolean {
  const v1 = version.split(".").map(Number);
  const v2 = required.split(".").map(Number);

  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const a = v1[i] || 0;
    const b = v2[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

// =============================================================================
// SESSION START HANDLER
// =============================================================================

async function handleSessionStart(input: HookInput): Promise<HookOutput> {
  // Clean up old session directories (TTL: 24 hours)
  const tmpDir = "/tmp";
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  try {
    const entries = readdirSync(tmpDir);
    for (const entry of entries) {
      if (entry.startsWith("analysis-") || entry.startsWith("review-") || entry.startsWith("plan-review-")) {
        const fullPath = join(tmpDir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory() && stat.mtimeMs < oneDayAgo) {
            rmSync(fullPath, { recursive: true, force: true });
          }
        } catch {
          // Ignore errors on individual directories
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  // Check claudemem installation
  const version = getClaudemimVersion();
  if (!version) {
    return {
      additionalContext: `⚠️ **claudemem not installed**

The code-analysis plugin uses AST structural analysis. Install with:
\`\`\`bash
npm install -g claude-codemem
claudemem init       # Configure API key
claudemem index      # Build AST index
\`\`\`

Until indexed, Grep/Glob will work normally.`,
    };
  }

  // Check version requirements
  if (!versionGte(version, "0.3.0")) {
    return {
      additionalContext: `⚠️ **claudemem update required**

Current: v${version}
Required: v0.3.0+

Update with:
\`\`\`bash
npm install -g claude-codemem@latest
claudemem index  # Rebuild index for AST features
\`\`\``,
    };
  }

  // Check index status
  const status = isIndexed(input.cwd);

  // Build feature message
  const hasV4 = versionGte(version, "0.4.0");
  const featureMsg = hasV4
    ? `✅ **claudemem v${version}** (v0.4.0+ features available)

Available commands:
- **v0.3.0**: \`map\`, \`symbol\`, \`callers\`, \`callees\`, \`context\`, \`search\`
- **v0.4.0**: \`dead-code\`, \`test-gaps\`, \`impact\``
    : `💡 **claudemem v${version}** (v0.3.0)

Available commands: \`map\`, \`symbol\`, \`callers\`, \`callees\`, \`context\`, \`search\`

**Upgrade to v0.4.0+ for:** \`dead-code\`, \`test-gaps\`, \`impact\``;

  if (!status.indexed) {
    return {
      additionalContext: `${featureMsg}

⚠️ **Not indexed for this project**

Run \`claudemem index\` to enable AST analysis.`,
    };
  }

  return {
    additionalContext: `${featureMsg}

AST index: ${status.symbolCount}

Grep/rg/find intercepted and replaced with AST analysis.`,
  };
}

// =============================================================================
// GREP INTERCEPT HANDLER
// =============================================================================

async function handleGrepIntercept(input: HookInput): Promise<HookOutput | null> {
  const pattern = input.tool_input?.pattern as string;
  if (!pattern) return null;

  // Check if indexed
  const status = isIndexed(input.cwd);
  if (!status.indexed) {
    return {
      additionalContext: `⚠️ **claudemem not indexed** - Grep allowed as fallback.

For AST structural analysis, run:
\`\`\`bash
claudemem index
\`\`\``,
    };
  }

  // Determine best command based on pattern
  let results: string | null = null;
  let commandUsed = "map";

  // If pattern looks like a symbol name, try symbol lookup first
  if (/^[A-Z][a-zA-Z0-9]*$|^[a-z][a-zA-Z0-9]*$|^[a-z_]+$/.test(pattern)) {
    results = runCommand("claudemem", ["--nologo", "symbol", pattern, "--raw"], input.cwd);
    if (results && results !== "No results found") {
      commandUsed = "symbol";
    } else {
      results = null;
    }
  }

  // Fallback to map
  if (!results) {
    results = runCommand("claudemem", ["--nologo", "map", pattern, "--raw"], input.cwd) || "No results found";
    commandUsed = "map";
  }

  return {
    additionalContext: `🔍 **CLAUDEMEM AST ANALYSIS** (Grep intercepted)

**Query:** "${pattern}"
**Command:** claudemem --nologo ${commandUsed} "${pattern}" --raw

${results}

---
✅ AST structural analysis complete.

**v0.3.0 Commands:**
- \`claudemem --nologo symbol <name> --raw\` → Exact location
- \`claudemem --nologo callers <name> --raw\` → What calls this?
- \`claudemem --nologo callees <name> --raw\` → What does this call?
- \`claudemem --nologo context <name> --raw\` → Full call chain`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Grep replaced with claudemem AST analysis. Results provided in context above.",
    },
  };
}

// =============================================================================
// BASH INTERCEPT HANDLER
// =============================================================================

async function handleBashIntercept(input: HookInput): Promise<HookOutput | null> {
  const command = input.tool_input?.command as string;
  if (!command) return null;

  // Check if command contains grep/find/rg
  const searchPatterns = [
    /\bgrep\b/,
    /\brg\b/,
    /\bfind\s+.*-name\b/,
    /\bfind\s+.*-iname\b/,
    /\bag\b/,
    /\back\b/,
  ];

  const isSearchCommand = searchPatterns.some((p) => p.test(command));
  if (!isSearchCommand) return null;

  // Check if indexed
  const status = isIndexed(input.cwd);
  if (!status.indexed) {
    return {
      additionalContext: `⚠️ **Search command detected but claudemem not indexed**

Command: \`${command}\`

For AST structural analysis, run \`claudemem index\` first.
Allowing command as fallback.`,
    };
  }

  // Extract search pattern from command
  const grepMatch = command.match(/(?:grep|rg|ag|ack)\s+(?:-[^\s]+\s+)*['""]?([^'""\s|>]+)['""]?/);
  const findMatch = command.match(/-i?name\s+['""]?\*?([^'""\s*]+)/);
  const pattern = grepMatch?.[1] || findMatch?.[1];

  if (!pattern) {
    return {
      additionalContext: `⚠️ **Search command detected** - Consider using claudemem instead:
\`\`\`bash
claudemem --nologo map "your query" --raw
\`\`\``,
    };
  }

  // Run claudemem instead
  const results = runCommand("claudemem", ["--nologo", "map", pattern, "--raw"], input.cwd) || "No results found";

  return {
    additionalContext: `🔍 **CLAUDEMEM AST ANALYSIS** (Bash search intercepted)

**Original command:** \`${command}\`
**Pattern extracted:** "${pattern}"
**Replaced with:** claudemem --nologo map "${pattern}" --raw

${results}

---
✅ Use claudemem for structural analysis instead of grep/find.`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Bash search command replaced with claudemem. Pattern "${pattern}" analyzed with AST.`,
    },
  };
}

// =============================================================================
// GLOB INTERCEPT HANDLER
// =============================================================================

async function handleGlobIntercept(input: HookInput): Promise<HookOutput | null> {
  const pattern = input.tool_input?.pattern as string;
  if (!pattern) return null;

  // Check if indexed
  const status = isIndexed(input.cwd);
  if (!status.indexed) {
    return {
      additionalContext: `💡 **Glob used** - Consider claudemem for semantic search:
\`\`\`bash
claudemem index  # First time only
claudemem --nologo map "your query" --raw
\`\`\``,
    };
  }

  // For glob, we just add context - don't block
  return {
    additionalContext: `💡 **Tip:** For semantic code search, use claudemem:
\`\`\`bash
claudemem --nologo map "component" --raw   # Find by concept
claudemem --nologo symbol "Button" --raw   # Find by name
\`\`\``,
  };
}

// =============================================================================
// READ INTERCEPT HANDLER
// =============================================================================

async function handleReadIntercept(input: HookInput): Promise<HookOutput | null> {
  // Just track reads, don't block
  // Could be used for feedback tracking in future
  return null;
}

// =============================================================================
// AUTO-REINDEX HANDLER
// =============================================================================

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".rb", ".java", ".kt", ".scala", ".swift",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".vue", ".svelte",
]);

const DEBOUNCE_SECONDS = 30;

async function handleAutoReindex(input: HookInput): Promise<HookOutput | null> {
  const filePath = (input.tool_response?.filePath || input.tool_input?.file_path) as string;
  if (!filePath) return null;

  // Check if code file
  const ext = extname(filePath).toLowerCase();
  if (!CODE_EXTENSIONS.has(ext)) return null;

  // Check if project is indexed
  const indexDir = join(input.cwd, ".claudemem");
  if (!existsSync(indexDir)) return null;

  // Debounce check
  const debounceFile = join(indexDir, ".reindex-timestamp");
  const lockFile = join(indexDir, ".reindex-lock");

  if (existsSync(debounceFile)) {
    try {
      const lastReindex = parseInt(readFileSync(debounceFile, "utf-8"));
      const elapsed = Math.floor(Date.now() / 1000) - lastReindex;
      if (elapsed < DEBOUNCE_SECONDS) {
        return null; // Debounced
      }
    } catch {
      // Ignore read errors
    }
  }

  // Check lock file for running process
  if (existsSync(lockFile)) {
    try {
      const pid = parseInt(readFileSync(lockFile, "utf-8"));
      // Check if process is still running
      try {
        process.kill(pid, 0); // Throws if not running
        return null; // Still running
      } catch {
        // Process not running, remove stale lock
        rmSync(lockFile, { force: true });
      }
    } catch {
      // Ignore lock check errors
    }
  }

  // Update timestamp and spawn background reindex
  writeFileSync(debounceFile, Math.floor(Date.now() / 1000).toString());

  const child = spawn("claudemem", ["index", "--quiet"], {
    cwd: input.cwd,
    detached: true,
    stdio: "ignore",
  });

  // Write PID to lock file
  if (child.pid) {
    writeFileSync(lockFile, child.pid.toString());
  }

  child.unref();

  return null; // No context for background operation
}

// =============================================================================
// MAIN DISPATCHER
// =============================================================================

async function main() {
  // Read JSON from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const inputJson = Buffer.concat(chunks).toString("utf-8");
  if (!inputJson.trim()) {
    process.exit(0);
  }

  let input: HookInput;
  try {
    input = JSON.parse(inputJson);
  } catch (error) {
    console.error("Failed to parse hook input:", error);
    process.exit(2);
  }

  let output: HookOutput | null = null;

  try {
    switch (input.hook_event_name) {
      case "SessionStart":
        output = await handleSessionStart(input);
        break;

      case "PreToolUse":
        switch (input.tool_name) {
          case "Grep":
            output = await handleGrepIntercept(input);
            break;
          case "Bash":
            output = await handleBashIntercept(input);
            break;
          case "Glob":
            output = await handleGlobIntercept(input);
            break;
          case "Read":
            output = await handleReadIntercept(input);
            break;
        }
        break;

      case "PostToolUse":
        if (input.tool_name === "Write" || input.tool_name === "Edit") {
          output = await handleAutoReindex(input);
        }
        break;
    }
  } catch (error) {
    console.error("Hook handler error:", error);
    process.exit(2);
  }

  // Output result
  if (output) {
    // Try to write to fd 3 first (Claude Code's expected output)
    try {
      const fs = await import("fs");
      fs.writeFileSync(3, JSON.stringify(output));
    } catch {
      // Fall back to stdout
      console.log(JSON.stringify(output));
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Hook handler fatal error:", error);
  process.exit(2);
});
