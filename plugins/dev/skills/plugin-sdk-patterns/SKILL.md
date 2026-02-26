---
name: plugin-sdk-patterns
description: Unified patterns and templates for creating consistent Claude Code plugins. Use when creating new plugins, designing plugin architecture, implementing builder patterns, or standardizing plugin structure. Trigger keywords - "plugin SDK", "plugin template", "plugin pattern", "builder pattern", "plugin structure", "new plugin", "plugin architecture".
version: 0.1.0
tags: [dev, plugin, sdk, patterns, templates, builder, architecture]
keywords: [plugin, sdk, patterns, templates, builder, architecture, structure, manifest, frontmatter]
plugin: dev
updated: 2026-01-28
---

# Plugin SDK Patterns

## Overview

This skill documents unified patterns and templates for creating consistent, professional Claude Code plugins. Following these patterns ensures your plugins integrate seamlessly with Claude Code's ecosystem and provide a predictable developer experience.

### Why Standardized Plugin Patterns Matter

**Consistency**: Users expect the same structure across all plugins, making them easier to learn and use.

**Maintainability**: Standard patterns make it easier to update and extend plugins over time.

**Discoverability**: Consistent naming and structure helps users find what they need quickly.

**Quality**: Templates enforce best practices and reduce common errors.

**Collaboration**: Teams can work together more effectively with shared conventions.

### The Builder Pattern Approach

Claude Code plugins follow a **builder pattern** where components (skills, commands, agents, hooks) are modular and composable:

- Each component is self-contained in its own directory
- Components declare their metadata via frontmatter
- The plugin.json manifest ties everything together
- Hooks provide lifecycle integration points

### Plugin Anatomy

```
my-plugin/
├── plugin.json              # Plugin manifest (required)
├── README.md                # User-facing documentation
├── DEPENDENCIES.md          # External dependencies (if any)
├── skills/                  # Reusable knowledge modules
│   ├── skill-one/
│   │   └── SKILL.md
│   └── skill-two/
│       └── SKILL.md
├── commands/                # Interactive commands
│   ├── command-one.md
│   └── command-two.md
├── agents/                  # Autonomous agents
│   ├── agent-one.md
│   └── agent-two.md
├── hooks/                   # Lifecycle hooks (optional)
│   └── hooks.json
├── mcp-servers/            # MCP server configurations (optional)
│   └── servers.json
└── examples/               # Example workflows (optional)
    └── example-workflow.md
```

## Plugin Manifest (plugin.json) Template

### Complete Template

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Brief description of what the plugin does",
  "author": "Your Name <email@example.com>",
  "license": "MIT",
  "homepage": "https://github.com/yourusername/your-repo",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/your-repo.git"
  },
  "tags": ["category1", "category2", "category3"],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "skills": [
    {
      "name": "skill-one",
      "path": "skills/skill-one/SKILL.md",
      "description": "Brief description of skill one"
    },
    {
      "name": "skill-two",
      "path": "skills/skill-two/SKILL.md",
      "description": "Brief description of skill two"
    }
  ],
  "skillBundles": [
    {
      "name": "core-bundle",
      "description": "Core skills for basic functionality",
      "skills": ["skill-one", "skill-two"]
    }
  ],
  "commands": [
    {
      "name": "/command-one",
      "path": "commands/command-one.md",
      "description": "Brief description of command one"
    }
  ],
  "agents": [
    {
      "name": "agent-one",
      "path": "agents/agent-one.md",
      "description": "Brief description of agent one"
    }
  ],
  "hooks": {
    "enabled": true,
    "configPath": "hooks/hooks.json"
  },
  "mcpServers": {
    "enabled": true,
    "configPath": "mcp-servers/servers.json"
  },
  "dependencies": {
    "system": ["node>=18.0.0", "git"],
    "npm": ["package-name@^1.0.0"],
    "plugins": ["other-plugin@marketplace-name"]
  },
  "compatibility": {
    "claudeCode": ">=1.0.0"
  }
}
```

### Field Descriptions

**Core Metadata:**
- `name` (required): Lowercase, hyphen-separated plugin identifier
- `version` (required): Semantic version (MAJOR.MINOR.PATCH)
- `description` (required): One-sentence summary (under 150 characters)
- `author`: Name and email in standard format
- `license`: SPDX license identifier (typically MIT)
- `homepage`: Primary documentation URL
- `repository`: Git repository information

**Discovery:**
- `tags`: Broad categories (e.g., "frontend", "backend", "testing")
- `keywords`: Specific search terms (e.g., "react", "typescript", "api")

**Components:**
- `skills`: Array of skill definitions
- `skillBundles`: Logical groupings of skills for auto-load
- `commands`: Array of command definitions
- `agents`: Array of agent definitions

**Integration:**
- `hooks`: Lifecycle hook configuration
- `mcpServers`: MCP server configuration
- `dependencies`: External requirements
- `compatibility`: Claude Code version requirements

## Skill File Template

### Standard SKILL.md Structure

```markdown
---
name: skill-name
description: Clear, concise description of what this skill teaches. Include trigger keywords and use cases. Trigger keywords - "keyword1", "keyword2", "keyword3".
version: 1.0.0
tags: [category1, category2, category3]
keywords: [keyword1, keyword2, keyword3, keyword4]
plugin: plugin-name
updated: 2026-01-28
---

# Skill Name

## Overview

Brief introduction to the skill and its purpose. Explain when to use this skill and what problems it solves.

### Key Concepts

- **Concept 1**: Brief explanation
- **Concept 2**: Brief explanation
- **Concept 3**: Brief explanation

### When to Use This Skill

- Scenario 1
- Scenario 2
- Scenario 3

## Core Patterns

### Pattern 1: Pattern Name

**Purpose**: Why this pattern exists

**Structure**:
```
Example code or structure
```

**Usage**:
- Step 1
- Step 2
- Step 3

**Best Practices**:
- Do this
- Don't do that

### Pattern 2: Pattern Name

(Same structure as Pattern 1)

## Integration

### With Other Skills

How this skill works alongside other skills in your plugin or ecosystem.

### With Tools

Which Claude Code tools are most relevant:
- Read/Write/Edit for file operations
- Bash for system commands
- Grep/Glob for searching
- Task for delegation

### With External Systems

Any external dependencies or integrations.

## Best Practices

### Do

- ✅ Best practice 1
- ✅ Best practice 2
- ✅ Best practice 3

### Don't

- ❌ Anti-pattern 1
- ❌ Anti-pattern 2
- ❌ Anti-pattern 3

## Examples

### Example 1: Basic Usage

**Scenario**: Clear description of the use case

**Implementation**:
```
Code or step-by-step example
```

**Result**: Expected outcome

### Example 2: Advanced Usage

(Same structure as Example 1)

## Troubleshooting

### Common Issues

**Issue 1**: Problem description
- **Cause**: Why it happens
- **Solution**: How to fix it

**Issue 2**: Problem description
- **Cause**: Why it happens
- **Solution**: How to fix it

## Summary

### Key Takeaways

- Takeaway 1
- Takeaway 2
- Takeaway 3

### Quick Reference

| Scenario | Pattern to Use | Key Points |
|----------|---------------|------------|
| Scenario 1 | Pattern 1 | Point 1, Point 2 |
| Scenario 2 | Pattern 2 | Point 1, Point 2 |

---

*Inspired by [Source/Project Name]*
```

### Frontmatter Fields

**Required:**
- `name`: Lowercase, hyphen-separated identifier
- `description`: Include trigger keywords and use cases
- `version`: Semantic version
- `plugin`: Parent plugin name
- `updated`: ISO date (YYYY-MM-DD)

**Recommended:**
- `tags`: 3-5 broad categories
- `keywords`: 5-10 specific terms for search

### Section Guidelines

**Overview** (50-100 lines):
- Introduction and purpose
- Key concepts
- When to use

**Core Patterns** (100-200 lines):
- 2-5 main patterns
- Each with purpose, structure, usage, best practices

**Integration** (30-50 lines):
- How it works with other components
- Tool usage recommendations

**Best Practices** (30-50 lines):
- Do/Don't lists
- Common pitfalls

**Examples** (50-100 lines):
- 2-3 concrete examples
- Scenario, implementation, result

**Troubleshooting** (30-50 lines):
- Common issues and solutions

**Summary** (20-30 lines):
- Key takeaways
- Quick reference table

## Command File Template

### Standard Command Structure

```markdown
---
name: /command-name
description: Brief description of what this command does
version: 1.0.0
plugin: plugin-name
updated: 2026-01-28
---

<role>
  <identity>Clear Role Name</identity>
  <expertise>
    - Expertise area 1
    - Expertise area 2
    - Expertise area 3
  </expertise>
  <mission>
    Single-sentence mission statement describing the command's purpose.
  </mission>
</role>

<instructions>
  <critical_constraints>
    <constraint name="Constraint 1">
      Description of the constraint and why it matters.
    </constraint>

    <constraint name="Constraint 2">
      Description of the constraint and why it matters.
    </constraint>
  </critical_constraints>

  <workflow>
    <phase number="1" name="Phase Name">
      <objective>What this phase accomplishes</objective>
      <steps>
        <step>Specific action 1</step>
        <step>Specific action 2</step>
        <step>Specific action 3</step>
      </steps>
      <output>What gets produced</output>
    </phase>

    <phase number="2" name="Phase Name">
      (Same structure as Phase 1)
    </phase>
  </workflow>

  <validation>
    <check>Validation check 1</check>
    <check>Validation check 2</check>
    <error_handling>How to handle failures</error_handling>
  </validation>
</instructions>

<examples>
  <example name="Example 1">
    <scenario>Description of the scenario</scenario>
    <execution>
      ```
      Example input/output
      ```
    </execution>
    <result>Expected outcome</result>
  </example>
</examples>

<formatting>
  <communication_style>
    - Guideline 1
    - Guideline 2
  </communication_style>

  <completion_message>
## Command Complete

**Summary**: Brief summary of what was done

**Output**: Description of the output

**Next Steps**: Recommended actions
  </completion_message>
</formatting>
```

### Command Design Principles

**Single Responsibility**: Each command should do one thing well.

**Clear Phases**: Break work into distinct, sequential phases.

**Validation**: Always validate inputs and outputs.

**Error Handling**: Provide clear error messages and recovery steps.

**Examples**: Include 2-3 concrete usage examples.

## Agent File Template

### Standard Agent Structure

```markdown
---
name: agent-name
description: Brief description of the agent's purpose and capabilities
version: 1.0.0
tools: [Read, Write, Edit, Bash, Grep, Glob, Task]
plugin: plugin-name
updated: 2026-01-28
---

<role>
  <identity>Clear Agent Identity</identity>
  <expertise>
    - Domain area 1
    - Domain area 2
    - Domain area 3
  </expertise>
  <mission>
    Single-sentence mission statement describing what the agent does.
  </mission>
</role>

<instructions>
  <critical_constraints>
    <constraint name="Tool Usage">
      - Prefer X tool for Y operations
      - Never use Z for W operations
      - Always validate before executing
    </constraint>

    <constraint name="Quality Standards">
      - Standard 1
      - Standard 2
      - Standard 3
    </constraint>
  </critical_constraints>

  <workflow>
    <phase number="1" name="Analysis">
      <objective>Understand the task and codebase</objective>
      <actions>
        <action>Use Grep to find relevant files</action>
        <action>Use Read to understand existing patterns</action>
        <action>Identify what needs to be done</action>
      </actions>
    </phase>

    <phase number="2" name="Planning">
      <objective>Create implementation plan</objective>
      <actions>
        <action>Break down task into steps</action>
        <action>Identify dependencies</action>
        <action>Choose appropriate patterns</action>
      </actions>
    </phase>

    <phase number="3" name="Implementation">
      <objective>Execute the plan</objective>
      <actions>
        <action>Create/modify files using Write/Edit</action>
        <action>Follow coding standards</action>
        <action>Add tests if applicable</action>
      </actions>
    </phase>

    <phase number="4" name="Validation">
      <objective>Ensure quality and correctness</objective>
      <actions>
        <action>Run linters and formatters</action>
        <action>Execute tests</action>
        <action>Verify against requirements</action>
      </actions>
    </phase>

    <phase number="5" name="Reporting">
      <objective>Communicate results</objective>
      <actions>
        <action>Show what was changed</action>
        <action>Report validation results</action>
        <action>Suggest next steps</action>
      </actions>
    </phase>
  </workflow>

  <delegation>
    <when_to_delegate>
      - Task requires specialized expertise
      - Subtask is independent and well-defined
      - Need to run parallel operations
    </when_to_delegate>

    <how_to_delegate>
      Use Task tool with clear instructions and context.
    </how_to_delegate>
  </delegation>
</instructions>

<knowledge>
  <domain_knowledge>
    - Key concept 1
    - Key concept 2
    - Key concept 3
  </domain_knowledge>

  <best_practices>
    - Practice 1
    - Practice 2
    - Practice 3
  </best_practices>

  <common_patterns>
    - Pattern 1: Description
    - Pattern 2: Description
    - Pattern 3: Description
  </common_patterns>
</knowledge>

<examples>
  <example name="Example 1">
    <task>Clear task description</task>
    <approach>
      1. Step 1
      2. Step 2
      3. Step 3
    </approach>
    <outcome>Expected result</outcome>
  </example>
</examples>
```

### Agent Design Principles

**Autonomy**: Agents should be able to complete tasks without constant user input.

**Transparency**: Always explain what you're doing and why.

**Tool Mastery**: Use the right tool for each job.

**Error Recovery**: Handle failures gracefully and inform the user.

**Delegation**: Use Task tool for specialized subtasks.

## Hooks Configuration Template

### hooks.json Structure

```json
{
  "hooks": [
    {
      "type": "tool_denial",
      "priority": 3,
      "enabled": true,
      "config": {
        "deniedTools": ["Read", "Glob"],
        "denialReason": "Task completed via custom-tool. Results shown above.",
        "contextInjection": {
          "method": "contextWindow",
          "maxLines": 10,
          "format": "summary"
        }
      }
    },
    {
      "type": "pre_response",
      "priority": 2,
      "enabled": true,
      "config": {
        "actions": [
          {
            "action": "inject_context",
            "source": "custom-source",
            "format": "markdown"
          }
        ]
      }
    },
    {
      "type": "post_response",
      "priority": 1,
      "enabled": false,
      "config": {
        "actions": [
          {
            "action": "log_interaction",
            "destination": "logs/interactions.log"
          }
        ]
      }
    }
  ]
}
```

### Hook Types

**tool_denial** (Priority 2-3):
- Intercept tool calls and provide alternative results
- Use for custom tool implementations
- Example: claudemem integration

**pre_response** (Priority 2):
- Inject context before agent responds
- Modify user input
- Add system instructions

**post_response** (Priority 1):
- Process agent output
- Log interactions
- Trigger external actions

### Hook Best Practices

**Priority Management**:
- Priority 3: Critical tool denials
- Priority 2: Context injection and pre-processing
- Priority 1: Post-processing and logging

**Denial Reasons**:
- Use success-like language ("Task completed via...")
- Avoid "denied" or "not available" phrasing
- Include indication of where results are shown

**Context Injection**:
- Keep injected context minimal (10-20 lines max)
- Use summary format when possible
- Place critical info at the top

## Plugin Creation Checklist

### 1. Planning Phase

- [ ] Define plugin purpose and scope
- [ ] Identify target users and use cases
- [ ] List required skills, commands, agents
- [ ] Document external dependencies
- [ ] Choose appropriate tags and keywords

### 2. Structure Setup

- [ ] Create plugin directory structure
- [ ] Initialize plugin.json with metadata
- [ ] Create README.md with user documentation
- [ ] Add LICENSE file (typically MIT)
- [ ] Create .gitignore for plugin-specific files

### 3. Component Development

**For each skill:**
- [ ] Create skill directory and SKILL.md
- [ ] Add complete frontmatter
- [ ] Write Overview section
- [ ] Document Core Patterns
- [ ] Add Integration guidance
- [ ] Include Best Practices
- [ ] Provide Examples
- [ ] Add Troubleshooting section
- [ ] Write Summary with quick reference
- [ ] Add to plugin.json skills array

**For each command:**
- [ ] Create command markdown file
- [ ] Add frontmatter with metadata
- [ ] Define role and mission
- [ ] Document critical constraints
- [ ] Break down workflow into phases
- [ ] Add validation rules
- [ ] Include examples
- [ ] Define formatting and output
- [ ] Add to plugin.json commands array

**For each agent:**
- [ ] Create agent markdown file
- [ ] Add frontmatter with tools list
- [ ] Define role and expertise
- [ ] Document critical constraints
- [ ] Break down workflow into phases
- [ ] Define delegation strategy
- [ ] Add knowledge section
- [ ] Include examples
- [ ] Add to plugin.json agents array

### 4. Integration

- [ ] Configure hooks if needed (hooks.json)
- [ ] Configure MCP servers if needed (servers.json)
- [ ] Create skill bundles for logical groupings
- [ ] Test component interactions
- [ ] Verify environment variable handling

### 5. Documentation

- [ ] Complete README.md with installation and usage
- [ ] Create DEPENDENCIES.md if external deps exist
- [ ] Add example workflows to examples/
- [ ] Document configuration options
- [ ] Include troubleshooting guide

### 6. Testing

- [ ] Test each command manually
- [ ] Test each agent with typical tasks
- [ ] Verify skill loading and application
- [ ] Test hook behavior if configured
- [ ] Verify MCP server connections if configured
- [ ] Test with different Claude Code versions

### 7. Release Preparation

- [ ] Bump version in plugin.json (semver)
- [ ] Update CHANGELOG.md
- [ ] Create git tag (plugins/{name}/vX.Y.Z)
- [ ] Update marketplace.json if applicable
- [ ] Push to repository with --tags

## Best Practices

### Do

✅ **Follow Semantic Versioning**: MAJOR.MINOR.PATCH
- MAJOR: Breaking changes
- MINOR: New features, backward compatible
- PATCH: Bug fixes, backward compatible

✅ **Use Descriptive Names**: lowercase-hyphen-separated for files and IDs

✅ **Include Frontmatter**: Every skill, command, agent needs complete metadata

✅ **Document Trigger Keywords**: Help users discover when to use components

✅ **Provide Examples**: At least 2-3 concrete examples per component

✅ **Test Before Release**: Verify all components work as documented

✅ **Use Skill Bundles**: Group related skills for easier auto-loading

✅ **Keep Dependencies Minimal**: Only require what's truly necessary

✅ **Version All Components**: Track versions in frontmatter

✅ **Use Relative Paths**: ${CLAUDE_PLUGIN_ROOT} for plugin-relative references

### Don't

❌ **Don't Hardcode Paths**: Use environment variables and relative paths

❌ **Don't Skip Frontmatter**: It's required for proper loading

❌ **Don't Use CamelCase**: Stick to lowercase-hyphen-separated

❌ **Don't Overcomplicate**: Keep components focused and simple

❌ **Don't Ignore Dependencies**: Document all external requirements

❌ **Don't Skip Validation**: Always validate inputs and outputs

❌ **Don't Forget Error Handling**: Provide clear error messages

❌ **Don't Mix Responsibilities**: One component = one job

❌ **Don't Duplicate Logic**: Extract shared patterns to skills

❌ **Don't Release Without Testing**: Always test before pushing

### Naming Conventions

**Plugins**: `lowercase-hyphen-separated`
- Example: `frontend-toolkit`, `code-analysis`, `seo-optimizer`

**Skills**: `descriptive-noun-phrase`
- Example: `react-patterns`, `api-design`, `testing-strategies`

**Commands**: `/verb-noun` or `/verb`
- Example: `/analyze`, `/generate-api`, `/review-code`

**Agents**: `role-based-name`
- Example: `developer`, `code-reviewer`, `api-designer`

**Files**: `lowercase-hyphen-separated.extension`
- Example: `plugin.json`, `SKILL.md`, `command-name.md`

### Version Numbering Strategy

**0.x.x** - Initial development, API not stable
**1.0.0** - First stable release
**1.x.0** - New features, backward compatible
**1.x.x** - Bug fixes only
**2.0.0** - Breaking changes

### Documentation Standards

**README.md** - User-facing documentation:
- Installation instructions
- Quick start guide
- Feature overview
- Configuration options
- Examples
- Troubleshooting

**DEPENDENCIES.md** - External requirements:
- System dependencies
- npm packages
- Other plugins
- Environment variables

**Inline Comments** - Code and configuration:
- Explain why, not what
- Document complex logic
- Note gotchas and edge cases

## Examples

### Minimal Plugin Example

**Directory Structure**:
```
minimal-plugin/
├── plugin.json
├── README.md
└── skills/
    └── core-skill/
        └── SKILL.md
```

**plugin.json**:
```json
{
  "name": "minimal-plugin",
  "version": "1.0.0",
  "description": "A minimal Claude Code plugin example",
  "author": "Your Name <email@example.com>",
  "license": "MIT",
  "tags": ["example", "minimal"],
  "keywords": ["example", "template", "minimal"],
  "skills": [
    {
      "name": "core-skill",
      "path": "skills/core-skill/SKILL.md",
      "description": "Core functionality"
    }
  ]
}
```

### Full-Featured Plugin Example

**Directory Structure**:
```
full-plugin/
├── plugin.json
├── README.md
├── DEPENDENCIES.md
├── skills/
│   ├── skill-one/
│   │   └── SKILL.md
│   └── skill-two/
│       └── SKILL.md
├── commands/
│   ├── command-one.md
│   └── command-two.md
├── agents/
│   ├── agent-one.md
│   └── agent-two.md
├── hooks/
│   └── hooks.json
├── mcp-servers/
│   └── servers.json
└── examples/
    └── example-workflow.md
```

**plugin.json**:
```json
{
  "name": "full-plugin",
  "version": "2.1.0",
  "description": "A full-featured plugin with all components",
  "author": "Your Name <email@example.com>",
  "license": "MIT",
  "homepage": "https://github.com/yourusername/full-plugin",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/full-plugin.git"
  },
  "tags": ["development", "testing", "automation"],
  "keywords": ["test", "dev", "workflow", "automation"],
  "skills": [
    {
      "name": "skill-one",
      "path": "skills/skill-one/SKILL.md",
      "description": "Primary skill functionality"
    },
    {
      "name": "skill-two",
      "path": "skills/skill-two/SKILL.md",
      "description": "Secondary skill functionality"
    }
  ],
  "skillBundles": [
    {
      "name": "core",
      "description": "Core skills loaded by default",
      "skills": ["skill-one", "skill-two"]
    }
  ],
  "commands": [
    {
      "name": "/command-one",
      "path": "commands/command-one.md",
      "description": "Primary command"
    },
    {
      "name": "/command-two",
      "path": "commands/command-two.md",
      "description": "Secondary command"
    }
  ],
  "agents": [
    {
      "name": "agent-one",
      "path": "agents/agent-one.md",
      "description": "Primary agent"
    },
    {
      "name": "agent-two",
      "path": "agents/agent-two.md",
      "description": "Specialized agent"
    }
  ],
  "hooks": {
    "enabled": true,
    "configPath": "hooks/hooks.json"
  },
  "mcpServers": {
    "enabled": true,
    "configPath": "mcp-servers/servers.json"
  },
  "dependencies": {
    "system": ["node>=18.0.0", "git"],
    "npm": ["typescript@^5.0.0", "prettier@^3.0.0"]
  },
  "compatibility": {
    "claudeCode": ">=1.0.0"
  }
}
```

## Summary

### Key Takeaways

1. **Standardization is Critical**: Use templates and patterns consistently across all plugins
2. **Frontmatter is Required**: Every component needs complete metadata
3. **Documentation is Part of the Product**: README, DEPENDENCIES, examples are not optional
4. **Test Before Release**: Verify all components work as documented
5. **Version Properly**: Follow semantic versioning for predictability
6. **Keep It Simple**: Focus components on single responsibilities
7. **Use Skill Bundles**: Group related skills for easier loading
8. **Handle Errors Gracefully**: Provide clear messages and recovery paths
9. **Document Dependencies**: System, npm, and plugin requirements
10. **Follow Naming Conventions**: Lowercase-hyphen-separated everywhere

### Quick Reference

| Component | File Extension | Required Frontmatter | Naming Pattern |
|-----------|---------------|---------------------|----------------|
| Plugin Manifest | .json | N/A | plugin.json |
| Skill | .md | name, description, version, plugin, updated | SKILL.md in named directory |
| Command | .md | name, description, version, plugin, updated | command-name.md |
| Agent | .md | name, description, version, tools, plugin, updated | agent-name.md |
| Hooks Config | .json | N/A | hooks.json |
| MCP Config | .json | N/A | servers.json |

### When to Use This Skill

- Creating a new Claude Code plugin from scratch
- Standardizing an existing plugin structure
- Implementing builder patterns for plugin components
- Designing plugin architecture for teams
- Reviewing plugin quality and consistency
- Onboarding new plugin developers

---

*Inspired by the Magus ecosystem and Claude Code plugin architecture*
