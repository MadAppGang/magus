# Test Plan: claudish Show panel, every running session takes the panel's size (R10)

The `spec.md` named below is kept in `docs/plans/2026-10-20-claudish-status-band-spec.md` at the repository root (revision R10).

- **Spec**: `spec.md`, "claudish status mod, 2.9.0: revision R10", R10.1–R10.3. R7.2/R9.1 supply the size oracle (`cols = max(40, columns)`, `rows = max(24, rows − 3)`); R6.5 supplies Show/Hide and "captures run only while the panel is open".
- **Contract**: `contract/index.d.ts`, `contract/run-source.ts`
- **Stack**: bun   **Framework**: `claude-code/testing` engine kit   **Scenarios**: 12 new (× terminal, desktop = 24 tests), plus 3 rewritten R7 scenarios (6 tests) and 6 adjusted R6/R7-era Button assertions
- **Host command**: `claude plugin test plugins/claudish` (not runnable in this sandbox).
- **Observation boundary**: recorded MCP requests (`resize_session`, `team` mode `resize`/`capture`/`list`, `capture_session`), `ui.open`/`ui.close`, the drawn band and panel, the published `showTab` and `panes/*` state. No private resize memory is read.

## Requirements

- REQ-R10-1: The panel's size is known once it has drawn in this load, and is kept while the panel is closed; it is the LAST size drawn.
- REQ-R10-2: Before the panel has ever drawn, nothing is resized.
- REQ-R10-3: On every poll tick, before the capture pass, every running slot of a resize-capable feed whose last-asked size differs is resized, panel open or closed, tab shown or not. A session started while closed is resized at its first tick.
- REQ-R10-4: A feed whose `resize` is false is never resized.
- REQ-R10-5: Finished slots and settled runs are never resized.
- REQ-R10-6: The size belongs to the session: hiding/closing the panel or a tab does not forget it; reopening at the same size sends no resize.
- REQ-R10-7: A new panel size resizes each running session once, at its next tick; the shown tab still at once, before its capture.
- REQ-R10-8: A session forgets its size once no longer running: its slot finished, or its run left the mod's list (cleared, compacted). Missing from a list answer is not leaving; listed again, it is not asked again.
- REQ-R10-9: The tab strip row ends with a `[ Hide ]` Button, flush right, as the band's Hide (`suggestion`, bold, 8 cells); tabs shrink first, Hide never does. The panel's Buttons are the tabs and Hide.
- REQ-R10-10: Pressing the panel's Hide does what the band's Hide does: `ui.close` of `claudish-show`, tabs and views kept for the next Show.

## Scenarios (tests/ext/r10-live-resize.test.ts)

#### TEST-R10-1: session started while closed is resized at a tick, no capture
- **Type**: component  **Priority**: critical
- **Given** a panel drawn at 120×40 then 130×44, then hidden **When** a delegation starts **Then** within 3 s exactly one `resize_session {cols:130, rows:41}` for it, no capture of it, no capture at all while closed.
- **Requirement**: REQ-R10-1, REQ-R10-3

#### TEST-R10-2: no resize before the panel ever drew
- **Type**: component  **Priority**: critical
- **Given** a running 2-slot team and a delegation **When** 10 s pass, then Show opens the panel undrawn for 3 s **Then** no resize; positive control: the first drawing (110×30) resizes all three to 110×27, once.
- **Requirement**: REQ-R10-2, REQ-R10-3

#### TEST-R10-3: a feed without resize is never resized
- **Type**: component  **Priority**: high
- **Given** `noResize` **When** the panel draws, hides, a delegation starts while closed, the panel reopens at a new size **Then** zero resize calls; captures run while open (positive control).
- **Requirement**: REQ-R10-4

#### TEST-R10-4: started and finished entirely while closed
- **Type**: component  **Priority**: critical
- **Given** a drawn-then-hidden panel **When** a delegation starts, is resized, then COMPLETES **Then** its one resize (120×37) came before it ended, it was never captured; reopening at 140 resizes the live team slot but not the finished session.
- **Requirement**: REQ-R10-3, REQ-R10-5

#### TEST-R10-5: a session that ends is not resized again
- **Type**: component  **Priority**: high
- **Given** a delegation resized while closed, then COMPLETED **When** the panel reopens at 150×46, then redraws at 160×46 **Then** the session keeps its single 120×37 call; the live team slot gets 120×37, 150×43, 160×43.
- **Requirement**: REQ-R10-5, REQ-R10-7

#### TEST-R10-6: hide → reopen at the same size sends nothing
- **Type**: component  **Priority**: critical
- **Given** 2 team slots and a delegation, all resized once **When** hidden 6 s, reopened at the same size, tab switched **Then** still 3 resize calls; captures resumed (positive control).
- **Requirement**: REQ-R10-6

#### TEST-R10-7: a new size reaches every running session once
- **Type**: component  **Priority**: high
- **Given** three running sessions at 120×37 **When** the panel redraws at 100×30 **Then** exactly three new calls at 100×27 within 3 s; the shown slot's next call after its resize is its capture.
- **Requirement**: REQ-R10-7

#### TEST-R10-8: missing from list answers is not leaving
- **Type**: component  **Priority**: high
- **Given** a team slot resized once (and not again over 4 s) **When** its run is absent from two list answers, then listed again while still in the mod's list **Then** no new resize, although captures continue (control); a new panel size (130×44) then resizes it exactly once, to 130×41.
- **Requirement**: REQ-R10-8 (re-synced R10.2: "Missing from one list answer is not leaving ... is not asked again").

#### TEST-R10-9: strip ends with `[ Hide ]`, flush right
- **Type**: component  **Priority**: critical
- **Given** an open 100-column panel with two tabs **When** drawn **Then** one Hide Button, text `[ Hide ]`, `suggestion` bold, no fill, in a width-8 Box, at the end of the row holding the tabs, flush right at 100 (R6's `expectFlushRight`); the other Buttons are the tabs.
- **Requirement**: REQ-R10-9

#### TEST-R10-10: Hide never shrinks
- **Type**: component  **Priority**: medium
- **Given** a 44-column panel and three long tab labels **When** drawn **Then** Hide is whole, in its 8-cell box, ending the strip, which fits 44 cells.
- **Requirement**: REQ-R10-9

#### TEST-R10-11: pressing the panel's Hide closes the panel
- **Type**: component  **Priority**: critical
- **Given** an open, capturing panel **When** its Hide is pressed **Then** `ui.close('claudish-show')`, the pane is gone, views and shown tab kept, the band header has no Hide, captures stop.
- **Requirement**: REQ-R10-10

#### TEST-R10-12: next Show reopens with the same tabs
- **Type**: component  **Priority**: high
- **Given** a panel hidden by its own Hide **When** Show is pressed again **Then** one `ui.open` of `claudish-show`, the same tab labels and view ids, the pressed slot shown, and the panel carries its Hide again.
- **Requirement**: REQ-R10-10

## Rewritten scenarios (tests/ext/r7-resize.test.ts)

- **TEST-9/10** → `R7.2 R10.1 R10.2 TEST-9 TEST-10`: three sessions get 132×41 once; only the shown tab must have its capture next (`expectBeforeOwnCapture`). REQ-R10-3, REQ-R10-7.
- **TEST-19** → `R10.1 R10.2 TEST-19`: after a redraw to 145×47 the hidden tab is resized within 3 s (its 5-second capture is ≥ 4 s away), with no capture of it before; the shown tab is resized before its capture; once per size. REQ-R10-3, REQ-R10-7.
- **TEST-20** → `R10.2 TEST-20`: Hide stops capture; reopening at 128×42 sends no resize while captures resume; a redraw at 140×42 sends one `[140, 39]`, paired with its capture. REQ-R10-6, REQ-R10-7.

## Adjusted R10.3 Button assertions (only the Button part changed)

- `tests/pane.test.ts` read-only test: tabs + exactly one Hide.
- `tests/ext/r6-show.test.ts` and `tests/ext/v2-show.test.ts`: `tabLabels` drops the `Hide` label; the strip test and the tab-header test also assert exactly one Hide.
- `tests/ext/v2-r4.test.ts` (2 places): the tab list ignores Hide.
- `tests/blind/show.test.ts`: not changed. It checks only for Input/Select in the panel and finds Hide in the band, never asserting the panel's Button list.

## Coverage map

| Requirement | Tests | Covered |
|---|---|---|
| REQ-R10-1 last size kept while closed | TEST-R10-1 | yes |
| REQ-R10-2 nothing before first drawing | TEST-R10-2, R7 TEST-12 | yes |
| REQ-R10-3 every running slot, each tick, open or closed | TEST-R10-1, -2, -4, TEST-9/10, TEST-19 | yes |
| REQ-R10-4 no resize without the feature | TEST-R10-3, R7 TEST-18 | yes |
| REQ-R10-5 finished never resized | TEST-R10-4, -5, R7 TEST-17 | yes |
| REQ-R10-6 size belongs to the session | TEST-R10-6, TEST-20 | yes |
| REQ-R10-7 new size once per session; shown before capture | TEST-R10-5, -7, TEST-19, TEST-20 | yes |
| REQ-R10-8 forgets only when finished or the run leaves the mod's list | TEST-R10-8 (absent-then-relisted keeps the size) | partly, see gaps |
| REQ-R10-9 strip Hide look and place | TEST-R10-9, -10, pane.test.ts | yes |
| REQ-R10-10 panel Hide behaviour | TEST-R10-11, -12 | yes |

## Known gaps

- REQ-R10-8 for a *finished* session: a finished session never runs again, so whether it forgot its size cannot be observed. A run leaving the mod's list (cleared, compacted) also ends the session's eligibility, so forgetting is not observable there either. TEST-R10-8 tests the observable rule: a brief absence does NOT forget.
- "Closing a tab" (R10.2) has no separate UI action in the R6.5 single-pane panel apart from the run leaving the band, which also ends the session's eligibility, so it is not tested on its own.
- "Tabs shrink first" is checked only through Hide staying whole and the row fitting its width. How a tab label gets cut is not specified, so no assertion is made about it.
