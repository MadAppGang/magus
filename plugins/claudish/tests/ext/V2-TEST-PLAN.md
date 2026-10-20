# Blind behaviour tests: claudish status mod 2.4.0

The spec files named below (`spec.md`, `spec-v2.md`, `spec-2.3.0.md`) are kept, as one document, in `docs/plans/2026-10-20-claudish-status-band-spec.md` at the repository root.

Authority: `spec-v2.md`. Each line below maps one expanded test name to a numbered point; every line runs on both `[terminal]` and `[desktop]`. The unchanged contracts supply run/slot addressing, the mocked clock, and read-only capture semantics. No implementation file is imported or inspected.

## §1 — Which runs the band draws (`v2-runs.test.ts`)

- `newer run hides an older settled run and counts one earlier run` → §1 newest-run filter, singular suffix, single-panel label and bare slot id; excludes the old model and its done count.
- `older partly-live run stays drawn with label/slot ids` → §1 keeps every older unsettled run, including its terminal sibling, uses qualified ids, and omits the single-run label and zero earlier count.
- `last-started settled run stays while an older run is live` → §1 most recent means last started, not last active; neither run is hidden.
- `hidden run count adds compacted runs without adding their status counts` → §1 adds `earlier.runs` to hidden runs, uses `2 earlier runs`, and excludes compacted status totals.
- `two hidden settled runs use the plural without compaction` → §1 counts two excluded runs, not their slots, and excludes their rows and done counts.
- `single team names the header and uses bare slot ids with no zero earlier suffix` → §1 exact two-space panel label, `01`/`02`, and no `label/slot` or earlier suffix.
- `a delegation uses its label even beside a team, never its full session id` → §1 delegation label in both single- and multi-run bands; no full session-id row id or sole-panel header label.

## §2 — Status badge (`v2-badges.test.ts`)

- `STARTING draws NEW with calm ink` → §2 NEW, run fill/ink, five-cell code and seven-cell dim/unfilled runtime; running header group and no old glyph/word.
- `RUNNING draws RUN with calm ink` → §2 RUN, run fill/ink, dim/unfilled runtime, running group, and no old glyph/word.
- `AWAITING_INPUT draws ASK with loud ink` → §2 ASK, bold permission fill/inverse ink across both parts, needs-you group, and no old glyph/word.
- `AWAITING_PERMISSION draws ASK with loud ink` → §2 ASK, bold permission fill/inverse ink across both parts, needs-you group, and no old glyph/word.
- `COMPLETED draws END with calm ink` → §2/§7 END, `inverseText` on `success`, dim/unfilled runtime (§8), done group, and no old glyph/word.
- `FAILED draws ERR with loud ink` → §2 ERR, bold error fill/inverse ink across both parts, failed group, and no old glyph/word.
- `TIMEOUT draws TMO with loud ink` → §2 TMO, bold error fill/inverse ink across both parts, failed group, and no old glyph/word.
- `EMPTY draws NIL with loud ink` → §2 non-shape-mismatch EMPTY uses NIL and failed group, with bold error styling and no old glyph/word.
- `CANCELLED draws STP with calm ink` → §2 STP, inactive fill/inverse ink, dim/unfilled runtime, stopped group, and no old glyph/word.
- `UNKNOWN draws ??? with calm ink` → §2 unknown code, inactive fill/inverse ink, dim/unfilled runtime, running group, and no stale known-state glyph/word.
- `shape_mismatch is FMT and wrong format, never NIL, empty or failed` → §2 FMT warning tone, warning-coloured wrong-format group, no repeated reason or red row, and exactly one wrong-format toast.
- `header groups are needs you, running, done, wrong format, failed, stopped` → §2 exact group order and separate FMT count; not two failed and not empty.
- `LOST draws LST with loud ink, not ERR or TMO` → §2 mod-domain LOST code and fail tone/group, not another failure code or RUN; arranged through public state rather than an unspecified missing-run deadline.
- `an unreachable run makes only its live slots unclear` → §2 unreachable live slot becomes ???, terminal slot stays END, and the old RUN code is absent.
- `runtime 42s formats as 42s in seven cells` → §2 seconds runtime, right-aligned seven-cell part; no old idle label.
- `runtime 1020s formats as 17m in seven cells` → §2 minute runtime, right-aligned seven-cell part; no old idle label.
- `runtime 11520s formats as 3h12m in seven cells` → §2 hour/minute runtime under ten hours, right-aligned seven-cell part; no old idle label.
- `runtime 36000s formats as 10h in seven cells` → §2 ten-hour boundary switches to hours, right-aligned seven-cell part; no old idle label.
- `runtime 46800s formats as 13h in seven cells` → §2 hour runtime under a day, right-aligned seven-cell part; no old idle label.
- `runtime 525600s formats as 6d02h in seven cells` → §2 day/hour runtime under ten days and zero-padded hours, right-aligned seven-cell part; no old idle label.
- `runtime 864000s formats as 10d in seven cells` → §2 ten-day boundary switches to days, right-aligned seven-cell part; no old idle label.
- `runtime 1036800s formats as 12d in seven cells` → §2 day runtime, right-aligned seven-cell part; no old idle label.
- `unknown runtime draws an em dash, never zero or NaN` → §2 absent start yields a padded em dash, not a fabricated age or invalid number.
- `live runtime advances but terminal runtime freezes at last activity` → §2 live clock advances 42s to 43s; terminal END remains 43s after another twenty seconds, not wall-clock age.

## §3 — Stale-meter (`v2-meter.test.ts`)

- `0s silence draws ▱▱▱▱▱ in success` → §3 zero filled cells, success ink, no numeric tail or old idle/warning glyph.
- `9s silence draws ▱▱▱▱▱ in success` → §3 below the ten-second edge, zero filled cells and no numeric tail.
- `10s silence draws ▰▱▱▱▱ in success` → §3 exact ten-second edge fills one cell, no numeric tail.
- `29s silence draws ▰▱▱▱▱ in success` → §3 below the thirty-second edge, one filled cell and no numeric tail.
- `30s silence draws ▰▰▱▱▱ 30s in success` → §3 exact thirty-second edge fills two cells and starts the numeric tail.
- `42s silence draws ▰▰▱▱▱ 42s in success` → §3 specified seconds example, two success-coloured cells, no old idle label.
- `59s silence draws ▰▰▱▱▱ 59s in success` → §3 below sixty seconds stays two cells/success, not fully filled.
- `60s silence draws ▰▰▰▱▱ 1m in warning` → §3 exact sixty-second edge fills three cells, changes to warning and minute age.
- `89s silence draws ▰▰▰▱▱ 1m in warning` → §3 below ninety seconds stays three cells/warning, not fully filled.
- `90s silence draws ▰▰▰▰▱ 1m in warning` → §3 exact ninety-second edge fills four cells, still warning.
- `119s silence draws ▰▰▰▰▱ 1m in warning` → §3 below 120 seconds stays four warning-coloured cells, not five.
- `120s silence draws ▰▰▰▰▰ 2m in error` → §3 exact 120-second edge fills five cells, changes to error and two-minute age.
- `3600s silence draws ▰▰▰▰▰ 1h in error` → §3 saturated meter and hour age format, not an old idle label.
- `STARTING has no stale-meter even with an idle value` → §3 only RUNNING gets a meter; neither meter cells nor old idle markers appear.
- `AWAITING_INPUT has no stale-meter even with an idle value` → §3 waiting for input is excluded even at 120s.
- `AWAITING_PERMISSION has no stale-meter even with an idle value` → §3 permission waiting is excluded even at 120s.
- `COMPLETED has no stale-meter even with an idle value` → §3 completed rows are excluded even with an idle value.
- `FAILED has no stale-meter even with an idle value` → §3 failed rows are excluded even with an idle value.
- `TIMEOUT has no stale-meter even with an idle value` → §3 timed-out rows are excluded even with an idle value.
- `EMPTY has no stale-meter even with an idle value` → §3 FMT rows are excluded even with an idle value.
- `CANCELLED has no stale-meter even with an idle value` → §3 stopped rows are excluded even with an idle value.
- `UNKNOWN has no stale-meter even with an idle value` → §3 unclear rows are excluded even at 120s.
- `RUNNING with unknown idle time leaves the meter blank` → §3 known idle time is required; no cells, old idle label or NaN.
- `1 completed turns reads ↻ 1` → §8 loops as a symbol and a number, dim, no fill; no word `loop`/`loops`.
- `2 completed turns reads ↻ 2` → §8 no plural: `↻ 2`, no word `loops`.

## §4/§7 — Stop/Show buttons (`v2-chips.test.ts`)

- `Show and Stop are bracketed buttons in their colour, bold, with no fill and no hotkeys` → §7 `[ Show ]` in `ide` and `[ Stop ]` in `error`, bold, no fill; `label` props the bare words; no old confirm label, hotkeys or first-press cancellation.
- `first press arms Stop? and the second within four seconds cancels only that slot once` → §4 exact armed label/ink, no first-press cancel, one cancel at 3999ms, unchanged siblings and retained Show; no terminal Stop.
- `the arm expires at exactly four seconds and a deadline press only re-arms` → §4 Stop? at 3999ms, original Stop at 4000ms, no cancel on the deadline press and no old confirm label.
- `simultaneous second presses cannot send duplicate cancels` → §4 exactly one cancel for racing second presses and no later duplicate.
- `delegation Stop? cancels only the session id, never a team or pane` → §4 unchanged delegation cancellation contract, one session-id-only cancel, STP and Show retained, no terminal Stop or old confirm label.

## §5 — Column fit (`v2-fit.test.ts`)

- `39 columns draws code, the model cut to 8 and both whole buttons; 38 draws only the header` → §9 floor (lead 2 + id 2 + code 5 + model min(8, content) + Stop 9 + Show 8 + 5 gaps) and header-only boundary; the model stays (`floor-m…`), no runtime/meter/values at the floor, armed `[ Stop? ]` still fits without cutting Show.
- `narrowing drops columns in the exact specified order` → §9 scans every width from 200 to 39 and checks activity → provider → loops (`↻ N`) → tools (`ƒ N`) → tokens (`↑…`) → cost (`<$0.01`) → meter → runtime → id to two → model to eight; the model is present at every width; no lower-priority drop first, missing buttons or wrapped text.
- `column widths and Show position do not change when Stop arms` → §7 Stop reserves nine cells, Show eight; arming preserves column widths and Show identity, with no original Stop or old confirm label.

## §6 — Show (`v2-show.test.ts`)

- `Show asks for 120 dock columns, 24 inline rows and close on Escape, even from the 30-column band` → §6/§7 open-size requests and `closeOnEscape: true` from a visible button at the floor; no pre-press open/capture or false unplaced toast.
- `an unplaced Show toasts the engine reason without claiming it is drawn` → §6 exact not-drawn-yet toast and engine reason when `isPlaced:false`, requested sizes retained, no success claim or cancel.
- `duplicate team model titles add label/slot; Hide then Show reopens the same tab, never a duplicate` → §6/§8 first title is the model; the second is retitled to label/slot on the same id once the open tabs are read; Hide closes it and Show reopens the same id with the same title, never a doubled suffix.
- `duplicate delegation model title adds only its label, never the session id` → §6 model-plus-delegation-label title, not a team-style label/slot or full session id.
- `tab header starts with the row badge, then bold model, provider, meter and activity` → §6 exact badge-led order and matching badge tone, bold model and coloured meter; no old glyph/idle label, ended marker or input controls.
- `an ended FMT tab explains the missed format without empty or shape_mismatch` → §6 FMT badge/loud runtime, friendly required-format explanation and ended marker; no NIL, empty, repeated reason or meter.
- `a three-line child frame is bottom-aligned in 8 body rows` → §6 one header row plus four blank rows above three child rows, with the prompt/status at the bottom and no blank footer or controls.
- `a three-line child frame is bottom-aligned in 4 body rows` → §6 exact body fit after the header, no off-by-one padding or blank footer/controls.

## Harness and verification

`v2-support.ts` reads rendered descriptions, Button child text, effective theme ink and documented state keys. Long/unknown runtimes, the mod-domain LOST state and compacted totals are arranged by public `state.get` hooks, not private exports. `frame` is the documented frame subtree key. The supplied harness and contracts are unchanged.

Typecheck only: `tsc -p tests/ext/v2-tsconfig.json`. The configuration includes only local test sources and the supplied declarations, emits no files and loads no ambient package types. `skipLibCheck` applies to the supplied declarations; test source files are checked strictly.

The additional `--noUnusedLocals --noUnusedParameters` check fails on 14 pre-existing unused `$` parameters in `tests/fake-claudish.ts`; it reports no errors in the new files. The supplied harness was not changed.

Behaviour tests were not run: the implementation is deliberately absent. A typecheck pass is not behavioural proof. There are 72 expanded cases per surface, 144 registered tests in total.

## §7/§8 — Hide (`v2-show.test.ts`, added for R2/R3)

- `while the tab is open and drawn the row reads [ Hide ]; pressing it closes the tab and clears its view; the row reads [ Show ] again` → §7/§8 `[ Hide ]` in `suggestion`, bold, no fill, `label` `Hide`, only on the slot whose tab is open; the press closes exactly that tab and clears its view; Show then reopens the same id; `closeOnEscape: true`.
- `a tab Claude Code keeps undrawn reads [ Show ], and pressing it opens the tab again` → §8 open but `isPlaced: false` reads Show, not Hide; the press opens that same id again (the person's request), and the row reads Hide once it is drawn.
- `the press opens the tab before anything else: ui.open is its first call` → §8 the first pane call a Show press makes is `ui.open`.

## §9 — Revision R4 (`v2-r4.test.ts`, added for R4; the other files migrated to it)

Inks are the §9 palette's hex, worked from its table and formulas (never imported). The harness pins
the theme through `config.list` and answers `env.get` for TERM_THEME/COLORFGBG, so the machine's own
values never reach a test: with no theme the band draws the dark palette.

- `tokens are one split badge, ↑ quiet and ↓ solid, both bold; tools and loops are bold text in their hues` → §9 token halves padded, inks; `ƒ`/`↻` in the tools/loops hues, no fill, no words.
- `<theme> draws the light|dark palette` (9 cases) → §9 `light…`/`dark…` names, then `auto` by TERM_THEME, then COLORFGBG's last field (7/15 light), then dark.
- `the theme is read again at every turn end` → §9 a theme change shows after the next turn end.
- `cost reads <$0.01, $x.xx, $xx.x, $xxx in the cost hue, bold; — when claudish reports none` → §9 cost format and ink.
- `narrowing never drops the model; at the floor it reads 8 cells; one cell below, the header draws alone` → §9 model kept at every width, `never-d…` at the floor.
- `after Hide, the next Show on any row reopens every hidden tab, the pressed tab last and in front; views kept, the list emptied` → §9 hiddenTabs (id, title), opens before anything else, pressed tab last, list emptied.
- `a tab Hide closed keeps its view, so the Show that restores it does not start it over` → §9 the plugin's own close keeps the view; no re-seed on restore.
- `a tab of a run the band no longer draws is closed on the next tick, its view cleared` → §9 tabs belong to the drawn runs.
- `a hidden tab of a run that left the band is dropped from the list; the next Show reopens only current tabs` → §9 retire also prunes hiddenTabs.
- `tokens with both values unknown read — alone; one unknown reads ↑— ↓780` → §8 rule that §9 does not override.

Not testable in the kit: the view cleared on the *person's* close (`origin.kind` `person`). The kit's
`$.ui.close` raises no hook, and the close-mark stand-in is a plugin, whose close §9 says keeps the view.


## §10 — Revision R5 (`v2-r5.test.ts`, added for R5; the other files migrated to it)

The floor now counts the model badge's padding: lead 2 + id 2 + code 5 + (min(8, model) + 2) +
Stop 9 + Show 8 + 5 gaps, with no gap before the provider (41 for a long model, 40 for `model-a`).
Tokens follow §10's last bullet, "Tokens, FINAL": two fixed inks, not derived from a hue.

- `the model is a badge, its name on the indigo solid fill, bold; the provider is its quiet half` → §10 model `#FFFFFF` on `#5B6CE0`, bold; provider `#FFFFFF` on `#293165`; each half padded.
- `there is no gap between the model and its provider` → §10 both halves in one Text, provider straight after the model, drawn ` model  provider `.
- `tokens are two fixed inks, ↑ on the in fill and ↓ on the out fill, both regular` → §10 dark in `#0F592A`, out `#16803D`, white text (light in `#CDFFD3`, out `#95FFA6`, text `#0B0B12`, checked in `v2-r4`'s theme cases).
- `the cost reads SUB for a cost of 0 or a native model reporting none, — for any other unknown` → §10 `SUB` for 0 and for `(native)`/`(Native)` with no cost, `—` for another unknown, `<$0.01` for 0.0096, all in the cost hue, bold.
