---
description: Show comprehensive help for the Code Analysis Plugin - lists agents, commands, skills, and usage examples
allowed-tools: Read
---

# Code Analysis Plugin Help

Present the following help information to the user:

---

## Code Analysis Plugin v1.5.0

**Deep code investigation and analysis toolkit for understanding complex codebases.**

### Quick Start

```bash
/analyze How is authentication implemented in this app?
```

---

## Agents (1)

| Agent | Description | Model |
|-------|-------------|-------|
| **codebase-detective** | Investigates codebases to understand patterns, trace flows, find implementations, analyze architecture, track bugs | Sonnet |

### When to Use

- Understanding how a feature works
- Finding where specific logic is implemented
- Tracing data flow through the application
- Investigating bugs and their root causes
- Analyzing code relationships and dependencies

---

## Commands (2)

| Command | Description |
|---------|-------------|
| **/analyze** | Launch deep codebase investigation for a specific question |
| **/help** | Show this help |

### Examples

```bash
/analyze How does the payment processing work?
/analyze Where are API endpoints defined?
/analyze What's the authentication flow?
/analyze Find all usages of the UserService class
```

---

## Skills (2)

| Skill | Description |
|-------|-------------|
| **deep-analysis** | Automatic code investigation patterns - proactively analyzes code |
| **claudemem-search** | Expert guidance on claudemem CLI for local semantic code search |

### Semantic Code Search with claudemem

For large codebases, use claudemem CLI:

**Install:**
```bash
npm install -g claude-codemem
claudemem init     # Configure OpenRouter API key
claudemem --models # See available embedding models
```

**Usage:**
```bash
claudemem index              # Index codebase (once)
claudemem search "auth flow" # Semantic search
claudemem status             # Check index
```

**Embedding Models:**
- `voyage/voyage-code-3` - Best quality (default) - $0.180/1M
- `qwen/qwen3-embedding-8b` - Best balanced - $0.010/1M
- `qwen/qwen3-embedding-0.6b` - Best value - $0.002/1M

**Benefits:**
- Tree-sitter AST parsing (preserves code structure)
- Local LanceDB storage (no cloud dependency)
- Find code by functionality, not just keywords

---

## Use Cases

| Scenario | How It Helps |
|----------|--------------|
| **New to codebase** | Understand architecture and patterns |
| **Bug investigation** | Trace issues to root cause |
| **Feature planning** | Find integration points |
| **Code review** | Understand context of changes |
| **Documentation** | Extract how things work |

---

## Integration with Frontend Plugin

The code-analysis plugin is recommended alongside frontend.
The `/implement` command will suggest it for better codebase understanding.

---

## Installation

```bash
# Add marketplace (one-time)
/plugin marketplace add MadAppGang/claude-code

# Install plugin
/plugin install code-analysis@mag-claude-plugins
```

**Optional**: For semantic code search, install claudemem: `npm install -g claude-codemem`

---

## More Info

- **Repo**: https://github.com/MadAppGang/claude-code
- **Author**: Jack Rudenko @ MadAppGang
