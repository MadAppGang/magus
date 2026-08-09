# Plugin Development Guide

Complete guide to creating Claude Code plugins for the Magus marketplace.

---

## Quick Start

Creating a new plugin takes about 15 minutes. Follow these steps:

### 1. Create Plugin Directory Structure

```bash
mkdir -p plugins/your-plugin-name/{agents,commands,skills,mcp-servers}
```

### 2. Add Your Artifacts

```
your-plugin-name/
├── plugin.json              # Plugin manifest (required)
├── README.md                # Plugin documentation (required)
├── agents/                  # Specialized agents (optional)
│   └── your-agent.md
├── commands/                # Slash commands (optional)
│   └── your-command.md
├── skills/                  # Workflow skills (optional)
│   └── your-skill/
│       └── SKILL.md
└── mcp-servers/            # MCP server configurations (optional)
    └── mcp-config.json
```

### 3. Create plugin.json Manifest

```json
{
  "name": "your-plugin-name",
  "version": "1.0.0",
  "description": "Brief description of your plugin",
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "company": "Your Company"
  },
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "category": "development",
  "agents": ["./agents/your-agent.md"],
  "commands": ["./commands/your-command.md"],
  "skills": ["./skills/your-skill"],
  "mcpServers": "./mcp-servers/mcp-config.json"
}
```

### 4. Add to marketplace.json

```json
{
  "plugins": [
    {
      "name": "your-plugin-name",
      "source": "./plugins/your-plugin-name",
      "description": "Brief description",
      "version": "1.0.0",
      "author": {
        "name": "Your Name",
        "email": "you@example.com"
      },
      "category": "development",
      "keywords": ["keyword1", "keyword2"],
      "strict": true
    }
  ]
}
```

### 5. Test Locally

```bash
# Add local marketplace
/plugin marketplace add /path/to/claude-code

# Install your plugin
/plugin install your-plugin-name@magus

# Verify it works
/plugin list
```

---

## Plugin Development Best Practices

### Agents

**Purpose:** Specialized AI personas for specific tasks (code review, architecture planning, testing, etc.)

**Best Practices:**

- ✅ **Clear descriptions**: Use the `description` frontmatter field to explain when the agent should be used
- ✅ **Include examples**: Provide concrete usage examples in descriptions
- ✅ **Define tools**: Specify required tools in frontmatter `tools` field
- ✅ **Use TodoWrite**: All agents should use TodoWrite for task tracking
- ✅ **Set appropriate model**: Use `haiku` for quick tasks, `sonnet` for complex work

**Example Agent Structure:**

```markdown
---
name: code-reviewer
description: Reviews code for quality, security, and best practices
model: sonnet
color: green
---

You are a senior code reviewer...
[Instructions go here]
```

### Commands

**Purpose:** Slash commands that trigger specific workflows (e.g., `/implement`, `/review`)

**Best Practices:**

- ✅ **Single responsibility**: Each command should do one thing well
- ✅ **Allowed tools**: Specify exactly which tools the command can use
- ✅ **Clear arguments**: Document expected input format
- ✅ **Error handling**: Include comprehensive error handling
- ✅ **User feedback**: Provide clear progress updates

**Example Command Structure:**

```markdown
---
name: implement
description: Implement a feature end-to-end with automated testing
allowed-tools: Task, Read, Write, Edit
---

# Implementation Workflow

[Command instructions go here]
```

### Skills

**Purpose:** Proactive workflows that Claude automatically triggers when appropriate

**Best Practices:**

- ✅ **Proactive invocation**: Define when Claude should automatically use the skill
- ✅ **Comprehensive instructions**: Include detailed step-by-step workflows
- ✅ **Agent delegation**: Skills should primarily invoke agents via Task tool
- ✅ **Clear output format**: Specify expected report structures

**Example Skill Structure:**

```markdown
---
name: browser-debugger
description: Automatically test UI in browser when user implements features
allowed-tools: Task
---

# Browser Debugger Skill

## When to use this Skill

Claude should invoke this Skill when:
- User implements UI components
- User asks to test in browser
[More triggers...]

## Instructions

[Step-by-step workflow...]
```

### MCP Servers

**Purpose:** External tools and integrations (APIs, file systems, databases, etc.)

**Best Practices:**

- ✅ **Environment variables**: Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths
- ✅ **Clear purpose**: Each MCP server should provide specific, well-defined functionality
- ✅ **Configuration**: Document required environment variables and setup steps
- ✅ **Dependencies**: List any system dependencies or prerequisites
- ✅ **Error handling**: Provide clear error messages for configuration issues

**Example MCP Server Configuration:**

```json
{
  "custom-server": {
    "command": "${CLAUDE_PLUGIN_ROOT}/bin/custom-mcp-server",
    "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config/server.json"],
    "env": {
      "CUSTOM_API_KEY": "${CUSTOM_API_KEY}"
    }
  },
  "external-api": {
    "command": "npx",
    "args": ["-y", "@your-org/custom-mcp-server"],
    "env": {
      "API_TOKEN": "${API_TOKEN}"
    }
  }
}
```

**MCP Server Best Practices:**

1. **Use plugin-relative paths**: Always use `${CLAUDE_PLUGIN_ROOT}` for files within the plugin
2. **Document environment variables**: Clearly list all required env vars in plugin README
3. **Provide setup instructions**: Include step-by-step setup in plugin documentation
4. **Handle missing dependencies**: Check for required tools (npx, node, etc.) and provide helpful error messages
5. **Test thoroughly**: Verify MCP servers work across different environments
6. **Include examples**: Provide example configurations and usage scenarios

**Common MCP Server Use Cases:**

- **API Integration**: Custom API clients, third-party service integrations
- **File System Operations**: Advanced file operations, project scaffolding
- **Development Tools**: Linters, formatters, code generators
- **Cloud Services**: AWS, Azure, GCP integrations
- **Custom Tooling**: Project-specific automation and utilities

---

## Quality Standards

All contributions must meet these standards:

### Documentation

- ✅ **Comprehensive README**: Include overview, installation, usage examples
- ✅ **Inline documentation**: Comment complex workflows and decisions
- ✅ **Example usage**: Provide real-world usage examples
- ✅ **Troubleshooting**: Include common issues and solutions

### Testing

- ✅ **Real-world testing**: Verify in actual projects, not just examples
- ✅ **Multiple scenarios**: Test edge cases and error conditions
- ✅ **Cross-platform**: Ensure works on macOS, Linux, Windows
- ✅ **Team tested**: Verify with multiple developers if possible

### Design

- ✅ **Focused scope**: Single, well-defined purpose
- ✅ **Reusable**: Works across different projects and stacks
- ✅ **Composable**: Can be combined with other plugins
- ✅ **Maintainable**: Clear code, good structure, easy to update

### Maintenance

- ✅ **Up-to-date**: Works with latest Claude Code version
- ✅ **Dependency management**: Pin versions, document requirements
- ✅ **Responsive**: Address issues and PRs promptly
- ✅ **Versioned**: Follow semantic versioning

---

## Plugin Categories

When creating a plugin, choose the appropriate category:

- **development**: Code generation, refactoring, implementation
- **testing**: Testing frameworks, E2E testing, visual regression
- **devops**: CI/CD, deployment, infrastructure management
- **documentation**: Docs generation, API reference, guides
- **analysis**: Code analysis, security scanning, performance
- **design**: UI/UX tools, design systems, Figma integration
- **database**: Migrations, queries, ORM utilities
- **api**: REST, GraphQL, API client generation

---

## Further Reading

- **[Marketplace Reference](./marketplace-reference.md)** - Technical schema and structure
- **[Contributing Guide](./contributing.md)** - How to submit your plugin
- **[Advanced Usage](../guides/advanced-usage.md)** - Advanced configuration options

---

## Need Help?

- **Questions**: Open an issue with `question` label
- **Ideas**: Open an issue with `plugin-idea` label
- **Email**: [i@madappgang.com](mailto:i@madappgang.com)

---

**Happy plugin development!** 🚀
