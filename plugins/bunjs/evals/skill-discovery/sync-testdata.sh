#!/bin/bash
# Build the two testdata variants from ./testdata/app/ plus the REAL security skill.
#
# The variants differ in exactly one thing — whether a CLAUDE.md routing row is
# present — so any difference in the result is attributable to that row and
# nothing else. Everything else, including the skill itself, is byte-identical.
#
# Regenerate after editing the skill:  ./sync-testdata.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_SRC="$HERE/../../skills/security"
TD="$HERE/testdata"

[ -f "$SKILL_SRC/SKILL.md" ] || { echo "security skill not found at $SKILL_SRC" >&2; exit 1; }

for variant in bare routed listed canary readrow; do
  rm -rf "${TD:?}/$variant"
  mkdir -p "$TD/$variant/.claude/skills/security"

  # The app under test, red: src/auth.ts is absent, so bun test fails.
  cp "$TD/app/package.json" "$TD/app/tsconfig.json" "$TD/app/auth.test.ts" "$TD/$variant/"

  # The real skill, verbatim — SKILL.md, references and the copyable assets.
  # node_modules and lockfiles are excluded; the agent does not need them and
  # they would bloat every sandbox copy.
  for part in SKILL.md references assets; do
    cp -R "$SKILL_SRC/$part" "$TD/$variant/.claude/skills/security/"
  done
  find "$TD/$variant/.claude/skills/security" -name 'node_modules' -type d -prune -exec rm -rf {} + 2>/dev/null || true
done

# Cell 2: the routing row is the ONLY addition over `bare`.
cp "$TD/routed-CLAUDE.md" "$TD/routed/CLAUDE.md"

# Cell 4: does the agent read CLAUDE.md AT ALL? A canary token it must echo.
cp "$TD/canary-CLAUDE.md" "$TD/canary/CLAUDE.md"

# Cell 5: same as `routed`, but the row prescribes an action the agent CAN take
# (Read the file) instead of one that is unavailable (invoke the Skill tool).
cp "$TD/readrow-CLAUDE.md" "$TD/readrow/CLAUDE.md"

# Cell 3: no routing row; instead REMOVE the disable-model-invocation flag, so the
# skill appears in the model's listing normally. This isolates the flag from the row
# — without it, a failure in `routed` is ambiguous between "the flag blocks Skill
# invocation" and "project-level skills are not Skill-invocable at all here".
sed -i '' '/^disable-model-invocation: true$/d' "$TD/listed/.claude/skills/security/SKILL.md"
grep -q 'disable-model-invocation' "$TD/listed/.claude/skills/security/SKILL.md" \
  && { echo "listed variant still carries the flag" >&2; exit 1; }

echo "testdata rebuilt:"
for variant in bare routed listed canary readrow; do
  n=$(find "$TD/$variant" -type f | wc -l | tr -d ' ')
  row=$([ -f "$TD/$variant/CLAUDE.md" ] && echo "row=YES" || echo "row=no ")
  flag=$(grep -q 'disable-model-invocation' "$TD/$variant/.claude/skills/security/SKILL.md" && echo "flag=YES" || echo "flag=no ")
  printf '  %-7s %3s files   %s   %s\n' "$variant" "$n" "$row" "$flag"
done

# Guard: bare vs routed must differ ONLY by CLAUDE.md.
diff_out=$(diff -rq "$TD/bare" "$TD/routed" 2>&1 | grep -v 'CLAUDE.md' || true)
[ -n "$diff_out" ] && { echo "CONFOUNDED (bare vs routed):" >&2; echo "$diff_out" >&2; exit 1; }

# Guard: bare vs listed must differ ONLY by SKILL.md (the removed flag line).
diff_out=$(diff -rq "$TD/bare" "$TD/listed" 2>&1 | grep -v 'SKILL.md' || true)
[ -n "$diff_out" ] && { echo "CONFOUNDED (bare vs listed):" >&2; echo "$diff_out" >&2; exit 1; }

echo "  verified: bare→routed differs only by CLAUDE.md; bare→listed only by the flag"
