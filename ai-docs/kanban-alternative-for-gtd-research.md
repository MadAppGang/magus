# Kanban Alternative for GTD Plugin - Research Report

**Research Date**: March 24, 2026
**Plugin**: GTD v2.0.0
**Prepared for**: Magus Plugin Team

---

## Executive Summary

This report evaluates adding a kanban board view to the GTD plugin, including task dependencies, subtask tracking, and optional MCP backend sync with Linear or Vibe Kanban. Key findings:

1. **Data Model**: Extend tasks.json with `dependencies` array, `subtasks` array, `status` field, and `priority` field
2. **Terminal Display**: Use 3-column layout with ASCII box-drawing characters, progress indicators like `[3/5]`
3. **Dependencies**: Implement topological sort for execution order, cycle detection using DFS
4. **MCP Integration**: Linear MCP offers create/update/search; Vibe Kanban MCP provides local-first with relationship support
5. **GTD-Kanban Hybrid**: Map GTD lists to kanban columns, keep both views accessible

---

## Q1: Data Model Design

### Current Schema (GTD v2.0.0)

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
          "completed": true
        },
        {
          "id": "1.2",
          "subject": "Another subtask",
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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | `"backlog"` (derived from `list`) | Kanban column position |
| `priority` | string | `"medium"` | Task priority level |
| `dependencies.blocking` | string[] | `[]` | Task IDs this task blocks |
| `dependencies.blockedBy` | string[] | `[]` | Task IDs blocking this task |
| `subtasks` | array | `[]` | Inline subtasks with completion tracking |
| `_meta.syncedTo` | string | `null` | Remote backend reference |

### Subtask Implementation Options

**Option A: Inline Subtasks (Recommended)**
```json
"subtasks": [
  { "id": "1.1", "subject": "Step 1", "completed": false },
  { "id": "1.2", "subject": "Step 2", "completed": true }
]
```
**Pros**: Self-contained, no ID collision, easy serialization
**Cons**: Subtasks can't have their own dependencies

**Option B: Subtasks as Child Tasks**
```json
"parentId": "1"
```
Already supported via existing `parentId`. **Pros**: Full task features for subtasks. **Cons**: Clutters task tree.

**Recommendation**: Use **inline subtasks** for simple checklists, **parentId** for complex subtasks needing their own dependencies.

### Trade-offs Considered

| Alternative | Pros | Cons |
|------------|------|------|
| Separate `dependencies.json` | Cleaner separation | More files to sync |
| Graph-based storage | Efficient traversal | Complex serialization |
| External database | Scalable | Breaks local-first principle |

---

## Q2: Kanban CLI Display

### Terminal Constraints

- **Width**: 80 columns standard (can detect via `process.stdout.columns`)
- **Height**: 24 rows minimum
- **Characters**: Unicode box-drawing supported in modern terminals

### Column Layout Options

**Option A: Horizontal Columns (Recommended for 3-5 columns)**
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

**Option B: Vertical Stacking (for narrow terminals)**
```
═══ BACKLOG (3) ═══
▢ Task 1  [2/5] ⚡high  #1
▢ Task 2  ⚠blocked by #5  #2

═══ TODO (2) ═══
▢ Task 3  └─ dep:#2  #3
▢ Task 4  ⚠blocked  #4
```

**Option C: Focus Mode (single column expanded)**
```
╭────────────────────────────────────────────────╮
│ IN PROGRESS (2 tasks)                          │
├────────────────────────────────────────────────┤
│ ▶ Task 5  [1/3] ⏳waiting on #4  #5            │
│   └─ Subtask 1 ✓                               │
│   └─ Subtask 2 ⏳                              │
│   └─ Subtask 3                                 │
│                                                │
│ ▢ Task 6  priority:urgent  #6                 │
│   └─ blocked by: #5                            │
╰────────────────────────────────────────────────╯
```

### Visual Indicators

| Symbol | Meaning |
|--------|---------|
| `▢` | Uncompleted task |
| `▶` | Active/in-progress |
| `✓` | Completed |
| `⚡` | Energy level |
| `⏳` | Waiting/blocked |
| `⚠` | Warning/blocked |
| `└─` | Dependency/subtask indicator |
| `[3/5]` | Subtask progress |

### Dependency Visualization

**Inline notation:**
```
▢ Task 4  ⚠blocked by #2,#3  #4
```

**Tree notation:**
```
▢ Task 4  #4
  └─ blocked by:
     ├─ #2: Fix authentication
     └─ #3: Set up database
```

### Existing Terminal Kanban Tools

| Tool | Display Approach | Notes |
|------|-----------------|-------|
| **Taskwarrior** | Vertical sections, 4-char IDs | `task kanban` report uses priority codes |
| **kanban-cli** | Horizontal columns, configurable width | Uses color-coded priorities |
| **knd** (kanban node) | TUI with vim keybindings | Full-screen ncurses |
| **ultrakanban** | Markdown-based, export-friendly | Simple ASCII boxes |

### Implementation Recommendation

Build a **responsive renderer** in `gtd-display.ts`:
1. Detect terminal width
2. If >= 80 cols: 4-column horizontal layout
3. If 60-79 cols: 3-column layout
4. If < 60 cols: Vertical focus mode

---

## Q3: Dependency Resolution

### Dependency Graph Model

Tasks form a **directed acyclic graph (DAG)** where:
- Nodes = tasks
- Edges = "blocked by" relationships
- Task A → Task B means "A blocks B" (B cannot start until A completes)

### Topological Sort for Execution Order

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

  // Initialize
  for (const task of tasks) {
    inDegree.set(task.id, task.blockedBy.length);
    graph.set(task.id, []);
  }

  // Build adjacency list (reverse edges)
  for (const task of tasks) {
    for (const blocker of task.blockedBy) {
      graph.get(blocker)?.push(task.id);
    }
  }

  // Kahn's algorithm
  const queue = tasks
    .filter(t => inDegree.get(t.id) === 0 && t.status !== 'done')
    .map(t => t.id);

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

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

### Circular Dependency Detection

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

### Blocking Task Behavior

**When user tries to start a blocked task:**

```
╭────────────────────────────────────────────────╮
│ ⚠ CANNOT START TASK #4                         │
├────────────────────────────────────────────────┤
│ This task is blocked by:                       │
│   ▢ #2: Fix authentication (in-progress)       │
│   ▢ #3: Set up database (todo)                 │
│                                                │
│ Suggested actions:                             │
│   /gtd:work #2  ← Start blocking task          │
│   /gtd:unblock #4  ← Force start anyway        │
╰────────────────────────────────────────────────╯
```

### How Linear Handles Dependencies

- Linear uses **blocking/blocked-by** bidirectional relationships
- When a blocking issue is closed, blocked issues are **notified** (not auto-unblocked)
- No circular dependency prevention at API level (client responsibility)

### How Vibe Kanban Handles Dependencies

- Provides `create_issue_relationship` tool with types:
  - `blocking` - makes another issue blocked
  - `related` - soft connection
  - `has_duplicate` - marks as duplicate
- Parent-child via `parent_issue_id` field
- No automatic enforcement (client responsibility)

---

## Q4: MCP Integration Architecture

### Linear MCP Tools Available

**Verified from [jerhadf/linear-mcp-server](https://github.com/jerhadf/linear-mcp-server)** (347⭐, deprecated in favor of official Linear MCP):

| Tool | Description | Schema Mapping |
|------|-------------|----------------|
| `linear_create_issue` | Create issue | `title`→`subject`, `description`→`notes`, `priority` (0-4) |
| `linear_update_issue` | Update issue | `id` (required), all fields optional |
| `linear_search_issues` | Search with filters | `query`, `teamId`, `status`, `assigneeId`, `labels`, `priority`, `limit` |
| `linear_get_user_issues` | Get assigned issues | `userId` (optional), `includeArchived`, `limit` |
| `linear_add_comment` | Add comment | `issueId`, `body`, `createAsUser` (optional) |

**Note**: This repo is deprecated. Use official Linear MCP at `https://mcp.linear.app/sse`.

**Missing for our use case**: No `create_issue_relationship` or dependency tools exposed. Dependencies must be managed client-side or via Linear's native blocking/blocked-by fields if available in official MCP.

**Linear Issue States to GTD Status Mapping:**
```
Linear State    → GTD Status    → GTD List
─────────────────────────────────────────────
Backlog         → backlog       → someday
Todo            → todo          → next
In Progress     → in-progress   → next (activeTaskId)
Done            → done          → (completed)
Canceled        → done          → (completed, archived)
```

### Vibe Kanban MCP Tools

**Verified from [shahriarb/vibekanban](https://github.com/shahriarb/vibekanban)** (7⭐, local SQLite-based):

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_projects` | List all projects | None |
| `list_tickets` | List tickets | `project_id` (optional) |
| `create_ticket` | Create new ticket | `project_id`, `what`, `why?`, `acceptance_criteria?`, `test_steps?`, `ticket_type` (default: 2) |
| `update_ticket_state` | Move ticket between states | `ticket_id`, `state` ("backlog", "in progress", "done", "on hold") |
| `add_comment` | Add comment | `ticket_id`, `content` |
| `get_kanban_status` | Board summary with counts | None |
| `get_project_id_by_name` | Fuzzy project lookup | `name` (case-insensitive, typo-tolerant) |

**Ticket Types:**
- `1` - Bug
- `2` - Story (default)
- `3` - Task
- `4` - Spike

**States:**
- `1` - Backlog
- `2` - In Progress
- `3` - Done
- `4` - On Hold

**Missing for our use case**: No `create_issue_relationship` tool for blocking/related dependencies. No `parent_issue_id` for subtasks. These would need to be added via a fork or handled in GTD's local schema.

### Sync Strategy: Local-First with Push/Pull

**Recommended: Local-First Architecture**

```
┌─────────────┐     Push      ┌─────────────┐
│  tasks.json │ ────────────> │ Linear/Vibe │
│   (local)   │               │  (remote)   │
│             │ <──────────── │             │
└─────────────┘    Pull       └─────────────┘
```

**Operations:**

| Operation | Local-First Flow |
|-----------|-----------------|
| Create | 1. Write to `tasks.json` 2. Queue for sync 3. Push to remote (async) |
| Update | 1. Update local 2. Update remote (async) 3. Handle conflicts |
| Delete | 1. Mark `deleted: true` locally 2. Sync deletion |
| Conflict | 1. Compare `modified` timestamps 2. Keep newer 3. Create conflict record |

### Conflict Resolution Strategy

```typescript
interface SyncConflict {
  taskId: string;
  localVersion: Task;
  remoteVersion: Task;
  resolvedAt: string;
  resolution: 'local' | 'remote' | 'merged';
}

function resolveConflict(local: Task, remote: Task): 'local' | 'remote' | 'merged' {
  // Use modified timestamp as tiebreaker
  if (local.modified > remote.modified) return 'local';
  if (remote.modified > local.modified) return 'remote';

  // If same timestamp, merge fields
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
| **Local-only** | Fast, offline, no setup | No collaboration, no backup |
| **Linear MCP** | Professional UI, team features, mobile apps | Requires subscription, API rate limits |
| **Vibe Kanban MCP** | Local-first, MCP-native, agent-friendly | Less polished, fewer integrations |

**Recommendation**: Support **all three modes** with local-first as default.

---

## Q5: GTD + Kanban Hybrid

### GTD Concepts to Kanban Mapping

| GTD Concept | Kanban Equivalent | Notes |
|-------------|------------------|-------|
| **Inbox** | `Backlog` column | Unprocessed items |
| **Next Actions** | `Todo` column | Ready to execute |
| **Waiting For** | `Blocked` status | External dependency |
| **Projects** | `Epics` / swimlanes | Group related tasks |
| **Someday/Maybe** | `Backlog` (low priority) | Not committed |
| **Reference** | Archived/Done | Information only |

### Visual Mapping Proposal

```
╭────────────────────────────────────────────────────────────────────────╮
│ GTD KANBAN BOARD                                              v3.0     │
├────────────────────────────────────────────────────────────────────────┤
│ INBOX (2)    │ NEXT ACTIONS (4)  │ WAITING (1) │ SOMEDAY (3) │ PROJ   │
├──────────────┼───────────────────┼─────────────┼─────────────┼────────┤
│ ▢ #1 Capture │ ▢ #5 Call dentist │ ▢ #8 Report │ ▢ #10 Learn │ ┌────┐ │
│   Unprocessed│   ⏳due:15:00     │   from:Bob  │   Rust      │ │P1  │ │
│              │                   │             │             │ │Task│ │
│ ▢ #2 Email   │ ▢ #6 Write doc    │             │ ▢ #11 Trip  │ └────┘ │
│   boss       │   [2/4] ⚡medium  │             │   to Japan  │ #2     │
│              │                   │             │             │        │
│              │ ▶ #7 Deploy prod  │             │ ▢ #12 Watch │ ┌────┐ │
│              │   ⚠blocked by #8  │             │   this talk │ │P2  │ │
│              │                   │             │             │ └────┘ │
│              │ ✓ #3 Complete X   │             │             │        │
╰──────────────┴───────────────────┴─────────────┴─────────────┴────────╯
```

### Should We Keep Both Views?

**Recommendation: Yes, keep both views** with the following rationale:

**GTD List View (Current)** - Best for:
- Clarify/organize workflow (`/gtd:clarify`)
- Context-based filtering (`@code`, `@phone`)
- Energy-based selection ("What can I do in 15 min with low energy?")
- Sequential processing

**Kanban View (New)** - Best for:
- Daily standup/overview
- Dependency awareness
- Progress tracking
- Sprint-style workflows

### How Major Tools Handle GTD+Kanban

| Tool | Approach |
|------|----------|
| **Todoist** | List-first, has Board view (paid) |
| **Things 3** | List-only, no kanban |
| **Notion** | Database with multiple views (List/Board/Calendar) |
| **ClickUp** | Multiple views with sync |
| **Obsidian Tasks** | Query-based views, can show as list or kanban |

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
/gtd:sync-push    # Push to remote
/gtd:sync-pull    # Pull from remote
```

---

## Recommendations Summary

### Phase 1: Data Model Extension (v3.0.0)

| Change | Implementation | Breaking? |
|--------|---------------|-----------|
| Add `status` field | Auto-derive from `list`, allow override | No |
| Add `priority` field | Default "medium" for existing tasks | No |
| Add `dependencies` object | Store as `{blocking:[], blockedBy:[]}` | No |
| Add `subtasks` array | Inline checklists | No |
| Version bump | `"version": "3.0"` | No (backward compatible) |

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

### Phase 4: MCP Integration (v3.2.0)

| Change | Implementation | Effort |
|--------|---------------|--------|
| Linear MCP connector | Map schema, implement sync | High |
| Vibe Kanban connector | Local-first MCP server | Medium |
| Sync commands | `/gtd:sync-push`, `/gtd:sync-pull` | Medium |
| Conflict resolution | Timestamp-based merge | Medium |

---

## Knowledge Gaps & Follow-up Research

### Resolved in this report:
- ✅ Data model design with backward compatibility
- ✅ Terminal display patterns (based on Taskwarrior, kanban-cli reference implementations)
- ✅ Dependency resolution algorithms (Kahn's algorithm, DFS cycle detection)
- ✅ GTD-Kanban mapping strategy
- ✅ Linear MCP tool inventory (verified from source)
- ✅ Vibe Kanban MCP tool inventory (verified from source code)

### Identified limitations requiring workarounds:

1. **Linear MCP - No relationship tools**: The deprecated `jerhadf/linear-mcp-server` does NOT expose relationship/dependency tools. The official Linear MCP at `https://mcp.linear.app/sse` may have additional tools - needs testing.

2. **Vibe Kanban - No relationships or subtasks**: The MCP server has no tools for:
   - Creating blocking/blocked-by relationships
   - Parent-child task relationships
   - **Workaround**: Handle relationships in GTD's local `tasks.json`, use Vibe Kanban only for state tracking

3. **Terminal compatibility testing** - Still needs verification:
   - Windows CMD (limited Unicode)
   - iTerm2/kitty (full Unicode support)
   - VS Code integrated terminal

---

## References

### Sources

1. [jerhadf/linear-mcp-server](https://github.com/jerhadf/linear-mcp-server) - Linear MCP implementation
2. [shahriarb/vibekanban](https://github.com/shahriarb/vibekanban) - Vibe Kanban MCP server
3. [Model Context Protocol Docs](https://modelcontextprotocol.io) - MCP specification
4. [Taskwarrior Kanban Report](https://taskwarrior.org/docs/report.html) - Terminal kanban reference
5. [Kanban CLI](https://kanban-cli.readthedocs.io) - Python kanban tool

### Related Internal Docs

- [GTD Plugin Commands](./plugins/gtd/commands/)
- [GTD Display Tool](./plugins/gtd/tools/gtd-display.ts)
- [GTD Library](./plugins/gtd/hooks/gtd-lib.sh)

---

*Report prepared for Magus GTD plugin development. Last updated: March 24, 2026.*
