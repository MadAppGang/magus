#!/usr/bin/env bash
# Integrity check for the architecture skill tree.
#
# Fails if the index or any leaf promises a file that does not exist, or if a file
# exists that nothing routes to. A router that names a missing file is worse than no
# router: the agent reads the promise, fails the Read, and falls back to memory.
#
# Usage: ./check-index.sh   (run from anywhere; resolves its own directory)

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

fail=0
note() { printf '  %s\n' "$1"; }

echo "=== architecture skill index check ==="

# --- 1. Every referenced path resolves -------------------------------------------------
# Collect `styles/x.md`, `patterns/x.md`, `references/x.md`, `../styles/x.md` style refs
# from every markdown file, resolve them relative to the referring file, and check.
echo
echo "1. referenced paths resolve"
missing=0
while IFS= read -r src; do
  dir=$(dirname "$src")
  grep -oE '(\.\./)*(references/)?(styles/|patterns/)?[a-z0-9-]+\.md' "$src" 2>/dev/null \
  | sort -u \
  | while IFS= read -r ref; do
      # Deliberate cross-plugin references. These live outside this tree by design:
      # sin-registry.md is dev:code-roast's maintained failure inventory, which the
      # "when NOT to use" sections cite rather than duplicate.
      case "$ref" in sin-registry.md) continue ;; esac
      # STRICT: resolve only relative to the referring file. A root-relative fallback
      # would mask exactly the bug this catches -- a leaf writing `references/x.md`
      # when it already lives inside references/.
      [ -f "$dir/$ref" ] || printf '  MISSING  %-42s referenced by %s\n' "$ref" "$src"
    done
done < <(find . -name '*.md' | sort) | sort -u | tee /tmp/arch-missing.$$
missing=$(wc -l < /tmp/arch-missing.$$ | tr -d ' ')
rm -f /tmp/arch-missing.$$
if [ "$missing" -eq 0 ]; then note "OK — every referenced path exists"; else fail=1; fi

# --- 2. The 22 GoF patterns are all present -------------------------------------------
echo
echo "2. all 22 GoF pattern files present"
expected=(
  factory-method abstract-factory builder prototype singleton
  adapter bridge composite decorator facade flyweight proxy
  chain-of-responsibility command iterator mediator memento observer
  state strategy template-method visitor
)
pfail=0
for p in "${expected[@]}"; do
  [ -f "references/patterns/$p.md" ] || { note "MISSING  references/patterns/$p.md"; pfail=1; fail=1; }
done
count=$(find references/patterns -name '*.md' | wc -l | tr -d ' ')
[ "$count" -eq 22 ] || { note "COUNT    expected 22 pattern files, found $count"; pfail=1; fail=1; }
[ "$pfail" -eq 0 ] && note "OK — 22/22 present"

# --- 3. The 7 styles are present -------------------------------------------------------
echo
echo "3. all 7 architectural style files present"
styles=(layered hexagonal clean modular-monolith microservices event-driven cqrs-event-sourcing)
sfail=0
for s in "${styles[@]}"; do
  [ -f "references/styles/$s.md" ] || { note "MISSING  references/styles/$s.md"; sfail=1; fail=1; }
done
[ "$sfail" -eq 0 ] && note "OK — 7/7 present"

# --- 4. Every pattern file is routed to from its category leaf -------------------------
echo
echo "4. every pattern is routed to from a category leaf"
rfail=0
for p in "${expected[@]}"; do
  if ! grep -qh "patterns/$p.md" references/creational.md references/structural.md references/behavioral.md 2>/dev/null; then
    note "ORPHAN   references/patterns/$p.md is not linked from any category leaf"
    rfail=1; fail=1
  fi
done
[ "$rfail" -eq 0 ] && note "OK — every pattern reachable from its leaf"

# --- 5. The index stays an index -------------------------------------------------------
echo
echo "5. index stays small (it must route, not teach)"
lines=$(wc -l < SKILL.md | tr -d ' ')
if [ "$lines" -gt 140 ]; then
  note "TOO BIG  SKILL.md is $lines lines; an index over ~140 has started teaching"
  fail=1
else
  note "OK — SKILL.md is $lines lines"
fi

# --- 6. Leaves stay unlisted (skill listing budget) ------------------------------------
echo
echo "6. skill carries disable-model-invocation (0 listing-budget cost)"
if grep -q '^disable-model-invocation: true' SKILL.md; then
  note "OK — flagged, costs 0 of the shared listing budget"
else
  note "UNFLAGGED  SKILL.md lacks disable-model-invocation: true; it will spend listing budget"
  fail=1
fi

echo
if [ "$fail" -eq 0 ]; then echo "PASS"; else echo "FAIL"; fi
exit "$fail"
