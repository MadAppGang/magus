# Test Plan: claudish Show panel resize (R7)

The `spec.md` named below is kept in `docs/plans/2026-10-20-claudish-status-band-spec.md` at the repository root (revision R7).

- **Spec**: `spec.md`, only “claudish status mod, 2.7.0: revision R7”, R7.1–R7.4 (R6.5 and existing tests supply harness/fallback context only).
- **Contract**: `contract/index.d.ts`, `contract/run-source.ts`
- **Stack**: bun   **Framework**: `claude-code/testing` engine kit   **Scenarios**: 22 parameterized scenario groups, expanding to 124 tests (58 unit, 66 component)
- **Host command**: `claude plugin test plugins/claudish` (not runnable in this sandbox; STOP_AT is implement).
- **Public surface**: `ClaudishFeatures.resize`, `RunSource.poll`, `RunSource.resize(ref, slot, cols, rows): Promise<ResizeResult>`, `ResizeResult` (`resized` / `gone` / `failed`); list capabilities; outgoing `resize_session` and `team(mode="resize")` requests; Pane `bodyColumns` / `scroll.bodyRows`; Show/Hide; captured text; debug logs.
- **Harness**: extend the existing fake with default resize advertisement, `noResize`, `resizeError`, two resize handlers, and `resizeCalls()`. Preserve the golden v1 examples (they do not advertise resize). Use the adapter factory import already exercised by `adapter.test.ts`, without reading its implementation.
- **Observation boundary**: recorded MCP requests are the specified external protocol, not internal function calls. Tests inspect no private resize cache or helper. UI cases run independently on terminal and desktop, using the mock clock and bounded waits, not real sleeps.

## Scenarios

#### TEST-1: Resize feature requires resize, capture, and capture_since_seq
- **Type**: unit
- **Priority**: critical
- **Given** each combination of the three capabilities, for both feed kinds **When** the adapter polls **Then** resize is their conjunction; the other three feature flags retain their existing meanings.
- **Requirement**: REQ-1

The existing `adapter.test.ts` golden and feature assertions gain `resize: false` because their input capabilities do not include resize. The `layout.test.ts` feature literals gain `resize: true`. The existing `pane.test.ts` read-only protocol allow-list additionally permits `team:resize` (R7.3), while continuing to reject input and every unrelated verb.

#### TEST-2: Resize does not depend on cancel or capture_spans
- **Type**: unit
- **Priority**: high
- **Given** an otherwise complete capability list without cancel or spans **When** the adapter polls either feed kind **Then** resize remains true and the omitted feature alone becomes false.
- **Requirement**: REQ-1

#### TEST-3: Delegation resize request and successful answer
- **Type**: unit
- **Priority**: critical
- **Given** a delegation ref **When** resize is requested **Then** exactly `resize_session({ session_id, cols, rows })` reaches its server and numeric dimensions decode as resized.
- **Requirement**: REQ-8, REQ-13

#### TEST-4: Team resize request and successful answer
- **Type**: unit
- **Priority**: critical
- **Given** a team ref **When** resize is requested **Then** exactly `team({ mode: "resize", path, slot, run_id, cols, rows })` reaches its server and numeric dimensions decode as resized.
- **Requirement**: REQ-8, REQ-13

#### TEST-5: Unknown run/session/slot answers mean gone
- **Type**: unit
- **Priority**: high
- **Given** each named ContractError **When** resize answers **Then** the result is exactly gone, not a failed resize or a screen update.
- **Requirement**: REQ-14

#### TEST-6: Other ContractErrors, rejection, plain errors and malformed answers mean failed
- **Type**: unit
- **Priority**: high
- **Given** resize_unsupported or another code, a transport rejection, plain error text, non-JSON, or absent/wrong-typed dimensions **When** resize answers **Then** failed is returned with the code/text where supplied, otherwise a nonempty diagnostic.
- **Requirement**: REQ-15

#### TEST-7: Panel size minus three rows, independently clamped at 80 × 24
- **Type**: component
- **Priority**: critical
- **Given** a live team tab and panels above, at, and below both limits **When** the panel draws and capture becomes due **Then** the resize request has the exact expected dimensions (including 80 × 27 body → 80 × 24 session).
- **Requirement**: REQ-3

#### TEST-8: Missing or non-finite panel dimensions use existing fallbacks
- **Type**: component
- **Priority**: medium
- **Given** absent dimensions, absent height alone, or non-finite dimensions **When** the panel draws **Then** resize uses the fallback-derived dimensions, clamped to at least 80 × 24.
- **Requirement**: REQ-3

#### TEST-9: Every tab, including an inactive team tab and a delegation, receives the panel size
- **Type**: component
- **Priority**: critical
- **Given** two team slots and a delegation **When** the shared panel draws and each tab is due **Then** all three resize once to the same panel size with the correct kind-specific wire request.
- **Requirement**: REQ-4, REQ-8, REQ-9

#### TEST-10: Resize is immediately before its matching capture
- **Type**: component
- **Priority**: critical
- **Given** a newly sized panel **When** each eligible tab is captured **Then** its resize is immediately followed by its capture in the external request sequence. The held-response case separately proves that capture awaits the answer; it does not assume that a remote resize takes zero time.
- **Requirement**: REQ-5

#### TEST-11: The capture waits for the resize answer
- **Type**: component
- **Priority**: critical
- **Given** a resize response held at the MCP boundary **When** a capture pass starts **Then** that tab is not captured until the response is released, after which the capture runs.
- **Requirement**: REQ-5

#### TEST-12: Closed or never-drawn panels do not resize
- **Type**: component
- **Priority**: high
- **Given** listed live tabs **When** polling occurs before Show, then after Show but before the first Pane drawing **Then** no resize is sent; after drawing a positive resize proves eligibility.
- **Requirement**: REQ-6, REQ-5

#### TEST-13: Successful resize is once per size, not once per tick or tab selection
- **Type**: component
- **Priority**: high
- **Given** successful resize and repeated capture passes/redraws/tab selections **When** the dimensions stay constant **Then** captures continue but no extra resize occurs.
- **Requirement**: REQ-9

#### TEST-14: A refused resize is also once per size
- **Type**: component
- **Priority**: critical
- **Given** resize_unsupported **When** several captures pass at the same size **Then** each tab is asked once, captures continue and the failure is logged once per attempt; changing size permits one new attempt.
- **Requirement**: REQ-9, REQ-10, REQ-12

#### TEST-15: Width and height changes each request the new size at the next capture
- **Type**: component
- **Priority**: high
- **Given** a resized live tab **When** the width alone, then height alone, then a previously used size is drawn **Then** each effective size change causes one new resize before capture; panel changes that still clamp to the same 80 × 24 session size do not repeat the request.
- **Requirement**: REQ-10, REQ-9

#### TEST-16: Drawing a changed panel size wakes a backed-off loop
- **Type**: component
- **Priority**: high
- **Given** status polls backed off after refusals but a live captured tab **When** the panel size changes **Then** the new resize/capture occurs without waiting for the backed-off status deadline.
- **Requirement**: REQ-10

#### TEST-17: Finished slots are not resized, although their final captures may continue
- **Type**: component
- **Priority**: high
- **Given** each terminal wire state and a live sibling **When** the panel draws or changes size **Then** only the sibling resizes; the finished slot can still supply its retained screen. Also reach the mod-domain LOST state by removing one slot from the fake's list and letting the existing missing-slot deadline pass; do not manufacture private state.
- **Requirement**: REQ-7

#### TEST-18: Feeds lacking resize never receive resize and retain Show capture
- **Type**: component
- **Priority**: critical
- **Given** noResize, or resize advertisement without capture support **When** Show is opened and drawn **Then** resize is never sent; a noResize feed still displays its captured screen.
- **Requirement**: REQ-2

#### TEST-19: An inactive tab is resized only when due for capture
- **Type**: component
- **Priority**: high
- **Given** two tabs whose first size has been requested **When** the panel size changes between the inactive tab's captures **Then** the inactive tab is neither resized nor captured early (its existing five-second cadence remains intact), and every new resize is paired immediately with that tab's own capture, never a resize-only pass.
- **Requirement**: REQ-5, REQ-10

#### TEST-20: Closing and reopening the panel asks for the same size again
- **Type**: component
- **Priority**: high
- **Given** a resized tab **When** Hide closes the panel, closed time passes, then Show reopens at the same size **Then** no closed-panel resize/capture occurs, and the reopened live tab resizes again before capture.
- **Requirement**: REQ-11

#### TEST-21: Resize answers never replace a tab's drawing
- **Type**: component
- **Priority**: critical
- **Given** a stable child screen and success, gone, or failed resize answers **When** resize and capture occur **Then** the child screen is still drawn, no resize diagnostic appears in the tab, and capture continues even for gone/failed resize answers.
- **Requirement**: REQ-12

#### TEST-22: Below-minimum panels retain line cutting
- **Type**: component
- **Priority**: medium
- **Given** a panel narrower than 80 and a wider captured line **When** Show draws **Then** the resize asks for 80 × 24 while the drawn line is still cut to the panel's existing viewport rule.
- **Requirement**: REQ-3

## Coverage map

| Requirement | Tests | Covered |
|---|---|---|
| REQ-1 (R7.1): resize iff resize + capture + capture_since_seq; other features unchanged | TEST-1, TEST-2; existing adapter assertions updated | yes |
| REQ-2 (R7.1): no resize calls when unsupported; retain R6 Show behaviour | TEST-18 | yes |
| REQ-3 (R7.2): panel body dimensions, fallbacks, subtract 3 rows, independent 80 × 24 clamp; small panel still cuts lines | TEST-7, TEST-8, TEST-22 | yes |
| REQ-4 (R7.2): every tab receives the same panel size | TEST-9 | yes |
| REQ-5 (R7.3): resize only for a due capture, immediately before it in the same pass | TEST-10, TEST-11, TEST-12, TEST-19 | yes |
| REQ-6 (R7.3): panel must have drawn at least once | TEST-12 | yes |
| REQ-7 (R7.3): no resize for finished slots | TEST-17 | yes, including LOST |
| REQ-8 (R7.3): exact delegation/team resize request shapes | TEST-3, TEST-4, TEST-9 | yes |
| REQ-9 (R7.3): once per tab per last requested size, whatever the answer | TEST-9, TEST-13, TEST-14, TEST-15 | yes |
| REQ-10 (R7.3): changed panel size wakes the loop and resizes at each tab's next capture | TEST-14, TEST-15, TEST-16, TEST-19 | yes |
| REQ-11 (R7.3): closed/ended tabs forget requested size; reopening resizes again | TEST-20; TEST-17 covers no resize after finish | partial: closed/reopened covered; ended reset is not independently observable for a finished slot |
| REQ-12 (R7.4): answer never changes tab drawing; failed answer logs one exact debug line; capture still runs | TEST-14, TEST-21 | yes |
| REQ-13 (R7.4): numeric cols/rows decode as resized using returned dimensions | TEST-3, TEST-4 | yes |
| REQ-14 (R7.4): unknown_run, unknown_session, unknown_slot decode as gone | TEST-5, TEST-21 | yes |
| REQ-15 (R7.4): all other errors/rejections/unreadable answers decode as failed, with code or text reason | TEST-6, TEST-14, TEST-21 | yes |

## Known gaps

- REQ-11: after a slot finishes, R7.3 independently prohibits resizing it, so forgetting its private last-size entry cannot be observed by reopening that finished slot. The contract defines no restart/resurrection operation for the same finished slot. Do not inspect the private cache or invent a terminal-to-live transition; cover the externally visible close/reopen branch instead.
- R7.2's fallback values are not restated in R7; the existing public `paneFit` tests provide the referenced 80-column/20-body-row fallback context. The new tests exercise those values through actual Pane props rather than importing that helper.
- The adapter construction entry point is supplied by the existing adapter test import; the supplied contracts declare RunSource, but not its factory. This is existing harness wiring, not a new production surface.
- No implementation files were read. No runtime/typecheck/negative-control evidence is claimed: the host must run the kit suite, then temporarily change one concrete size expectation (for example 136 × 40 to 137 × 40), confirm failure, and restore it.
