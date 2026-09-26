# Dingo build and tooling

Read this when setting up a Dingo project's build, CI or editor, or when a transpile error
needs locating. The language itself is in `../SKILL.md`.

Verified against the Dingo source (`cmd/dingo/main.go`, `cmd/dingo/compile.go`,
`pkg/config/config.go`). Re-check `dingo --help` if the installed version is much newer.

## Commands

| Command | What it does |
|---|---|
| `dingo build [go build flags] <files or packages>` | Transpile, then `go build`. Every `go build` flag passes through (`-o`, `-race`, `-ldflags`). Takes explicit files or packages only: `./...` is refused with "recursive patterns like './...' are not yet supported". |
| `dingo run <files> [-- program args]` | Transpile, then `go run`. Explicit files only, like `dingo build`. |
| `dingo go <file.dingo \| ./...>` | Transpile only. Needs at least one argument and accepts `./...`. Writes into the build directory (`build/` by default), not beside the source; `-o` names the output for a single file. `-O` is declared but rejected as not supported. |
| `dingo watch <packages> [-- program args]` | Watch, rebuild and restart on change. |
| `dingo fmt`, `dingo lint` | Format and lint `.dingo` files; both accept `./...`. `dingo fmt --check .` exits 1 on an unformatted file. `dingo lint` is advisory: it prints warnings and always exits 0. |
| `dingo clean` | Remove build artifacts. |

## Where generated Go goes

Every transpiling command writes into the build directory, `build/` by default
(`[build] outdir` in `dingo.toml`), mirroring the source tree, plus source maps under
`.dmap/`. Source directories stay clean.

The two kinds of command leave that directory in different states:

- `dingo build <pkg>` makes `build/` a complete module: it gets a `go.mod`,
  every generated `.go` file in the workspace (not only the named package's), and copies of
  the project's plain `.go` files, including `_test.go` files. The Go toolchain runs from
  inside it. It also writes the build output (a binary, or an archive for a library
  package) into the current directory unless `-o` says otherwise.
- `dingo go ./...` writes only the generated `.go` files. `build/` gets no `go.mod` and no
  test files, so `go vet` or `go test` run from the module root cannot see the generated
  code and fail with `undefined:` errors on any package whose tests sit beside the source.

Measured with dingo 0.14.0 on a two-package module with the default `dingo.toml`.

Add `build/` and `.dmap/` to `.gitignore`. Generated code is an artifact, and the `.dingo`
files are the source of truth.

## Checking a project

Run the Go toolchain inside the build directory, after a `dingo build` has made it a module:

```bash
dingo fmt --check .
dingo build -o /dev/null ./cmd/app      # any one package: it transpiles the whole workspace
(cd build && go vet ./... && go test ./...)
dingo lint ./...                         # advisory; never fails
```

`dingo build` exits 0 even when another package has a type error, because `go build` only
compiles the named package. The `go vet ./...` inside `build/` is what catches it (measured:
exit 1 on a type error in a package the build did not name).

## CI

```yaml
- run: go install github.com/MadAppGang/dingo/cmd/dingo@latest
- run: dingo fmt --check .
- run: dingo build -o /dev/null ./cmd/app
- run: cd build && go vet ./... && go test ./...
```

## Editor support

Editor integration goes through `dingo-lsp`, a language server that proxies `gopls` for the
generated code and maps positions back to `.dingo` source. The Dingo repo ships editor
setups under `editors/` (VS Code, GoLand, Neovim). `gopls` must be installed.

## Transpile errors

Errors point at the `.dingo` source line, not the generated Go. Fix the `.dingo` file and
re-run. Never edit the generated `.go` files: the next transpile overwrites them.
