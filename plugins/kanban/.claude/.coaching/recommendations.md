[human]
- Delegate tasks sooner rather than excessive file reading
  <!-- evidence: excessive-reads-before-delegation signal (rule_based_signals) -->
- Avoid excessive sleep commands between file operations
  <!-- evidence: Multiple sleep commands in failed sequences (tool_call_summary) -->
session: f1626ff0
count: 0


[claude]
count: 3

1. You ran 21 grep/rg searches this session. For faster semantic code exploration:
  `mnemex --agent map "your concept"` -- understands intent, not just text
  `mnemex --agent symbol "SymbolName"` -- direct AST symbol lookup
  Skill: use the Skill tool with `code-analysis:mnemex-search`
2. Session files detected in /tmp/ -- these are cleared on reboot. Use persistent paths:
  `ai-docs/sessions/{task-slug}-{timestamp}-{random}/` for research artifacts
  `.claude/.coaching/` for plugin state
  See: CLAUDE.md Session Directories section
3. You read 13 files before delegating to an agent (pre-digestion anti-pattern).
  For investigation tasks, give agents the raw problem -- they investigate independently.
  Pre-digested context reduces multi-model diversity. See: MEMORY.md 'Raw Task vs Pre-Digested Context'
