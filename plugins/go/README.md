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
- **Go language server** — `gopls` for `.go` files, behind a wrapper that stops it
  when idle and lets sessions in one worktree share one gopls daemon. See
  [Language server](#language-server).

## Language server

go gives Claude Code's code intelligence for `.go` files to `gopls`, behind a small
wrapper that does two things plain gopls does not:

- **Idle stop.** After 10 minutes with no traffic from Claude Code and no request
  waiting for an answer, the wrapper stops the server and exits with code 1. Claude
  Code treats that as a crash and starts the server again on the next request, so a
  session left open overnight holds no language server memory.
- **Shared gopls.** Sessions in the same worktree that start gopls with the same
  settings connect to one shared gopls daemon (`gopls -remote=auto`). The settings
  are the gopls binary, the Go toolchain and `gopackagesdriver` found on `PATH`, the Go
  and proxy variables gopls reads, `HOME`, `USER` and the socket directory; sessions
  that differ in any of them get separate daemons. Each session still has its own gopls
  session, so unsaved edits in one never show in another. The daemon leaves about a
  minute after its last session.

The plain gopls runs instead of the wrapper when the wrapper cannot start: no Bun, a
Bun older than 1.4.0, or a check slower than 3 seconds. A shared gopls that exits,
stays silent for 20 seconds, or is sent over 4 MiB before its first answer is replaced
once by a plain gopls in the same session. That covers startup only: a server that
fails later ends the wrapper, and Claude Code restarts it as it would a plain server.
Every reason is printed on the server's stderr, starting with `lsp:`.

### Requirements

- `gopls` on the `PATH` Claude Code starts with:
  `go install golang.org/x/tools/gopls@latest`. Without it, every session starts with
  a note that names this command; the rest of the plugin works.
- [Bun](https://bun.sh) 1.4.0 or later for the wrapper. Without it plain gopls still
  runs.

### Replacing `gopls-lsp` and `lsp`

go declares `.go`, as do `gopls-lsp` from the official marketplace and the `lsp`
plugin go replaces. When two installed plugins declare one extension, the first one
loaded wins, so remove those two:

```
/plugin uninstall gopls-lsp
/plugin uninstall lsp
```

While either one is still enabled, every new session starts with a warning that names
it and the `claude plugin uninstall … --scope …` command that removes it.

To see which plugin serves `.go` now, run `/plugin` and look for a language server
named `gopls` under `go`, or open a `.go` file and check the server's stderr for an
`lsp:` line.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MAGUS_LSP_IDLE_MINUTES` | `10` | Minutes without traffic before the server is stopped. Decimal, `0` turns idle stop off. Anything else, or a positive value under 1 ms or over about 24.8 days, uses the default and prints a note. |

gopls runs shared only when it is started with no extra arguments, on macOS or Linux,
when `USER` is a single file name (no `/`, not `.` or `..`), when its socket path fits
the platform's limit, and when its socket directory (`XDG_RUNTIME_DIR`, else `TMPDIR`,
else `/tmp`) is a real directory, not a symbolic link, that belongs to you and gives no
permission at all to your group or other users (mode `0700`, as the macOS per-user
`TMPDIR` and a normal `XDG_RUNTIME_DIR` are), and the socket lands directly in it.
Otherwise it runs plain, still with idle stop. On macOS only the mode is checked, not
ACL entries.

### Exit codes

| Situation | Exit |
|---|---|
| Claude Code sends `exit` or closes stdin | 0 |
| Idle stop, a protocol error on a shared server, a wrapper error | 1 |
| The server exits by itself | its code; 128 + signal for a signal; 1 for 0 |
| The wrapper gets TERM / INT / HUP | 143 / 130 / 129 |

The wrapper never exits 0 on its own: Claude Code would then treat the server as
running, and every later request would fail.

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
| Write Go tests | `dev:qa-engineer` | `roles/tester/` + `testing-patterns.md` |

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
├── hooks/                       # SessionStart: deps check, conflict and missing-gopls warning
├── language-server/             # the gopls wrapper: bin/launch.sh, src/ relay, idle stop, shared gopls
├── tests/                       # wrapper and hook tests (a real gopls daemon included)
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
