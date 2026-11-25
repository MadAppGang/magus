# lsp

Language servers for Claude Code's code intelligence, for Go (`gopls`) and
TypeScript/JavaScript (`typescript-language-server`), behind a small wrapper
that does two things the plain servers do not:

- **Idle stop.** After 10 minutes with no traffic from Claude Code and no request
  waiting for an answer, the wrapper stops the server and exits with code 1. Claude
  Code treats that as a crash and starts the server again on the next request, so a
  session left open overnight holds no language server memory.
- **Shared gopls.** Sessions in the same worktree that start gopls with the same
  settings connect to one shared gopls daemon (`gopls -remote=auto`). The settings
  are the gopls binary, the Go toolchain and `gopackagesdriver` found on `PATH`, the Go and proxy
  variables gopls reads, `HOME`, `USER` and the socket directory; sessions that
  differ in any of them get separate daemons. Each session still has its own gopls
  session, so unsaved edits in one never show in another. The daemon leaves about a
  minute after its last session.

The plain server runs instead of the wrapper when the wrapper cannot start: no Bun,
a Bun older than 1.4.0, or a check slower than 3 seconds. A shared gopls that exits,
stays silent for 20 seconds, or is sent over 4 MiB before its first answer is
replaced once by a plain gopls in the same session. That covers startup only: a
server that fails later ends the wrapper, and Claude Code restarts it as it would a
plain server. Every reason is printed on the server's stderr, starting with `lsp:`.

## Requirements

- The language servers themselves, on the `PATH` Claude Code starts with:
  - `gopls`: `go install golang.org/x/tools/gopls@latest`
  - `typescript-language-server`: `npm install -g typescript-language-server typescript`
- [Bun](https://bun.sh) 1.4.0 or later for the wrapper. Without it the plain
  servers still run.

## Replacing the official LSP plugins

This plugin declares the same file extensions as `gopls-lsp` and `typescript-lsp`
from the official marketplace. When two installed plugins declare one extension,
the first one loaded wins, so remove those two:

```
/plugin uninstall gopls-lsp
/plugin uninstall typescript-lsp
```

While either one is still enabled, every new session starts with a warning that names
it and the `claude plugin uninstall … --scope …` command that removes it.

To see which plugin serves `.go` now, run `/plugin` and look for a language server
named `gopls` under `lsp`, or open a `.go` file and check the server's stderr for an
`lsp:` line.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MAGUS_LSP_IDLE_MINUTES` | `10` | Minutes without traffic before the server is stopped. Decimal, `0` turns idle stop off. Anything else, or a positive value under 1 ms or over about 24.8 days, uses the default and prints a note. |

gopls runs shared only when it is started with no extra arguments, on macOS or
Linux, when `USER` is a single file name (no `/`, not `.` or `..`), when its socket
path fits the platform's limit, and when its socket directory (`XDG_RUNTIME_DIR`,
else `TMPDIR`, else `/tmp`) is a real directory, not a symbolic link, that belongs to
you and gives no permission at all to your group or other users (mode `0700`, as the
macOS per-user `TMPDIR` and a normal `XDG_RUNTIME_DIR` are), and the socket lands
directly in it. Otherwise it runs plain, still with idle stop. On macOS only the mode
is checked, not ACL entries.

## Exit codes

| Situation | Exit |
|---|---|
| Claude Code sends `exit` or closes stdin | 0 |
| Idle stop, a protocol error on a shared server, a wrapper error | 1 |
| The server exits by itself | its code; 128 + signal for a signal; 1 for 0 |
| The wrapper gets TERM / INT / HUP | 143 / 130 / 129 |

The wrapper never exits 0 on its own: Claude Code would then treat the server as
running, and every later request would fail.
