# No Logging By Default

## Overview

**Claudish does NOT write log files by default.** Logging is completely disabled unless you explicitly enable debug mode with the `--debug` flag.

## Default Behavior

```bash
# NO log files created (default)
claudish
claudish --model x-ai/grok-code-fast-1 "your prompt"

# Log files created (opt-in)
claudish --debug --model x-ai/grok-code-fast-1 "your prompt"
```

## Why This Matters

**Performance**: File I/O (even async) has overhead. By default, claudish runs with:
- ✅ Zero disk writes
- ✅ Zero logging overhead
- ✅ Maximum performance
- ✅ Clean working directory (no logs/ folder)

**Privacy**: Debug logs contain:
- API request/response bodies
- Model outputs
- Tool call arguments
- Thinking content (for reasoning models)

Without debug mode, none of this is written to disk.

## When To Enable Debug Mode

Use `--debug` flag only when:
1. **Troubleshooting issues** - Need to see what's happening
2. **Bug reports** - Sharing logs with maintainers
3. **Development** - Working on claudish itself
4. **Investigating model behavior** - Analyzing thinking blocks, SSE events, etc.

## Debug Mode Details

When you enable debug mode with `--debug`:

```bash
claudish --debug --model x-ai/grok-code-fast-1 "test prompt"
```

**What happens:**
1. Creates `logs/` directory in current working directory
2. Creates timestamped log file: `logs/claudish_YYYY-MM-DD_HH-MM-SS.log`
3. Writes all proxy activity to file (async buffered for performance)
4. Shows log file path on startup: `[claudish] Debug log: logs/claudish_...log`

**Log levels:**
- `--log-level debug` - Full verbose (everything)
- `--log-level info` - Structured logs with truncated content (default)
- `--log-level minimal` - Only critical events

**Performance:**
- Async buffered writes (non-blocking)
- Batched every 100ms or 50 messages
- Minimal overhead with async I/O
- Much better than v1.1.0 (which had blocking sync writes)

## Code Verification

### Default Debug Mode (cli.ts line 13)
```typescript
debug: false, // No debug logging by default
```

### Logger Guards Against Creating Files (logger.ts line 56-63)
```typescript
export function initLogger(debugMode: boolean, ...) {
  if (!debugMode) {
    logFilePath = null;  // No file path set
    // ... cleanup timers ...
    return;  // Early return - no file created
  }

  // Only reaches here if debugMode === true
  mkdirSync(logsDir, { recursive: true });
  logFilePath = join(logsDir, `claudish_${timestamp}.log`);
  writeFileSync(logFilePath, ...);
}
```

### All Log Calls Check File Path First (logger.ts line 97-105)
```typescript
export function log(message: string, ...) {
  if (logFilePath) {  // Only logs if file path is set
    logBuffer.push(logLine);
    // ...
  }
  // If logFilePath is null, nothing happens
}
```

## Common Misconceptions

### ❌ "Claudish is slow because of logging"
**Reality:** By default, NO logging happens. Zero performance impact from logging.

### ❌ "My logs/ directory has large files"
**Reality:** Those are from previous debug sessions. Delete them or run:
```bash
rm -rf logs/
```

### ❌ "I need debug mode for normal use"
**Reality:** You don't! Debug mode is ONLY for troubleshooting. Normal usage has zero logging.

## Performance Troubleshooting

If experiencing lag:

### 1. Check for Multiple Processes
```bash
ps aux | grep claudish | grep -v grep

# Kill all claudish processes
npm run kill-all
```

**Common cause:** Starting claudish multiple times without killing previous instances. Each instance runs its own proxy server, multiplying CPU/memory usage.

### 2. Disable Debug Mode
```bash
# ❌ Slow (if you don't need logs)
claudish --debug --model x-ai/grok-code-fast-1

# ✅ Fast (no logging overhead)
claudish --model x-ai/grok-code-fast-1
```

### 3. Check System Resources
```bash
# CPU usage
top -o cpu | grep -E "bun|claude"

# Memory usage
ps aux | grep -E "claudish|claude.*settings" | awk '{print $2, $3, $4, $11}'
```

## Development Scripts

### Without Debug (default)
```bash
npm run dev              # Interactive, no debug
npm run dev:grok         # Grok model, no debug
npm run dev:info         # Monitor mode, no debug
```

### With Debug (opt-in)
```bash
npm run dev:grok:debug   # Grok with debug logging
```

## Environment Variables

None of these enable logging:
- `OPENROUTER_API_KEY` - Required for API access
- `ANTHROPIC_API_KEY` - Placeholder to bypass Claude Code prompt
- `CLAUDISH_MODEL` - Default model selection
- `CLAUDISH_PORT` - Proxy port

**Logging ONLY enabled by `--debug` flag.**

## Summary

| Mode | Log Files | Performance | Use Case |
|------|-----------|-------------|----------|
| Default | ❌ None | ✅ Maximum | Normal usage |
| --debug | ✅ Created | ⚠️ Overhead | Troubleshooting |

**By default, claudish is silent and fast. Debug mode is opt-in only.**

---

**Version:** 1.1.2
**Date:** 2025-11-11
**Confirmed:** Zero logging by default
