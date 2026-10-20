# Test Plan: claudish status mod R8 finished-step bars

The `spec.md` named below is kept in `docs/plans/2026-10-20-claudish-status-band-spec.md` at the repository root (revision R8).

- **Spec**: spec.md, R8.1–R8.2; R6.4/R6.6 are context only where not superseded.
- **Contract**: contract/index.d.ts; contract/run-source.ts; the spec's Client props and existing engine-kit test helpers.
- **Stack**: bun   **Framework**: claude-code/testing (host engine kit)   **Scenarios**: 10 logical scenarios; TEST-1–TEST-8 produce 30 new component tests across terminal and desktop and their parameter sets.
- **Host command**: `claude plugin test plugins/claudish`. STOP_AT is implement; no execution or negative control in this sandbox.

## Public surface

The contract exports the run/slot/trail types, public plugin state, and RunSource port (recognizeCall, poll, stop, capture, resize, runLine, fetchHint). Rendering is exercised through the existing kit's AbovePrompt mount and Client scope, not implementation imports. R8's exact cell prop and timeline palette shapes are specified in spec.md, not exported as dedicated types in the contract. Test-owned TimelineProps and palette expectations follow those shapes.

## Scenarios

#### TEST-1: each finished step draws one full-colour foreground bar, oldest first
- **Type**: component
- **Priority**: critical
- **Given** finished steps from the R6.4 tool families and say/think/ask kinds in light and dark themes **When** a live badges cell at least 30 columns draws **Then** its left prefix has one bar per finished step, in order, at full foreground colour, with no background or dimming; the current step is not a bar. The palette equals the retained R6.6 table.
- **Requirement**: REQ-1, REQ-9

#### TEST-2: a run of one colour is not merged
- **Type**: component
- **Priority**: critical
- **Given** four consecutive read-family steps **When** they are finished **Then** four bars draw, not one N× time badge.
- **Requirement**: REQ-2

#### TEST-3: the bar cap keeps the newest finished steps
- **Type**: component
- **Priority**: critical
- **Given** 36 finished steps delivered in legal recent batches **When** the cell draws at widths 30, 31, 32, 33, 52 and 53 **Then** exactly floor(width/2)−1 bars draw, their colours identify the newest retained suffix, and no fold/count or past time badge draws.
- **Requirement**: REQ-3

#### TEST-4: exactly one space separates the bars and current words
- **Type**: component
- **Priority**: high
- **Given** finished steps and short current words **When** there is room for both **Then** the prefix is precisely the bars, one space, and the current words.
- **Requirement**: REQ-4

#### TEST-5: no history adds no leading separator
- **Type**: component
- **Priority**: high
- **Given** only a current step **When** the cell draws **Then** it begins with the current words, has no bars, and retains its whole flush-right badge.
- **Requirement**: REQ-4, REQ-5

#### TEST-6: long current words are cut between bars and a whole flush-right badge
- **Type**: component
- **Priority**: critical
- **Given** finished steps and words wider than the available space **When** the cell draws at widths 30 and 70 **Then** its prefix remains the bars and one space, the visible words end with …, the two-part badge remains whole at the right edge, and the drawing does not exceed the width.
- **Requirement**: REQ-5

#### TEST-7: a leaving job becomes a bar only after scrolling out
- **Type**: component
- **Priority**: critical
- **Given** a drawn Read job **When** a new Bash job arrives **Then** during the old job's scroll-out it is still visible and contributes no bar; after the bounded transition there is one Read bar and the new job's words and badge.
- **Requirement**: REQ-6

#### TEST-8: the live Client receives exactly the R8.2 props
- **Type**: component
- **Priority**: high
- **Given** a live row **When** the band hands it to the Client **Then** its exact keys are look, steps, elapsed, live, idle, endedFor, staleAfter, staleFull, width and c; before is absent; unchanged thresholds, elapsed time and Client identity remain correct.
- **Requirement**: REQ-7

#### TEST-9: the Client still receives the newest 40 steps
- **Type**: component
- **Priority**: high
- **Given** 50 steps arriving across three polls of at most 20 recent steps **When** the cell receives its history **Then** exactly the newest 40 steps remain, with unchanged first/last contents and no assertion of the removed before value.
- **Requirement**: REQ-8
- **Existing test**: r6-timeline.test.ts, updated R8.2 last-40 scenario.

#### TEST-10: retain unaffected R6 behaviour and update obsolete expectations only
- **Type**: component
- **Priority**: high
- **Given** the existing R6 timeline and palette scenarios **When** migrating their superseded assertions **Then** current timer/name inks, own-clock advancement, silence thresholds, narrow rendering, ended rows, line look, legend, theme selection and non-Client colour restrictions remain covered without requiring fold colours or before.
- **Requirement**: REQ-10
- **Existing coverage**: r6-timeline.test.ts and r6-row.test.ts; update shared r6-support.ts expectations. Seven affected scenario definitions run on both surfaces (14 host tests).

## Coverage map

| Requirement | Tests | Covered |
|---|---|---|
| REQ-1: live badges cells ≥30 draw one foreground-only, full-colour bar per finished step, oldest first | TEST-1 | yes |
| REQ-2: equal-colour consecutive steps never merge | TEST-2; updated R6 badges/current-clock scenario | yes |
| REQ-3: at most floor(width/2)−1 bars, keeping the newest; no fold/count | TEST-3; updated former fold scenario | yes |
| REQ-4: exactly one space follows bars; no bars means current words start the row | TEST-4, TEST-5 | yes |
| REQ-5: current words fill available space, cut with …; whole two-part badge flush right | TEST-5, TEST-6; retained R6 truncation scenario | yes |
| REQ-6: a leaving job is not a bar during scroll-out and becomes one once gone | TEST-7 | yes |
| REQ-7: exact R8.2 Client props, with no before | TEST-8; updated R6 Client scenario | yes |
| REQ-8: still at most the newest 40 steps | TEST-9 | yes |
| REQ-9: timeline palette drops foldCount/foldTime/foldInk, retaining other colours | TEST-1; existing legend and dark/light palette scenarios via updated shared expectations | yes |
| REQ-10: R6 behaviour outside the superseded history presentation remains unchanged | TEST-10 and the retained R6 scenarios | yes |

## Known gaps

- None in the requested R8.1–R8.2 scope at the scenario level. Runtime and type-check results remain unmeasured: the caller states this kit cannot run here.
- The explicit contract lacks a dedicated exported Client-props/palette type; use the spec's rendering contract and existing public kit surface, not an invented production export.
- The read allowlist does not include failing.md and spec.md does not link it, so that path was refused. The seven affected definitions (14 surface tests) were identified by searching only tests/ for the replaced expectations.
- R7 maintenance only: add isError: false to the empty MCP content testdata; change no resize expectation or behaviour.

## Host verification and negative control (not performed here)

Run the host command above after applying the test changes. Temporarily change TEST-2's expected four bars to five, run it and capture the failure, then restore four. Do not declare the suite proven before that control and the restored full run succeed.
