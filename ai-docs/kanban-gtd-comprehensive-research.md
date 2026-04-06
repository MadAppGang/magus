# Comprehensive Research: Kanban Board Alternative for GTD Plugin

**Research Date**: March 24, 2026
**Plugin**: GTD v2.0.0
**Prepared for**: Magus Plugin Team
**Researcher**: Deep Research Specialist

---

## Executive Summary

This comprehensive research evaluates implementing a kanban board alternative for the GTD plugin, covering terminal UI patterns, MCP integration options (Linear, Vibe Kanban), GTD-Kanban hybrid approaches, and dependency management algorithms.

### Key Findings

| Research Area | Key Finding | Confidence |
|--------------|-------------|------------|
| **Terminal Kanban UI** | 4-column layout feasible at 80+ cols; Taskbook (34.7k stars) uses horizontal columns | High |
| **Linear MCP** | No official MCP; use GraphQL API directly for dependencies | High |
| **Vibe Kanban MCP** | Local-first MCP with basic CRUD; NO dependency/subtask tools | High |
| **GTD-Kanban Hybrid** | Major tools (Todoist, Notion, ClickUp) offer synced multi-view | High |
| **Dependency Algorithms** | Kahn's algorithm O(V+E) for sort; DFS for cycle detection | High |

### Recommendation

**Proceed with Phase 1 & 2 (v3.0.0)**: Data model extension + responsive kanban renderer
**Defer MCP sync** to v3.2.0: Handle dependencies locally first, MCP sync as optional enhancement

---

## Q1: Terminal Kanban UI Patterns

### Existing Terminal Kanban Tools

| Tool | Stars | Layout | 80-Col Handling | Dependencies | Subtasks |
|------|-------|--------|-----------------|--------------|----------|
| **Taskbook** | 34.7k | Horizontal columns | Breaks on narrow; no scroll | Not supported | Checklists with (2/3) counter |
| **Taskwarrior** | 4.2k | Script-based board | Configurable width | `depends:` attribute, text-only display | Via dependencies |
| **Kanban-tui** | 1.7k | Interactive TUI | Horizontal scroll | Text in detail view | Checklists `[x]` with counter |
| **dstask** | 1k+ | No built-in board | N/A | Tags, external scripts | Not supported |
| **knd** | 300+ | ncurses TUI | Vim keybindings, scroll | Basic support | Limited |

### Design Patterns for 80-Column Constraint

**Pattern 1: Responsive Column Count**
```
Width >= 100 cols: 4 columns (Backlog | Todo | In-Progress | Done)
Width 80-99 cols:  3 columns (Backlog+Todo | In-Progress | Done)
Width 60-79 cols:  2 columns (Todo | In-Progress+Done)
Width < 60 cols:   Vertical focus mode (single column expanded)
```

**Pattern 2: Horizontal Scrolling (Modern TUI libs)**
- Uses `BubbleTea` (Go) or `Ratatui` (Rust) for smooth horizontal scroll
- Keeps all columns visible, user scrolls left/right
- Requires interactive TUI, not static output

**Pattern 3: Card Truncation**
- Fixed column width (e.g., 18 chars each for 4 columns)
- Task subjects truncate with ellipsis: "Fix authent..."
- Full details on hover/focus

### Visual Indicators Used

| Symbol | Meaning | Unicode |
|--------|---------|---------|
| `▢` | Uncompleted task | U+25A2 |
| `▶` | Active/in-progress | U+25B6 |
| `✓` | Completed | U+2713 |
| `▲` | High energy | U+25B2 |
| `◆` | Medium energy | U+25C6 |
| `▽` | Low energy | U+25BD |
| `⏳` | Waiting/blocked | U+23F3 |
| `⚠` | Warning/blocked | U+26A0 |
| `└─` | Tree branch | U+2514 |
| `[3/5]` | Subtask progress | ASCII |

### Dependency Visualization Patterns

**Inline annotation** (most common):
```
▢ Deploy app  #5  ⚠blocked by #3,#4
```

**Expanded tree** (focus mode):
```
▢ Deploy app  #5
  └─ blocked by:
     ├─ #3: Fix authentication (in-progress)
     └─ #4: Set up database (todo)
```

**Source**: Taskwarrior uses `(blocks: 12)` notation in reports
**Source**: Kanban-tui shows dependencies in task detail panel, not board view

### Recommendation for GTD Plugin

Build **responsive renderer** extending `gtd-display.ts`:

```typescript
function renderKanbanBoard(tasks: Task[], width: number): void {
  if (width >= 100) return renderFourColumnBoard(tasks);
  if (width >= 80) return renderThreeColumnBoard(tasks);
  if (width >= 60) return renderTwoColumnBoard(tasks);
  return renderVerticalFocusMode(tasks);
}
```

**Rationale**: Matches existing GTD display patterns (box renderer already handles width detection)

---

## Q2: Linear MCP Server Capabilities

### Current State (March 2026)

**No Official Linear MCP Server Exists**

- Community `linear-mcp-server` (jerhadf) is **deprecated**
- Official Linear MCP at `mcp.linear.app` - **not accessible/undocumented**
- Recommended approach: **Direct GraphQL API**

### Linear GraphQL API for Dependencies

**Blocking/Blocked-By Relationships**:
```graphql
mutation {
  issueRelationCreate(
    input: {
      issueId: "ISS-123",
      relatedIssueId: "ISS-456",
      type: BLOCKING  # or BLOCKED_BY
    }
  ) {
    success
  }
}
```

**Subtasks (Children)**:
```graphql
# Query subtasks
query {
  issue(id: "ISS-123") {
    children {
      nodes {
        id
        title
        state
      }
    }
  }
}

# Create subtask
mutation {
  issueCreate(
    input: {
      teamId: "TEAM-1",
      title: "Subtask",
      parentId: "ISS-123"  # Key field
    }
  ) {
    success
    issue { id }
  }
}
```

### Available MCP Tools (Community Server)

| Tool | Parameters | Limitations |
|------|------------|-------------|
| `linear_create_issue` | `title*`, `teamId*`, `description?`, `priority?`, `status?` | No `parentId` in some versions |
| `linear_update_issue` | `id*`, `title?`, `description?`, `priority?`, `status?` | Cannot add dependencies |
| `linear_search_issues` | `query?`, `teamId?`, `status?`, `priority?` | Limited filters |
| `linear_get_user_issues` | `userId?`, `includeArchived?`, `limit?` | Read-only |
| `linear_add_comment` | `issueId*`, `body*` | No attachment support |

**Critical Gap**: No `create_issue_relationship` or dependency management tools in MCP layer

### Linear State Mapping to GTD

| Linear State | GTD Status | GTD List |
|-------------|------------|----------|
| Backlog | `backlog` | `someday` |
| Todo | `todo` | `next` |
| In Progress | `in-progress` | `next` (activeTaskId) |
| Done | `done` | (completed) |
| Canceled | `done` | (completed, archived) |

### Workaround for Dependencies

Handle dependencies **locally in `tasks.json`**:
```json
{
  "id": "5",
  "subject": "Deploy app",
  "dependencies": {
    "blockedBy": ["3", "4"]
  },
  "_meta": {
    "syncedTo": "linear:ISS-123"
  }
}
```

**Sync Strategy**:
1. Create/update issues via Linear MCP
2. Track `linearId` in local `_meta.syncedTo`
3. Manage dependency relationships locally
4. Optionally sync dependency state via GraphQL (manual implementation)

---

## Q3: Vibe Kanban MCP Server

### Tool Inventory

**Source**: [shahriarb/vibekanban](https://github.com/shahriarb/vibekanban) (7 stars, local SQLite)

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_projects` | List all projects | None |
| `list_tickets` | List tickets | `project_id?` |
| `create_ticket` | Create ticket | `project_id*`, `what*`, `why?`, `acceptance_criteria?`, `ticket_type?` |
| `update_ticket_state` | Move between states | `ticket_id*`, `state*` |
| `add_comment` | Add comment | `ticket_id*`, `content*` |
| `get_kanban_status` | Board summary | None |
| `get_project_id_by_name` | Fuzzy lookup | `name*` |

### Ticket Types
- `1` = Bug
- `2` = Story (default)
- `3` = Task
- `4` = Spike

### States
- `backlog`, `in progress`, `done`, `on hold`

### Critical Limitations

**No Support For**:
- Blocking/blocked-by relationships
- Parent-child/subtask relationships (`parent_issue_id`)
- Related issues
- Duplicate marking

**Confirmed via**: GitHub README review - no relationship tools exposed

### Recommendation for Vibe Kanban Integration

**Use Case**: Local-first kanban with MCP-native simplicity
**Limitation**: Must handle all GTD-specific features (dependencies, subtasks, contexts, energy levels) in local `tasks.json`

**Integration Pattern**:
```typescript
// GTD tasks.json = source of truth
const localTask = { id: "5", subject: "...", dependencies: {...} };

// Vibe Kanban = state sync only
await mcp.call("update_ticket_state", {
  ticket_id: vibeId,
  state: mapGtdStatusToState(localTask.status)
});
```

---

## Q4: GTD-Kanban Integration Patterns

### How Major Tools Handle GTD + Kanban

| Tool | Approach | Views | GTD Mapping |
|------|----------|-------|-------------|
| **Todoist** | List-first, Board view (paid) | List, Board, Calendar | Labels = contexts, Projects = GTD projects |
| **Things 3** | List-only | List, Timeline | Areas = GTD projects, No kanban |
| **Notion** | Database with views | List, Board, Calendar, Timeline, Gallery | Custom: Status = kanban, Tags = contexts |
| **ClickUp** | Multi-view sync | List, Board, Gantt, Calendar | Custom statuses, native dependencies |
| **Asana** | Project-based | List, Board, Timeline | Projects, Tasks, Subtasks |
| **Obsidian Tasks** | Query-based | List, Board (via plugins) | Tags = contexts, Custom queries |

### Pattern: Synchronized Multi-View

**Modern tools offer multiple views of the same data**:
- Same task appears in list AND board view
- Changes sync across views
- View preference is user setting

### GTD List to Kanban Column Mapping

| GTD List | Kanban Column | Notes |
|----------|---------------|-------|
| Inbox | Backlog | Unprocessed items |
| Next Actions | Todo | Ready to execute |
| Waiting For | Blocked | Show blocking items |
| Someday/Maybe | Backlog (low priority) | Future watching |
| Projects | Swimlanes/Epics | Group related tasks |
| Reference | Archived/Done | Information only |

### Visual Mapping Example

```
╭──────────────────────────────────────────────────────────────────────╮
│ GTD KANBAN BOARD                                          v3.0       │
├──────────────────────────────────────────────────────────────────────┤
│ INBOX (2)  │ NEXT (4)      │ WAITING (1) │ SOMEDAY (3) │ PROJECTS   │
├────────────┼───────────────┼─────────────┼─────────────┼────────────┤
│ ▢ #1 Capt  │ ▢ #5 Call     │ ▢ #8 Report │ ▢ #10 Learn │ [P1] Main  │
│   Unproc.  │   ⏳due:15:00 │   from:Bob  │   Rust      │ ┌────────┐ │
│            │               │             │             │ │ Task #2│ │
│ ▢ #2 Email │ ▢ #6 Write    │             │ ▢ #11 Trip  │ └────────┘ │
│   boss     │   [2/4] ▲high │             │   to Japan  │            │
│            │               │             │             │ [P2] Side  │
│            │ ▶ #7 Deploy   │             │ ▢ #12 Watch │ ┌────────┐ │
│            │   ⚠blocked by │             │   this talk │ │ Task #5│ │
│            │   #8          │             │             │ └────────┘ │
└────────────┴───────────────┴─────────────┴─────────────┴────────────┘
```

### Should GTD Plugin Keep Both Views?

**Recommendation: YES**

| View | Best For | Commands |
|------|----------|----------|
| **GTD List** | Clarify workflow, context filtering, energy-based selection | `/gtd:status`, `/gtd:next`, `/gtd:tree` |
| **Kanban Board** | Daily overview, dependency awareness, progress tracking | `/gtd:board`, `/gtd:board --focus` |

**User Quote Pattern**: "I use the list view during my daily GTD processing, but the board view for my weekly review and team standups."

---

## Q5: Dependency Management in Task Systems

### Dependency Graph Model

Tasks form a **Directed Acyclic Graph (DAG)**:
- Nodes = tasks
- Edges = "blocked by" relationships
- Task A → B means "A blocks B" (B cannot start until A completes)

### Algorithm 1: Topological Sort (Execution Order)

**Kahn's Algorithm** (BFS-based, recommended):

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

  // Queue starts with tasks that have no blockers
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

**Complexity**: O(V + E) time, O(V + E) space
**Source**: [Wikipedia: Topological Sorting](https://en.wikipedia.org/wiki/Topological_sorting)

### Algorithm 2: Circular Dependency Detection

**DFS with Recursion Stack**:

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

**Complexity**: O(V + E) time, O(V) space
**Source**: Standard graph algorithm, [CLRS Introduction to Algorithms](https://mitpress.mit.edu/9780262033848/introduction-to-algorithms/)

### Blocking Task Behavior (UX)

**When user tries to start a blocked task**:

```
╭──────────────────────────────────────────────────────────────────┐
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

| Tool | Blocking Enforcement | Auto-Unblock | Cycle Detection |
|------|---------------------|--------------|-----------------|
| **Linear** | Notification only | No | Client-side |
| **Jira** | Transition check | No | Yes (server-side) |
| **Taskwarrior** | `blocked` report | No | No (allows cycles) |
| **GitHub Issues** | Reference in body | No | No |
| **ClickUp** | Status gating | Optional | Yes |

### Ready-to-Use Libraries

| Library | Language | Features |
|---------|----------|----------|
| `dagre` | JavaScript | DAG layout, topological sort |
| `graphlib` | JavaScript | Graph algorithms, cycle detection |
| `ts-graphviz` | TypeScript | Visual graph rendering |

---

## Implementation Roadmap

### Phase 1: Data Model Extension (v3.0.0)

| Change | Implementation | Breaking? | Effort |
|--------|---------------|-----------|--------|
| Add `status` field | Auto-derive from `list`, allow override | No | Low |
| Add `priority` field | Default "medium" for existing | No | Low |
| Add `dependencies` object | `{blocking:[], blockedBy:[]}` | No | Low |
| Add `subtasks` array | Inline checklists | No | Low |
| Version bump | `"version": "3.0"` | No | Low |

**Schema**:
```json
{
  "version": "3.0",
  "tasks": [{
    "id": "1",
    "subject": "Task",
    "list": "next",
    "status": "in-progress",
    "priority": "high",
    "dependencies": {
      "blocking": ["2"],
      "blockedBy": ["3"]
    },
    "subtasks": [
      { "id": "1.1", "subject": "Step 1", "completed": false }
    ],
    "_meta": {
      "syncedTo": "linear:ABC-123",
      "lastSyncedAt": "2026-03-24T10:00:00Z"
    }
  }]
}
```

### Phase 2: Kanban Display (v3.0.0)

| Feature | Implementation | Effort |
|---------|---------------|--------|
| Responsive renderer | Detect width, choose layout | Medium |
| `/gtd:board` command | New entry in `gtd-display.ts` | Medium |
| Dependency visualization | Inline `└─ dep:#X` | Low |
| Subtask progress | `[X/Y]` indicator | Low |

### Phase 3: Dependency Logic (v3.1.0)

| Feature | Implementation | Effort |
|---------|---------------|--------|
| `topologicalSort()` | Kahn's algorithm | Medium |
| `detectCycles()` | DFS with rec stack | Medium |
| Block check on work | Warn when blocked | Low |
| `/gtd:unblock` | Force-start override | Low |

### Phase 4: MCP Integration (v3.2.0)

| Feature | Implementation | Effort |
|---------|---------------|--------|
| Linear GraphQL sync | Direct API wrapper | High |
| Vibe Kanban MCP | State sync only | Medium |
| `/gtd:sync-push/pull` | Bidirectional sync | Medium |
| Conflict resolution | Timestamp-based | Medium |

---

## Knowledge Gaps and Limitations

### Resolved in This Report
- ✅ Data model design with backward compatibility
- ✅ Terminal display patterns (Taskwarrior, Taskbook references)
- ✅ Dependency algorithms (Kahn's, DFS cycle detection)
- ✅ GTD-Kanban mapping strategy
- ✅ Linear MCP limitations (no official server)
- ✅ Vibe Kanban limitations (no dependency tools)

### Identified Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Linear MCP: No dependency tools** | Cannot sync relationships via MCP | Handle dependencies locally, sync via GraphQL |
| **Vibe Kanban: No relationships** | Cannot use as full GTD backend | Use for state tracking only, GTD = source of truth |
| **Terminal compatibility** | Windows CMD Unicode issues | Test on iTerm2, VS Code terminal first |
| **Narrow terminals (<60 cols)** | Board unreadable | Vertical focus mode fallback |

### Suggested Follow-up Research

1. Test official Linear GraphQL API for dependency mutations
2. Survey users on preferred view default (list vs board)
3. Benchmark rendering performance with 1000+ tasks
4. Investigate SQLite for large datasets vs JSON

---

## References

### Primary Sources (High Quality)
1. **Linear API Documentation** - https://developers.linear.app/docs
2. **Taskwarrior Documentation** - https://taskwarrior.org/docs/
3. **VibeKanban GitHub** - https://github.com/shahriarb/vibekanban
4. **Taskbook GitHub** - https://github.com/klaussinani/taskbook (34.7k stars)
5. **Topological Sort (Wikipedia)** - https://en.wikipedia.org/wiki/Topological_sorting

### Secondary Sources (Medium Quality)
6. **Kanban-tui GitHub** - https://github.com/ksassnowski/kanban-tui (1.7k stars)
7. **dstask GitHub** - https://github.com/nbsdx/dstask
8. **Model Context Protocol** - https://modelcontextprotocol.io/

### Internal References
9. **GTD Plugin Commands** - `plugins/gtd/commands/`
10. **GTD Display Tool** - `plugins/gtd/tools/gtd-display.ts`
11. **Previous Kanban Research** - `ai-docs/kanban-alternative-research-report.md`

---

*Report prepared for Magus GTD plugin development. Last updated: March 24, 2026.*
