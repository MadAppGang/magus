#!/bin/sh
# ax-dump.sh — dump a macOS app's accessibility tree WITHOUT stealing focus, in a
# way that SURVIVES SwiftUI's lazy collections.
#
# Why this exists: the obvious `entire contents of window 1` intermittently
# returns NOTHING on SwiftUI apps, because lazy collections (icon grids,
# scrolling lists) render as `AXOpaqueProviderGroup` and traversing into one
# throws, aborting the whole enumeration. This script descends the tree by
# explicit child iteration with per-node try/catch, so one bad node can't blank
# the result. It prints role + position + size + any label for every element —
# exactly what you need to (a) find the AXSheet/AXGroup you want and (b) identify
# a target button by ON-SCREEN POSITION (SwiftUI buttons usually have no title;
# `description`/`title` come back `missing value`, so position is how you tell
# Save from Cancel).
#
# Usage:
#   ax-dump.sh "<AppProcessName>"                 # dump window 1
#   ax-dump.sh "<AppProcessName>" --sheet         # dump sheet 1 of window 1 (a modal)
#   ax-dump.sh "<AppProcessName>" --path '<AX reference>'  # dump a subtree
#
# The process name is the AX process name, which may differ from the app's
# display name. Find it with:
#   osascript -e 'tell application "System Events" to name of every process'
# (Electron clones often report e.g. "Claude (inference-test)", not the bundle name.)
#
# After dumping, AXPress a target (match by POSITION, re-dumped each run — never
# hardcode an index across UI states):
#   osascript -e 'tell application "System Events" to tell process "App" \
#     to perform action "AXPress" of (UI element 16 of UI element 1 of sheet 1 of window 1)'
# Then VERIFY: confirm `frontmost` stayed false AND re-capture the window — a
# press can silently no-op and still return cleanly.

set -eu

PROC="${1:-}"
if [ -z "$PROC" ]; then
  echo "usage: ax-dump.sh \"<AppProcessName>\" [--sheet | --path '<AX reference>']" >&2
  exit 2
fi

ROOT="window 1"
case "${2:-}" in
  --sheet) ROOT="sheet 1 of window 1" ;;
  --path)  ROOT="${3:?--path needs an AX reference like \"UI element 1 of window 1\"}" ;;
  "") ;;
  *) echo "unknown option: $2" >&2; exit 2 ;;
esac

# Explicit BFS (depth-capped), each node guarded. No recursive handler (those are
# brittle under `tell process`); instead a manual worklist of {element, depth}.
# Output one line per node: <indent><role> [kids] pos=x,y size=wxh label=...
osascript 2>&1 <<OSA
tell application "System Events"
  tell process "$PROC"
    set fm to frontmost
    set report to "process=$PROC frontmost=" & fm & "  (frontmost=false => reading did NOT steal focus)" & linefeed
    set rootEl to $ROOT
    -- worklist of elements, parallel list of depths
    set work to {rootEl}
    set depths to {0}
    set maxDepth to 6
    repeat while (count of work) > 0
      set el to item 1 of work
      set d to item 1 of depths
      if (count of work) > 1 then
        set work to items 2 thru -1 of work
        set depths to items 2 thru -1 of depths
      else
        set work to {}
        set depths to {}
      end if
      -- build the line for this node, guarding every property access
      set pad to ""
      repeat d times
        set pad to pad & "  "
      end repeat
      set r to "?"
      try
        set r to (role of el) as string
      end try
      set kc to "?"
      try
        set kc to (count of UI elements of el) as string
      end try
      set ps to "?"
      try
        set p to position of el
        set ps to ((item 1 of p) as string) & "," & ((item 2 of p) as string)
      end try
      set sz to "?"
      try
        set s to size of el
        set sz to ((item 1 of s) as string) & "x" & ((item 2 of s) as string)
      end try
      set lb to ""
      try
        set lb to (description of el) as string
      end try
      if lb is "" or lb is "missing value" then
        try
          set lb to (title of el) as string
        end try
      end if
      if lb is "" or lb is "missing value" then
        try
          set lb to (value of el) as string
        end try
      end if
      set report to report & pad & r & " [" & kc & " kids] pos=" & ps & " size=" & sz & " label=" & lb & linefeed
      -- enqueue children (prepend so it reads depth-first-ish), guarded
      if d < maxDepth then
        set kids to {}
        try
          set kids to UI elements of el
        end try
        set newWork to {}
        set newDepths to {}
        repeat with c in kids
          set end of newWork to (contents of c)
          set end of newDepths to (d + 1)
        end repeat
        set work to newWork & work
        set depths to newDepths & depths
      end if
    end repeat
    return report
  end tell
end tell
OSA
