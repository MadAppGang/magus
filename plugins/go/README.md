# go

Go development toolkit for Claude Code.

## What's here

- **`go-tui` skill** — build colorful, graph-and-badge-heavy Go terminal UIs with
  the Charm stack (Bubble Tea, Lip Gloss, Bubbles, ntcharts), plus a verified
  color-accurate screenshot workflow for visually critiquing a running TUI.
  Invoke with `/go-tui`.
- **`knowledge/` base** — a curated, production-grade Go knowledge base: the Uber
  Go Style Guide, *100 Go Mistakes*, Go Proverbs, and XML-tagged implementation
  patterns (error handling, concurrency, interface design, context usage, testing,
  HTTP APIs, …) organized by role (`developer`, `architect`, `tester`,
  `code-reviewer`). These are plain reference files — they are consumed by agents,
  not invoked directly.

## This plugin ships no implementation agents — use `dev@magus`

By design, the `go` plugin does **not** ship its own coder/architect/reviewer/test
agents. The [`dev@magus`](https://github.com/MadAppGang/magus) plugin already
provides language-agnostic role agents, and they are wired to **automatically
discover and use this plugin's `knowledge/` base when both plugins are installed**:

| Task | Use this dev agent | Reads from `knowledge/` |
|------|--------------------|--------------------------|
| Implement Go code | `dev:developer` | `roles/developer/` + `references/` |
| Design Go architecture | `dev:architect` | `roles/architect/` + `references/` |
| Review Go code | `dev:reviewer` | `roles/code-reviewer/` + style guides |
| Write Go tests | `dev:test-architect` | `roles/tester/` + `testing-patterns.md` |

So the intended workflow is: **install both plugins, then delegate Go work to the
`dev` agents** — they pick up the Go knowledge automatically.

### If the `dev` plugin isn't installed

This plugin's knowledge base only helps if something reads it. Install the `dev`
plugin to get the role agents that use it:

```
/plugin install dev@magus
```

Without `dev`, you can still:
- use the `go-tui` skill (`/go-tui`) — it's self-contained, and
- read the `knowledge/` files yourself for reference.

## Layout

```
go/
├── plugin.json
├── skills/
│   └── go-tui/                  # /go-tui — Charm-stack TUIs + screenshot workflow
└── knowledge/                   # reference files consumed by dev@magus agents
    ├── go-proverbs.md
    ├── uber-go-style-guide.md
    ├── 100-go-mistakes.md
    ├── modern-backend-development.md
    ├── references/              # production-code patterns by topic
    └── roles/                   # role-scoped guidance + reference indexes
        ├── developer/
        ├── architect/
        ├── tester/
        └── code-reviewer/
```
