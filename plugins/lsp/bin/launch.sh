#!/bin/sh
# Entry point for every language server this plugin declares: $@ is the server
# command line. A short check (stdin from /dev/null, output to stderr only)
# decides whether the Bun wrapper can run; on any failure, a missing Bun, or a
# check slower than 3 s, the plain server is exec'd instead. Both paths exec, so
# the pid Claude Code holds is the wrapper's or the server's.
main="$(dirname "$0")/../src/main.ts"
plain() {
  echo "lsp: starting plain $1" >&2
  exec "$@"
}
command -v bun >/dev/null 2>&1 || plain "$@"
bun --env-file=/dev/null --config=/dev/null "$main" --check "$@" </dev/null >&2 &
pf=$!
(
  trap 'kill "$s" 2>/dev/null; exit 0' TERM
  sleep 3 &
  s=$!
  wait "$s"
  kill -0 $$ 2>/dev/null && kill -KILL "$pf" 2>/dev/null
) </dev/null >/dev/null 2>&1 &
wd=$!
trap 'kill -KILL "$pf" 2>/dev/null; kill "$wd" 2>/dev/null; exit 143' TERM
trap 'kill -KILL "$pf" 2>/dev/null; kill "$wd" 2>/dev/null; exit 130' INT
trap 'kill -KILL "$pf" 2>/dev/null; kill "$wd" 2>/dev/null; exit 129' HUP
wait "$pf"
rc=$?
kill "$wd" 2>/dev/null
wait "$wd" 2>/dev/null
trap - TERM INT HUP
[ "$rc" -eq 0 ] && exec bun --env-file=/dev/null --config=/dev/null "$main" "$@"
plain "$@"
