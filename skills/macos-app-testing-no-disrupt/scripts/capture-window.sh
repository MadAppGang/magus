#!/bin/sh
# capture-window.sh — capture a specific macOS window by owner name, WITHOUT
# bringing it to the foreground or stealing the user's focus.
#
# Why this exists: the obvious tools (computer-use `screenshot`, `screencapture`
# with no args) only grab the composited foreground — they need the target app
# to be frontmost, which interrupts whatever the user is doing. `screencapture
# -l <windowID>` reads a single window's backing store directly, so it works
# even when the window is buried behind others. The only missing piece is
# turning an app name into a CGWindowID, which we do with a tiny inline Swift
# program (no Python/Quartz dependency, present on every Mac with Xcode tools).
#
# Usage:
#   capture-window.sh "<owner name substring>" <output.png> [--list]
#
# Examples:
#   capture-window.sh "Claude Profiles" /tmp/cp.png      # capture first normal window
#   capture-window.sh "Claude" --list                    # list matching windows, don't capture
#
# Exit codes: 0 ok · 2 no matching window · 3 capture failed

set -eu

NAME="${1:-}"
OUT="${2:-}"

if [ -z "$NAME" ]; then
  echo "usage: capture-window.sh \"<owner name>\" <output.png> [--list]" >&2
  exit 2
fi

# Inline Swift: enumerate on-screen windows (read-only, no focus change) and
# print "windowID<TAB>owner<TAB>layer=<n><TAB>title" for every window whose
# owner name contains NAME (case-insensitive).
SWIFT_SRC="$(cat <<'EOF'
import CoreGraphics
import Foundation
let target = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
for w in list {
    let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
    if target.isEmpty || owner.localizedCaseInsensitiveContains(target) {
        let wid = (w[kCGWindowNumber as String] as? Int) ?? -1
        let name = (w[kCGWindowName as String] as? String) ?? ""
        let layer = (w[kCGWindowLayer as String] as? Int) ?? -1
        print("\(wid)\t\(owner)\tlayer=\(layer)\t\(name)")
    }
}
EOF
)"

TMP_SWIFT="$(mktemp /tmp/find-window.XXXXXX.swift)"
trap 'rm -f "$TMP_SWIFT"' EXIT
printf '%s\n' "$SWIFT_SRC" > "$TMP_SWIFT"

MATCHES="$(swift "$TMP_SWIFT" "$NAME" 2>/dev/null || true)"

if [ -z "$MATCHES" ]; then
  echo "no on-screen window whose owner contains: $NAME" >&2
  echo "(is the app running and does it have a visible window? try: pgrep -fl '$NAME')" >&2
  exit 2
fi

# --list mode: show the candidates and stop. Useful when an app has several
# windows (a main window + a sheet/panel) and you need to pick the right id.
if [ "${2:-}" = "--list" ]; then
  printf 'windowID\towner\tlayer\ttitle\n'
  printf '%s\n' "$MATCHES"
  exit 0
fi

if [ -z "$OUT" ]; then
  echo "usage: capture-window.sh \"<owner name>\" <output.png>" >&2
  exit 2
fi

# Prefer a normal window (layer 0). Sheets, popovers, and menus live on other
# layers; the main content is almost always layer 0. Fall back to the first
# match if no layer-0 window exists.
WID="$(printf '%s\n' "$MATCHES" | awk -F'\t' '$3=="layer=0"{print $1; exit}')"
if [ -z "$WID" ]; then
  WID="$(printf '%s\n' "$MATCHES" | head -n1 | cut -f1)"
fi

# -o = omit the drop shadow · -x = silent (no capture sound). No -W/-i, so this
# never waits for or steals user interaction.
if screencapture -o -x -l "$WID" "$OUT"; then
  echo "captured windowID=$WID → $OUT"
  exit 0
else
  echo "screencapture failed for windowID=$WID" >&2
  exit 3
fi
