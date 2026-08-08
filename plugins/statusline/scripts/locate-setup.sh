#!/usr/bin/env bash
# Locate the setup@magus plugin root, which now owns the statusline.
#
# This exists only for the deprecation window. statusline@magus no longer
# carries statusline.sh — setup@magus does — so the shim commands need to find
# it without knowing the machine's layout.
#
# Prints the setup plugin root on stdout and exits 0, or prints nothing and
# exits 1 when setup is not installed.
#
# Two layouts are probed, because a plugin loads from either depending on the
# marketplace's source type:
#
#   cache        ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
#                setup is a sibling two levels up, under its own version dir.
#   directory    <repo>/plugins/<plugin>/
#                setup is a direct sibling, no version dir.
set -uo pipefail

root="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$root" ] || exit 1

# Directory-type marketplace: plugins are direct siblings.
if [ -f "$root/../setup/scripts/statusline.sh" ]; then
  cd "$root/../setup" && pwd && exit 0
fi

# Cache layout: ../../setup/<version>/. Highest version wins, matching the
# loader, and sort -V so 10.0.0 beats 9.0.0.
best=""
for candidate in "$root"/../../setup/*/scripts/statusline.sh; do
  [ -f "$candidate" ] || continue
  version_dir="$(cd "$(dirname "$(dirname "$candidate")")" && pwd)"
  if [ -z "$best" ]; then
    best="$version_dir"
  else
    newer="$(printf '%s\n%s\n' "$(basename "$best")" "$(basename "$version_dir")" | sort -V | tail -1)"
    [ "$newer" = "$(basename "$version_dir")" ] && best="$version_dir"
  fi
done

[ -n "$best" ] && printf '%s\n' "$best" && exit 0
exit 1
