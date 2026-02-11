# Plugins Reference: Agent Component - Official Docs

> Source: https://code.claude.com/docs/en/plugins-reference.md
> Fetched: 2026-02-09

## Agent Definition in Plugins

**Location**: `agents/` directory in plugin root

**File format**: Markdown files with YAML frontmatter describing agent capabilities

### Agent File Structure

```markdown
---
name: agent-name
description: What this agent specializes in and when Claude should invoke it
---

Detailed system prompt for the agent describing its role, expertise, and behavior.
```

### Integration Points

- Agents appear in the `/agents` interface
- Claude can invoke agents automatically based on task context
- Agents can be invoked manually by users
- Plugin agents work alongside built-in Claude agents

### Namespacing

Agent names are namespaced with plugin name. For example, the agent `agent-creator`
in plugin `plugin-dev` appears as `plugin-dev:agent-creator` in the Task tool.

### Selection Mechanism

From official subagents docs:

> Claude automatically delegates tasks based on:
> 1. The task description in your request
> 2. The `description` field in subagent configurations
> 3. Current context

**The `description` field is the PRIMARY selection signal.**

### Best Practices for Descriptions

From official example agents:

1. **Be specific about WHEN to use**:
   - "Use immediately after writing or modifying code"
   - "Use proactively when encountering any issues"
   - "Use when analyzing data or generating reports"

2. **Include the domain**: "Expert code review specialist" not just "reviewer"

3. **Include trigger phrases**: "Use proactively" encourages automatic delegation

4. **Include examples in description**: The detective agent's description has 3 examples
   showing Claude exactly when to select it (this is extremely effective for selection)

### Supported Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier |
| `description` | Yes | **THE selection signal** - when Claude should delegate |
| `tools` | No | Tool allowlist (inherits all if omitted) |
| `disallowedTools` | No | Tool denylist |
| `model` | No | `sonnet`, `opus`, `haiku`, `inherit` |
| `permissionMode` | No | Permission mode override |
| `maxTurns` | No | Max agentic turns |
| `skills` | No | Skills to preload |
| `mcpServers` | No | MCP servers |
| `hooks` | No | Lifecycle hooks |
| `memory` | No | Persistent memory scope |
