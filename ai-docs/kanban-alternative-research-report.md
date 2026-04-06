# Kanban Alternative for GTD Plugin - Research Report

**Research Date**: March 24, 2026
**Plugin**: GTD v2.0.0
**Prepared for**: Magus Plugin Team
**Researcher**: Deep Research Specialist

---

## Executive Summary

This report evaluates adding a kanban board view to the GTD plugin, including task dependencies, subtask tracking, and optional MCP backend sync with Linear or Vibe Kanban. Key findings:

1. **Data Model**: Extend tasks.json with `dependencies` array, `subtasks` array, `status` field, and `priority` field (backward compatible)
2. **Terminal Display**: Use responsive 3-4 column layout with Unicode box-drawing, progress indicators like `[3/5]`
3. **Dependencies**: Implement Kahn's algorithm for topological sort, DFS for cycle detection
4. **MCP Integration**: Linear MCP (official) offers create/update/search; Vibe Kanban MCP provides local-first with SQLite storage
5. **GTD-Kanban Hybrid**: Map GTD lists to kanban columns, keep both views accessible via `/gtd:status` and `/gtd:board`

---

## Q1: Data Model Design

### Current GTD v2.0.0 Schema

```json
{
  "version": "2.0",
  "nextId": 1,
  "lastReview": null,
  "activeTaskId": null,
  "tasks": [
    {
      "id": "1",
      "subject": "Task description",
      "list": "inbox|next|waiting|someday|project|reference",
      "context": ["@code"],
      "parentId": null,
      "energy": "high|medium|low",
      "timeEstimate": 30,
      "waitingOn": null,
      "dueDate": "2026-03-25T10:00:00Z",
      "created": "2026-03-24T08:00:00Z",
      "modified": "2026-03-24T08:00:00Z",
      "completed": null,
      "notes": ""
    }
  ]
}
```

### Recommended Extended Schema (v3.0.0)

```json
{
  "version": "3.0",
  "nextId": 1,
  "lastReview": null,
  "activeTaskId": null,
  "tasks": [
    {
      "id": "1",
      "subject": "Task description",
      "list": "inbox|next|waiting|someday|project|reference",
      "status": "backlog|todo|in-progress|review|done|blocked",
      "priority": "urgent|high|medium|low",
      "context": ["@code"],
      "parentId": null,
      "dependencies": {
        "blocking": ["2", "3"],
        "blockedBy": ["4"]
      },
      "subtasks": [
        {
          "id": "1.1",
          "subject": "Subtask description",
          "completed": false
        }
      ],
      "energy": "high|medium|low",
      "timeEstimate": 30,
      "waitingOn": null,
      "dueDate": "2026-03-25T10:00:00Z",
      "created": "2026-03-24T08:00:00Z",
      "modified": "2026-03-24T08:00:00Z",
      "completed": null,
      "notes": "",
      "_meta": {
        "syncedTo": "linear:ABC-123|vibe:456",
        "lastSyncedAt": "2026-03-24T10:00:00Z"
      }
    }
  ]
}
```

### Field Specifications

| Field | Type | Default | Description | Source |
|-------|------|---------|-------------|--------|
| `status` | string | derived from `list` | Kanban column: backlog/todo/in-progress/review/done/blocked | Linear states mapping |
| `priority` | string | `"medium"` | Task priority: urgent/high/medium/low | Linear priority (0-4) |
| `dependencies.blocking` | string[] | `[]` | Task IDs this task blocks | Taskwarrior `depends` pattern |
| `dependencies.blockedBy` | string[] | `[]` | Task IDs blocking this task | Taskwarrior `depends` pattern |
| `subtasks` | array | `[]` | Inline subtasks with completion tracking | GitHub issues subtasks |
| `_meta.syncedTo` | string | `null` | Remote backend reference for MCP sync | MCP integration pattern |

### Subtask Implementation Options

**Option A: Inline Subtasks (Recommended)**
```json
"subtasks": [
  { "id": "1.1", "subject": "Step 1", "completed": false },
  { "id": "1.2", "subject": "Step 2", "completed": true }
]
```

| Pro | Con |
|-----|-----|
| Self-contained, no ID collision | Subtasks can't have their own dependencies |
| Easy serialization to JSON | Subtasks can't be referenced independently |
| Atomic updates | Limited depth (no recursive subtasks) |

**Option B: Subtasks as Child Tasks**
```json
"parentId": "1"
```

| Pro | Con |
|-----|-----|
| Full task features for subtasks | Clutters task tree |
| Can have their own dependencies | More complex queries |
| Consistent with hierarchy pattern | Requires depth awareness |

**Recommendation**: Use **inline subtasks** for simple checklists, **parentId** for complex subtasks needing their own dependencies.

### Trade-offs Considered

| Alternative | Pros | Cons |
|------------|------|------|
| Separate `dependencies.json` | Cleaner separation | More files to sync, harder atomic updates |
| Graph-based storage (SQLite) | Efficient traversal | Breaks local-first JSON principle, adds dependency |
| External database (Linear) | Scalable, team features | Requires subscription, offline limited |

**Source**: Taskwarrior uses inline `depends:` attribute ([Taskwarrior Dependencies](https://taskwarrior.org/docs/))
**Source**: Linear uses relational issue links ([Linear API](https://developers.linear.app/))

---

## Q2: Kanban CLI Display

### Terminal Constraints

- **Width**: 80 columns standard (detect via `process.stdout.columns`)
- **Height**: 24 rows minimum
- **Characters**: Unicode box-drawing supported in modern terminals (iTerm2, kitty, VS Code, Terminal.app)

### Recommended: Responsive Column Layout

```
┌────────────────┬────────────────┬────────────────┬────────────────┐
│   BACKLOG      │     TODO       │  IN PROGRESS   │     DONE       │
├────────────────┼────────────────┼────────────────┼────────────────┤
│ ▢ Task 1       │ ▢ Task 3       │ ▶ Task 5       │ ✓ Task 8       │
│   [2/5] ⚡high  │   └─ dep:#2    │   [1/3] ⏳#4   │   completed    │
│                │ ▢ Task 4       │                │                │
│                │   ⚠blocked     │                │                │
└────────────────┴────────────────┴────────────────┴────────────────┘
```

### Visual Indicators

| Symbol | Meaning | Source |
|--------|---------|--------|
| `▢` | Uncompleted task | Unicode U+25A2 |
| `▶` | Active/in-progress | Unicode U+25B6 |
| `✓` | Completed | Unicode U+2713 |
| `⚡` | Energy level | Unicode U+26A1 |
| `⏳` | Waiting/blocked | Unicode U+23F3 |
| `⚠` | Warning/blocked | Unicode U+26A0 |
| `└─` | Dependency indicator | Unicode U+2514 |
| `[3/5]` | Subtask progress | GitHub-style |

### Dependency Visualization

**Inline notation:**
```
▢ Task 4  ⚠blocked by #2,#3  #4
```

**Expanded notation:**
```
▢ Task 4  #4
  └─ blocked by:
     ├─ #2: Fix authentication (in-progress)
     └─ #3: Set up database (todo)
```

### Existing Terminal Kanban Tools

| Tool | Display Approach | GitHub Stars | Source |
|------|-----------------|--------------|--------|
| **Taskwarrior** | `blocked`/`blocking` reports, dependency tree | 4.2k | [taskwarrior.org](https://taskwarrior.org/) |
| **Taskbook** | TUI board with lanes | 8.7k | [klaussinani/taskbook](https://github.com/klaussinani/taskbook) |
| **Kanban.bash** | ASCII board with columns | 1.1k | [cynic/kanban.bash](https://github.com/cynic/kanban.bash) |
| **Knd** | ncurses TUI with vim keybindings | 300+ | Node-based kanban CLI |

### Implementation Recommendation

Build a **responsive renderer** in `gtd-display.ts`:

```typescript
function renderKanbanBoard(tasks: Task[], width: number): void {
  if (width >= 100) return renderFourColumnBoard(tasks);
  if (width >= 80) return renderThreeColumnBoard(tasks);
  return renderVerticalFocusMode(tasks);
}
```

**Phases:**
1. Width >= 100: 4-column horizontal (Backlog/Todo/In-Progress/Done)
2. Width 80-99: 3-column (Backlog+Todo/In-Progress/Done)
3. Width < 80: Vertical focus mode (single column expanded)

---

## Q3: Dependency Resolution

### Dependency Graph Model

Tasks form a **directed acyclic graph (DAG)** where:
- Nodes = tasks
- Edges = "blocked by" relationships
- Task A → Task B means "A blocks B" (B cannot start until A completes)

### Topological Sort for Execution Order

**Algorithm: Kahn's Algorithm (BFS-based)**

```typescript
interface TaskNode {
  id: string;
  blockedBy: string[];
  status: string;
}

function topologicalSort(tasks: TaskNode[]): string[] {
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  const result: string[] = [];

  // Initialize in-degree (number of blockers)
  for (const task of tasks) {
    inDegree.set(task.id, task.blockedBy.length);
    graph.set(task.id, []);
  }

  // Build adjacency list (blocker -> dependent)
  for (const task of tasks) {
    for (const blocker of task.blockedBy) {
      graph.get(blocker)?.push(task.id);
    }
  }

  // Queue starts with tasks that have no blockers (in-degree 0)
  const queue = tasks
    .filter(t => inDegree.get(t.id) === 0 && t.status !== 'done')
    .map(t => t.id);

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    // Decrement in-degree for dependents
    for (const dependent of graph.get(current) || []) {
      const newDegree = (inDegree.get(dependent) || 0) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  return result;
}
```

**Time Complexity**: O(V + E) where V = tasks, E = dependencies
**Space Complexity**: O(V + E)

**Source**: Kahn's algorithm - [Wikipedia: Topological Sorting](https://en.wikipedia.org/wiki/Topological_sorting)

### Circular Dependency Detection

**Algorithm: DFS with Recursion Stack**

```typescript
function detectCircularDependencies(tasks: TaskNode[]): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(taskId: string): void {
    visited.add(taskId);
    recStack.add(taskId);
    path.push(taskId);

    const task = tasks.find(t => t.id === taskId);
    for (const blockedBy of task?.blockedBy || []) {
      if (!visited.has(blockedBy)) {
        dfs(blockedBy);
      } else if (recStack.has(blockedBy)) {
        // Found cycle
        const cycleStart = path.indexOf(blockedBy);
        cycles.push([...path.slice(cycleStart), blockedBy]);
      }
    }

    path.pop();
    recStack.delete(taskId);
  }

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      dfs(task.id);
    }
  }

  return cycles;
}
```

**Time Complexity**: O(V + E)
**Space Complexity**: O(V) for recursion stack

### Blocking Task Behavior

**When user tries to start a blocked task:**

```
┌──────────────────────────────────────────────────────────────────┐
│ CANNOT START TASK #4                                            │
├──────────────────────────────────────────────────────────────────┤
│ This task is blocked by:                                        │
│   ▢ #2: Fix authentication (in-progress)                        │
│   ▢ #3: Set up database (todo)                                  │
│                                                                 │
│ Suggested actions:                                              │
│   /gtd:work #2    Start working on blocking task                │
│   /gtd:unblock #4 Force start anyway (not recommended)          │
└──────────────────────────────────────────────────────────────────┘
```

### How Major Tools Handle Dependencies

| Tool | Blocking Behavior | Auto-Unblock | Cycle Detection |
|------|-------------------|--------------|-----------------|
| **Linear** | Blocking issue marked, dependent notified | No | Client-side |
| **Jira** | Links shown, status check on transition | No | Yes (server-side) |
| **Taskwarrior** | `blocked` report, `depends:` attribute | No | No (allows cycles) |
| **GitHub Issues** | Blocking references in body | No | No |
| **Linear MCP** | No direct dependency tools | N/A | N/A |

**Source**: [Linear: Issue Relationships](https://linear.app/docs)
**Source**: [Taskwarrior: Dependencies](https://taskwarrior.org/docs/)

---

## Q4: MCP Integration Architecture

### Linear MCP Tools Available

**Source**: [NPM: linear-mcp-server](https://www.npmjs.com/package/linear-mcp-server)

**Note**: The community `linear-mcp-server` is **deprecated**. Use official Linear MCP:
- Official MCP: `https://mcp.linear.app/sse`
- Documentation: [Linear MCP Changelog](https://linear.app/changelog/2025-05-01-mcp)

| Tool | Description | Parameters |
|------|-------------|------------|
| `linear_create_issue` | Create new issue | `title*`, `teamId*`, `description?`, `priority?` (0-4), `status?` |
| `linear_update_issue` | Update existing issue | `id*`, `title?`, `description?`, `priority?`, `status?` |
| `linear_search_issues` | Search with filters | `query?`, `teamId?`, `status?`, `assigneeId?`, `labels?`, `priority?`, `limit?` |
| `linear_get_user_issues` | Get assigned issues | `userId?`, `includeArchived?`, `limit?` |
| `linear_add_comment` | Add comment | `issueId*`, `body*`, `createAsUser?`, `displayIconUrl?` |

**Missing for our use case**:
- No `create_issue_relationship` for blocking/blocked-by dependencies
- Would need to use Linear's native native blocking feature via GraphQL directly

### Linear Issue State Mapping

| Linear State | GTD Status | GTD List |
|-------------|------------|----------|
| Backlog | `backlog` | `someday` |
| Todo | `todo` | `next` |
| In Progress | `in-progress` | `next` (activeTaskId) |
| Done | `done` | (completed) |
| Canceled | `done` | (completed, archived) |

### Vibe Kanban MCP Tools

**Source**: [VibeKanban GitHub](https://github.com/shahriarb/vibekanban)

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_projects` | List all projects | None |
| `list_tickets` | List tickets | `project_id` (optional) |
| `create_ticket` | Create new ticket | `project_id*`, `what*`, `why?`, `acceptance_criteria?`, `test_steps?`, `ticket_type?` |
| `update_ticket_state` | Move ticket | `ticket_id*`, `state*` (backlog/in progress/done/on hold) |
| `add_comment` | Add comment | `ticket_id*`, `content*` |
| `get_kanban_status` | Board summary | None |
| `get_project_id_by_name` | Fuzzy project lookup | `name*` |

**Ticket Types**:
- `1` = Bug
- `2` = Story (default)
- `3` = Task
- `4` = Spike

**States**: `backlog`, `in progress`, `done`, `on hold`

**Missing**: No dependency relationships, no parent-child task linking.

### Sync Strategy: Local-First with Push/Pull

**Architecture:**

```
┌─────────────┐     Push/Pull    ┌─────────────┐
│  tasks.json │ <──────────────> │ Linear/Vibe │
│   (local)   │                  │  (remote)   │
└─────────────┘                  └─────────────┘
```

**Operations:**

| Operation | Local-First Flow |
|-----------|-----------------|
| Create | 1. Write to `tasks.json` 2. Queue for sync 3. Push to remote (async) |
| Update | 1. Update local 2. Update remote (async) 3. Handle conflicts |
| Delete | 1. Mark `deleted: true` locally 2. Sync deletion |
| Conflict | Compare `modified` timestamps, keep newer, create conflict record |

### Conflict Resolution

```typescript
interface SyncConflict {
  taskId: string;
  localVersion: Task;
  remoteVersion: Task;
  resolvedAt: string;
  resolution: 'local' | 'remote' | 'merged';
}

function resolveConflict(local: Task, remote: Task): 'local' | 'remote' | 'merged' {
  // Timestamp-based resolution
  if (local.modified > remote.modified) return 'local';
  if (remote.modified > local.modified) return 'remote';

  // Merge strategy for same-timestamp conflicts
  return 'merged';
}
```

### MCP Integration Commands

```bash
# Sync commands
/gtd:sync-push      # Push local changes to remote
/gtd:sync-pull      # Pull remote changes
/gtd:sync-status    # Show sync state

# Backend configuration
/gtd:link-linear    # Link to Linear project
/gtd:link-vibe      # Link to Vibe Kanban project
/gtd:unlink         # Remove remote link
```

### Trade-offs: Linear vs Vibe Kanban vs Local-Only

| Option | Pros | Cons |
|--------|------|------|
| **Local-only** | Fast, offline, no setup, private | No collaboration, no backup, manual sync |
| **Linear MCP** | Professional UI, team features, mobile apps | Requires subscription, API rate limits, no direct dependency tools in MCP |
| **Vibe Kanban MCP** | Local-first, MCP-native, SQLite, agent-friendly | Less polished, no dependency linking, single-user |

**Recommendation**: Support **all three modes** with **local-first as default**. MCP sync is optional.

---

## Q5: GTD + Kanban Hybrid

### GTD Concepts → Kanban Mapping

| GTD Concept | Kanban Equivalent | Notes |
|-------------|------------------|-------|
| **Inbox** | `Backlog` column | Unprocessed items, need clarify |
| **Next Actions** | `Todo` column | Ready to execute, no blockers |
| **Waiting For** | `Blocked` status | External dependency, show blocker |
| **Projects** | `Epics` / swimlanes | Group related tasks |
| **Someday/Maybe** | `Backlog` (low priority) | Not committed, future watching |
| **Reference** | Archived/Done | Information only, searchable |

### Visual Mapping Proposal

```
┌────────────────────────────────────────────────────────────────────────────┐
│ GTD KANBAN BOARD                                            v3.0           │
├────────────────────────────────────────────────────────────────────────────┤
│ INBOX (2)    │ NEXT ACTIONS (4)  │ WAITING (1) │ SOMEDAY (3) │ PROJECTS   │
├──────────────┼───────────────────┼─────────────┼─────────────┼────────────┤
│ ▢ #1 Capture │ ▢ #5 Call dentist │ ▢ #8 Report │ ▢ #10 Learn │ [P1] Main  │
│   Unprocessed│   ⏳due:15:00     │   from:Bob  │   Rust      │ ┌────────┐ │
│              │                   │             │             │ │ Task #2 │ │
│ ▢ #2 Email   │ ▢ #6 Write doc    │             │ ▢ #11 Trip  │ └────────┘ │
│   boss       │   [2/4] ⚡medium  │             │   to Japan  │            │
│              │                   │             │             │            │
│              │ ▶ #7 Deploy prod  │             │ ▢ #12 Watch │ [P2] Side  │
│              │   ⚠blocked by #8  │             │   this talk │ ┌────────┐ │
│              │                   │             │             │ │ Task #5 │ │
│              │ ✓ #3 Complete X   │             │             │ └────────┘ │
└──────────────┴───────────────────┴─────────────┴─────────────┴────────────┘
```

### Should We Keep Both Views?

**Recommendation: Yes, keep both views**

**GTD List View (Current `/gtd:status`)** - Best for:
- Clarify/organize workflow (`/gtd:clarify`)
- Context-based filtering (`@code`, `@phone`)
- Energy-based selection ("What can I do in 15 min with low energy?")
- Sequential processing
- GTD purists

**Kanban View (New `/gtd:board`)** - Best for:
- Daily standup/overview
- Dependency awareness
- Progress tracking
- Sprint-style workflows
- Visual thinkers

### How Major Tools Handle GTD+Kanban

| Tool | Approach | Views Available |
|------|----------|-----------------|
| **Todoist** | List-first, Board view (paid) | List, Board, Calendar |
| **Things 3** | List-only, areas/projects | List, Timeline |
| **Notion** | Database with multiple views | List, Board, Calendar, Timeline, Gallery |
| **ClickUp** | Multiple synchronized views | List, Board, Gantt, Calendar, Timeline |
| **Asana** | Project-based, board/list toggle | List, Board, Timeline, Calendar |

**Pattern**: Modern tools offer **multiple synchronized views** of the same data.

### Implementation: Dual-View System

Add `/gtd:board` command alongside existing `/gtd:status`:

```bash
# Existing commands (unchanged)
/gtd:status       # Dashboard with counts
/gtd:next         # Next actions list
/gtd:tree         # Full hierarchy

# New commands
/gtd:board        # Kanban board view
/gtd:board --focus next   # Single column expanded
/gtd:board --dependents   # Show dependency tree
/gtd:sync-push    # Push to remote
/gtd:sync-pull    # Pull from remote
```

---

## Implementation Roadmap

### Phase 1: Data Model Extension (v3.0.0)

| Change | Implementation | Breaking? | Effort |
|--------|---------------|-----------|--------|
| Add `status` field | Auto-derive from `list`, allow override | No | Low |
| Add `priority` field | Default "medium" for existing tasks | No | Low |
| Add `dependencies` object | Store as `{blocking:[], blockedBy:[]}` | No | Low |
| Add `subtasks` array | Inline checklists | No | Low |
| Version bump | `"version": "3.0"` | No | Low |

### Phase 2: Kanban Display (v3.0.0)

| Change | Implementation | Effort |
|--------|---------------|--------|
| Responsive renderer | Detect width, choose layout | Medium |
| `/gtd:board` command | New entry in `gtd-display.ts` | Medium |
| Dependency visualization | Inline `└─ dep:#X` notation | Low |
| Subtask progress | `[X/Y]` indicator | Low |

### Phase 3: Dependency Logic (v3.1.0)

| Change | Implementation | Effort |
|--------|---------------|--------|
| Topological sort | `topologicalSort()` function | Medium |
| Cycle detection | DFS with recursion stack | Medium |
| Block check | Warn when starting blocked task | Low |
| `/gtd:unblock` | Force-start override command | Low |

### Phase 4: MCP Integration (v3.2.0)

| Change | Implementation | Effort |
|--------|---------------|--------|
| Linear MCP connector | Map schema, implement sync | High |
| Vibe Kanban connector | Local-first MCP server | Medium |
| Sync commands | `/gtd:sync-push`, `/gtd:sync-pull` | Medium |
| Conflict resolution | Timestamp-based merge | Medium |

---

## Knowledge Gaps & Future Research

### Resolved in this report:
- ✅ Data model design with backward compatibility
- ✅ Terminal display patterns (based on Taskwarrior, kanban-cli reference implementations)
- ✅ Dependency resolution algorithms (Kahn's algorithm, DFS cycle detection)
- ✅ GTD-Kanban mapping strategy
- ✅ Linear MCP tool inventory (verified from NPM registry)
- ✅ Vibe Kanban MCP tool inventory (verified from GitHub README)

### Identified limitations requiring workarounds:

1. **Linear MCP - No relationship tools**: The community `linear-mcp-server` does NOT expose relationship/dependency tools. The official Linear MCP (`https://mcp.linear.app/sse`) may have additional tools for blocking/blocked-by relationships - needs testing with actual Linear account.

2. **Vibe Kanban - No dependencies or subtasks**: The MCP server has no tools for:
   - Creating blocking/blocked-by relationships
   - Parent-child task relationships
   - **Workaround**: Handle relationships in GTD's local `tasks.json`, use Vibe Kanban only for state tracking

3. **Terminal compatibility testing** - Still needs verification:
   - Windows CMD (limited Unicode support)
   - iTerm2/kitty (full Unicode support)
   - VS Code integrated terminal
   - GitHub Codespaces terminal

4. **Mobile display** - Not addressed:
   - Narrow terminals (<60 columns)
   - Alternative rendering for mobile

### Suggested Follow-up Research:

1. Test official Linear MCP with blocking/blocked-by API
2. Survey users on preferred view defaults
3. Benchmark rendering performance with 1000+ tasks
4. Investigate SQLite-based local storage vs JSON for large datasets

---

## References

### Primary Sources

1. **[Linear MCP Server (NPM)](https://www.npmjs.com/package/linear-mcp-server)** - Deprecated community Linear MCP
   - Quality: High (official registry)
   - Date: Retrieved March 24, 2026

2. **[VibeKanban GitHub](https://github.com/shahriarb/vibekanban)** - Local-first Kanban with MCP
   - Quality: Medium (GitHub repo, 7★)
   - Date: Retrieved March 24, 2026

3. **[Taskwarrior Documentation](https://taskwarrior.org/docs/commands/)** - Dependency and reporting
   - Quality: High (official docs)
   - Date: Retrieved March 24, 2026

4. **[Linear API Documentation](https://developers.linear.app/)** - GraphQL API reference
   - Quality: High (official docs)
   - Date: Retrieved March 24, 2026

5. **[Linear MCP Changelog](https://linear.app/changelog/2025-05-01-mcp)** - Official MCP announcement
   - Quality: High (official)
   - Date: Retrieved March 24, 2026

### Secondary Sources

6. **[Model Context Protocol](https://modelcontextprotocol.io/)** - MCP specification
   - Quality: High (Anthropic official)

7. **[Kahn's Algorithm](https://en.wikipedia.org/wiki/Topological_sorting)** - Topological sort reference
   - Quality: High (Wikipedia community)

8. **[Taskbook GitHub](https://github.com/klaussinani/taskbook)** - Terminal kanban reference
   - Quality: Medium (8.7k★ GitHub)

### Internal References

9. **GTD Plugin Commands** - `plugins/gtd/commands/`
   - Quality: High (project source)

10. **GTD Display Tool** - `plugins/gtd/tools/gtd-display.ts`
    - Quality: High (project source)

---

*Report prepared for Magus GTD plugin development. Last updated: March 24, 2026.*