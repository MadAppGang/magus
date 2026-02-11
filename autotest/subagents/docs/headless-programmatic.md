# Run Claude Code Programmatically - Official Docs

> Source: https://code.claude.com/docs/en/headless.md
> Fetched: 2026-02-09

## Key CLI Patterns for Testing

### Basic Usage
```bash
claude -p "prompt" --allowedTools "Read,Edit,Bash"
```

### Streaming JSON (for transcript capture)
```bash
claude -p "prompt" --output-format stream-json --verbose
```

Note: `--output-format stream-json` REQUIRES `--verbose` flag when using `-p`.

### JSON Output (for structured results)
```bash
claude -p "prompt" --output-format json
```

### Auto-approve Tools
```bash
claude -p "prompt" --allowedTools "Bash,Read,Edit"
```

### Custom System Prompt
```bash
claude -p "prompt" --append-system-prompt "Additional instructions"
```

### Session Management
```bash
# Get session ID
session_id=$(claude -p "Start review" --output-format json | jq -r '.session_id')

# Resume specific session
claude -p "Continue" --resume "$session_id"
```

## Key Insight for Subagent Testing

When using `-p` mode, Claude will only delegate to subagents if it determines
the task warrants delegation. Simple tasks are handled directly. To test
subagent selection specifically, tasks should be:

1. Complex enough to warrant delegation
2. Domain-specific enough to match a subagent's description
3. Explicitly requesting delegation (e.g., "Use the X agent to...")

## Permissions in Programmatic Mode

- `--dangerously-skip-permissions` - Skip all permission checks (bypasses hooks too!)
- `--allowedTools "Tool1,Tool2"` - Auto-approve specific tools
- Permission rule syntax supports prefix matching: `Bash(git diff *)`
