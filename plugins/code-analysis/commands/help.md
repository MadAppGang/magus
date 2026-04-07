---
name: code-analysis-help
description: Show comprehensive help for the Code Analysis Plugin - lists agents, commands, skills, and usage examples
allowed-tools: Read
---

# Code Analysis Plugin Help

Present the following help information to the user:

---

## Code Analysis Plugin v3.1.0

**Deep code investigation using INDEXED MEMORY (mnemex). GREP/FIND FORBIDDEN.**

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

## Skills (4)

| Skill | Description |
|-------|-------------|
| **investigate** | Code investigation with mode-based routing: architecture, implementation, testing, debugging |
| **deep-analysis** | Comprehensive multi-dimensional audit with all mnemex AST commands |
| **mnemex-search** | Expert guidance on mnemex CLI for semantic code search and AST analysis |
| **mnemex-orchestration** | Parallel multi-agent mnemex orchestration patterns |

### Which Skill Should I Use?

| Your Question Contains... | Use This Skill | Mode |
|--------------------------|----------------|------|
| "debug", "error", "broken", "failing", "crash" | **investigate** | Bug Investigation |
| "test", "coverage", "edge case", "mock" | **investigate** | Test Gap Analysis |
| "architecture", "design", "structure", "layer" | **investigate** | Architecture Analysis |
| "implementation", "how does", "code flow" | **investigate** | Implementation Tracing |
| "comprehensive audit", "full review", "all dimensions" | **deep-analysis** | All dimensions |

**Examples:**
- "Why is login broken?" → investigate (Bug Investigation mode)
- "What's tested?" → investigate (Test Gap Analysis mode)
- "What's the architecture?" → investigate (Architecture Analysis mode)
- "How does auth work?" → investigate (Implementation Tracing mode)
- "Full codebase audit" → deep-analysis

### Quick Reference

| Scenario | Skill |
|----------|-------|
| General investigation | `code-analysis:investigate` |
| Architecture, implementation, tests, bugs | `code-analysis:investigate` |
| Comprehensive multi-dimensional audit | `code-analysis:deep-analysis` |
| mnemex commands guidance | `code-analysis:mnemex-search` |
| Parallel multi-agent orchestration | `code-analysis:mnemex-orchestration` |
| Claudish CLI usage | `multimodel:claudish-usage` |

**Integration Patterns:**
- Use `investigate` for targeted single-dimension analysis
- Use `deep-analysis` for comprehensive audits requiring all 7 dimensions
- Use `mnemex-search` before any direct mnemex command usage

### Semantic Code Search with mnemex

For large codebases, use mnemex CLI:

**Install:**
```bash
npm install -g claude-codemem
mnemex init     # Configure OpenRouter API key
mnemex --models # See available embedding models
```

**Usage:**
```bash
mnemex index              # Index codebase (once)
mnemex search "auth flow" # Semantic search
mnemex status             # Check index
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
/plugin marketplace add MadAppGang/magus

# Install plugin
/plugin install code-analysis@magus
```

**Optional**: For semantic code search, install mnemex: `npm install -g claude-codemem`

---

## More Info

- **Repo**: https://github.com/MadAppGang/magus
- **Author**: Jack Rudenko @ MadAppGang
