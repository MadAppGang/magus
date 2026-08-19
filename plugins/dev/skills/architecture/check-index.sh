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

# Groups the refactoring router marks "not yet written". Section 4b separately asserts this
# advertisement matches disk, so this cannot become a way to hide a genuinely broken link.
UNWRITTEN_GROUPS=""
if [ -f references/refactoring.md ]; then
  UNWRITTEN_GROUPS=$(grep -E '^\| `(composing|moving|data|conditionals|calls|generalization)`' references/refactoring.md \
    | grep 'not yet written' \
    | sed -E 's|.*refactoring/techniques/([a-z-]+\.md).*|\1|' | tr '\n' ' ')
fi

# --- 1. Every referenced path resolves -------------------------------------------------
# Collect `styles/x.md`, `patterns/x.md`, `references/x.md`, `../styles/x.md` style refs
# from every markdown file, resolve them relative to the referring file, and check.
echo
echo "1. referenced paths resolve"
missing=0
while IFS= read -r src; do
  dir=$(dirname "$src")
  # Fenced blocks are stripped before scanning: example ADRs and worked snippets carry
  # illustrative paths (adr.md ships `docs/typescript-setup.md`) that are not references.
  # This tracks the opening fence's CHARACTER and LENGTH, because a naive toggle gets three
  # cases wrong: ~~~ fences are missed entirely; a ````-wrapped example containing ``` has
  # its toggle inverted, leaking fenced content back in; and an unbalanced fence silently
  # swallows the rest of the file -- a checker that stops checking without saying so.
  awk '
    {
      if (match($0, /^[[:space:]]*(```+|~~~+)/)) {
        m = substr($0, RSTART, RLENGTH); sub(/^[[:space:]]*/, "", m)
        ch = substr(m, 1, 1); len = length(m)
        if (!inf) { inf = 1; fch = ch; flen = len; next }
        else if (ch == fch && len >= flen) { inf = 0; next }
      }
      if (!inf) print
    }
    END { if (inf) print "__UNCLOSED_FENCE__" }
  ' "$src" 2>/dev/null \
  | grep -oE '__UNCLOSED_FENCE__|[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*\.md' \
  | sort -u \
  | while IFS= read -r ref; do
      if [ "$ref" = "__UNCLOSED_FENCE__" ]; then
        printf '  UNCLOSED FENCE in %s -- scan stopped early; rest of file NOT checked\n' "$src"
        continue
      fi
      # Capture whole tokens, then filter. An earlier regex excluded uppercase, so
      # `ADR-0001-use-postgresql-database.md` clipped to `-0001-...` and was reported MISSING
      # against a path nobody wrote. Every real reference here is lowercase kebab; every
      # uppercase token is a doc pointer (CLAUDE.md, AGENTS.md, ADR templates).
      case "$ref" in *[A-Z]*) continue ;; esac
      # Deliberate cross-plugin references. These live outside this tree by design:
      # sin-registry.md is dev:code-roast's maintained failure inventory, which the
      # "when NOT to use" sections cite rather than duplicate.
      case "$ref" in sin-registry.md) continue ;; esac
      # Technique groups the refactoring router itself advertises as not yet written.
      # Derived from that table, never hard-coded: when a group is written and its status
      # flips to "written", this exemption disappears and the link is enforced again.
      case " $UNWRITTEN_GROUPS " in *" $(basename -- "$ref") "*) continue ;; esac
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

# --- 4b. Refactoring tier: all 22 smells indexed, technique groups honest --------------
echo
echo "4b. refactoring tier"
rfail=0
if [ -f references/refactoring.md ]; then
  smells=(
    "Long Method" "Large Class" "Primitive Obsession" "Long Parameter List" "Data Clumps"
    "Alternative Classes" "Refused Bequest" "Switch Statements" "Temporary Field"
    "Divergent Change" "Parallel Inheritance" "Shotgun Surgery"
    "Comments" "Duplicate Code" "Data Class" "Dead Code" "Lazy Class" "Speculative Generality"
    "Feature Envy" "Inappropriate Intimacy" "Message Chains" "Middle Man"
  )
  missing_smells=0
  for s in "${smells[@]}"; do
    grep -qF "$s" references/refactoring.md || { note "MISSING SMELL  $s"; missing_smells=1; rfail=1; fail=1; }
  done
  # Incomplete Library Class is the 23rd row (Fowler groups it under Couplers); count the table.
  rows=$(grep -cE '^\| \*\*(Bloater|OO Abuser|Change Preventer|Dispensable|Coupler)\*\*' references/refactoring.md)
  if [ "$rows" -lt 22 ]; then
    note "COUNT    smell table has $rows rows, expected >= 22"; rfail=1; fail=1
  fi
  [ "$missing_smells" -eq 0 ] && [ "$rows" -ge 22 ] && note "OK — $rows smell rows, all 22 named smells present"

  # Every group the router advertises as "written" must exist; every one advertised as
  # "not yet written" must NOT exist. A stale status line is worse than no status line.
  while IFS='|' read -r _ _ path _ status _; do
    p=$(echo "$path" | tr -d ' `'); st=$(echo "$status" | tr -d ' *')
    case "$p" in refactoring/techniques/*.md) ;; *) continue ;; esac
    if [ "$st" = "written" ] && [ ! -f "references/$p" ]; then
      note "ADVERTISED-MISSING  references/$p marked written but absent"; rfail=1; fail=1
    fi
    if [ "$st" = "notyetwritten" ] && [ -f "references/$p" ]; then
      note "STALE-STATUS  references/$p exists but is marked not yet written"; rfail=1; fail=1
    fi
  done < <(grep -E '^\| `(composing|moving|data|conditionals|calls|generalization)`' references/refactoring.md)
  [ "$rfail" -eq 0 ] && note "OK — technique-group status lines match what is on disk"

  # Each written group must contain EXACTLY the number of `## N. Technique` entries its
  # status row advertises, and the entries must be numbered 1..N with no gaps.
  #
  # This check exists because the counts were wrong once: Generalization was published here
  # as 13 and Organizing Data as 16, against a real 12 and 15. Both authoring agents then
  # invented a technique to fill the slot -- and invented DIFFERENT ones. A presence-only
  # loop passes that; an equality check does not.
  cfail=0
  while IFS='|' read -r _ _ path count status _; do
    p=$(echo "$path" | tr -d ' `'); c=$(echo "$count" | tr -d ' '); st=$(echo "$status" | tr -d ' *')
    case "$p" in refactoring/techniques/*.md) ;; *) continue ;; esac
    [ "$st" = "written" ] || continue
    [ -f "references/$p" ] || continue
    actual=$(grep -cE '^## [0-9]+\. ' "references/$p")
    if [ "$actual" -ne "$c" ]; then
      note "COUNT    references/$p has $actual entries, status row says $c"; cfail=1; fail=1
    fi
    # Numbering must be dense and ascending: 1..N.
    expected_seq=$(seq 1 "$actual" | tr '\n' ' ')
    actual_seq=$(grep -oE '^## [0-9]+\.' "references/$p" | grep -oE '[0-9]+' | tr '\n' ' ')
    if [ "$expected_seq" != "$actual_seq" ]; then
      note "NUMBERING references/$p entries are not numbered 1..$actual"; cfail=1; fail=1
    fi
  done < <(grep -E '^\| `(composing|moving|data|conditionals|calls|generalization)`' references/refactoring.md)
  [ "$cfail" -eq 0 ] && note "OK — every written group's entry count matches its status row"

  # No technique may appear in two groups. Fowler assigns each exactly one home, and a
  # miscounted group is the situation that produces a duplicate.
  dupes=$(grep -hoE '^## [0-9]+\. .*' references/refactoring/techniques/*.md 2>/dev/null \
    | sed -E 's/^## [0-9]+\. //' | sort | uniq -d)
  if [ -n "$dupes" ]; then
    note "DUPLICATE technique appears in more than one group:"
    echo "$dupes" | while read -r d; do note "    $d"; done
    fail=1
  else
    note "OK — no technique appears in two groups"
  fi
else
  note "SKIP — references/refactoring.md not present"
fi

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
