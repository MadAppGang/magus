
## Multi-Model Validation: 4-MESSAGE PATTERN ENFORCED

> Added by `orchestration` plugin v0.4.0

### CRITICAL: Parallel Execution Pattern

When running multiple AI models in parallel (multi-model review, consensus validation), you MUST follow the 4-Message Pattern:

| Message | Purpose | Tools Allowed |
|---------|---------|---------------|
| **1** | Preparation | Bash ONLY (mkdir, setup) |
| **2** | Parallel Execution | Task ONLY (multiple calls) |
| **3** | Auto-Consolidation | Task ONLY (single call) |
| **4** | Present Results | Text output |

### Why This Matters

**WRONG** (executes sequentially):
```typescript
await TodoWrite({...});  // Tool 1
await Task({...});       // Waits for TodoWrite
await Bash({...});       // Waits for Task
await Task({...});       // Waits for Bash - NO PARALLELISM
```

**CORRECT** (executes in parallel):
```typescript
// Message 2: ONLY Task calls - all run simultaneously
await Task({ subagent_type: "reviewer", model: "grok" });
await Task({ subagent_type: "reviewer", model: "gemini" });
await Task({ subagent_type: "reviewer", model: "gpt-5" });
// All 3 execute in parallel!
```

### Claudish Commands

```bash
claudish --top-models              # Top recommended models
claudish --free                    # Free models (qwen3-coder, devstral)
claudish --model MODEL "prompt"    # Run single model
```

### When to Use Multi-Model Validation

- Code review with consensus analysis
- Architecture plan validation
- Implementation verification
- Any task benefiting from multiple expert perspectives

### Anti-Patterns (AVOID)

1. **Mixed tools in parallel message** - Breaks parallelism
2. **Waiting for user to request consolidation** - Auto-consolidate after N>=2 reviews
3. **Background execution in proxy agents** - Use synchronous/blocking claudish calls
4. **Returning full output to orchestrator** - Write to file, return brief summary

### Skills Reference

Load orchestration skills in agent/command frontmatter:
```yaml
skills: orchestration:multi-model-validation, orchestration:quality-gates
```

Available skills:
- `multi-agent-coordination` - Agent selection, parallel vs sequential
- `multi-model-validation` - 4-Message Pattern, claudish, consensus
- `quality-gates` - Approval gates, TDD loops, severity
- `todowrite-orchestration` - Phase tracking, progress
- `error-recovery` - Timeouts, failures, retries
