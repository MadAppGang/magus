# R6 test plan: claudish status mod 2.6.0

The spec files named below (`spec.md`, `spec-v2.md`, `spec-2.3.0.md`) are kept, as one document, in `docs/plans/2026-10-20-claudish-status-band-spec.md` at the repository root.

- **Spec**: `spec.md` (R6), with `spec-v2.md` (R1–R5) and `spec-2.3.0.md` for everything R6 leaves alone
- **Contract**: `contract/` (state types, manifest `userConfig.timeline`, `hooks-status-signatures/*.d.ts`), `loadout/claude-code-engine-types.d.ts` (`claude-code/testing`)
- **Stack**: bun, run by `claude plugin test`. Every band and pane test loops `[terminal]` and `[desktop]`. The no-`Client` checks run on `vscode`.
- **Type check**: the whole `tests/` tree passes `tsc --strict --noUnusedLocals --noUncheckedIndexedAccess` against the engine types and the contract `.d.ts` files. None of it has been run.

Every test checks something R6 says must not appear; the per-section notes say which. Where R6 leaves rounding open, as for quiet inks that land on an exact half, the helpers accept both spellings (`mixCandidates`, `quietDark`). They accept nothing wider.

## Shared helpers (updated)

| File | Change | Spec |
|---|---|---|
| `ui.ts` | The `Mounted` type gains the kit's `Client` acts: `drawn({ in })`, `find/findAll({ in })`, `advance`, `resize` | R6.4 |
| `ext/support.ts` | Adds `QUIET_DARK` (run, tools, loops, cost, model), worked from §9's "55 % toward black". `THEME` now includes the quiet inks. `themeOnly` compares hex without regard to case and rejects the retired keys | R6.2, R6.5, R6.6 |
| `ext/v2-support.ts` | `V2_THEME` and `themeKeysOnly` get the same updates. New: `expectInkOneOf`, and `tabHeader` is exported | R6.2, R6.6 |
| `blind/helpers.ts` | `ALLOWED_COLOURS` gains the quiet inks. New: `allowedSpelling` | R6.2, R6.6 |
| `ext/r6-support.ts` (new) | Timeline tables (light, dark, timeline-only), Client props type, `cells`/`naturalCells` measurer, `drawnRows`, `untilPoll` (reads right after a poll so the seconds are exact), `silentFor`, `runsOf`/`inkOfLast`, `expectFlushRight`, `activeTab`, `views` | R6.3–R6.6 |

## New tests (`tests/ext/r6-*.test.ts`)

| Test | Spec point |
|---|---|
| r6-numbers: counts 999 / 1.0k, 9.9k / 10k, 999k / 1.0M; 12 700 reads 13k | R6.1 counts. Negative: no `12.7k`, `10.0k`, `1000k` |
| r6-numbers: the cost cell (SUB / — / dollars) | R6.1 cost cell and SUB rule; R6.2 quiet ink. Negative: −1 never reads as an amount |
| r6-numbers: a provider's trailing (Native) is dropped in the row and the tab header | R6.1 provider name; SUB still keyed on claudish's string. Negative: no `native` in any case |
| r6-row: the block, with no gap and one space each side of each part | R6.2 block, `tokens` Text, inks, `ƒ8`/`↻1`, badge runtime. Negative: no `ƒ 8`, no words |
| r6-row: unknown values (` — ` tokens, `ƒ—`, `↻—`) | R6.2 unknowns. Negative: no `↑`/`↓`, no out part |
| r6-row: Show always reads Show, filled on the shown tab's row; no row reads Hide | R6.2 Show and Hide. Negative: no Hide in any row |
| r6-row: the Stop column exists only while some row can be stopped (live cell +10) | R6.2 Stop column. Negative: no Stop and no 9-cell box |
| r6-row: a feed that does not offer cancel draws no Stop column | R6.2 Stop column |
| r6-row: only allowed colours in band and panel; timeline colours only inside Clients; `c` = dark table | R6.6. Negative: retired keys and timeline-only hex are absent |
| r6-row: a light theme hands Clients the light timeline table | R6.6 table and theme pick |
| r6-fit: the example floor, 41 drawn at exactly 41 cells and 40 the header alone | R6.3 floor. Negative: no Button at 40 |
| r6-fit: at every width from 30 to 200, no row is wider than the band, and a timeline row is exactly as wide | R6.3 width rules |
| r6-timeline: the live cell is a Client `timeline:<runId>/<slot>`, `./flow.tsx`, with exactly R6.4's props | R6.4 drawing. Negative: no activity or meter text in the row |
| r6-timeline: without `recent`, a step per kind or tool change and per tool call; wait, then the final step | R6.4 recording. Negative: nothing after the final step |
| r6-timeline: `recent` maps kinds, keeps older steps and replaces the rest | R6.4 `recent`. Negative: replaced words are gone |
| r6-timeline: the last 40 steps, plus `before` `{ count, ms }` | R6.4 last 40 |
| r6-timeline: final step: done, stop, fail with `reason: detail` or the reason alone | R6.4 final step |
| r6-timeline: badges look: N× merge, words, name and time flush right, inks; the cell counts on by itself | R6.4 badges look, cell clock |
| r6-timeline: badges look: words cut with `…`, badge whole | R6.4 |
| r6-timeline: silence colours ok / warn / bad with `#FFFFFF` text; 3 s → 5 s on the cell's clock; ASK is never silent | R6.4 and R6.7 thresholds |
| r6-timeline: fold into `+N` plus the summed time, past badges ≤ half the cell | R6.4 fold |
| r6-timeline: an ended row shows last or failure words left and the end badge right | R6.4 ended row. Negative: no time and no past badge |
| r6-timeline: legend: a Client keyed `legend` under the rows, indented 2, each colour once, in order | R6.4 legend. Negative: none with no finished step, none at the floor, none once every row has ended |
| r6-timeline: narrow cell: one `▌` per finished step, then the badge; bars alone below that | R6.4 narrow |
| r6-timeline: the line look: `ᗧ`, step times `2.4s` / `14s` / `1m05s`, `ᗣ` when silent | R6.4 line look. Negative: no ghost while streaming, no legend |
| r6-timeline: the line look on ended rows: `✓`, `■`, `✕` | R6.4 line look, ended |
| r6-timeline: any option but `line` gives badges | R6.4 option |
| r6-show: one pane `claudish-show` (claudish, 120, 24, Escape); the open is the first call; it picks the slot's tab | R6.5. Negative: never a `cl_` pane id |
| r6-show: an unplaced open toasts "Show m: not drawn yet. reason" for 8 s | R6.5 toast. Negative: no Hide |
| r6-show: header Hide: suggestion, bold, 8 cells, right edge; closes the pane; views and tab kept; Show restores | R6.5 Hide. Negative: no Hide while undrawn, no captures while closed, no re-seed |
| r6-show: tabs follow the band: seeded `waiting` before any Show; a run that leaves is cleared | R6.5 tabs. Negative: no capture before open |
| r6-show: tab labels: `kimi-k3 01`, `label/slot` across runs, a delegation's `#label` | R6.5 labels. Negative: never the session id |
| r6-show: strip: dots, inactive labels, the shown tab's ink, `│`, `─` rule; a tab press | R6.5 strip |
| r6-show: the shown tab falls back to the first; with no tab, `No run to show.` in dim | R6.5 |
| r6-meter: no meter in the tab header unless RUNNING with a known idle | R6.7 |
| r6-meter `[vscode]`: with no `Client`, the row draws the meter (4 s, 5 s, 65 s, 130 s) | R6.4 and R6.7. Negative: no Client, no number below 5 s |

## Rewritten tests (each was in `failing-tests.txt`)

| File: test (now) | Spec point |
|---|---|
| band: header and rows | R6.2: no activity beside a timeline; R6.4: slot 04's Client ends on ` blocked ` |
| band: colours are theme keys, outside the frame | R6.6, with the pane at `claudish-show` |
| band: Show opens the one Show pane on that slot's tab; header Hide; the next Show restores it | R6.5 |
| band: Show on an open but undrawn panel: no Hide; the open comes first | R6.5 |
| blind/band: fields in order (badge, block, live cell, buttons) | R6.2 and R6.4. Negative: no meter, no activity |
| blind/band: colours are theme keys, the palette, or quiet inks | R6.6 |
| blind/band: the stale-meter shows in the tab header, never in a timeline row | R6.7 |
| blind/band: narrowing drops provider, loops, tools, tokens; never activity | R6.3 |
| blind/band: panel slots and delegations share the format (` ƒN `) | R6.2 |
| blind/show: one pane for every slot (open, header Hide, reuse, switch) | R6.5 |
| blind/show: a delegation shows in its own tab and captures by `session_id` | R6.5 |
| blind/show: a read-only live view, captured only while the panel is open | R6.5 (room = rows − 2) |
| ext band-layout: shrinking drops provider … live cell, with no activity or meter | R6.3 and R6.1 (`↑48k`, `ƒ12`) |
| ext band-layout: badge, colour, header group and live cell, ×10 states | R6.4: every row has its Client and no meter text |
| ext band-layout: null metrics; native shows as `Anthropic`; the tab meter at 119 s and 120 s | R6.1 and R6.7 |
| ext delegation: row and live counters (` ƒ4 `, ` ↻1 `) | R6.2 |
| ext Show: one pane for every slot; header Hide; Show restores the pressed tab | R6.5 |
| ext Show: a stopped slot keeps its frame until final (captures filtered to its slot) | R6.5: every tab captures while the panel is open |
| v2-fit: narrowing order (provider … live, runtime, id, model) | R6.3 |
| v2-meter: 0 / 4 / 5 / 29 / 30 / 42 / 59 / 60 / 89 / 90 / 119 / 120 / 3600 s in the tab header | R6.7 thresholds and colours |
| v2-meter: 1 and 2 turns read ` ↻1 ` / ` ↻2 ` on the loops quiet ink | R6.2 |
| v2-r4: tokens `↑13k`/`↓780`; tools and loops on quiet inks | R6.1 and R6.2 |
| v2-r4: nine theme rows, using `↑13k` | R6.1 (palette unchanged) |
| v2-r4: cost on the cost quiet ink | R6.1 and R6.2 |
| v2-r4: after the header Hide, Show reopens on the pressed tab; no `hiddenTabs` | R6.5 |
| v2-r4: Hide keeps views, so Show does not re-seed | R6.5 |
| v2-r4: a run that leaves the band: view cleared, strip shows current tabs | R6.5 |
| v2-r4: hidden panel, then a run leaves: only current tabs | R6.5 |
| v2-r5: tokens `↑13k`/`↓780` fixed inks | R6.1 |
| v2-r5: SUB / — on the cost quiet ink | R6.1 and R6.2 |
| v2-show: Show opens `claudish-show` (claudish, 120, 24, Escape) from the floor | R6.5 |
| v2-show: two tabs of one model add the slot id; Hide then Show, one pane | R6.5 labels |
| v2-show: a delegation adds only its label; the team slot adds `label/slot` | R6.5 labels |
| v2-show: tab header (badge, model, provider, `▰▰▱▱▱ 42s`, activity) | §6 with R6.5: the panel's only Buttons are its tabs |
| v2-show: a three-line frame is top-aligned in 8 and in 4 rows | R6.5: replaces bottom alignment |
| v2-show: no row reads Hide; the header carries it; Hide keeps views | R6.5 |
| v2-show: an undrawn panel has no Hide; Show opens it again | R6.5 |
| v2-show: every Show opens `claudish-show` first | R6.5 |
| layout: paneLines segments; a short frame is top-aligned (1 line, no padding) | R6.5 |
| layout: a wide character draws plain; with paint off every line is plain (no padding) | R6.5 |
| layout: count (R6.1 boundaries) | R6.1 |
| layout: tokens (R6.1 units) | R6.1 |
| layout: marks; the row carries the bare count or `—` | R6.2 |
| layout: stale-meter (R6.7): fills from 5 s, `flowing` below 5 s | R6.7 |
| layout (new): cost — negative / NaN / ∞ / missing; `providerName` | R6.1 |
| pane: frames (mounts `claudish-show`; `showTab.active` is the pressed tab) | R6.5 |
| pane: viewport: last 21 lines in 24 rows, plus the `─` rule | R6.5 |
| pane: colours with spans and without (mount `claudish-show`) | R6.5 |
| pane: style budget at exactly the budget and one segment over: top-aligned, no blank rows above | R6.5 |
| pane: final frame; never spawned (mount `claudish-show`) | R6.5 |
| pane: unavailable: `tokens ↑13k ↓780 · ƒ 8 · ↻ 1` | R6.8. Negative: no `ƒ8`, `↻1` or `12.7k` |
| pane: capture scope: closing `claudish-show` stops all captures and keeps the views | R6.5 |

These failing tests keep their bodies. The updated helpers fix them, because R6 changes only the colour set they check:

- v2-badges: 10 states × 2 surfaces
- v2-chips: buttons
- ext degrade: unknown state, and malformed capture
- ext Show: spans mirrored, and placement

## Removed tests and assertions (why R6 removed the behaviour)

| What was removed | Why |
|---|---|
| One pane (`cl_…`) per slot, titled by model, retitled `model (label/slot)` | R6.5: one pane `claudish-show` titled `claudish`; the label lives in the tab strip |
| Per-row `[ Hide ]`; Hide closes every tab; `hiddenTabs`; restore order with the pressed tab last | R6.5: Hide is in the header and closes the one pane. The tabs follow the band, so there is no hidden list |
| Close-and-reopen of an undrawn tab | R6.5: Show reopens `claudish-show` as its first call; there is no per-tab close |
| Bottom-aligned frames with blank rows above | R6.5: top-aligned |
| `ƒ 8` / `↻ 1` (space) in the row; `tally()` / `rowCells()` unit checks | R6.2: `ƒ8` / `↻1` in the row; R6.8 keeps the space only in the Show numbers line. The drawn checks cover both |
| `↑12.7k`, `48.1k`, `999.9k` | R6.1: a whole number of k from 9 950 |
| Stale meter starting at 10 s, numbers from 30 s, meter text in band rows | R6.7: from 5 s with the number. R6.4: a row with a timeline draws its live cell, not the meter |
| Activity text in rows | R6.2: activity only on a row without a timeline |
| Tools, loops and cost as plain bold text in their hue | R6.2: on their hue's quiet ink |
| r6-fit drop-order and r6-show top-aligned drafts | Duplicates of the rewritten v2-fit and v2-show tests |

## Known gaps

- R6.4 "faded toward the page" past-badge and legend fills: the amount of fade is not specified, so the tests check only that a past badge is not the full step colour.
- R6.4 "the 400-step cap": not covered. Whether `before.count` includes dropped steps is not specified.
- R6.5 "in the band's run order" across several runs: covered within one run (slot order). The order between runs is not fixed by the text.
- R6.7 "0 cells filled" below 5 s in a vscode band row: only "no number" is asserted, because the contract says the band animates a flowing meter.
- Two passing pane tests ("read-only", "every cell a different colour") still mount a `cl_…` id. Under R6.5 that draws the engine's own drawing, so they now pass without checking anything. They were not in `failing-tests.txt` and are left as they were.

## Run 1 (633 pass, 28 fail): what was changed in the tests

- **Module path**: R6.4 accepts `./flow.tsx` or a path ending `hooks/status/flow.tsx`. Checked by `isFlowModule` and in `band.test.ts`.
- **Tokens halves**: found by text and ink. A Text's key can't be observed in a drawn tree (amended R6.2).
- **More than 20 steps**: `recent` is cut to its newest 20, so these trails are now built over several polls. That covers the last-40 test and the fold test.
- **r6-numbers, provider test**: the run label is now `prov-run`; the old label `native` matched the check itself.
- **r6-show, Hide**: the Hide node and the boxes holding it now come from the same drawing. They had come from two separate drawings, so comparing them by identity always failed.
- **band-layout, tab-header meter**: the meter colour is now read as an inherited ink rather than from an exact Text node.
- **line look**: no ghost while streaming. After the cell's own clock reaches silence, the ghost is present and may cover at most one cell of each time (`underGhost`).
- **narrow cell**: "bars alone" is now asserted only for a cell narrower than the badge itself (9–10 cells). Cells of 11–13 are an open question, reported to the coordinator.
- **pane read-only, pane every-cell-a-colour**: these now mount `claudish-show` and assert that a real frame is drawn.

## Run 2 (655 pass, 6 fail): spec clarified, tests aligned

- **Waiting slot, never silent**: the cell's own clock now moves 2 s before the asks badge is read. R6.4 says a new job scrolls in, so the cell shows the old job until then. The not-silent assertion is unchanged. The coordinator ruled this an animation, not an implementation issue.
- **Narrow cell**: under the coordinator's ruling, bars alone means a cell narrower than the badge plus one cell (under 12 here). That gives `▌▌▌▌`, a bar for every step including the current one, and the current bar blinks over one second of the cell's clock. Cells of 12–14 are asserted again: as many bars as fit before the badge (`cell − 12`, at most 3).
- **Legend indent**: asserted exactly. The legend's row Box holds an empty `Box` of `width: 2` directly before the legend Client.
