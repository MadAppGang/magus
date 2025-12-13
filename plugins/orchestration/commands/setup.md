---
name: setup
description: Add 4-Message Pattern enforcement rules to project CLAUDE.md and verify claudish setup
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Setup Multi-Model Validation Enforcement

This command sets up multi-model validation enforcement for this project.

## Steps

### 1. Check claudish installation

```bash
which claudish && claudish --version
```

If not installed, guide user:
```bash
npm install -g claudish
export OPENROUTER_API_KEY=your-key  # Get at openrouter.ai/keys
```

### 2. Check OpenRouter API key

```bash
[ -n "$OPENROUTER_API_KEY" ] && echo "API key configured" || echo "API key missing"
```

If missing:
```bash
export OPENROUTER_API_KEY=your-key
```

### 3. Test model availability

```bash
claudish --top-models
```

Show top recommended models for multi-model validation.

### 4. Check CLAUDE.md for existing rules

Read the project's CLAUDE.md and look for the marker:
`## Multi-Model Validation: 4-MESSAGE PATTERN ENFORCED`

### 5. If rules not present, ask user

```typescript
AskUserQuestion({
  questions: [{
    question: "Add 4-Message Pattern enforcement rules to CLAUDE.md?",
    header: "Setup",
    multiSelect: false,
    options: [
      { label: "Yes, add rules (Recommended)", description: "Adds documentation about parallel execution patterns" },
      { label: "No, skip", description: "Hooks will still work, just no documentation in CLAUDE.md" }
    ]
  }]
})
```

### 6. Inject rules if user agrees

Read the template from `${CLAUDE_PLUGIN_ROOT}/templates/claude-md-rules.md` and append to project CLAUDE.md.

### 7. Confirm setup

Report status:
- claudish installed: Yes/No
- OpenRouter API key: Configured/Missing
- Available models: List top 5
- CLAUDE.md rules: Added/Already present/Skipped
- Hooks active: Yes (via plugin.json)

## Success Message

```
Multi-Model Validation setup complete!

- 4-Message Pattern documented in CLAUDE.md
- Claudish ready for external model validation
- Session start will check claudish status

Available skills:
- orchestration:multi-model-validation
- orchestration:multi-agent-coordination
- orchestration:quality-gates
- orchestration:todowrite-orchestration
- orchestration:error-recovery

Test: Use /review command with multiple models or reference skills in your agents.
```
