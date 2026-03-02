---
name: setup
description: Add claudemem MCP tools documentation to project CLAUDE.md and verify setup
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Setup Claudemem MCP Integration

This command sets up claudemem semantic search as MCP tools for this project.

## Steps

### 1. Check claudemem installation

```bash
which claudemem && claudemem --version
```

If not installed, guide user:
```bash
npm install -g claude-codemem
```

### 2. Check index status

Use the claudemem MCP tool if available, otherwise fall back to CLI:

```bash
claudemem status
```

If not indexed:
```bash
claudemem index
```

### 3. Verify MCP server configuration

Check that the code-analysis plugin's `.mcp.json` includes claudemem:

```json
{
  "claudemem": {
    "command": "claudemem",
    "args": ["--mcp"]
  }
}
```

### 4. Check CLAUDE.md for existing rules

Read the project's CLAUDE.md and look for the marker:
`## Code Search: CLAUDEMEM MCP`

### 5. If rules not present, ask user

```typescript
AskUserQuestion({
  questions: [{
    question: "Add claudemem MCP tools documentation to CLAUDE.md?",
    header: "Setup",
    multiSelect: false,
    options: [
      { label: "Yes, add docs (Recommended)", description: "Documents available MCP tools and recommended search workflow" },
      { label: "No, skip", description: "MCP tools still available, just no documentation in CLAUDE.md" }
    ]
  }]
})
```

### 6. Inject rules if user agrees

Append the contents of `templates/claude-md-rules.md` to the project CLAUDE.md.

### 7. Confirm setup

Report status:
- claudemem installed: Yes/No (version)
- claudemem indexed: Yes/No (file count)
- MCP server configured: Yes/No
- CLAUDE.md docs: Added/Already present/Skipped

## Success Message

```
claudemem MCP setup complete!

- 11 structured MCP tools available (search, map, symbol, callers, callees, etc.)
- Auto-reindexing on file changes (2-minute debounce)
- Freshness metadata on every response

Use ToolSearch with "claudemem" to discover available MCP tools.
```
