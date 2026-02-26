# Agent Development Plugin

Create, implement, and review Claude Code agents and commands with multi-model validation.

## Installation

```bash
/plugin install agentdev@magus
```

## Features

- **3 Specialized Agents** for the full agent development lifecycle
- **1 Orchestration Command** for end-to-end workflows
- **3 Reusable Skills** with XML standards, patterns, and schemas
- **Multi-Model Validation** via Claudish for quality assurance
- **Parallel Execution** for 3-5x faster reviews

## Agents

| Agent | Usage | Description |
|-------|-------|-------------|
| `agentdev:architect` | Design agents | Creates comprehensive agent design plans |
| `agentdev:developer` | Implement agents | Writes agent/command files from designs |
| `agentdev:reviewer` | Review agents | Validates quality and standards compliance |

## Commands

| Command | Description |
|---------|-------------|
| `/develop` | Full-cycle agent development with multi-model validation |

## Skills

| Skill | Description |
|-------|-------------|
| `agentdev:xml-standards` | XML tag structure patterns for agents |
| `agentdev:patterns` | Common agent templates and patterns |
| `agentdev:schemas` | YAML frontmatter schemas |

## Usage Examples

### Create a New Agent
```
/develop Create an agent that reviews GraphQL schemas for security
```

### Improve an Existing Agent
```
/develop Improve the backend-developer agent to support GraphQL
```

### Create an Orchestrator Command
```
/develop Create a /deploy-aws command for ECS deployment
```

## Dependencies

- `orchestration@magus` (auto-installed)

## Multi-Model Validation

The `/develop` command uses external AI models via [Claudish](https://github.com/MadAppGang/claudish) for:
- **Plan Review** - Validate design before implementation
- **Implementation Review** - Quality check with multiple perspectives

**Install Claudish:** `npm install -g claudish`

Supported models:
- `x-ai/grok-code-fast-1` - Fast, coding-focused
- `google/gemini-2.5-flash` - Budget-friendly
- `google/gemini-2.5-pro` - Advanced reasoning
- `deepseek/deepseek-chat` - Reasoning specialist
- `anthropic/claude-sonnet-4.5` - Alternative perspective

## License

MIT
