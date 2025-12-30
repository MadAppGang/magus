# Claudemem Hook Command Implementation Guide

**Date:** 2025-12-29
**Target Version:** claudemem v0.9.0
**Purpose:** Add unified `hook` command to handle all Claude Code hook events

---

## Overview

This document provides detailed implementation instructions for adding a `hook` command to claudemem that handles all Claude Code hook events in TypeScript.

### Command Naming Convention

To avoid confusion, claudemem uses distinct command names:

| Command | Purpose | Example |
|---------|---------|---------|
| `claudemem hook` | Handle Claude Code hook events (stdin JSON) | `claudemem hook < input.json` |
| `claudemem githook` | Manage git pre-commit hooks | `claudemem githook install` |

**Important:** The git hooks command is named `githook` (not `hooks`) to prevent confusion with the `hook` command for Claude Code integration.

### Goals

1. **Single entry point** - `claudemem hook` handles all hook types
2. **Replace bash scripts** - Eliminate POSIX compatibility issues
3. **Native integration** - Leverage existing claudemem infrastructure
4. **Backward compatible** - Existing commands unchanged

---

## 1. Command Registration

### File: `src/commands/hook.ts`

```typescript
import { Command } from "commander";
import { handleHook } from "../hooks/dispatcher";

export function registerHookCommand(program: Command): void {
  program
    .command("hook")
    .description("Handle Claude Code hook events (reads JSON from stdin)")
    .option("--debug", "Enable debug logging")
    .action(async (options) => {
      try {
        await handleHook({ debug: options.debug });
        process.exit(0);
      } catch (error) {
        if (options.debug) {
          console.error("Hook error:", error);
        }
        process.exit(2); // Blocking error
      }
    });
}
```

### Update: `src/index.ts`

```typescript
import { registerHookCommand } from "./commands/hook";

// In the command registration section:
registerHookCommand(program);
```

---

## 2. Type Definitions

### File: `src/hooks/types.ts`

```typescript
/**
 * Hook input from Claude Code (received via stdin)
 */
export interface HookInput {
  /** Unique session identifier */
  session_id: string;

  /** Path to conversation transcript */
  transcript_path: string;

  /** Current working directory */
  cwd: string;

  /** Permission mode */
  permission_mode: "default" | "plan" | "bypasspermissions";

  /** Hook event type */
  hook_event_name: "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStop";

  /** Tool name (for PreToolUse/PostToolUse) */
  tool_name?: string;

  /** Tool input parameters */
  tool_input?: {
    // Grep
    pattern?: string;
    path?: string;

    // Bash
    command?: string;
    description?: string;

    // Write/Edit
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;

    // Read
    file_path?: string;
    offset?: number;
    limit?: number;

    // Generic
    [key: string]: unknown;
  };

  /** Tool response (for PostToolUse) */
  tool_response?: {
    filePath?: string;
    success?: boolean;
    [key: string]: unknown;
  };

  /** Tool use ID */
  tool_use_id?: string;
}

/**
 * Hook output to Claude Code (written to fd 3 or stdout)
 */
export interface HookOutput {
  /** Additional context to show Claude */
  additionalContext?: string;

  /** Tool-specific control (PreToolUse only) */
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
  };
}

/**
 * Handler function signature
 */
export type HookHandler = (input: HookInput) => Promise<HookOutput | null>;

/**
 * Handler options
 */
export interface HookOptions {
  debug?: boolean;
}
```

---

## 3. Main Dispatcher

### File: `src/hooks/dispatcher.ts`

```typescript
import { createReadStream } from "fs";
import { HookInput, HookOutput, HookOptions } from "./types";
import { handleSessionStart } from "./handlers/session-start";
import { handlePreToolUse } from "./handlers/pre-tool-use";
import { handlePostToolUse } from "./handlers/post-tool-use";

/**
 * Read JSON from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);

    // Handle case where stdin is empty/closed
    if (process.stdin.readableEnded) {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    }
  });
}

/**
 * Write output to fd 3 (Claude Code's expected output) or stdout
 */
function writeOutput(output: HookOutput): void {
  const json = JSON.stringify(output);

  try {
    // Try fd 3 first (Claude Code's hook output channel)
    const fs = require("fs");
    fs.writeFileSync(3, json);
  } catch {
    // Fall back to stdout
    console.log(json);
  }
}

/**
 * Main hook dispatcher
 */
export async function handleHook(options: HookOptions = {}): Promise<void> {
  const { debug = false } = options;

  // Read input
  const inputJson = await readStdin();
  if (!inputJson.trim()) {
    if (debug) console.error("Empty stdin");
    return;
  }

  // Parse input
  let input: HookInput;
  try {
    input = JSON.parse(inputJson);
  } catch (error) {
    throw new Error(`Failed to parse hook input: ${error}`);
  }

  if (debug) {
    console.error(`Hook: ${input.hook_event_name} ${input.tool_name || ""}`);
  }

  // Dispatch to handler
  let output: HookOutput | null = null;

  switch (input.hook_event_name) {
    case "SessionStart":
      output = await handleSessionStart(input);
      break;

    case "PreToolUse":
      output = await handlePreToolUse(input);
      break;

    case "PostToolUse":
      output = await handlePostToolUse(input);
      break;

    case "Stop":
    case "SubagentStop":
      // No action needed for these events currently
      break;

    default:
      if (debug) {
        console.error(`Unknown hook event: ${input.hook_event_name}`);
      }
  }

  // Write output if any
  if (output) {
    writeOutput(output);
  }
}
```

---

## 4. Session Start Handler

### File: `src/hooks/handlers/session-start.ts`

```typescript
import { existsSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { HookInput, HookOutput } from "../types";
import { getVersion, isIndexed, versionGte } from "../../utils/version";

/**
 * Clean up old session directories (TTL: 24 hours)
 */
function cleanupOldSessions(): number {
  const tmpDir = "/tmp";
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let cleaned = 0;

  try {
    const prefixes = ["analysis-", "review-", "plan-review-"];
    const entries = readdirSync(tmpDir);

    for (const entry of entries) {
      if (!prefixes.some((p) => entry.startsWith(p))) continue;

      const fullPath = join(tmpDir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory() && stat.mtimeMs < oneDayAgo) {
          rmSync(fullPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        // Ignore individual directory errors
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  return cleaned;
}

/**
 * Handle SessionStart hook event
 */
export async function handleSessionStart(input: HookInput): Promise<HookOutput> {
  // Clean up old sessions
  const cleaned = cleanupOldSessions();

  // Get claudemem version
  const version = getVersion();
  if (!version) {
    return {
      additionalContext: `⚠️ **claudemem not properly installed**

Reinstall with:
\`\`\`bash
npm install -g claude-codemem@latest
claudemem init
claudemem index
\`\`\``,
    };
  }

  // Check minimum version
  if (!versionGte(version, "0.3.0")) {
    return {
      additionalContext: `⚠️ **claudemem update required**

Current: v${version}
Required: v0.3.0+

Update with:
\`\`\`bash
npm install -g claude-codemem@latest
claudemem index
\`\`\``,
    };
  }

  // Build feature message based on version
  const hasV4 = versionGte(version, "0.4.0");
  const hasV8 = versionGte(version, "0.8.0");

  let featureMsg = `✅ **claudemem v${version}**\n\n`;

  if (hasV8) {
    featureMsg += `Available commands:
- **AST**: \`map\`, \`symbol\`, \`callers\`, \`callees\`, \`context\`, \`search\`
- **Analysis**: \`dead-code\`, \`test-gaps\`, \`impact\`
- **Learning**: \`feedback\` (search result feedback)`;
  } else if (hasV4) {
    featureMsg += `Available commands:
- **v0.3.0**: \`map\`, \`symbol\`, \`callers\`, \`callees\`, \`context\`, \`search\`
- **v0.4.0**: \`dead-code\`, \`test-gaps\`, \`impact\``;
  } else {
    featureMsg += `Available commands: \`map\`, \`symbol\`, \`callers\`, \`callees\`, \`context\`, \`search\`

Upgrade to v0.4.0+ for: \`dead-code\`, \`test-gaps\`, \`impact\``;
  }

  // Check index status
  const status = isIndexed(input.cwd);

  if (!status.indexed) {
    return {
      additionalContext: `${featureMsg}

⚠️ **Not indexed for this project**

Run \`claudemem index\` to enable AST analysis.`,
    };
  }

  // Build cleanup message
  const cleanupMsg = cleaned > 0 ? `\n\n🧹 Cleaned ${cleaned} old session directories` : "";

  return {
    additionalContext: `${featureMsg}

AST index: ${status.symbolCount}${cleanupMsg}

Grep/rg/find intercepted and replaced with AST analysis.`,
  };
}
```

---

## 5. PreToolUse Handler

### File: `src/hooks/handlers/pre-tool-use.ts`

```typescript
import { HookInput, HookOutput } from "../types";
import { isIndexed, runClaudemem } from "../../utils/claudemem";

/**
 * Handle PreToolUse hook events
 */
export async function handlePreToolUse(input: HookInput): Promise<HookOutput | null> {
  switch (input.tool_name) {
    case "Grep":
      return handleGrepIntercept(input);
    case "Bash":
      return handleBashIntercept(input);
    case "Glob":
      return handleGlobIntercept(input);
    case "Read":
      return handleReadIntercept(input);
    default:
      return null;
  }
}

/**
 * Intercept Grep tool - replace with AST analysis
 */
async function handleGrepIntercept(input: HookInput): Promise<HookOutput | null> {
  const pattern = input.tool_input?.pattern;
  if (!pattern) return null;

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
    results = runClaudemem(["--agent", "symbol", pattern], input.cwd);
    if (results && results !== "No results found") {
      commandUsed = "symbol";
    } else {
      results = null;
    }
  }

  // Fallback to map
  if (!results) {
    results = runClaudemem(["--agent", "map", pattern], input.cwd) || "No results found";
    commandUsed = "map";
  }

  return {
    additionalContext: `🔍 **CLAUDEMEM AST ANALYSIS** (Grep intercepted)

**Query:** "${pattern}"
**Command:** claudemem --agent ${commandUsed} "${pattern}"
${results}

---
✅ AST structural analysis complete.

**Commands:**
- \`claudemem --agent symbol <name>\` → Exact location
- \`claudemem --agent callers <name>\` → What calls this?
- \`claudemem --agent callees <name>\` → What does this call?
- \`claudemem --agent context <name>\` → Full call chain`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Grep replaced with claudemem AST analysis. Results provided in context.",
    },
  };
}

/**
 * Intercept Bash tool - detect grep/find commands
 */
async function handleBashIntercept(input: HookInput): Promise<HookOutput | null> {
  const command = input.tool_input?.command;
  if (!command) return null;

  // Patterns that indicate search commands
  const searchPatterns = [
    /\bgrep\s+(?:-[^\s]+\s+)*["']?([^"'\s|>]+)/,
    /\brg\s+(?:-[^\s]+\s+)*["']?([^"'\s|>]+)/,
    /\bag\s+(?:-[^\s]+\s+)*["']?([^"'\s|>]+)/,
    /\back\s+(?:-[^\s]+\s+)*["']?([^"'\s|>]+)/,
    /\bfind\s+.*-i?name\s+["']?\*?([^"'\s*]+)/,
  ];

  // Extract search pattern
  let extractedPattern: string | null = null;
  for (const regex of searchPatterns) {
    const match = command.match(regex);
    if (match) {
      extractedPattern = match[1];
      break;
    }
  }

  if (!extractedPattern) return null;

  const status = isIndexed(input.cwd);
  if (!status.indexed) {
    return {
      additionalContext: `⚠️ **Search command detected but claudemem not indexed**

Command: \`${command}\`

For AST structural analysis, run \`claudemem index\` first.
Allowing command as fallback.`,
    };
  }

  // Run claudemem instead
  const results = runClaudemem(["--agent", "map", extractedPattern], input.cwd) || "No results found";

  return {
    additionalContext: `🔍 **CLAUDEMEM AST ANALYSIS** (Bash search intercepted)

**Original command:** \`${command}\`
**Pattern extracted:** "${extractedPattern}"
**Replaced with:** claudemem --agent map "${extractedPattern}"
${results}

---
✅ Use claudemem for structural analysis instead of grep/find.`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Bash search replaced with claudemem. Pattern "${extractedPattern}" analyzed with AST.`,
    },
  };
}

/**
 * Intercept Glob tool - provide tips
 */
async function handleGlobIntercept(input: HookInput): Promise<HookOutput | null> {
  const status = isIndexed(input.cwd);

  if (!status.indexed) {
    return {
      additionalContext: `💡 **Glob used** - Consider claudemem for semantic search:
\`\`\`bash
claudemem index  # First time only
claudemem --agent map "your query"\`\`\``,
    };
  }

  // Don't block Glob, just add tips
  return {
    additionalContext: `💡 **Tip:** For semantic code search, use claudemem:
\`\`\`bash
claudemem --agent map "component"   # Find by concept
claudemem --agent symbol "Button"   # Find by name
\`\`\``,
  };
}

/**
 * Intercept Read tool - could track for feedback
 */
async function handleReadIntercept(input: HookInput): Promise<HookOutput | null> {
  // Currently no action - could track reads for feedback in future
  return null;
}
```

---

## 6. PostToolUse Handler

### File: `src/hooks/handlers/post-tool-use.ts`

```typescript
import { existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { spawn } from "child_process";
import { join, extname } from "path";
import { HookInput, HookOutput } from "../types";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".rb", ".java", ".kt", ".scala", ".swift",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".vue", ".svelte",
]);

const DEBOUNCE_SECONDS = 30;

/**
 * Handle PostToolUse hook events
 */
export async function handlePostToolUse(input: HookInput): Promise<HookOutput | null> {
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    return handleAutoReindex(input);
  }
  return null;
}

/**
 * Auto-reindex after file changes
 */
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

  // Update timestamp
  writeFileSync(debounceFile, Math.floor(Date.now() / 1000).toString());

  // Spawn background reindex
  const child = spawn(process.execPath, [process.argv[1], "index", "--quiet"], {
    cwd: input.cwd,
    detached: true,
    stdio: "ignore",
  });

  // Write PID to lock file
  if (child.pid) {
    writeFileSync(lockFile, child.pid.toString());

    // Clean up lock file when process exits
    child.on("exit", () => {
      try {
        rmSync(lockFile, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  }

  child.unref();

  return null; // No context for background operation
}
```

---

## 7. Utility Functions

### File: `src/utils/claudemem.ts`

```typescript
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Get claudemem version
 */
export function getVersion(): string | null {
  try {
    const result = spawnSync(process.execPath, [process.argv[1], "--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.status === 0) {
      const match = result.stdout?.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if project is indexed
 */
export function isIndexed(cwd: string): { indexed: boolean; symbolCount?: string } {
  const indexDir = join(cwd, ".claudemem");
  if (!existsSync(indexDir)) {
    return { indexed: false };
  }

  try {
    const result = spawnSync(process.execPath, [process.argv[1], "status"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });

    if (result.status === 0) {
      const match = result.stdout?.match(/(\d+)\s+(chunks|symbols)/);
      if (match) {
        return { indexed: true, symbolCount: match[0] };
      }
    }
    return { indexed: false };
  } catch {
    return { indexed: false };
  }
}

/**
 * Run claudemem command and return output
 */
export function runClaudemem(args: string[], cwd?: string): string | null {
  try {
    const result = spawnSync(process.execPath, [process.argv[1], ...args], {
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

/**
 * Compare semantic versions
 */
export function versionGte(version: string, required: string): boolean {
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
```

---

## 8. Directory Structure

```
claudemem/
├── src/
│   ├── commands/
│   │   ├── hook.ts              # Command registration
│   │   ├── index.ts             # Existing
│   │   └── ...
│   ├── hooks/
│   │   ├── types.ts             # Type definitions
│   │   ├── dispatcher.ts        # Main dispatcher
│   │   └── handlers/
│   │       ├── session-start.ts
│   │       ├── pre-tool-use.ts
│   │       └── post-tool-use.ts
│   ├── utils/
│   │   ├── claudemem.ts         # Claudemem utilities
│   │   └── ...
│   └── index.ts                 # Updated with hook command
├── package.json
└── ...
```

---

## 9. Testing

### File: `tests/hooks/dispatcher.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleHook } from "../../src/hooks/dispatcher";

describe("Hook Dispatcher", () => {
  describe("SessionStart", () => {
    it("should return version info when installed", async () => {
      const input = {
        hook_event_name: "SessionStart",
        cwd: "/tmp/test-project",
        session_id: "test-123",
      };

      // Mock stdin
      const originalStdin = process.stdin;
      // ... mock implementation
    });
  });

  describe("PreToolUse - Grep", () => {
    it("should intercept Grep and run claudemem", async () => {
      const input = {
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "handleHook" },
        cwd: "/tmp/indexed-project",
      };
      // ... test
    });

    it("should allow Grep when not indexed", async () => {
      const input = {
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "test" },
        cwd: "/tmp/not-indexed",
      };
      // ... test
    });
  });

  describe("PostToolUse - Auto Reindex", () => {
    it("should trigger reindex for TypeScript files", async () => {
      // ... test
    });

    it("should debounce rapid file changes", async () => {
      // ... test
    });

    it("should skip non-code files", async () => {
      // ... test
    });
  });
});
```

---

## 10. Plugin Configuration Update

After implementing, update the code-analysis plugin to use claudemem directly:

### File: `plugins/code-analysis/plugin.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "claudemem hook" }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Grep|Bash|Glob|Read",
        "hooks": [{ "type": "command", "command": "claudemem hook" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "claudemem hook" }]
      }
    ]
  }
}
```

---

## 11. Migration Checklist

### Phase 1: Implementation
- [ ] Create `src/hooks/types.ts`
- [ ] Create `src/hooks/dispatcher.ts`
- [ ] Create `src/hooks/handlers/session-start.ts`
- [ ] Create `src/hooks/handlers/pre-tool-use.ts`
- [ ] Create `src/hooks/handlers/post-tool-use.ts`
- [ ] Create `src/commands/hook.ts`
- [ ] Update `src/index.ts` to register hook command
- [ ] Add utility functions to `src/utils/claudemem.ts`

### Phase 2: Testing
- [ ] Unit tests for each handler
- [ ] Integration test with mock stdin
- [ ] Manual test with Claude Code

### Phase 3: Release
- [ ] Update version to 0.9.0
- [ ] Update CHANGELOG.md
- [ ] Publish to npm: `npm publish`

### Phase 4: Plugin Update
- [ ] Update `plugins/code-analysis/plugin.json` to use `claudemem hook`
- [ ] Remove old bash scripts (keep for fallback)
- [ ] Release code-analysis v3.0.0

---

## 12. Backward Compatibility

The `hook` command is additive - no existing commands change. Users who don't update their plugin configuration will continue using the bash scripts.

**Recommended migration:**
1. Release claudemem v0.9.0 with hook command
2. Update code-analysis plugin to use `claudemem hook`
3. Keep bash scripts as fallback for claudemem < 0.9.0
4. Remove bash scripts in future release

---

## 13. Error Handling

```typescript
// In dispatcher.ts
export async function handleHook(options: HookOptions = {}): Promise<void> {
  try {
    // ... normal flow
  } catch (error) {
    // Write to stderr (Claude sees this on exit code 2)
    console.error(`Hook error: ${error instanceof Error ? error.message : error}`);

    // Exit code 2 = blocking error
    // Exit code 0 = success
    // Other = non-blocking error (logged but doesn't block)
    throw error; // Will cause exit(2) in command handler
  }
}
```

---

## Summary

This implementation:
1. **Single command** - `claudemem hook` handles all events
2. **Type-safe** - Full TypeScript with interfaces
3. **Native** - Uses claudemem's existing infrastructure
4. **Tested** - Unit tests for each handler
5. **Compatible** - Additive change, no breaking changes

**Estimated effort:** 2-3 hours for implementation, 1-2 hours for testing.

---

**Maintained by:** MadAppGang
**Last Updated:** December 2025
