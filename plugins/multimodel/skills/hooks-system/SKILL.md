---
name: hooks-system
description: Comprehensive lifecycle hook patterns for Claude Code workflows. Use when configuring PreToolUse, PostToolUse, UserPromptSubmit, Stop, or SubagentStop hooks. Covers hook matchers, command hooks, prompt hooks, validation, metrics, auto-formatting, and security patterns. Trigger keywords - "hooks", "PreToolUse", "PostToolUse", "lifecycle", "tool matcher", "hook template", "auto-format", "security hook", "validation hook".
version: 0.1.0
tags: [orchestration, hooks, lifecycle, PreToolUse, PostToolUse, UserPromptSubmit, validation, security]
keywords: [hooks, lifecycle, pre-tool, post-tool, user-prompt, session-start, stop, subagent, notification, permission, validation, auto-format, security, metrics]
plugin: multimodel
updated: 2026-01-28
---

# Hooks System

**Version:** 1.0.0
**Purpose:** Lifecycle hook patterns for validation, automation, security, and metrics in Claude Code workflows
**Status:** Production Ready

## Overview

Hooks are lifecycle callbacks that execute at specific points in the Claude Code workflow. They enable:
- **Validation** (block dangerous operations before execution)
- **Automation** (auto-format code after file changes)
- **Security** (enforce safety policies on commands and tools)
- **Metrics** (track tool usage, performance, costs)
- **Quality Control** (run tests after implementation changes)
- **Context Injection** (load project-specific context at session start)

Hooks transform Claude Code from a reactive assistant into a **proactive, policy-enforced development environment**.

---

## Hook Types Reference

Claude Code provides 7 hook types that fire at different lifecycle stages:

| Hook Type | When It Fires | Receives | Can Modify | Use Cases |
|-----------|---------------|----------|------------|-----------|
| **PreToolUse** | Before tool execution | Tool name, input | Tool input, can block | Validation, security checks, permission gates |
| **PostToolUse** | After tool completion | Tool name, input, output | Nothing (read-only) | Auto-format, metrics, notifications |
| **UserPromptSubmit** | User submits prompt | Prompt text | Nothing (read-only) | Complexity analysis, model routing, context injection |
| **SessionStart** | Session begins | Session metadata | Nothing (read-only) | Load project context, initialize environment |
| **Stop** | Main session stops | Session metadata | Nothing (read-only) | Completion validation, cleanup, final reports |
| **SubagentStop** | Sub-agent (Task) completes | Task metadata, output | Nothing (read-only) | Task metrics, result validation |
| **Notification** | System notification | Notification data | Nothing (read-only) | Alert logging, external integrations |
| **PermissionRequest** | Tool needs permission | Tool name, action | Nothing (read-only) | Custom approval workflows |

**Key Concepts:**

- **PreToolUse**: Only hook that can **block or modify** execution
- **PostToolUse**: Cannot modify output, but can trigger follow-up actions
- **Matcher**: Regex pattern to filter which tools trigger the hook
- **Hooks Array**: Commands to execute when hook fires (can run multiple)

---

## Hook Configuration in settings.json

Hooks are configured in `.claude/settings.json` under the `"hooks"` key:

### Basic Structure

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": ["echo 'File change detected'"]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": ["bun run format"]
      }
    ]
  }
}
```

### Configuration Properties

**matcher** (required):
- Regex pattern to match tool names
- Uses JavaScript regex syntax
- Examples:
  - `"^Write$"` - Matches only Write tool
  - `"^(Write|Edit)$"` - Matches Write or Edit
  - `".*"` - Matches all tools (use sparingly)
  - `"^Bash$"` - Matches Bash tool

**hooks** (required):
- Array of commands to execute
- Commands run sequentially
- Can be shell commands or custom scripts
- Each command runs in its own shell context

**continueOnError** (optional, default: true):
- `true`: Continue workflow if hook fails
- `false`: Stop workflow on hook failure
- Use `false` for critical validation hooks

**timeout** (optional, default: 30000ms):
- Maximum execution time for hook command
- In milliseconds (30000 = 30 seconds)
- Hook is killed if timeout exceeded

### Advanced Configuration Example

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Write$",
        "hooks": [
          "node scripts/validate-file.js",
          "node scripts/check-secrets.js"
        ],
        "continueOnError": false,
        "timeout": 10000
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": ["bun run format", "bun run lint --fix"],
        "continueOnError": true,
        "timeout": 60000
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/analyze-complexity.js"]
      }
    ]
  }
}
```

---

## Ready-To-Use Hook Templates

### Template 1: File Protection Hook

**Purpose:** Block writes to sensitive files (secrets, credentials, config)

**Hook Type:** PreToolUse

**Matcher:** `"^(Write|Edit)$"`

**Configuration:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": ["node scripts/protect-files.js"],
        "continueOnError": false,
        "timeout": 5000
      }
    ]
  }
}
```

**Script: scripts/protect-files.js**

```javascript
#!/usr/bin/env node

const PROTECTED_PATTERNS = [
  /\.env$/,
  /\.env\./,
  /credentials\.json$/,
  /secrets\.yaml$/,
  /id_rsa$/,
  /\.pem$/,
  /\.key$/
];

const args = process.argv.slice(2);
const filePath = args[0] || '';

const isProtected = PROTECTED_PATTERNS.some(pattern => pattern.test(filePath));

if (isProtected) {
  console.error(`❌ BLOCKED: Cannot modify protected file: ${filePath}`);
  process.exit(1);
}

console.log(`✅ File write allowed: ${filePath}`);
process.exit(0);
```

**When to Use:**
- Protecting credentials and secrets
- Preventing accidental config file modifications
- Enforcing file-level permissions in team workflows

---

### Template 2: Auto-Format Hook

**Purpose:** Automatically format code after file changes

**Hook Type:** PostToolUse

**Matcher:** `"^(Write|Edit)$"`

**Configuration:**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": [
          "bun run format",
          "bun run lint --fix"
        ],
        "continueOnError": true,
        "timeout": 60000
      }
    ]
  }
}
```

**package.json Scripts:**

```json
{
  "scripts": {
    "format": "prettier --write .",
    "lint": "eslint . --ext .ts,.tsx,.js,.jsx"
  }
}
```

**When to Use:**
- Maintaining consistent code style
- Automatic linting and formatting
- Reducing manual formatting overhead
- Enforcing team style guidelines

**Benefits:**
- Every file change is auto-formatted
- No manual "run prettier" steps needed
- Consistent style across all changes
- Catches lint errors immediately

---

### Template 3: Security Command Blocker

**Purpose:** Block dangerous bash commands (rm -rf /, force push, etc.)

**Hook Type:** PreToolUse

**Matcher:** `"^Bash$"`

**Configuration:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": ["node scripts/security-check.js"],
        "continueOnError": false,
        "timeout": 5000
      }
    ]
  }
}
```

**Script: scripts/security-check.js**

```javascript
#!/usr/bin/env node

const DANGEROUS_COMMANDS = [
  /rm\s+-rf\s+\//,           // rm -rf /
  /rm\s+-rf\s+~\//,          // rm -rf ~/
  /git\s+push\s+.*--force/,   // git push --force
  /git\s+reset\s+--hard/,     // git reset --hard (main/master)
  /chmod\s+777/,              // chmod 777
  /sudo\s+rm/,                // sudo rm
  /:\(\)\{\s*:\|:&\s*\};:/,   // fork bomb
  /dd\s+if=.*of=\/dev\//,     // dd to device
  /mkfs/,                     // format filesystem
  />\s*\/dev\/sd/             // redirect to disk
];

const args = process.argv.slice(2);
const command = args.join(' ');

const isDangerous = DANGEROUS_COMMANDS.some(pattern => pattern.test(command));

if (isDangerous) {
  console.error(`❌ BLOCKED: Dangerous command detected: ${command}`);
  console.error('This command could cause data loss or system damage.');
  process.exit(1);
}

console.log(`✅ Command allowed: ${command}`);
process.exit(0);
```

**When to Use:**
- Production environments
- Shared development machines
- Preventing accidental destructive commands
- Enforcing security policies

**Protected Against:**
- Recursive deletion of root or home directories
- Force pushing to protected branches
- Destructive git operations
- System-level permission changes
- Fork bombs and other malicious commands

---

### Template 4: Task Complexity Analyzer

**Purpose:** Analyze prompt complexity and suggest appropriate model tier

**Hook Type:** UserPromptSubmit

**Matcher:** `".*"` (all prompts)

**Configuration:**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/analyze-complexity.js"]
      }
    ]
  }
}
```

**Script: scripts/analyze-complexity.js**

```javascript
#!/usr/bin/env node

const fs = require('fs');

const args = process.argv.slice(2);
const prompt = args.join(' ');

// Complexity scoring
let score = 0;

// Length-based scoring
if (prompt.length > 500) score += 2;
if (prompt.length > 1000) score += 3;

// Keyword-based scoring
const complexKeywords = [
  'implement', 'refactor', 'architect', 'design',
  'optimize', 'performance', 'security', 'scale'
];
const simpleKeywords = ['fix', 'update', 'change', 'modify'];

complexKeywords.forEach(keyword => {
  if (prompt.toLowerCase().includes(keyword)) score += 2;
});

simpleKeywords.forEach(keyword => {
  if (prompt.toLowerCase().includes(keyword)) score -= 1;
});

// Determine recommended model
let recommendation;
if (score >= 5) {
  recommendation = 'Claude Opus 4.5 (complex task)';
} else if (score >= 2) {
  recommendation = 'Claude Sonnet 4.5 (medium task)';
} else {
  recommendation = 'Claude Haiku 3.5 (simple task)';
}

// Log recommendation
const logEntry = {
  timestamp: new Date().toISOString(),
  prompt: prompt.substring(0, 100),
  score,
  recommendation
};

fs.appendFileSync('.claude/complexity-log.json', JSON.stringify(logEntry) + '\n');

console.log(`Complexity Score: ${score} - Recommended: ${recommendation}`);
process.exit(0);
```

**When to Use:**
- Cost optimization (use cheaper models for simple tasks)
- Automatic model routing based on task complexity
- Performance tracking (are prompts getting more complex?)
- Budget management (track usage patterns)

---

### Template 5: Metrics Collector

**Purpose:** Log tool usage to track productivity and patterns

**Hook Type:** PostToolUse

**Matcher:** `".*"` (all tools)

**Configuration:**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/collect-metrics.js"]
      }
    ]
  }
}
```

**Script: scripts/collect-metrics.js**

```javascript
#!/usr/bin/env node

const fs = require('fs');

const args = process.argv.slice(2);
const toolName = args[0] || 'unknown';
const duration = args[1] || '0';

const metric = {
  timestamp: new Date().toISOString(),
  tool: toolName,
  duration: parseInt(duration),
  session: process.env.CLAUDE_SESSION_ID || 'unknown'
};

// Append to metrics file
const metricsPath = '.claude/metrics.json';
fs.appendFileSync(metricsPath, JSON.stringify(metric) + '\n');

// Calculate daily stats
const today = new Date().toISOString().split('T')[0];
const metrics = fs.readFileSync(metricsPath, 'utf-8')
  .split('\n')
  .filter(line => line)
  .map(line => JSON.parse(line))
  .filter(m => m.timestamp.startsWith(today));

const toolCounts = metrics.reduce((acc, m) => {
  acc[m.tool] = (acc[m.tool] || 0) + 1;
  return acc;
}, {});

console.log(`Today's usage: ${JSON.stringify(toolCounts)}`);
process.exit(0);
```

**When to Use:**
- Tracking tool usage patterns
- Performance monitoring
- Cost analysis (which tools are expensive?)
- Productivity metrics (how many files changed today?)

**Metrics Collected:**
- Tool name (Write, Edit, Bash, etc.)
- Execution duration
- Timestamp
- Session ID

---

### Template 6: Test Runner Hook

**Purpose:** Automatically run tests when test files are modified

**Hook Type:** PostToolUse

**Matcher:** `"^(Write|Edit)$"`

**Configuration:**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": ["node scripts/auto-test.js"]
      }
    ]
  }
}
```

**Script: scripts/auto-test.js**

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const filePath = args[0] || '';

// Only run tests for test files
const isTestFile = /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath);

if (!isTestFile) {
  console.log('Not a test file, skipping auto-test');
  process.exit(0);
}

console.log(`Running tests for: ${filePath}`);

try {
  // Run the specific test file
  const output = execSync(`bun test ${filePath}`, {
    encoding: 'utf-8',
    timeout: 30000
  });

  console.log(output);
  console.log('✅ Tests passed');
  process.exit(0);
} catch (error) {
  console.error('❌ Tests failed:');
  console.error(error.stdout || error.message);
  process.exit(0); // Don't block workflow, just notify
}
```

**When to Use:**
- Test-driven development workflows
- Immediate feedback on test changes
- Catching broken tests before commit
- Continuous validation during implementation

---

### Template 7: Session Context Injector

**Purpose:** Load project-specific context at session start

**Hook Type:** SessionStart

**Matcher:** `".*"`

**Configuration:**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/load-context.js"]
      }
    ]
  }
}
```

**Script: scripts/load-context.js**

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Load project context files
const contextFiles = [
  'CLAUDE.md',
  'README.md',
  'ARCHITECTURE.md',
  '.claude/context.json'
];

const context = contextFiles
  .filter(file => fs.existsSync(file))
  .map(file => {
    const content = fs.readFileSync(file, 'utf-8');
    return `--- ${file} ---\n${content}\n`;
  })
  .join('\n');

// Write to session context file
const sessionContext = '.claude/session-context.txt';
fs.writeFileSync(sessionContext, context);

console.log('Session context loaded:');
contextFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`  ✅ ${file}`);
  }
});

process.exit(0);
```

**When to Use:**
- Ensuring Claude has project context every session
- Loading team guidelines and conventions
- Auto-loading architecture documentation
- Reducing need for manual context sharing

---

### Template 8: Completion Evaluator

**Purpose:** Validate that deliverables were produced before session ends

**Hook Type:** Stop

**Matcher:** `".*"`

**Configuration:**

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/evaluate-completion.js"]
      }
    ]
  }
}
```

**Script: scripts/evaluate-completion.js**

```javascript
#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

// Check if deliverables directory exists
const deliverablesPath = 'ai-docs/deliverables';

if (!fs.existsSync(deliverablesPath)) {
  console.log('⚠️  Warning: No deliverables directory found');
  process.exit(0);
}

// Count deliverables
const files = fs.readdirSync(deliverablesPath);

if (files.length === 0) {
  console.log('⚠️  Warning: No deliverables produced in this session');
} else {
  console.log(`✅ Session completed with ${files.length} deliverables:`);
  files.forEach(file => console.log(`  - ${file}`));
}

// Get git status
try {
  const status = execSync('git status --short', { encoding: 'utf-8' });
  const changedFiles = status.split('\n').filter(line => line).length;
  console.log(`📝 ${changedFiles} files changed`);
} catch (error) {
  // Not a git repo, skip
}

process.exit(0);
```

**When to Use:**
- Ensuring deliverables are produced
- Session quality validation
- Tracking productivity (files changed, deliverables created)
- Alerting when session ends without output

---

## Hook Chains

### Execution Flow

**PreToolUse → Tool Execution → PostToolUse**

1. **PreToolUse hooks run first**
   - Can modify tool input
   - Can block execution (exit code != 0)
   - If blocked, tool never executes

2. **Tool executes**
   - Only if PreToolUse passed
   - Normal tool behavior

3. **PostToolUse hooks run after**
   - Cannot modify tool output
   - Cannot block tool (already executed)
   - Can trigger follow-up actions

### Multiple Hooks on Same Event

When multiple hooks are configured for the same event, they execute **sequentially in array order**:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": [
          "bun run format",      // Runs first
          "bun run lint --fix",  // Runs second
          "bun test"             // Runs third
        ]
      }
    ]
  }
}
```

**Execution Order:**
1. `bun run format` executes
2. Wait for completion (or timeout)
3. `bun run lint --fix` executes
4. Wait for completion (or timeout)
5. `bun test` executes
6. PostToolUse complete

**Error Handling:**
- If `continueOnError: true` (default), failure in step 1 doesn't stop step 2
- If `continueOnError: false`, failure in step 1 stops entire chain

### Combining Hooks for Comprehensive Workflows

**Example: Full-Stack Quality Chain**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": ["node scripts/protect-files.js"],
        "continueOnError": false
      },
      {
        "matcher": "^Bash$",
        "hooks": ["node scripts/security-check.js"],
        "continueOnError": false
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": [
          "bun run format",
          "bun run lint --fix",
          "node scripts/auto-test.js",
          "node scripts/collect-metrics.js"
        ],
        "continueOnError": true
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/analyze-complexity.js"]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/evaluate-completion.js"]
      }
    ]
  }
}
```

**Workflow:**

1. **User submits prompt** → Complexity analyzed
2. **User requests file write** → File protection checked (PreToolUse)
3. **Write tool executes** → File written
4. **PostToolUse chain runs:**
   - Format code with Prettier
   - Fix lint issues
   - Run relevant tests
   - Log metrics
5. **User requests bash command** → Security check (PreToolUse)
6. **Session ends** → Completion evaluation

This creates a **fully automated quality pipeline** with zero manual intervention.

---

## Best Practices

### Do:

- ✅ **Use PreToolUse for validation** - It's the only hook that can block execution
- ✅ **Set appropriate timeouts** - Hooks should complete quickly (5-30 seconds)
- ✅ **Log hook activity** - Track what hooks are doing for debugging
- ✅ **Use specific matchers** - Avoid `.*` matcher when possible (reduces overhead)
- ✅ **Exit with proper codes** - Exit 0 for success, non-zero for failure
- ✅ **Make hooks idempotent** - Safe to run multiple times
- ✅ **Test hooks independently** - Run hook scripts manually before adding to config
- ✅ **Use continueOnError wisely** - False for critical validation, true for nice-to-have

### Don't:

- ❌ **Don't use PostToolUse for validation** - Tool already executed, too late to block
- ❌ **Don't run expensive operations** - Hooks should be fast (<30s)
- ❌ **Don't rely on environment state** - Each hook runs in fresh shell
- ❌ **Don't modify files in PreToolUse** - Modifying files during validation causes confusion
- ❌ **Don't use `.*` matcher everywhere** - Creates overhead on every tool call
- ❌ **Don't swallow errors silently** - Log errors even with continueOnError: true

### Performance Tips:

**Fast Hooks (<5s):**
- File validation checks
- Regex-based security checks
- Simple logging/metrics
- Quick script executions

**Medium Hooks (5-30s):**
- Code formatting (prettier)
- Linting with auto-fix
- Unit test execution
- Complexity analysis

**Slow Hooks (>30s) - AVOID:**
- Full test suite execution (use PostToolUse with specific test files instead)
- External API calls with retries
- Large file processing
- Heavy computations

**Optimization:**
- Use hook matchers to limit when hooks run
- Run heavy operations in background (don't block workflow)
- Cache results when possible
- Use incremental tools (only format changed files)

---

## Examples

### Example 1: Full-Stack Development Hook Setup

**Scenario:** React/TypeScript project with comprehensive quality automation

**Configuration:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": ["node scripts/protect-files.js"],
        "continueOnError": false,
        "timeout": 5000
      },
      {
        "matcher": "^Bash$",
        "hooks": ["node scripts/security-check.js"],
        "continueOnError": false,
        "timeout": 5000
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": [
          "bun run format",
          "bun run lint --fix",
          "node scripts/auto-test.js"
        ],
        "continueOnError": true,
        "timeout": 60000
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/analyze-complexity.js"]
      }
    ],
    "SessionStart": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/load-context.js"]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/evaluate-completion.js"]
      }
    ]
  }
}
```

**Workflow:**

1. **Session starts** → Project context loaded (CLAUDE.md, README.md, ARCHITECTURE.md)
2. **User: "Implement login feature"** → Complexity analyzed (score: 5, recommend Sonnet)
3. **Claude writes LoginForm.tsx** →
   - PreToolUse: File protection check passes ✅
   - Write tool executes
   - PostToolUse chain:
     - Format with Prettier ✅
     - Lint with ESLint ✅
     - Run LoginForm.test.tsx ✅
4. **User: "Run database migration"** →
   - PreToolUse: Security check blocks `rm -rf /` in migration script ❌
   - Error shown to user
5. **Session ends** → Completion evaluation: 5 files changed, 3 deliverables created

**Benefits:**
- Zero manual formatting/linting
- Immediate test feedback
- Dangerous commands blocked
- Full audit trail via metrics
- Consistent quality across all changes

---

### Example 2: Security-Hardened Hook Configuration

**Scenario:** Production environment with strict security policies

**Configuration:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Write$",
        "hooks": [
          "node scripts/security/check-secrets.js",
          "node scripts/security/validate-permissions.js",
          "node scripts/security/check-file-size.js"
        ],
        "continueOnError": false,
        "timeout": 10000
      },
      {
        "matcher": "^Edit$",
        "hooks": [
          "node scripts/security/backup-file.js",
          "node scripts/security/check-secrets.js"
        ],
        "continueOnError": false,
        "timeout": 10000
      },
      {
        "matcher": "^Bash$",
        "hooks": [
          "node scripts/security/command-whitelist.js",
          "node scripts/security/check-dangerous.js"
        ],
        "continueOnError": false,
        "timeout": 5000
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/security/audit-log.js"],
        "continueOnError": true
      }
    ]
  }
}
```

**Security Layers:**

1. **Secrets Detection** - Blocks files containing API keys, passwords, tokens
2. **Permission Validation** - Ensures Claude can only write to allowed directories
3. **File Size Limits** - Prevents writing huge files (>10MB)
4. **File Backups** - Auto-backup before editing critical files
5. **Command Whitelist** - Only allow pre-approved bash commands
6. **Dangerous Command Blocker** - Block rm, format, force push, etc.
7. **Audit Logging** - Log every tool use to audit trail

**Example Script: scripts/security/check-secrets.js**

```javascript
#!/usr/bin/env node

const fs = require('fs');

const SECRETS_PATTERNS = [
  /api[_-]?key["\s:=]+[a-zA-Z0-9]{20,}/i,
  /password["\s:=]+.{8,}/i,
  /bearer\s+[a-zA-Z0-9\-._~+/]+=*/i,
  /AIza[0-9A-Za-z-_]{35}/,              // Google API Key
  /sk-[a-zA-Z0-9]{48}/,                  // OpenAI API Key
  /xox[baprs]-[0-9a-zA-Z-]{10,}/,       // Slack Token
  /github_pat_[a-zA-Z0-9]{82}/          // GitHub PAT
];

const args = process.argv.slice(2);
const filePath = args[0];
const content = fs.readFileSync(filePath, 'utf-8');

const foundSecret = SECRETS_PATTERNS.find(pattern => pattern.test(content));

if (foundSecret) {
  console.error('❌ BLOCKED: File contains potential secrets');
  console.error(`Pattern matched: ${foundSecret}`);
  console.error('Remove secrets before writing to file.');
  process.exit(1);
}

console.log('✅ No secrets detected');
process.exit(0);
```

---

### Example 3: Multi-Agent Workflow with Routing Hooks

**Scenario:** Complex workflows that route to different agents based on prompt

**Configuration:**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/routing/analyze-intent.js"]
      }
    ],
    "SubagentStop": [
      {
        "matcher": ".*",
        "hooks": ["node scripts/routing/collect-results.js"]
      }
    ]
  }
}
```

**Script: scripts/routing/analyze-intent.js**

```javascript
#!/usr/bin/env node

const fs = require('fs');

const args = process.argv.slice(2);
const prompt = args.join(' ');

// Intent classification
const intents = {
  'ui-design': ['design', 'figma', 'mockup', 'ui', 'ux', 'interface'],
  'backend': ['api', 'database', 'server', 'endpoint', 'authentication'],
  'testing': ['test', 'spec', 'coverage', 'e2e', 'unit test'],
  'devops': ['deploy', 'docker', 'ci/cd', 'kubernetes', 'pipeline'],
  'review': ['review', 'audit', 'analyze', 'check quality']
};

let detectedIntent = 'general';
let maxScore = 0;

for (const [intent, keywords] of Object.entries(intents)) {
  const score = keywords.filter(kw =>
    prompt.toLowerCase().includes(kw)
  ).length;

  if (score > maxScore) {
    maxScore = score;
    detectedIntent = intent;
  }
}

// Write routing decision
const routingDecision = {
  timestamp: new Date().toISOString(),
  prompt: prompt.substring(0, 100),
  intent: detectedIntent,
  confidence: maxScore
};

fs.writeFileSync('.claude/routing-decision.json', JSON.stringify(routingDecision));

console.log(`Intent: ${detectedIntent} (confidence: ${maxScore})`);

// Suggest agent
const agentMap = {
  'ui-design': 'designer',
  'backend': 'backend-developer',
  'testing': 'test-architect',
  'devops': 'devops-engineer',
  'review': 'code-reviewer'
};

const suggestedAgent = agentMap[detectedIntent] || 'developer';
console.log(`Suggested agent: ${suggestedAgent}`);

process.exit(0);
```

**Script: scripts/routing/collect-results.js**

```javascript
#!/usr/bin/env node

const fs = require('fs');

const args = process.argv.slice(2);
const agentName = args[0];
const status = args[1] || 'completed';

// Load previous results
let results = [];
if (fs.existsSync('.claude/agent-results.json')) {
  results = JSON.parse(fs.readFileSync('.claude/agent-results.json', 'utf-8'));
}

// Add new result
results.push({
  timestamp: new Date().toISOString(),
  agent: agentName,
  status: status
});

fs.writeFileSync('.claude/agent-results.json', JSON.stringify(results, null, 2));

console.log(`Collected result from ${agentName}: ${status}`);
console.log(`Total agents completed: ${results.length}`);

process.exit(0);
```

**Workflow:**

1. **User: "Design login page and implement API"**
2. **UserPromptSubmit hook:**
   - Analyzes intent: Mixed (ui-design + backend)
   - Suggests: Use orchestrator to coordinate multiple agents
3. **Orchestrator launches:**
   - designer agent (for UI)
   - backend-developer agent (for API)
4. **SubagentStop hook fires after each:**
   - designer completes → Result collected
   - backend-developer completes → Result collected
5. **Final report:** 2 agents completed successfully

---

## Troubleshooting

### Problem: Hook never fires

**Cause:** Matcher regex doesn't match tool name

**Solution:** Test regex pattern

```bash
# Test if matcher matches tool name
node -e "console.log(/^Write$/.test('Write'))"  # Should print: true
node -e "console.log(/^write$/.test('Write'))"  # Should print: false (case-sensitive)
```

**Fix:**
```json
{
  "matcher": "^Write$"   // Correct (matches Write exactly)
  // NOT "^write$"       // Wrong (lowercase doesn't match)
}
```

---

### Problem: Hook blocks workflow unintentionally

**Cause:** Hook script exits with non-zero code (failure)

**Solution:** Debug hook script independently

```bash
# Run hook script manually
node scripts/protect-files.js /path/to/file
echo $?  # Should print 0 for success, 1 for failure
```

**Fix:** Ensure script exits with correct code

```javascript
// ❌ Wrong - implicit exit code
if (isProtected) {
  console.error('File protected');
  // Missing process.exit()
}

// ✅ Correct - explicit exit codes
if (isProtected) {
  console.error('File protected');
  process.exit(1);  // Non-zero = failure
}

console.log('File allowed');
process.exit(0);  // Zero = success
```

---

### Problem: Hook times out

**Cause:** Hook script takes too long (>30s default)

**Solution:** Increase timeout or optimize script

```json
{
  "matcher": "^(Write|Edit)$",
  "hooks": ["bun test"],
  "timeout": 120000  // Increase to 2 minutes
}
```

**Better Solution:** Optimize script to run faster

```javascript
// ❌ Slow - runs ALL tests
execSync('bun test');

// ✅ Fast - runs only relevant test file
const testFile = filePath.replace(/\.ts$/, '.test.ts');
if (fs.existsSync(testFile)) {
  execSync(`bun test ${testFile}`);
}
```

---

### Problem: Hooks interfere with each other

**Cause:** Multiple hooks modify same files simultaneously

**Solution:** Use proper ordering in hooks array

```json
{
  "PostToolUse": [
    {
      "matcher": "^(Write|Edit)$",
      "hooks": [
        "bun run format",     // First: format
        "bun run lint --fix"  // Second: lint (after format)
        // NOT both at same time
      ]
    }
  ]
}
```

**Explanation:** Hooks in array run **sequentially**, not parallel. This ensures format completes before lint starts.

---

## Summary

Hooks enable proactive, policy-enforced development in Claude Code:

- **7 Hook Types** - PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop, SubagentStop, Notification, PermissionRequest
- **PreToolUse = Validation** - Only hook that can block execution
- **PostToolUse = Automation** - Auto-format, metrics, notifications
- **Matchers = Filtering** - Regex patterns to control when hooks fire
- **Chains = Workflows** - Multiple hooks execute sequentially
- **Templates = Ready-to-Use** - 8 production-ready templates for common needs

**Use Cases:**
- Security (block dangerous commands, detect secrets)
- Quality (auto-format, lint, test after changes)
- Metrics (track tool usage, performance, costs)
- Context (load project docs at session start)
- Validation (ensure deliverables produced)

Master hooks and transform Claude Code into a **zero-overhead, fully automated development environment**.

---

**Inspired By:**
- Frontend plugin auto-format hooks (prettier + eslint on every file change)
- Code Analysis plugin security checks (dangerous command detection)
- Orchestration plugin metrics collection (tool usage tracking)
- Multi-agent workflows with routing hooks (intent-based agent selection)
