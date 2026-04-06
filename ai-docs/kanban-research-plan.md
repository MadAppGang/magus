# Kanban Alternative for GTD Plugin - Research Plan

## Session Info
- **Date**: 2026-03-23
- **Researcher**: Deep Research Specialist
- **Session Path**: ai-docs/sessions/kanban-research-20260323

## Research Questions

### Q1: Data Model Design
How should we extend tasks.json schema to support:
- Blocking/blocked-by dependencies (distinct from parent-child)
- Subtask completion tracking
- Kanban column/status
- Priority levels

### Q2: Kanban CLI Display
How to render kanban board in terminal (80-column constraint):
- Column layout options
- Visual dependency indicators
- Subtask progress display
- Reference existing terminal kanban tools

### Q3: Dependency Resolution
- Task dependency workflows
- Circular dependency detection
- Topological sort for execution order
- Linear and Vibe Kanban approaches

### Q4: MCP Integration Architecture
- Linear MCP tools and schema mapping
- Vibe Kanban MCP integration (blocking, related, has_duplicate)
- Sync strategy (local-first vs remote-first)
- Conflict resolution

### Q5: GTD + Kanban Hybrid
- GTD concepts to kanban mapping
- Keep both views or merge
- Todoist, Things 3, Notion approaches

## Research Approach
1. Examine current GTD plugin implementation
2. Web search for terminal kanban tools and best practices
3. Research Linear MCP and Vibe Kanban MCP documentation
4. Investigate task dependency algorithms
5. Study GTD-Kanban hybrid implementations
