#!/bin/sh
# SessionStart (matcher `startup`) fallback for deps-check.ts. The registration
# runs this only when Bun is not on the PATH Claude Code started with, which is
# the one dependency the TypeScript check cannot report itself. $1 is the label.
#
# Writes the same ledger as deps-check.ts, 0700: seen/<label> = sh, then claims
# the Bun requirement's dedupe key, so a session prints one Bun line however
# many plugins carry this file. A bun in a place an installer or Homebrew puts
# one is reported as off the PATH, naming that place; only when there is none
# is Bun called missing. scripts/check-hook-copies.ts recomputes the key, the
# install line, the Bun prefix and the PATH line formats from
# lib/requires-probe.ts and fails when this file disagrees. Exit 0 always.

label=$1
case $label in
'' | *[!a-z0-9._-]*) exit 0 ;;
esac
key=bun-3182ab42b0f1

sid=$(cat 2>/dev/null | tr -d '\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_-]*\)".*/\1/p')
if [ -n "$sid" ]; then
	umask 077
	base=${TMPDIR:-/tmp}
	dir=$base/magus-deps-$sid
	if mkdir -p "$dir/seen" "$dir/claimed" 2>/dev/null; then
		printf sh >"$dir/seen/$label" 2>/dev/null
		find "$base" -maxdepth 1 -type d -name 'magus-deps-*' -mtime +0 -exec rm -rf {} + 2>/dev/null
		mkdir "$dir/claimed/$key" 2>/dev/null || exit 0
	fi
fi

# The first bun where an installer or Homebrew leaves one. A path that would
# break the JSON line is skipped.
found=
for d in ${BUN_INSTALL:+"$BUN_INSTALL/bin"} "$HOME/.bun/bin" /opt/homebrew/bin /usr/local/bin /home/linuxbrew/.linuxbrew/bin; do
	case $d in
	*\"* | *\\* | *[[:cntrl:]]*) continue ;;
	esac
	if [ -f "$d/bun" ] && [ -x "$d/bun" ]; then
		found=$d
		break
	fi
done

if [ -n "$found" ]; then
	# Under $HOME: shown as ~/…, and $HOME in the PATH line.
	rel=${found#"$HOME"/}
	if [ -n "$HOME" ] && [ "$HOME" != / ] && [ "$rel" != "$found" ]; then
		shown="~/$rel" pathdir="\$HOME/$rel"
	else
		shown=$found pathdir=$found
	fi
	case ${SHELL:-} in
	*zsh) rc='~/.zshrc' fmt='export PATH="%s:$PATH"' ;;
	*fish) rc='~/.config/fish/config.fish' fmt='fish_add_path %s' ;;
	*) rc='~/.bashrc' fmt='export PATH="%s:$PATH"' ;;
	esac
	# shellcheck disable=SC2059 # fmt is one of the three fixed formats above
	line=$(printf "$fmt" "$pathdir" | sed 's/["\\]/\\&/g')
	printf '{"systemMessage":"magus-deps: Bun is installed at %s but is not on the PATH Claude Code started with, so magus hooks and MCP servers cannot run (noticed by %s).\\n  Add %s to %s, then restart Claude Code from a new terminal."}\n' "$shown" "$label" "$line" "$rc"
else
	printf '{"systemMessage":"magus-deps: Bun is missing — magus hooks and MCP servers need it (noticed by %s).\\n  Install: curl -fsSL https://bun.sh/install | bash, then restart Claude Code from a new terminal."}\n' "$label"
fi
exit 0
