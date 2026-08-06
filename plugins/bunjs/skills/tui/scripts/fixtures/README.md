# check-surface fixtures — negative controls

`scripts/check-surface.ts --self-test` scans this directory. Nothing else does: `walk()` skips any
directory named `fixtures`, and `tsconfig.json` includes only `assets/**/*`, so these files are
never linted as skill content and never typechecked. They are deliberately wrong.

## Each fixture states its own expectation

The prefix is documentation; the `EXPECT` markers are what the self-test reads. A fixture with no
marker FAILS, so a new file cannot be added without saying what it proves.

| Marker | Meaning |
|---|---|
| `EXPECT rule 4` · `EXPECT rules 2, 3, 5` | every listed rule id must appear in the output |
| `EXPECT N violations` | exactly N — this is what stops one form covering for another |
| `EXPECT N blocks` | how many fenced blocks extraction must COUNT (unlabelled and indented units are scanned but never counted) |
| `EXPECT clean` | zero violations; the false positives the linter must never invent |
| `EXPECT warning` · `EXPECT no warning` | whether the file trips the extraction alarm (it opened a ts/tsx fence and produced no block). An app README must not; a fence that opened and yielded nothing must |
| `EXPECT known gap` | a hole that is NOT closed. Printed as `GAP` on every run, never fails the build, and flips to `CLOSED` the day someone fixes it |

**A rule id alone is a weak assertion.** Only the first construct use in a unit is reported, so a
`.tsx` fixture holding three evasions proves whichever one comes first and silently excuses the other
two. Put independent forms in separate fenced blocks of a `.md` fixture and assert the count — that
is why `bypass-17`, `-22`, `-25` and `-28` are markdown.

## Prefixes

| Prefix | Expectation |
|---|---|
| `bypass-*` | must flag. Each was a real evasion — reported by an adversarial verifier, or found here by attacking the linter |
| `clean-*` | must be silent. Real code, the surface banner that quotes the banned form in order to ban it, and an ordinary app README |
| `warn-*` | must be violation-free but must still trip the extraction alarm |
| `gap-*` | must currently NOT flag, and says why the hole is left open |
| `references/*.md` | the path is the point. `core-api.md` sits where `ALLOW_MIX` matches, so scanning it exercises the allowlist rather than asserting one; `components-and-charts.md` sits where that allowlist USED to match, and proves the exemption is now scoped by the gate marker's position instead — flagged above it, exempt below it |

## The bar for a change

A fixture that stops behaving flips the self-test to `FAIL` and exits 1. Add a `bypass-*` file for
every new evasion **before** fixing it. Then check the fixture is load-bearing: break the mechanism
it targets and confirm that fixture — not merely *some* fixture — fails. Four of the fixtures written
for this pass looked green while the mechanism under them was disabled, because a neighbouring rule
or a fallback path caught the file anyway.
