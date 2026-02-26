# Design Task: Plugin Display System

## Overview

Design the UI components for displaying Claude Code plugins in claudeup-gui. This document specifies all available data fields with real examples from the codebase.

---

## 1. Core Plugin Information

### Primary Fields (Always Available)

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string | Unique identifier (name@marketplace) | `"frontend@magus"` |
| `name` | string | Plugin display name | `"frontend"` |
| `version` | string \| null | Current version | `"3.13.0"` |
| `description` | string | Plugin description (can be long) | `"Comprehensive frontend development toolkit with TypeScript, React 19, Vite..."` |
| `marketplace` | string | Marketplace identifier | `"magus"` |
| `marketplaceDisplay` | string | Human-readable marketplace name | `"Magus"` |
| `enabled` | boolean | Whether plugin is currently enabled | `true` |

### Update Information

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `installedVersion` | string? | Currently installed version | `"3.12.0"` |
| `hasUpdate` | boolean? | Update available indicator | `true` |

---

## 2. Scope Status (Multi-Scope Installation)

Plugins can be installed at three different scopes. Each scope has independent enable/disable state.

```typescript
interface ScopeStatus {
  enabled: boolean;
  version?: string;
}
```

| Field | Description | Example |
|-------|-------------|---------|
| `userScope` | Global installation (all projects) | `{ enabled: true, version: "3.13.0" }` |
| `projectScope` | Current project only | `{ enabled: false }` |
| `localScope` | Local development path | `{ enabled: true, version: "dev" }` |

### Scope Priority Display

Visual hierarchy should show:
1. **Local** (highest priority, overrides others)
2. **Project** (overrides global)
3. **User/Global** (default scope)

---

## 3. Extended Plugin Metadata

### Author Information

```typescript
interface Author {
  name: string;
  email?: string;
  company?: string;
}
```

**Real Example:**
```json
{
  "name": "Jack Rudenko",
  "email": "i@madappgang.com",
  "company": "MadAppGang"
}
```

### Classification

| Field | Type | Example |
|-------|------|---------|
| `category` | string | `"development"`, `"media"`, `"workflow"`, `"content"` |
| `keywords` | string[] | `["frontend", "typescript", "react", "vite", "tanstack"]` |
| `homepage` | string? | `"https://github.com/MadAppGang/claude-code"` |
| `license` | string? | `"MIT"` |

---

## 4. Plugin Components (Capabilities)

These arrays show what the plugin provides:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `agents` | string[] | AI agents provided | `["developer", "architect", "tester", "reviewer"]` |
| `commands` | string[] | Slash commands | `["/implement", "/review", "/import-figma"]` |
| `skills` | string[] | Skills/capabilities | `["react-patterns", "tanstack-query", "browser-debugger"]` |
| `mcpServers` | string[] | Bundled MCP servers | `["chrome-devtools"]` |
| `hooks` | string? | Hook configuration | `"./hooks/hooks.json"` |

---

## 5. Real Plugin Examples

### Example 1: Development Plugin (Large)

```json
{
  "id": "dev@magus",
  "name": "dev",
  "version": "1.17.0",
  "description": "Universal development assistant with self-improving learning, documentation, deep research, specification interviews, and DevOps guidance. v1.17.0: Dingo skill auto-detection - agents now auto-load dingo+golang skills when .dingo files detected. 30+ skills.",
  "marketplace": "magus",
  "marketplaceDisplay": "Magus",
  "enabled": true,
  "hasUpdate": false,
  "category": "development",
  "author": {
    "name": "Jack Rudenko",
    "email": "i@madappgang.com",
    "company": "MadAppGang"
  },
  "keywords": ["development", "universal", "deep-research", "devops", "react", "typescript", "golang", "python", "rust"],
  "agents": ["stack-detector", "developer", "debugger", "architect", "ui", "scribe", "spec-writer", "devops", "researcher", "synthesizer", "doc-writer", "doc-analyzer", "doc-fixer"],
  "commands": ["/dev:help", "/dev:implement", "/dev:debug", "/dev:feature", "/dev:architect", "/dev:ui", "/dev:create-style", "/dev:interview", "/dev:deep-research", "/dev:doc", "/dev:learn"],
  "skills": ["context-detection", "react-typescript", "vue-typescript", "golang", "dingo", "bunjs", "python", "rust", "ui-design-review"],
  "userScope": { "enabled": true, "version": "1.17.0" },
  "projectScope": { "enabled": false },
  "localScope": null
}
```

### Example 2: Media Plugin (Medium)

```json
{
  "id": "nanobanana@magus",
  "name": "nanobanana",
  "version": "2.2.3",
  "description": "AI image generation and editing using Google Gemini 3 Pro Image API (Nano Banana Pro). Simple Node.js CLI with markdown styles, batch generation, reference image support, and comprehensive error handling with retry logic.",
  "marketplace": "magus",
  "marketplaceDisplay": "Magus",
  "enabled": false,
  "hasUpdate": true,
  "installedVersion": "2.1.0",
  "category": "media",
  "author": {
    "name": "Jack Rudenko",
    "company": "MadAppGang"
  },
  "keywords": ["image-generation", "ai-art", "gemini", "text-to-image"],
  "agents": [],
  "commands": ["/nanobanana:generate", "/nanobanana:edit"],
  "skills": ["image-prompts", "style-transfer"],
  "userScope": { "enabled": false, "version": "2.1.0" },
  "projectScope": null,
  "localScope": null
}
```

### Example 3: Analysis Plugin (Specialized)

```json
{
  "id": "code-analysis@magus",
  "name": "code-analysis",
  "version": "3.0.0",
  "description": "Deep code investigation with claudemem. v3.0.0: ENRICHMENT MODE - hooks now enhance native tools with AST context instead of blocking.",
  "marketplace": "magus",
  "marketplaceDisplay": "Magus",
  "enabled": true,
  "hasUpdate": false,
  "category": "development",
  "author": {
    "name": "Jack Rudenko"
  },
  "keywords": ["code-analysis", "semantic-search", "claudemem", "debugging"],
  "agents": ["codebase-detective"],
  "commands": ["/code-analysis:analyze", "/code-analysis:help", "/code-analysis:setup"],
  "skills": ["deep-analysis", "claudemem-search", "architect-detective", "developer-detective", "ultrathink-detective"],
  "hooks": "./hooks/hooks.json",
  "userScope": { "enabled": true, "version": "3.0.0" },
  "projectScope": { "enabled": true, "version": "3.0.0" },
  "localScope": null
}
```

---

## 6. UI Component Requirements

### 6.1 Plugin Card (List View)

**Must Display:**
- Plugin name (prominent)
- Version badge
- Enabled/disabled toggle
- Description (truncated to 2 lines)
- Category badge
- Update indicator (if available)

**Optional/Expandable:**
- Author name
- Keywords (first 3-5)
- Component counts (e.g., "11 agents, 8 commands, 13 skills")

### 6.2 Plugin Detail View

**Header Section:**
- Plugin name + version
- Author with company
- Category badge
- Enable/disable toggle
- Update button (if hasUpdate)
- Marketplace source

**Description Section:**
- Full description (can be multi-paragraph)
- Homepage link (if available)
- License badge

**Capabilities Section:**
- Agents list with descriptions
- Commands list (clickable to show usage)
- Skills list (collapsible if many)
- MCP servers (if any)

**Scope Management Section:**
- Three-column layout: Global | Project | Local
- Each column shows: enabled state, version if installed
- Visual indicator for which scope is active

### 6.3 States to Handle

1. **Not Installed** - Show "Install" button, marketplace info
2. **Installed (Disabled)** - Grayed out, "Enable" option
3. **Installed (Enabled)** - Full color, "Disable" option
4. **Update Available** - Badge/indicator, "Update" button
5. **Installing/Updating** - Loading state
6. **Error** - Error message display

---

## 7. Design Considerations

### Description Handling

Descriptions can be very long (100+ words). Consider:
- Truncation with "Read more" in list view
- Full text in detail view
- Version changelog often embedded (e.g., "v3.0.0: ENRICHMENT MODE...")

### Keyword Display

Some plugins have 20+ keywords. Consider:
- Show first 5-8 with "+N more"
- Searchable/filterable
- Category-based grouping

### Multi-Scope Complexity

Users may have:
- Same plugin at different versions in different scopes
- Enabled in one scope, disabled in another
- Clear visual hierarchy needed

### Component Counts

Large plugins can have:
- 11+ agents
- 8+ commands
- 30+ skills
- Consider collapsible sections with counts

---

## 8. Category Colors (Suggestion)

| Category | Color Suggestion | Example Plugins |
|----------|------------------|-----------------|
| `development` | Blue | frontend, dev, code-analysis, agentdev |
| `media` | Purple | nanobanana, video-editing |
| `workflow` | Green | conductor |
| `content` | Orange | seo |

---

## 9. Accessibility Requirements

- All interactive elements keyboard-navigable
- Screen reader support for status badges
- Color-blind friendly indicators (not color-only)
- Sufficient contrast for enabled/disabled states

---

## 10. Responsive Behavior

- **Desktop (1200px+)**: Side-by-side list + detail
- **Tablet (768-1199px)**: Stacked list, modal detail
- **Mobile (<768px)**: Full-width cards, slide-in detail

---

## Appendix: Type Definitions

```typescript
interface PluginInfo {
  // Core identification
  id: string;                    // "plugin-name@marketplace"
  name: string;                  // "plugin-name"
  version: string | null;        // "1.2.3"
  description: string;           // Full description text

  // Marketplace info
  marketplace: string;           // "marketplace-id"
  marketplaceDisplay: string;    // "Marketplace Name"

  // Status
  enabled: boolean;              // Current state
  installedVersion?: string;     // Installed version
  hasUpdate?: boolean;           // Update available

  // Per-scope status
  userScope?: ScopeStatus;       // Global scope
  projectScope?: ScopeStatus;    // Project scope
  localScope?: ScopeStatus;      // Local dev scope

  // Metadata
  category?: string;             // "development" | "media" | etc.
  author?: {
    name: string;
    email?: string;
    company?: string;
  };
  homepage?: string;             // URL
  license?: string;              // "MIT"
  keywords?: string[];           // ["keyword1", "keyword2"]

  // Components
  agents?: string[];             // Agent names
  commands?: string[];           // Command names
  skills?: string[];             // Skill names
  mcpServers?: string[];         // MCP server names
  hooks?: string;                // Hooks config path
}

interface ScopeStatus {
  enabled: boolean;
  version?: string;
}
```
