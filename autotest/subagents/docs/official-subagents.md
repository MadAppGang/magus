# Create custom subagents - Official Claude Code Documentation

> Source: https://code.claude.com/docs/subagents
> Fetched: 2026-02-09

> Create and use specialized AI subagents in Claude Code for task-specific workflows and improved context management.

Subagents are specialized AI assistants that handle specific types of tasks. Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions. When Claude encounters a task that matches a subagent's description, it delegates to that subagent, which works independently and returns results.

## Key Selection Mechanism

**Claude uses each subagent's `description` field to decide when to delegate tasks.**

When you create a subagent, write a clear description so Claude knows when to use it.

## Built-in subagents

| Agent | Model | Tools | Purpose |
|-------|-------|-------|---------|
| **Explore** | Haiku (fast) | Read-only | File discovery, code search, codebase exploration |
| **Plan** | Inherits | Read-only | Codebase research for planning |
| **General-purpose** | Inherits | All tools | Complex research, multi-step operations, code modifications |
| **Bash** | Inherits | Bash | Running terminal commands in separate context |
| **statusline-setup** | Sonnet | Read, Edit | Configure status line |
| **Claude Code Guide** | Haiku | Read-only + web | Questions about Claude Code features |

## Subagent Configuration

### File Format
Markdown files with YAML frontmatter:
```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code...
```

### Scope / Priority (highest to lowest)
1. `--agents` CLI flag (current session only)
2. `.claude/agents/` (project-level)
3. `~/.claude/agents/` (user-level)
4. Plugin's `agents/` directory (where plugin is enabled)

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier using lowercase letters and hyphens |
| `description` | Yes | When Claude should delegate to this subagent |
| `tools` | No | Tools the subagent can use. Inherits all tools if omitted |
| `disallowedTools` | No | Tools to deny |
| `model` | No | `sonnet`, `opus`, `haiku`, or `inherit` (default: inherit) |
| `permissionMode` | No | `default`, `acceptEdits`, `delegate`, `dontAsk`, `bypassPermissions`, `plan` |
| `maxTurns` | No | Max agentic turns before stop |
| `skills` | No | Skills to preload into context |
| `mcpServers` | No | MCP servers available |
| `hooks` | No | Lifecycle hooks scoped to this subagent |
| `memory` | No | Persistent memory scope: `user`, `project`, `local` |

### CLI-defined subagents (JSON)
```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer...",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

## Critical Insight: Description Drives Selection

> Claude automatically delegates tasks based on:
> 1. The task description in your request
> 2. The `description` field in subagent configurations
> 3. Current context

To encourage proactive delegation, include phrases like "use proactively" in description.

## Best Practices (from official docs)

- **Design focused subagents:** each should excel at one specific task
- **Write detailed descriptions:** Claude uses the description to decide when to delegate
- **Limit tool access:** grant only necessary permissions
- **Check into version control:** share project subagents with your team

## Example Descriptions (from official docs)

- `"Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code."`
- `"Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues."`
- `"Data analysis expert for SQL queries, BigQuery operations, and data insights. Use proactively for data analysis tasks and queries."`
- `"Execute read-only database queries. Use when analyzing data or generating reports."`

## Disabling Subagents

```json
{
  "permissions": {
    "deny": ["Task(Explore)", "Task(my-custom-agent)"]
  }
}
```

## Subagent Limitations

- Subagents cannot spawn other subagents
- Background subagents auto-deny non-pre-approved permissions
- MCP tools not available in background subagents
