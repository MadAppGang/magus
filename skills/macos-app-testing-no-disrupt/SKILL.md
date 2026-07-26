---
name: macos-app-testing-no-disrupt
description: >-
  Verify, screenshot, AND drive a native macOS app on the same machine the user
  is actively working on, WITHOUT stealing their mouse, keyboard, or window
  focus. Use this whenever you need to screenshot, inspect, click through, or
  confirm the behavior of a running Mac app (Swift/SwiftUI, Electron, AppKit, a
  dev build, a cloned app) and the user is present at the machine — even if they
  just say "check that it works", "screenshot the app", "verify the UI", "does
  the picker show X", "click through the flow", or "test my app". Especially use
  it the moment driving the GUI with computer-use would yank focus away from the
  user. Covers focus-free window capture (screencapture -l), focus-free clicking
  and typing via the Accessibility API (AXPress / set value), read-only
  window/process/file inspection, and human-handoff only when AX genuinely can't
  reach a control.
---

# Testing native macOS apps without disrupting the user

## The core problem

You need to confirm a native macOS app does what it should — see its window,
check what it wrote to disk, verify a process spawned — but **the user is sitting
at the same Mac, working.** The naive approach (computer-use `screenshot` + clicks)
forces the target app to the **foreground**, hijacking the user's mouse, keyboard,
and focus. That is the disruption to avoid.

The insight that makes this tractable: **macOS has two separate input paths, and
only one of them needs the app frontmost.**

- You **can see** any window's pixels without focusing it — `screencapture -l`
  reads a single window's backing store directly, even when it's buried behind
  other windows.
- You **can click and type into** a backgrounded app via the **Accessibility
  API** (`AXPress`, `set value`). AX delivers a *semantic* action straight to the
  app's element tree, bypassing the cursor and the frontmost-app event routing —
  so focus never moves. What you **cannot** do focus-free is synthesize a
  *hardware* mouse/keyboard event at a screen coordinate (computer-use, raw
  `cliclick`) — those go to whatever's frontmost, so they require foregrounding.

So the disruption-free strategy is: **observe by capture+inspect, and DRIVE by
AX** — both without taking focus. Reach for the human only when a specific
control genuinely won't expose to AX (see "Clicking … the AX way"). And lead with
side-effect checks where you can: much verification needs no clicks at all,
because a native app's behavior is written into files, processes, and logs you
can read without touching its window.

## Decision: do you even need the GUI?

Before reaching for a screenshot, ask what you're actually verifying. A native
app's real behavior is usually observable without its window:

- **Did it write the right config / output?** → read the files it writes
  (capture a baseline first; see "Verify by side effect").
- **Did it spawn the right helper / server?** → `pgrep -fl`, check the port.
- **Did it log success / error?** → tail its log file.
- **Does the UI actually render X?** (a label, a picker entry, a state) → *this*
  is what window capture is for.

Lead with side-effect checks when you can — they're rigorous and need no window
at all. Use window capture for the genuinely visual claims. In practice you'll
use both: capture the screenshot for the visual proof the user asked for, and
corroborate with files/logs/processes so the verdict isn't "it looked right."

## Capturing a window without stealing focus

Use the bundled helper — it turns an app name into a window id and captures it,
no focus change:

```sh
# capture the app's main window to a PNG (does NOT foreground it)
scripts/capture-window.sh "Claude Profiles" /tmp/app.png

# if the app has several windows (main + a sheet/panel), list them first:
scripts/capture-window.sh "Claude Profiles" --list
# → windowID  owner            layer    title
#   7382      Claude Profiles  layer=0  Claude Profiles
```

Then `Read` the PNG to see it. The helper picks the layer-0 (normal) window by
default. Sheets, modals, popovers, and menus often live on a *different* window
layer, so when the thing you want to verify is inside a sheet (e.g. a
model-picker dialog), run `--list` first, find the row whose title or layer
matches the sheet, and capture that specific id directly:
`screencapture -o -x -l <sheet-window-id> /tmp/sheet.png`. If the sheet is drawn
into the parent window (common in SwiftUI), the layer-0 capture already contains
it — `--list` tells you which case you're in.

**Why a script, not the computer-use `screenshot` tool:** that tool captures the
composited foreground and needs the app frontmost. `screencapture -l <id>` does
not. This is the whole point of the skill — don't fall back to the focus-stealing
path just because it's one tool call.

### How the helper works (so you can adapt it)

Two steps, both focus-free:

1. **Name → window id**, via an inline Swift call to `CGWindowListCopyWindowInfo`
   (on every Mac with Xcode command-line tools; no Python/Quartz needed). It
   lists on-screen windows with their owner, layer, and title.
2. **Capture by id**: `screencapture -o -x -l <windowID> out.png`
   (`-o` omits the drop shadow, `-x` silences the shutter sound). Crucially
   there's no `-W`/`-i`, so it never waits for or grabs user interaction.

If you ever need to do this inline (e.g. the script isn't on the path), those two
commands are the entire technique.

## Verify by side effect (the most disruption-free check)

The strongest, least-intrusive verification: **snapshot state, trigger the
behavior, diff.** A native app reveals what it did through what it touches.

```sh
# 1. BASELINE — before the action, record the relevant state
cat "<app-data-dir>/some-config.json"          # what's there now
pgrep -fl '<helper-process>' || echo "none"    # what's running now

# 2. user (or your scripted launch) performs the action

# 3. DIFF — what changed tells you exactly what the app did
cat "<app-data-dir>/some-config.json"          # new keys? merged cleanly?
pgrep -fl '<helper-process>'                    # did the expected process spawn?
tail -n 30 "<app-log-file>"                      # success / error markers?
```

Capturing a baseline matters: "the config has `deploymentMode: 3p`" is weak
("was it already there?"); "the config *gained* `deploymentMode: 3p` and kept
its existing keys" is a real assertion about the app's write logic.

## Clicking a button WITHOUT stealing focus — the AX way

You CAN click a backgrounded app's buttons without foregrounding it. The
Accessibility API's `AXPress` action delivers a semantic "press this element"
message straight to the app's accessibility tree — it bypasses the cursor and
the frontmost-app event routing entirely, so focus never moves. (This is a
different path from synthesizing a hardware click at a screen coordinate, which
*does* require the app frontmost and is what computer-use / `screencapture -i`
do. `AXPress` is the focus-free one.)

```sh
# Press a button by walking to it explicitly, then AXPress. Verify frontmost
# is unchanged afterward to confirm focus wasn't stolen.
osascript <<'OSA'
tell application "System Events"
  tell process "<AppProcessName>"
    set btn to button "<Title>" of window 1   -- or an explicit index path; see below
    perform action "AXPress" of btn
    return "pressed; frontmost=" & frontmost    -- frontmost=false means focus was NOT taken
  end tell
end tell
OSA
```

### The SwiftUI gotcha that makes this fail — and the fix

On SwiftUI apps, `entire contents of window 1` (and `of sheet 1`) **intermittently
returns nothing**. The cause: SwiftUI renders lazy collections (icon grids,
scrolling model lists) as an `AXOpaqueProviderGroup`, and `entire contents`
throws when it tries to traverse one, aborting the whole enumeration. So the
buttons look "unreachable" — but they aren't. The fix is to **descend the tree by
explicit index path instead of `entire contents`:**

```sh
# Map the structure level by level (NOT entire contents):
osascript -e 'tell application "System Events" to tell process "App" to get role of UI elements of window 1'
# Then address the target directly, e.g. a button inside a sheet's group:
#   UI element 16 of UI element 1 of sheet 1 of window 1
# This never touches the lazy AXOpaqueProviderGroup, so it always works.
```

Use the bundled mapper — it does the guarded descent for you and survives the
lazy-collection trap (per-node try/catch, prints role + position + size + label):

```sh
scripts/ax-dump.sh "<AXProcessName>"            # dump window 1
scripts/ax-dump.sh "<AXProcessName>" --sheet    # dump a modal (sheet 1 of window 1)
scripts/ax-dump.sh "<AXProcessName>" --path 'UI element 8 of UI element 1'  # a subtree
```

(The AX *process* name may differ from the display name —
`osascript -e 'tell application "System Events" to name of every process'`.
Electron clones report e.g. `Claude (inference-test)`.)

Practical recipe that survives the lazy-collection trap:
1. `ax-dump.sh` (or `UI elements of window 1`) → find the `AXSheet` / `AXGroup`
   you want.
2. Identify the target by **on-screen position**, cross-referenced against a
   `capture-window.sh` screenshot — SwiftUI buttons almost always have no title
   (`description`/`title` come back `missing value`), so position is how you tell
   Save from Cancel. Skip iterating *into* any `AXOpaqueProviderGroup` /
   `AXScrollArea` unless you need its children — and when you do, grab its child
   group directly (`UI element 1 of UI element 8 of …`) rather than `entire contents`.
3. `perform action "AXPress"` on the resolved element.
4. **Verify the press did something** — confirm `frontmost` stayed `false` AND
   re-capture the window. A press can silently no-op and still return cleanly
   (observed: `AXCancel` reported success while the sheet stayed open), so never
   assume success from a clean return — check the visible result.

> **Never hardcode an index like `UI element 16` across runs.** Element indices
> and counts shift between UI states (a "New Profile" sheet and a "Select Models"
> sheet have different button layouts). Re-dump for the *current* state, match the
> target by position each time, then press.

This drives full multi-step flows (open a sheet → fill a field → pick a list
item → Save → launch) entirely in the background. Typing into a field uses
`set value of <textField> to "..."` (also focus-free), not keystrokes (which need
frontmost).

### Electron / web-view apps — AX won't reach the UI

SwiftUI/AppKit native controls expose to AX (with the explicit-path trick above).
**Electron apps are different:** their entire UI is Chromium web content, which
System Events sees as one opaque `AXWebArea` with no usable child elements —
`entire contents` comes back empty and there's no explicit path to descend,
because the native AX tree genuinely has no buttons. (Electron *can* be forced to
expose its web AX tree by setting the `AXManualAccessibility` attribute on the
app element, but it's fiddly and unreliable — don't rabbit-hole on it.)

For an Electron app you still observe focus-free via `screencapture -l`. To drive
it, prefer the deterministic / human-handoff fallbacks below. A useful trick for
*observing* an Electron app's network behavior without driving its UI: Electron
honors `http_proxy`/`HTTPS_PROXY`, or you can point whatever endpoint it calls at
a tiny logging pass-through proxy and watch the real requests — often that tells
you what you needed without clicking anything.

### When AX genuinely can't reach it

Some controls never expose to AX (custom-drawn views, WKWebView/Electron web
content). If `AXPress`/explicit-path both fail after an honest attempt, fall
back — in order:

1. **Hand the click to the human.** State exactly what to click, observe the side
   effects passively. The human clicks at their pace; you never take focus.
2. **Drive it deterministically without the GUI** — invoke the same code path the
   button triggers (write the config the app writes, run the CLI it shells out to,
   hit the endpoint it calls). Proves the behavior with no window at all.
3. **Last resort:** foreground the app to click it, with explicit in-the-moment
   consent, and warn it takes their focus. If you must foreground, do the whole
   burst in ONE pass (computer-use only, no shell calls interleaved) — every Bash
   call returns focus to the terminal, so interleaving shell + clicks re-steals
   focus on every step.

## Reading the frontmost app (read-only, safe)

To check what currently has focus *without changing it*:

```sh
osascript -e 'tell application "System Events" to name of first application process whose frontmost is true'
```

This is read-only — it observes, it doesn't activate anything. Use it to confirm
a capture didn't steal focus (the frontmost app should be unchanged after).
**Do not** use `tell application "X" to activate` or
`set frontmost ... to true` for a verification task — those are exactly the
focus-stealing calls this skill exists to avoid.

## Dev / unsigned / cloned builds — the gotchas

Testing a development build of an app surfaces friction the techniques above
don't, learned the hard way:

- **An un-bundled binary** (e.g. `swift run` / `.build/release/Foo`) has no Dock
  identity and no bundle id, so computer-use's app allowlist can't target it by
  name. Wrap it in a `.app` bundle if you need allowlist control — but for
  capture-by-window-id you don't, since `screencapture -l` keys on the window,
  not the bundle.
- **computer-use's allowlist only resolves apps in `/Applications`.** An app in
  `/tmp` returns "not installed" even after `lsregister`. If you must drive it
  with computer-use, it has to live in `/Applications`. (Capture-by-id sidesteps
  this entirely — another reason to prefer it.)
- **To run a dev build under an already-granted identity**, swapping its binary
  into the granted `.app` works — but back up the original first and restore it
  after; treat it as a reversible, temporary swap, and don't do it without the
  user's OK.
- **Environment inheritance:** launching with `open -n` from a shell that has the
  needed `PATH`/env *does* propagate that env to the app (so a dev app can find a
  dev tool on `~/bin`). LaunchServices-launched apps otherwise get a minimal
  `PATH`. Verify with:
  `ps eww -p <pid> -o command= | tr ' ' '\n' | grep '^PATH='`.

## Safety

- **Never** use `pkill` or broad process-killing commands to clean up a test app
  — that can kill unrelated user processes. Kill a *specific* pid you captured,
  or ask the user to quit the app.
- Any binary swap into an installed `.app` must be reversible (back up, restore)
  and consented to.
- Treat foregrounding the app as a disruption: ask before doing it, every time.

## Quick reference

| Goal | Command |
|---|---|
| Capture app window, no focus steal | `scripts/capture-window.sh "<App Name>" /tmp/out.png` |
| List an app's windows (pick a sheet) | `scripts/capture-window.sh "<App Name>" --list` |
| Capture a specific window id | `screencapture -o -x -l <id> /tmp/out.png` |
| Click a button, no focus steal | `osascript -e 'tell application "System Events" to tell process "App" to perform action "AXPress" of (UI element N of UI element 1 of sheet 1 of window 1)'` |
| Type into a field, no focus steal | `osascript -e 'tell application "System Events" to tell process "App" to set value of (UI element 3 of …) to "text"'` |
| Map AX tree (avoid `entire contents` on SwiftUI) | `osascript -e 'tell application "System Events" to tell process "App" to get role of UI elements of window 1'` |
| Is the app running? | `pgrep -fl "<App Name>"` |
| What's frontmost (read-only)? | `osascript -e 'tell application "System Events" to name of first application process whose frontmost is true'` |
| Did a helper spawn? | `pgrep -fl '<helper>'` |
| What env did it inherit? | `ps eww -p <pid> -o command= \| tr ' ' '\n' \| grep '^PATH='` |
