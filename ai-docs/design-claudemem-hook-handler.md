# Design: Claudemem Hook Handler

**Date:** 2025-12-29
**Status:** Draft
**Purpose:** Replace bash hook scripts with unified TypeScript handler in claudemem

---

## Problem

Currently the code-analysis plugin has 6 separate bash scripts for hooks:
- `session-start.sh` - Check claudemem status
- `intercept-grep.sh` - Replace Grep with AST analysis
- `intercept-bash.sh` - Intercept grep/find commands
- `intercept-glob.sh` - Intercept file search
- `intercept-read.sh` - Track file reads
- `auto-reindex.sh` - Background reindex after edits

**Issues with bash:**
- POSIX compatibility (flock not on macOS, bash 3.2 vs 4.0)
- jq dependency for JSON parsing
- Harder to test and maintain
- No type safety
- Complex quoting/escaping

---

## Solution

Add a `claudemem hook` command that handles all hook events in TypeScript.

### Command Interface

```bash
# Reads JSON from stdin, dispatches to appropriate handler
claudemem hook
```

### Hook Input Structure (from Claude Code)

```typescript
interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: "default" | "plan" | "bypasspermissions";
  hook_event_name: "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop";

  // Only for PreToolUse/PostToolUse
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  tool_use_id?: string;
}
```

### Hook Output Structure

```typescript
interface HookOutput {
  // Add context to Claude's response
  additionalContext?: string;

  // For PreToolUse - control tool execution
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
  };
}
```

### Exit Codes

- `0` - Success (stdout JSON processed)
- `2` - Blocking error (stderr shown to Claude)
- Other - Non-blocking error (stderr logged)

---

## Handler Dispatch Logic

```typescript
async function handleHook(input: HookInput): Promise<HookOutput | null> {
  switch (input.hook_event_name) {
    case "SessionStart":
      return handleSessionStart(input);

    case "PreToolUse":
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
          return null; // Allow other tools
      }

    case "PostToolUse":
      if (input.tool_name === "Write" || input.tool_name === "Edit") {
        return handleAutoReindex(input);
      }
      return null;

    default:
      return null;
  }
}
```

---

## Handler Implementations

### SessionStart Handler

```typescript
async function handleSessionStart(input: HookInput): Promise<HookOutput> {
  // 1. Clean up old session directories (TTL: 24h)
  await cleanupOldSessions();

  // 2. Check claudemem installation and version
  const version = await getClaudemimVersion();
  if (!version) {
    return {
      additionalContext: "⚠️ **claudemem not installed**..."
    };
  }

  // 3. Check index status
  const status = await getIndexStatus(input.cwd);
  if (!status.indexed) {
    return {
      additionalContext: `✅ claudemem v${version} - Not indexed...`
    };
  }

  return {
    additionalContext: `✅ claudemem v${version} - ${status.symbolCount} symbols indexed`
  };
}
```

### Grep Intercept Handler

```typescript
async function handleGrepIntercept(input: HookInput): Promise<HookOutput | null> {
  const pattern = input.tool_input?.pattern as string;
  if (!pattern) return null;

  // Check if indexed
  const status = await getIndexStatus(input.cwd);
  if (!status.indexed) {
    return {
      additionalContext: "⚠️ claudemem not indexed - Grep allowed"
    };
  }

  // Run AST analysis
  const results = await runClaudemem(input.cwd, ["map", pattern, "--raw"]);

  return {
    additionalContext: `🔍 **CLAUDEMEM AST ANALYSIS**\n\n${results}`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Grep replaced with claudemem AST analysis"
    }
  };
}
```

### Auto-Reindex Handler

```typescript
async function handleAutoReindex(input: HookInput): Promise<HookOutput | null> {
  const filePath = input.tool_response?.filePath as string;
  if (!filePath) return null;

  // Check if code file
  const codeExtensions = /\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|scala|swift|c|cpp|h|cs|php|vue|svelte)$/i;
  if (!codeExtensions.test(filePath)) return null;

  // Check if indexed
  const indexDir = path.join(input.cwd, ".claudemem");
  if (!fs.existsSync(indexDir)) return null;

  // Debounce check (30 seconds)
  const debounceFile = path.join(indexDir, ".reindex-timestamp");
  if (fs.existsSync(debounceFile)) {
    const lastReindex = parseInt(fs.readFileSync(debounceFile, "utf-8"));
    if (Date.now() / 1000 - lastReindex < 30) {
      return null; // Debounced
    }
  }

  // Write timestamp and spawn background reindex
  fs.writeFileSync(debounceFile, Math.floor(Date.now() / 1000).toString());
  spawn("claudemem", ["index", "--quiet"], {
    cwd: input.cwd,
    detached: true,
    stdio: "ignore"
  }).unref();

  return null; // Don't add context for background operation
}
```

---

## Plugin Configuration Update

Replace 6 hook configurations with 1:

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

## Benefits

1. **Type Safety** - Full TypeScript with interfaces
2. **Single Codebase** - All hook logic in claudemem repo
3. **No jq/flock** - Native JSON, cross-platform locking
4. **Testable** - Unit tests for each handler
5. **Simpler Config** - 1 command instead of 6 scripts
6. **Maintainable** - One place to update hook logic

---

## Implementation Steps

1. Add `hook` command to claudemem CLI
2. Implement handler dispatch logic
3. Port each bash script to TypeScript handler
4. Add unit tests
5. Update plugin.json to use new command
6. Remove old bash scripts
7. Release claudemem v0.9.0

---

## Fallback Behavior

If claudemem is not installed, hooks won't run - this is fine because:
- SessionStart already handles "not installed" case
- Other hooks require claudemem anyway

---

**Note:** This requires changes to claudemem repository, not this plugin repo.
