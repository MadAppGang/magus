#!/bin/bash
# Every path the index names must exist, and every skill in the plugin must be named
# by the index. A router that points at a missing file is worse than no router — the
# agent follows it, gets nothing, and falls back to guessing.
#
# Run after adding, renaming or removing a skill:  ./check-index.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/../.." && pwd)"
fail=0

echo "paths the index names:"
named=""
for p in $(grep -oE 'skills/[a-z-]+/SKILL\.md' "$HERE/SKILL.md" | sort -u); do
  if [ -f "$PLUGIN/$p" ]; then
    printf '  OK    %s\n' "$p"
    named="$named $(basename "$(dirname "$p")")"
  else
    printf '  MISS  %s\n' "$p"
    fail=1
  fi
done

echo
echo "skills present but NOT named by the index:"
orphans=0
for d in "$PLUGIN"/skills/*/; do
  name="$(basename "$d")"
  [ "$name" = "bun" ] && continue          # the index does not index itself
  case " $named " in
    *" $name "*) ;;
    *) printf '  ORPHAN %s\n' "$name"; orphans=1; fail=1 ;;
  esac
done
[ $orphans -eq 0 ] && echo "  (none)"

echo
if [ $fail -eq 0 ]; then
  echo "index is consistent with the plugin"
else
  echo "INDEX IS STALE — fix skills/bun/SKILL.md" >&2
fi
exit $fail
