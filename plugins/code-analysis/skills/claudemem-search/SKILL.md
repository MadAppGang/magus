---
name: claudemem-search
description: Expert guidance on using the claudemem CLI for local semantic code search. Provides installation validation, best practices for indexing with Tree-sitter, formulating effective search queries, and MCP server integration. Use when working with large codebases requiring semantic search without cloud dependencies. Alternative to claude-context MCP.
allowed-tools: Bash, Task, AskUserQuestion
---

# Claudemem Semantic Code Search Expert

This Skill provides comprehensive guidance on leveraging the **claudemem** CLI tool for efficient, local semantic code search using hybrid vector retrieval (BM25 + OpenRouter embeddings).

## Tool Overview

**claudemem** is a local-first semantic code search CLI that:
- Uses **Tree-sitter** for AST-aware code parsing (preserves function/class boundaries)
- Generates embeddings via **OpenRouter** (free tier available)
- Stores vectors locally in **LanceDB** (no cloud dependency for storage)
- Supports hybrid search: BM25 keyword matching + dense vector similarity
- Can run as **MCP server** for Claude Code integration

### Key Differences from Claude-Context

| Feature | claudemem | claude-context |
|---------|-----------|----------------|
| Embedding Provider | OpenRouter | OpenAI |
| Vector Storage | LanceDB (local) | Zilliz Cloud |
| Parsing | Tree-sitter AST | AST/LangChain |
| MCP Mode | `claudemem --mcp` | Built-in |
| API Key Required | OPENROUTER_API_KEY | OPENAI_API_KEY + MILVUS_TOKEN |
| Cloud Dependency | None (embeddings only) | Zilliz Cloud required |

**Choose claudemem when:**
- You prefer local-only storage
- You have OpenRouter API key (or want to use free tier)
- You don't want Zilliz Cloud dependency
- You need Tree-sitter AST parsing for specific languages

**Choose claude-context when:**
- You already have OpenAI + Zilliz credentials
- You want cloud-synced indexes across machines
- You prefer proven MCP integration

## When to Use This Skill

Claude should invoke this Skill when:

- User mentions: "claudemem", "tree-sitter search", "local semantic search"
- User wants semantic search WITHOUT cloud dependencies
- User asks: "install claudemem", "set up local code search"
- User has OpenRouter API key but not OpenAI/Zilliz
- Before launching codebase-detective when claudemem is preferred
- User asks about alternatives to claude-context

## Phase 1: Installation Validation (REQUIRED)

### Step 1: Check if claudemem is Installed

```bash
# Check if claudemem CLI is available
which claudemem || command -v claudemem

# Check version
claudemem --version
```

**If NOT installed**, present installation options:

```typescript
AskUserQuestion({
  questions: [{
    question: "claudemem CLI not found. How would you like to install it?",
    header: "Install",
    multiSelect: false,
    options: [
      { label: "npm (Recommended)", description: "npm install -g claude-codemem" },
      { label: "Homebrew (macOS)", description: "brew tap MadAppGang/claude-mem && brew install --cask claudemem" },
      { label: "Shell script", description: "curl -fsSL https://raw.githubusercontent.com/MadAppGang/claudemem/main/install.sh | bash" },
      { label: "Skip installation", description: "I'll install it manually later" }
    ]
  }]
})
```

**Execute installation based on choice:**

```bash
# npm (works everywhere)
npm install -g claude-codemem

# Homebrew (macOS)
brew tap MadAppGang/claude-mem && brew install --cask claudemem

# Shell script
curl -fsSL https://raw.githubusercontent.com/MadAppGang/claudemem/main/install.sh | bash
```

### Step 2: Check Configuration

```bash
# Check if initialized (looks for config)
ls ~/.claudemem/config.json 2>/dev/null || echo "Not configured"

# Check for project-local index
ls .claudemem/ 2>/dev/null || echo "No local index"
```

**If NOT configured**, run init wizard:

```bash
claudemem init
```

This prompts for:
- OpenRouter API key (required)
- Embedding model selection

### Step 2.5: Choose Embedding Model

Run `claudemem --models` to see available embedding models:

```bash
claudemem --models
```

**Curated Picks:**

| Model | Best For | Price | Context |
|-------|----------|-------|---------|
| `voyage/voyage-code-3` | **Best Quality** (default) | $0.180/1M | 32K |
| `qwen/qwen3-embedding-8b` | Best Balanced | $0.010/1M | 33K |
| `qwen/qwen3-embedding-0.6b` | Best Value | $0.002/1M | 33K |
| `sentence-transformers/all-minilm-l6-v2` | Fastest | $0.005/1M | 1K |

**Recommendation**: Use `voyage/voyage-code-3` for best code understanding (default).

The tool remembers your model choice after first configuration.

### Step 3: Validate OpenRouter API Key

```bash
# Test API connection by checking available models
claudemem models
```

If this fails, guide user to get API key:
```
To get an OpenRouter API key:
1. Go to https://openrouter.ai/keys
2. Sign up (free tier available)
3. Create new API key
4. Run: claudemem init
```

## Phase 2: Indexing Best Practices

### 2.1 Initial Indexing

```bash
# Index current directory
claudemem index

# Index specific path
claudemem index /path/to/project

# Skip confirmation prompts (for automation)
claudemem index -y
```

**What happens during indexing:**
1. Tree-sitter parses code into semantic units (functions, classes, methods)
2. OpenRouter generates embeddings for each chunk
3. LanceDB stores vectors locally in `.claudemem/` directory

### 2.2 Supported Languages

Tree-sitter parsing works best for:
- TypeScript / JavaScript
- Python
- Go
- Rust
- C / C++
- Java

**Unsupported languages** fall back to line-based chunking (still works, less semantic).

### 2.3 Check Indexing Status

```bash
claudemem status
```

Output example:
```
Indexed: 1,234 chunks from 567 files
Last indexed: 2025-12-12 10:30:00
Languages: TypeScript (456), Go (111)
```

### 2.4 Re-indexing

```bash
# Clear and re-index
claudemem clear && claudemem index

# Auto re-index happens on search if files changed
claudemem search "query" --no-reindex  # Skip auto-reindex
```

## Phase 3: Search Query Formulation

### 3.1 Basic Search

```bash
# Natural language query
claudemem search "user authentication login flow"

# Limit results
claudemem search "database connection" -n 5

# Filter by language
claudemem search "HTTP handler" -l go
```

### 3.2 Effective Query Patterns

**Concept-Based Queries (Best):**
```bash
claudemem search "user authentication login flow with JWT tokens"
claudemem search "database connection pooling initialization"
claudemem search "error handling middleware for HTTP requests"
```

**Why These Work:**
- Natural language describes WHAT the code does
- Multiple related concepts improve relevance
- Captures intent, not just syntax

**Avoid These:**
```bash
# Too generic
claudemem search "user"

# Too specific/technical (use grep instead)
claudemem search "express.Router().post('/api/users')"
```

### 3.3 Query Templates by Use Case

**Authentication:**
```bash
claudemem search "user login authentication with password validation"
claudemem search "JWT token generation and validation"
claudemem search "OAuth2 authentication flow"
```

**Database Operations:**
```bash
claudemem search "user data persistence save to database"
claudemem search "SQL query execution with prepared statements"
claudemem search "database transaction commit and rollback"
```

**API Endpoints:**
```bash
claudemem search "HTTP POST endpoint for creating users"
claudemem search "GraphQL resolver for user queries"
claudemem search "REST API handler for updating profile"
```

**Error Handling:**
```bash
claudemem search "global error handler for uncaught exceptions"
claudemem search "validation error formatting for API responses"
claudemem search "retry logic for failed requests"
```

## Phase 4: MCP Server Integration

### 4.1 Running as MCP Server

```bash
# Start MCP server
claudemem --mcp
```

**MCP Tools Available:**
- `search_code` - Semantic search with auto-reindexing
- `index_codebase` - Manual full reindex
- `get_status` - Index status
- `clear_index` - Reset index

### 4.2 Adding to Claude Code

```bash
# Add claudemem as MCP server
claude mcp add claudemem \
  -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  -- claudemem --mcp
```

### 4.3 Using MCP Tools

Once configured as MCP, use tools like:

```typescript
// Search via MCP
mcp__claudemem__search_code({
  query: "authentication flow"
})

// Index via MCP
mcp__claudemem__index_codebase({
  path: "/project"
})

// Check status
mcp__claudemem__get_status({})
```

## Phase 5: Integration with Detective Agent

### Workflow with Codebase-Detective

```markdown
# When investigating codebase:

## Step 1: Validate claudemem is installed
which claudemem

## Step 2: Index (if needed)
claudemem status || claudemem index

## Step 3: Search semantically
claudemem search "user authentication login flow"
claudemem search "password validation and hashing"

## Step 4: Launch codebase-detective with findings
Task tool with search results as context
```

### Combining with Grep

```bash
# 1. Semantic search for general area
claudemem search "HTTP request middleware authentication" -n 10

# 2. Grep for specific patterns in found files
grep -r "req\.user|req\.auth" src/middleware/

# 3. Read exact implementations
cat src/middleware/auth.ts
```

## Phase 6: Troubleshooting

### Problem: "claudemem: command not found"

```bash
# Check npm global path
npm list -g --depth=0 | grep claude-codemem

# Ensure npm bin is in PATH
export PATH="$(npm bin -g):$PATH"

# Or reinstall
npm install -g claude-codemem
```

### Problem: "OpenRouter API error"

```bash
# Check API key is set
echo $OPENROUTER_API_KEY

# Reconfigure
claudemem init
```

### Problem: "Indexing failed"

```bash
# Clear and retry
claudemem clear
claudemem index

# Check for unsupported file types
# Tree-sitter may fail on some languages
```

### Problem: "Search returns irrelevant results"

Solutions:
1. Make query more specific
2. Use language filter: `-l typescript`
3. Reduce limit to see top results: `-n 5`
4. Try different phrasing

## Phase 7: Best Practices Summary

### Installation

- **npm** is the most reliable installation method
- Always run `claudemem init` after installation
- Get OpenRouter API key from https://openrouter.ai/keys (free tier available)

### Indexing

- Index once, search many times
- Use `claudemem status` before re-indexing
- Add `.claudemem/` to `.gitignore` (local index)

### Searching

- Use natural language concept queries
- Start with 10 results, adjust as needed
- Use `-l` language filter for multi-language projects
- Combine with grep for precision

### MCP Integration

- Use `claudemem --mcp` for Claude Code integration
- Set OPENROUTER_API_KEY environment variable
- Consider as alternative to claude-context when you prefer local storage

## Quality Checklist

Before completing a claudemem workflow, ensure:

- [ ] claudemem CLI is installed and accessible
- [ ] OpenRouter API key is configured
- [ ] Codebase is indexed (check with `claudemem status`)
- [ ] Search queries use natural language concepts
- [ ] Results are relevant and actionable
- [ ] File locations are documented for follow-up

## Notes

- Requires OpenRouter API key (https://openrouter.ai) - all embedding models are paid
- Default model: `voyage/voyage-code-3` (best code understanding, $0.180/1M tokens)
- Run `claudemem --models` to see all available models and choose based on budget/quality
- All data stored locally in `.claudemem/` directory (no cloud storage)
- Tree-sitter provides excellent parsing for TypeScript, Go, Python, Rust
- Hybrid search combines keyword (BM25) + semantic (embeddings)
- Can run as MCP server with `--mcp` flag
- Initial indexing takes ~1-2 minutes for typical projects
- Automatic change detection re-indexes modified files on search

---

**Maintained by:** Jack Rudenko @ MadAppGang
**Plugin:** code-analysis v1.5.0
**Last Updated:** December 2025
