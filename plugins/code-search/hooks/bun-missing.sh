#!/bin/sh
# SessionStart (matcher `startup`) fallback for deps-check.ts. The registration
# runs this only when Bun is not on the PATH Claude Code started with, which is
# the one dependency the TypeScript check cannot report itself. $1 is the label.
#
# Writes the same ledger as deps-check.ts: seen/<label> = sh, then claims the
# Bun requirement's dedupe key, so a session prints one Bun line however many
# plugins carry this file. scripts/check-hook-copies.ts recomputes that key, the
# install line and the PATH lines from lib/requires-probe.ts and fails when this
# file disagrees. Exit 0 always.

label=$1
case $label in
'' | *[!a-z0-9._-]*) exit 0 ;;
esac
key=bun-3182ab42b0f1

sid=$(cat 2>/dev/null | tr -d '\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_-]*\)".*/\1/p')
if [ -n "$sid" ]; then
	base=${TMPDIR:-/tmp}
	dir=$base/magus-deps-$sid
	if mkdir -p "$dir/seen" "$dir/claimed" 2>/dev/null; then
		printf sh >"$dir/seen/$label" 2>/dev/null
		find "$base" -maxdepth 1 -type d -name 'magus-deps-*' -mtime +0 -exec rm -rf {} + 2>/dev/null
		mkdir "$dir/claimed/$key" 2>/dev/null || exit 0
	fi
fi

if [ -x "$HOME/.bun/bin/bun" ]; then
	case ${SHELL:-} in
	*zsh) rc='~/.zshrc' line='export PATH=\"$HOME/.bun/bin:$PATH\"' ;;
	*fish) rc='~/.config/fish/config.fish' line='fish_add_path $HOME/.bun/bin' ;;
	*) rc='~/.bashrc' line='export PATH=\"$HOME/.bun/bin:$PATH\"' ;;
	esac
	printf '{"systemMessage":"magus-deps: Bun is installed at ~/.bun/bin but is not on the PATH Claude Code started with, so magus hooks and MCP servers cannot run (noticed by %s).\\n  Add %s to %s, then restart Claude Code from a new terminal."}\n' "$label" "$line" "$rc"
else
	printf '{"systemMessage":"magus-deps: Bun is missing — magus hooks and MCP servers need it (noticed by %s).\\n  Install: curl -fsSL https://bun.sh/install | bash, then restart Claude Code from a new terminal."}\n' "$label"
fi
exit 0
