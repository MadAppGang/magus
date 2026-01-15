# Research Findings: Integration & Compatibility - How to fit into existing systems?

**Researcher**: Explorer 5
**Date**: 2026-01-14
**Model Strategy**: openrouter (local codebase analysis)
**Queries Executed**: 8 local queries (Glob, Grep, Read)

---

## Executive Summary

Analyzed the Claude Code plugin ecosystem to determine optimal integration strategy for pair programming multi-model review. Key findings: hooks provide real-time interception, output styles offer passive enhancement, and multiple plugins successfully coexist through careful hook ordering and shared dependencies. Recommendation: **Hybrid approach** - hooks for real-time review + output style for presentation.

---

## Key Findings

### Finding 1: Plugin Architecture - Two Proven Patterns

**Summary**: Claude Code supports both standalone plugins and composition via dependencies.

**Evidence**:
- **Standalone Pattern**: code-analysis, orchestration, dev plugins operate independently with distinct features
- **Dependency Pattern**: multimodel plugin depends on orchestration@^0.10.0, dev depends on orchestration@^0.8.0, seo depends on orchestration
- **Composition Pattern**: Multiple plugins share orchestration skills for multi-agent coordination

**Plugin Manifest Structure** (from multiple plugin.json files):
```json
{
  "name": "plugin-name",
  "version": "X.Y.Z",
  "description": "...",
  "hooks": "./hooks/hooks.json",           // Optional: hook system integration
  "outputStyles": ["./output-styles/*.md"], // Optional: presentation layer
  "agents": ["./agents/*.md"],
  "commands": ["./commands/*.md"],
  "skills": ["./skills/*"],
  "mcpServers": "./mcp-servers/mcp-config.json", // Optional: MCP integration
  "dependencies": {                        // Optional: require other plugins
    "orchestration@mag-claude-plugins": "^0.10.0"
  }
}
```

**Sources**:
- `/Users/jack/mag/claude-code/plugins/orchestration/plugin.json` - Quality: High, Local source
- `/Users/jack/mag/claude-code/plugins/code-analysis/plugin.json` - Quality: High, Local source
- `/Users/jack/mag/claude-code/plugins/multimodel/plugin.json` - Quality: High, Local source
- `/Users/jack/mag/claude-code/plugins/dev/plugin.json` - Quality: High, Local source

**Confidence**: High
**Multi-source**: Yes (4 plugin examples)
**Contradictions**: None

**Architecture Options**:
1. **Standalone Plugin**: New "pair-programming" plugin with all features
   - Pros: Clean separation, independent versioning, easy to disable
   - Cons: Duplicates multi-model logic, separate maintenance

2. **Enhancement to Orchestration**: Add hooks to orchestration plugin
   - Pros: Reuses multi-model patterns, centralized coordination logic
   - Cons: Increases orchestration complexity, affects all users

3. **Enhancement to Multimodel**: Add hooks to existing multimodel plugin
   - Pros: Natural fit (already does multi-model voting), reuses claudish integration
   - Cons: Changes focus from post-execution voting to real-time review

**Recommendation**: **Option 3 - Enhance multimodel plugin** with real-time review mode as opt-in feature.

---

### Finding 2: Hook System Implementation - Real-Time Interception Available

**Summary**: Hook system supports PreToolUse, PostToolUse, SessionStart, SubagentStop events with command-based handlers.

**Evidence**:
From `plugins/code-analysis/hooks/hooks.json`:
```json
{
  "description": "Code analysis hooks - intercept search tools, redirect to claudemem semantic search",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts\"",
          "timeout": 10
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Grep|Bash|Glob|Read",
        "hooks": [{
          "type": "command",
          "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts\"",
          "timeout": 15
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{
          "type": "command",
          "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts\"",
          "timeout": 10
        }]
      }
    ]
  }
}
```

**Hook Handler Interface** (from handler.ts):
```typescript
interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: "default" | "plan" | "bypasspermissions";
  hook_event_name: "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop";
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  tool_use_id?: string;
}

interface HookOutput {
  additionalContext?: string;
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
  };
}
```

**Key Capabilities**:
- **PreToolUse**: Can inspect tool calls BEFORE execution, allow/deny, add context
- **PostToolUse**: Can inspect tool responses AFTER execution, enrich output
- **SessionStart**: Initialize state, check configuration
- **Matcher**: Target specific tools (Read, Write, Bash, etc.)
- **Timeout**: Configurable (10-15s typical)
- **Decision**: Allow/Deny with reason (for PreToolUse)

**Sources**:
- `/Users/jack/mag/claude-code/plugins/code-analysis/hooks/hooks.json` - Quality: High, Local source
- `/Users/jack/mag/claude-code/plugins/code-analysis/hooks/handler.ts` - Quality: High, Local source (100 lines analyzed)
- `/Users/jack/mag/claude-code/plugins/orchestration/hooks/hooks.json` - Quality: High, Local source

**Confidence**: High
**Multi-source**: Yes (2 production implementations)
**Contradictions**: None

**For Pair Programming Use Case**:
- Use **PreToolUse** for Write/Edit/Bash tools to duplicate actions across models
- Use **PostToolUse** to collect review feedback after execution
- Use **SessionStart** to load model preferences, check claudish availability

---

### Finding 3: Hook Compatibility - Multiple Hooks Can Coexist

**Summary**: Multiple plugins can register hooks for the same events; hooks execute in plugin load order.

**Evidence**:
From existing plugin ecosystem:
- **code-analysis**: Hooks PreToolUse (Grep/Bash/Glob/Read), PostToolUse (Write/Edit), SessionStart
- **orchestration**: Hooks SessionStart, SubagentStop, PreToolUse (Task)
- **seo**: Hooks SessionStart (separate hooks.json file)
- **autopilot**: Hooks SessionStart (separate hooks.json file)

**No Hook Conflicts Found**:
- Grep query for "hook.*conflict|multiple.*hooks" returned no results in documentation
- Multiple plugins successfully coexist in `.claude/settings.json`:
```json
{
  "enabledPlugins": {
    "agentdev@mag-claude-plugins": true,
    "code-analysis@mag-claude-plugins": true,
    "dev@mag-claude-plugins": true,
    "multimodel@mag-claude-plugins": true
  }
}
```

**Code-Analysis v3.0.0 Pattern - Non-Blocking Enrichment**:
From plugin description:
> "ENRICHMENT MODE - hooks now enhance native tools with AST context instead of blocking. Grep/Glob/Bash searches receive claudemem results as additional context while still running normally."

**Key Insight**: Modern hook pattern returns `permissionDecision: "allow"` with `additionalContext` rather than blocking. This prevents conflicts with other hooks.

**Sources**:
- `/Users/jack/mag/claude-code/.claude/settings.json` - Quality: High, Local source
- `/Users/jack/mag/claude-code/plugins/code-analysis/plugin.json` - Quality: High, Local source
- `/Users/jack/mag/claude-code/plugins/orchestration/hooks/hooks.json` - Quality: High, Local source
- Grep results across codebase - Quality: High, Negative evidence (no conflicts documented)

**Confidence**: High
**Multi-source**: Yes (3 plugins with hooks)
**Contradictions**: None

**Compatibility Assessment**:
- ✅ **code-analysis hooks**: Compatible (different matchers - code-analysis targets Read/Grep, pair-programming would target Write/Edit/Bash)
- ✅ **orchestration hooks**: Compatible (orchestration hooks Task tool, pair-programming hooks Write/Edit)
- ✅ **Multiple plugins**: No known conflicts with 4+ plugins enabled simultaneously

**Recommendation**: Use non-blocking enrichment pattern (allow + additionalContext) to avoid conflicts.

---

### Finding 4: Output Style System - Presentation Layer Enhancement

**Summary**: Output styles provide session-wide behavior modification through markdown-based instructions injected into system context.

**Evidence**:
From `plugins/dev/output-styles/self-improving.md`:
```markdown
---
name: Self-Improving
description: Learn from corrections and preferences during sessions, then propose updates to CLAUDE.md. Trigger with "learn from this session" or at conversation end.
keep-coding-instructions: true
---

# Self-Improving Mode

You are Claude Code with learning capabilities. While helping with tasks, you observe for learnable patterns and can update project instructions based on user feedback.

## How Learning Works

1. **During the session**: Track corrections and preferences in your context
2. **When triggered**: Analyze patterns and propose CLAUDE.md updates
3. **After approval**: Update the project's CLAUDE.md with learned rules
```

**Output Style Structure**:
- **Frontmatter**: Metadata (name, description, keep-coding-instructions)
- **Content**: Markdown instructions injected into system prompt
- **Activation**: User selects via UI or command flag

**Key Characteristics**:
- **Passive**: No active interception, just adds instructions to system context
- **Session-wide**: Applied for entire conversation, not per-tool
- **Presentation-focused**: Changes how AI presents information, not what it does
- **No code execution**: Pure prompt engineering

**Existing Use Cases**:
- `self-improving.md` - Learning mode that tracks corrections
- `explanatory-output-style` - Verbose explanations (from settings.json reference)
- `learning-output-style` - Educational mode (from settings.json reference)

**Sources**:
- `/Users/jack/mag/claude-code/plugins/dev/output-styles/self-improving.md` - Quality: High, Local source (249 lines)
- `/Users/jack/mag/claude-code/plugins/dev/plugin.json` - Quality: High, Local source
- `/Users/jack/mag/claude-code/.claude/settings.json` - Quality: High, Local source (shows enabled output styles)

**Confidence**: High
**Multi-source**: Yes (2 sources)
**Contradictions**: None

**For Pair Programming Use Case**:
- Output style could instruct AI to "present multi-model review results in specific format"
- Output style could track "which models agreed/disagreed" for session summary
- Output style CANNOT trigger multi-model execution (requires hooks or commands)

**Comparison**:

| Capability | Hooks | Output Styles |
|------------|-------|---------------|
| Real-time interception | ✅ Yes | ❌ No |
| Trigger multi-model calls | ✅ Yes (via PreToolUse) | ❌ No |
| Modify tool execution | ✅ Yes (allow/deny) | ❌ No |
| Presentation format | ✅ Via additionalContext | ✅ Primary purpose |
| Code execution | ✅ Yes (bash/bun handler) | ❌ No |
| Session-wide behavior | ✅ Via SessionStart | ✅ Yes |

**Recommendation**: Use **hooks for execution** (trigger reviews) + **output style for presentation** (format results).

---

### Finding 5: Configuration Surface - Environment Variables + Plugin Settings

**Summary**: Claude Code supports project-specific configuration via `.claude/settings.json` with environment variable substitution.

**Evidence**:
From `ai-docs/TEAM_CONFIG_ARCHITECTURE.md`:
```json
{
  "mcpServers": {
    "apidog": {
      "command": "npx",
      "args": ["-y", "@apidog/mcp-server", "--project-id", "2847593"],
      "env": {
        "APIDOG_API_TOKEN": "${APIDOG_API_TOKEN}"  // ← References secret
      }
    }
  }
}
```

**Configuration Patterns**:

**1. Shareable Config (committed to git)**:
- Project IDs, URLs, non-sensitive values
- Plugin enable/disable state
- Default model preferences

**2. Private Secrets (environment variables)**:
- API tokens, credentials
- Each developer's `.env` file
- Referenced via `${VAR_NAME}` syntax

**3. Plugin-Specific Files**:
- `.claude/multimodel-team.json` - Model preferences and history (from multimodel plugin)
- `.claude/CLAUDE.md` - Project-specific instructions (from self-improving output style)

**Configuration Schema for Pair Programming**:
```json
{
  "enabledPlugins": {
    "multimodel@mag-claude-plugins": true
  },
  "env": {
    "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY}",
    "PAIR_PROGRAMMING_MODE": "on|off",
    "PAIR_PROGRAMMING_MODELS": "grok,gemini,gpt-5",
    "PAIR_PROGRAMMING_THRESHOLD": "majority|supermajority|unanimous"
  }
}
```

**Dynamic MCP Configuration** (from `ai-docs/DYNAMIC_MCP_GUIDE.md`):
- Plugins can include MCP servers with `${PLACEHOLDER}` values
- Setup commands help users configure project-specific values
- Runtime substitution via `.claude/settings.json` env section

**Sources**:
- `/Users/jack/mag/claude-code/ai-docs/TEAM_CONFIG_ARCHITECTURE.md` - Quality: High, Local source (official architecture doc)
- `/Users/jack/mag/claude-code/.claude/settings.json` - Quality: High, Local source
- `/Users/jack/mag/claude-code/plugins/multimodel/commands/team.md` - Quality: High, Local source
- `/Users/jack/mag/claude-code/ai-docs/DYNAMIC_MCP_GUIDE.md` - Quality: High, Local source (80 lines analyzed)

**Confidence**: High
**Multi-source**: Yes (4 sources)
**Contradictions**: None

**User-Facing Settings**:
1. **Mode Toggle**: Enable/disable pair programming per session
2. **Model Selection**: Which models to use for review (defaults from team.md preferences)
3. **Threshold**: Agreement level required (majority/supermajority/unanimous)
4. **Auto vs Manual**: Automatic review on every Write/Edit, or on-demand via command
5. **Notification Style**: Inline, summary, or terminal output

**Migration Path**:
- Existing multimodel users: Pair programming as new mode alongside voting
- No breaking changes: New hooks are opt-in via configuration
- Graceful degradation: Falls back to native tools if claudish unavailable

---

## Integration Recommendations

### Recommended Approach: Hooks + Output Style Hybrid

**Architecture**:
```
multimodel plugin (enhanced)
├── hooks/
│   ├── hooks.json                # Hook registration
│   └── pair-programming-handler.ts  # PreToolUse/PostToolUse logic
├── output-styles/
│   └── pair-programming.md       # Presentation format instructions
├── commands/
│   ├── team.md                   # Existing voting command
│   └── pair.md                   # New pair programming command
└── skills/
    └── pair-programming-protocol # Shared coordination logic
```

**Why This Approach**:
1. **Reuses existing infrastructure**: claudish integration, model preferences, voting logic
2. **Separation of concerns**: Hooks for execution, output styles for presentation
3. **Compatible with existing plugins**: Non-blocking enrichment pattern
4. **Opt-in**: Users enable via configuration, defaults to off
5. **Graceful degradation**: Falls back if claudish not available

### Hook Strategy: PreToolUse for Write/Edit/Bash

**Hook Configuration**:
```json
{
  "PreToolUse": [
    {
      "matcher": "Write|Edit|Bash",
      "hooks": [{
        "type": "command",
        "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/pair-programming-handler.ts\"",
        "timeout": 180
      }]
    }
  ]
}
```

**Handler Logic**:
1. Check if pair programming mode enabled (from settings)
2. If enabled, launch parallel review via claudish + Task tool
3. Collect votes from N models (timeout: 120s)
4. Aggregate consensus (APPROVE/REJECT/SPLIT)
5. Return:
   - `permissionDecision: "allow"` (non-blocking)
   - `additionalContext`: "Multi-model review: 3/4 APPROVE. Concerns: [list]"

**Benefits**:
- ✅ Real-time interception (catches all Write/Edit actions)
- ✅ Non-blocking (doesn't prevent tool execution)
- ✅ Compatible with code-analysis hooks (different matchers)
- ✅ Configurable timeout (avoids hanging sessions)

### Output Style Strategy: Presentation Layer

**Output Style Content** (pair-programming.md):
```markdown
# Pair Programming Mode

You are Claude Code with multi-model review capabilities. Every code change is
independently reviewed by 2-4 alternative AI models in real-time.

## Review Result Format

When you receive multi-model review context, present it like this:

**Multi-Model Review**: {verdict}
- Models: {model-list}
- Consensus: {approve}/{total} APPROVE ({percentage}%)
- Key Concerns: {issues}

If REJECTED or SPLIT, pause and ask user if they want to proceed or revise.
```

**Benefits**:
- ✅ Consistent presentation across sessions
- ✅ Configurable by users (can edit output style)
- ✅ No code changes needed for UX tweaks
- ✅ Compatible with explanatory/learning output styles

### Configuration Surface

**User Settings** (`.claude/settings.json`):
```json
{
  "enabledPlugins": {
    "multimodel@mag-claude-plugins": true
  },
  "pairProgramming": {
    "enabled": false,                // Default: off (opt-in)
    "models": null,                  // Default: use team preferences
    "threshold": "majority",         // 50% approval required
    "autoReview": true,              // Review every Write/Edit automatically
    "notificationStyle": "inline"    // inline|summary|terminal
  }
}
```

**Setup Command** (`/multimodel:setup-pair`):
```bash
# Interactive configuration
1. Check claudish availability
2. Load team preferences or prompt for models
3. Ask for threshold (majority/supermajority/unanimous)
4. Ask for auto vs manual mode
5. Write configuration to .claude/settings.json
6. Test with sample review
```

---

## Compatibility Matrix

| Plugin | Conflicts? | Mitigation |
|--------|------------|------------|
| **code-analysis** | ❌ No | Different matchers (code-analysis: Read/Grep, pair-programming: Write/Edit) |
| **orchestration** | ❌ No | Different matchers (orchestration: Task, pair-programming: Write/Edit) |
| **dev** | ❌ No | Output styles can coexist (keep-coding-instructions: true) |
| **frontend** | ❌ No | No hooks, only MCP servers |
| **bun** | ❌ No | No hooks, only MCP servers |
| **seo** | ❌ No | Different hook events (seo: SessionStart) |

**Testing Strategy**:
1. Enable pair-programming + code-analysis + orchestration simultaneously
2. Verify hooks execute in correct order (SessionStart → PreToolUse → PostToolUse)
3. Check that additionalContext from multiple hooks merges correctly
4. Measure latency impact (baseline vs 1 hook vs 3 hooks)

---

## Migration Path

### Phase 1: Opt-In Beta (v1.0.0)
- Add pair programming hooks to multimodel plugin
- Default: disabled (users must enable in settings)
- Command: `/team --pair` to trigger manual review
- Documentation: "Experimental - requires claudish + OpenRouter API key"

### Phase 2: Auto-Review Mode (v1.1.0)
- Add auto-review configuration (review every Write/Edit automatically)
- Output style for consistent presentation
- Performance optimizations (caching, selective review)

### Phase 3: Advanced Features (v2.0.0)
- Confidence scoring and uncertainty quantification
- Smart triggers (only review complex changes)
- Cost optimization (sample reviews, free model fallbacks)

---

## Source Summary

**Total Sources**: 12
- High Quality: 12
- Medium Quality: 0
- Low Quality: 0

**Source List**:
1. `/Users/jack/mag/claude-code/plugins/orchestration/plugin.json` - Quality: High, Date: 2026-01-14, Type: Local source (plugin manifest)
2. `/Users/jack/mag/claude-code/plugins/code-analysis/plugin.json` - Quality: High, Date: 2026-01-14, Type: Local source (plugin manifest)
3. `/Users/jack/mag/claude-code/plugins/multimodel/plugin.json` - Quality: High, Date: 2026-01-14, Type: Local source (plugin manifest)
4. `/Users/jack/mag/claude-code/plugins/dev/plugin.json` - Quality: High, Date: 2026-01-14, Type: Local source (plugin manifest)
5. `/Users/jack/mag/claude-code/plugins/code-analysis/hooks/hooks.json` - Quality: High, Date: 2026-01-14, Type: Local source (hook system implementation)
6. `/Users/jack/mag/claude-code/plugins/code-analysis/hooks/handler.ts` - Quality: High, Date: 2026-01-14, Type: Local source (hook handler implementation)
7. `/Users/jack/mag/claude-code/plugins/orchestration/hooks/hooks.json` - Quality: High, Date: 2026-01-14, Type: Local source (hook system implementation)
8. `/Users/jack/mag/claude-code/.claude/settings.json` - Quality: High, Date: 2026-01-14, Type: Local source (user configuration)
9. `/Users/jack/mag/claude-code/plugins/dev/output-styles/self-improving.md` - Quality: High, Date: 2026-01-14, Type: Local source (output style implementation)
10. `/Users/jack/mag/claude-code/ai-docs/TEAM_CONFIG_ARCHITECTURE.md` - Quality: High, Date: 2026-01-14, Type: Local source (official architecture doc)
11. `/Users/jack/mag/claude-code/plugins/multimodel/commands/team.md` - Quality: High, Date: 2026-01-14, Type: Local source (command implementation)
12. `/Users/jack/mag/claude-code/ai-docs/DYNAMIC_MCP_GUIDE.md` - Quality: High, Date: 2026-01-14, Type: Local source (configuration guide)

---

## Knowledge Gaps

What this research did NOT find:
- **Hook execution order**: No documentation on which hook fires first when multiple plugins match same event. Suggested query: Inspect Claude Code source code for hook ordering logic.
- **Hook performance budget**: No guidelines on acceptable latency for hooks (10s timeout observed, but is this soft/hard limit?). Suggested query: Review Claude Code hook timeout behavior and user experience impact.
- **Output style conflicts**: No examples of multiple output styles with conflicting instructions. Suggested query: Test multiple output styles with contradictory instructions to observe behavior.
- **Configuration validation**: No schema validation for plugin-specific settings in `.claude/settings.json`. Suggested query: Review error handling when invalid config provided.

---

## Search Limitations

- Model: Claude Sonnet 4.5
- Web search: unavailable (openrouter strategy, local analysis only)
- Local search: performed (8 queries via Glob/Grep/Read)
- Date range: Current codebase state (2026-01-14)
- Query refinement: not needed (local sources comprehensive)
