---
name: statusline-customization
description: Configuration reference and troubleshooting for the statusline plugin — sections, themes, bar widths, and script architecture
user-invocable: false
disable-model-invocation: true
---

# Statusline Customization Reference

## Config File

**Location:** `~/.claude/statusline-config.json`

### Schema

```json
{
  "sections": {
    "model": true,         // Model name (Opus/Sonnet/Haiku)
    "branch": true,        // Git branch name
    "worktree": true,      // Worktree indicator (wt:name)
    "cost": true,          // Session cost ($X.XX)
    "duration": true,      // Session duration (Xm Xs)
    "context_bar": true,   // Context window usage bar
    "plan_limits": true,   // Plan limit bars with reset countdowns (master switch)
    "claudish_plan": true  // Provider plan bars when the session is routed via claudish
  },
  "icons": {
    "nerd_font": false     // Opt in to Nerd Font glyphs (RAM → 󰍛). Default OFF
  },
  "context_bar_width": 12, // Width of context bar in chars (8-20)
  "plan_bar_width": 10,    // Width of plan limit bar in chars (6-16)
  "theme": "default",      // Color theme name
  "appearance": "auto",    // "auto" | "light" | "dark" — see Appearance below
  "wrap": "auto",          // "auto" wraps to the terminal width, "off" forces one line
  "max_lines": 0,          // Cap on wrapped rows; 0 means no cap
  "layout": "auto"         // "auto" | "aligned" | "compact" — see Wrapping below
}
```

All fields are optional. Missing fields use defaults shown above. `sections` and
`icons` are independent groups — setting one never affects the other.

`theme` and `appearance` are orthogonal: `theme` picks the palette's character
(default / minimal / neon / monochrome), `appearance` picks whether that palette is
drawn for a light or a dark terminal.

## Appearance

The statusline resolves light vs dark at render time, because the same colours cannot
work on both. Resolution order, first hit wins:

1. `appearance` in this config, when set to `light` or `dark`
2. `$STATUSLINE_APPEARANCE` — per-pane override without touching the config
3. `~/.config/tmux/theme` containing `light` or `dark` — an explicit user pin
4. tmux's session-scope `COLORFGBG`, read via `tmux show-environment`
5. macOS `AppleInterfaceStyle`
6. `dark`

**The `$COLORFGBG` environment variable is deliberately never read.** Claude Code
inherits it once at launch and freezes it, so it reports whichever profile was active
when the session started — measured stuck at `15;0` (dark) through an entire light
session. tmux refreshes its own copy on every client attach via `update-environment`,
which is why step 4 asks tmux rather than the environment.

Steps 4 and 5 fork, so their verdict is cached in `~/.claude/.statusline-appearance`
for 30 seconds. Steps 1-3 are free and run on every render.

### Why colours are all 256-cube indices

Every colour in the script is written as `38;5;N` / `48;5;N` with N in 16-255, and
never as a base-16 code (`30-37`, `40-47`, `90-97`, `100-107`).

Base-16 codes are **palette slots**: the terminal profile decides what RGB each one
means. Cube indices 16-231 are **fixed RGB** on every profile. Mixing the two breaks
silently — the chips used to pair a fixed background with `\033[97m`, and iTerm2's
light profile maps that slot to `#3C3835`, a near-black. The worktree chip rendered
near-black on `#AF5F00` (2.1:1) and the branch chip near-black on `#005F00` (1.04:1,
effectively invisible). Both pairs are now fixed on both halves and clear WCAG AA.

If you add a segment, use a cube index. A base-16 code will look correct on your
profile and break on someone else's.

### Bars are vivid, text is muted

Four colour functions, deliberately not shared:

| Function | Used for | Character |
|---|---|---|
| `color_for_pct` | the context `%` label | muted, meant to be read |
| `bar_color_for_pct` | the context `█` fill | vivid green → amber → orange → red |
| `plan_color_for_pct` | the `5h:`/`7d:` labels | muted |
| `plan_bar_color_for_pct` | the plan `█` fill | vivid teal → blue → orange → red |

A bar fill is a solid block several columns wide, so saturation reads there without the
glare it causes on thin text strokes. On a light ground the fills sit around 2.4-3.4:1,
below the threshold used for text — that is intended. A bar is a magnitude you scan;
the number beside it carries the precision, and that number keeps the muted colour.

The plan bars hold a cool hue family rather than reusing the context ramp, so the two
bars stay distinguishable when both are on the same row.

### Worktree chip colours

The `wt:` chip is tinted from its own name, drawn from an 18-colour palette per
appearance (`WT_PALETTE` in `apply_theme`). The same worktree gets the same colour in
every pane and across restarts, so the chip is recognisable without reading it. The
hash is pure bash, so it adds no fork to a per-turn render.

Two worktrees can land on the same tint — 18 buckets is a palette, not a hash space,
and with a dozen worktrees open a collision is likely. The name is still spelled out
in the chip. Widen `WT_PALETTE` if it bothers you; every entry must keep 4.5:1 against
`BADGE_FG` for its appearance.

## Wrapping

When the rendered width exceeds the terminal, the statusline splits across rows at
section boundaries. Claude Code prints every line the command emits, so extra rows
cost only vertical space.

Width comes from `$COLUMNS`, which Claude Code injects per render from the live
terminal size — it is absent from the `claude` process's own environment, so it
tracks resizes rather than freezing at launch.

`max_lines` defaults to `0` (no cap) on purpose. A hard two-line cap reads tidier and
is not: at 90 columns it produces a 161-column second row that the terminal soft-wraps
anyway, giving the same height with ragged, mid-section breaks. A section is never
split internally, so a single segment wider than the terminal still overflows.

### `layout` — fewest lines vs aligned columns

These two goals genuinely conflict. Giving each bar its own labelled row lines their
left edges up, and usually costs a row that packing them together would not.

| `layout` | Behaviour |
|---|---|
| `auto` (default) | Fewest lines. The gutter is used only when it adds no row. |
| `aligned` | Gutter whenever wrapping starts, even at the cost of a row. |
| `compact` | Never use the gutter. |

Both layouts are built every render and compared by line count, so `auto` can never be
taller than `compact`. In practice `auto` rarely shows the gutter, because packing both
bars onto one shared row is usually a line cheaper. Set `aligned` if you want the
columns and are happy to spend the row:

```
                                            auto (2 rows)
* Opus | wt:x | $39.78 | 1h27m | 󰍛 1.3G | 🤖 +1115/-209
██░░░░ 35% 1M+ | █▀▀▀▀▀---- 5h:64% ↻2h10m 7d:18%

                                         aligned (3 rows)
* Opus | wt:x | $39.78 | 1h27m | 󰍛 1.3G | 🤖 +1115/-209
ctx   ██░░░░ 35% 1M+
plan  █▀▀▀▀▀---- 5h:64% ↻2h10m 7d:18% ↻1d6h
```

Packed rows are **not** indented into the gutter, because they cannot be: Claude Code
strips leading whitespace from every line it renders. Measured — six leading spaces and
six leading U+00A0 both came back flush against an unindented line, while a line
starting with a letter kept its position.

### Measuring width

`display_width` strips SGR escapes and counts columns, treating 🤖 and ⚡ as two.

**Never widen it with a bracket expression.** `${s//[🤖⚡]/}` reads as a character class
and is a byte class: it deletes any byte occurring in either encoding. `█` `░` `▀` all
share 🤖's and ⚡'s `E2` lead byte, so bars measured roughly double and the statusline
wrapped 180-column terminals. Add each glyph as its own full-string replacement, and
add a case to the `display_width` unit tests in `test-statusline.ts` — over-measuring
produces no error and no visible breakage, so only a unit test catches it.

## Sections Reference

| Section | Color | Description |
|---------|-------|-------------|
| `model` | Cyan (bold) | Shortened model name with `*` prefix |
| `branch` | Green | Current git branch or short commit hash. **Hidden while the worktree chip is showing** — see below |
| `worktree` | Orange (bold) | `wt:name` — only shown when inside a linked worktree. Replaces the branch chip rather than sitting next to it |
| `cost` | Yellow | Cumulative session cost in USD |
| `duration` | Magenta | Session duration in minutes/seconds |
| `context_bar` | Green→Red gradient | Visual bar + token count (90k/200k) + compaction indicator (⟳) |
| `plan_limits` | Teal→Red gradient | Dual bar: top=5h, bottom=7d plan usage with reset countdowns. **Anthropic only** — suppressed entirely when the session is routed through claudish (see below) |
| `claudish_plan` | Teal→Red gradient | The ACTIVE provider's plan windows when routed through claudish. Same `id:NN% ↻countdown` style as `plan_limits`, with an arbitrary number of windows. Requires `plan_limits` to also be on |
| `diff` | Cyan+green/red | Two independent chips rendered side-by-side: `🤖 +A/-D` (U+1F916) shows lines Claude has added/removed *in this conversation*; `⎇ +A/-D` (U+2387, plain Unicode — no Nerd Font needed) shows uncommitted lines from `git diff --shortstat` in the current worktree. The glyphs pair semantically — 🤖 is what the agent wrote, ⎇ is what is uncommitted in git. Each chip is hidden when its counts are zero; the git chip is also hidden when cwd is not a git repo. The whole section is hidden when both sides are zero. |
| `memory` | Dim cyan | `RAM 1.1G` — resident memory of the Claude Code process **tree**: the entrypoint plus every descendant, summed. Labelled **RAM**, not MEM, so it is not misread as LLM/agentic memory. Summing RSS double-counts shared libraries, so the figure is a slight overestimate. The config key stays `memory` for back-compat. Renders as `󰍛 1.1G` when `icons.nerd_font` is on. |

### Branch and worktree: exactly one chip

A worktree directory is conventionally named after its branch, so rendering both chips
printed the same string twice:

```
* Opus | worktree-mcp-failed-auth |  wt:mcp-failed-auth  | ...
         \___ branch chip ______/    \___ worktree chip _/
```

The rule:

| Where you are | What renders |
|---|---|
| Main worktree | Branch chip only (no worktree chip has ever rendered here) |
| Linked worktree | Worktree chip only — the branch chip is suppressed |
| Linked worktree, `sections.worktree: false` | Branch chip returns |

The branch chip is suppressed by whether the worktree chip is **actually rendered**, not
merely by being inside a worktree. That is what makes the third row work: a user who
turned the worktree chip off must not lose both and end up with no git context at all.

**Trade-off:** when a worktree's directory name differs from its branch — worktree
`mcp-failed-auth` checked out on `feature/xyz` — only the directory name is shown and
the branch is hidden. Set `sections.worktree: false` to get the branch name back.

Both keys are honoured exactly as before, and neither chip's colour or formatting changed.

## Icons (Nerd Font opt-in)

```json
{ "icons": { "nerd_font": false } }
```

**Default: `false`.** When on, segments that have a glyph render it instead of their
text label. One space separates glyph and value either way, so the two forms are
spaced identically:

| Segment | `nerd_font: false` | `nerd_font: true` | Codepoint |
|---|---|---|---|
| `memory` | `RAM 1.1G` | `󰍛 1.1G` | `U+F035B` (nf-md-memory) |

Nothing else changes. `⎇`, `↻`, `🤖`, `⟳` and `⚡` are plain Unicode or emoji, render
in any modern font, and are always on — they are not governed by this key.

### Why it is opt-in, and why "I have a Nerd Font" is not enough

Nerd Font glyphs live in the Unicode private use areas, so an unpatched font renders
them as tofu (□) or as **blank space** — a segment that silently vanishes.

Coverage is also **partial and varies by font**. Measured on a machine with 0xProto
Nerd Font installed:

| Codepoint | Set | Result |
|---|---|---|
| `U+F035B` nf-md-memory | Material Design | renders |
| `U+F2DB` nf-fa-microchip | Font Awesome | **blank** |
| `U+F4BC` nf-oct-cpu | Octicons | **blank** |

So the presence of a patched font in `~/Library/Fonts` cannot decide this — only the
user looking at the specific glyph can. `/statusline:install` probes the font
directories by filename (`nerd|NF-|powerline`; `fc-list` is not used, it is usually
absent on macOS), and when it finds something it prints the real glyph in a sample
line and asks the user to confirm they see an icon rather than a box or a gap. No
patched font found means the question is skipped and `false` is written.

Only Material Design (`nf-md-*`) glyphs are used, as the best-covered set.

### Adding a glyph to another segment

`scripts/statusline.sh` has an icon table near the top of the helpers:

```bash
ICON_RAM='󰍛'  # U+F035B nf-md-memory
```

Add the pair there, then call `icon_or "$ICON_X" "TEXT"` at the render site. Do not
branch on `$ICONS_NERD_FONT` inline — the helper keeps the fallback and the glyph in
one place, and keeps the single-space rule uniform.

### Plan Limits Bar Characters

- `█` — both 5h and 7d usage at this position
- `▀` — only 5h usage (top half)
- `▄` — only 7d usage (bottom half)
- `-` — empty (unused capacity)

### Reset Countdown Format

After each percentage, a countdown shows when the limit resets:

- `↻1h40m` — resets in 1 hour 40 minutes
- `↻3d12h` — resets in 3 days 12 hours
- `↻now` — resetting now

Example: `█▄▄------- 5h:18% ↻1h40m 7d:35% ↻3d12h`

### Claudish sessions (non-Anthropic providers)

When Claude Code runs behind [claudish](https://github.com/MadAppGang/claudish), requests go to
a Qwen / GLM / Kimi / OpenRouter account — **not** the Anthropic one. Anthropic's `5h:`/`7d:`
numbers would then describe an account the session is not spending, so the whole `plan_limits`
segment is suppressed, and the background poll of `api.anthropic.com/api/oauth/usage` is skipped
(it would also leave a stale `~/.claude/.statusline-usage-cache.json` behind for real Anthropic
sessions to read).

Detection is env-based: the session is treated as claudish-routed when **either**
`CLAUDISH_ACTIVE_MODEL_NAME` or `CLAUDISH_TOKEN_FILE` is non-empty. Native Anthropic sessions
set neither and are completely unaffected.

In its place, `claudish_plan` renders the ACTIVE provider's plan windows, read from the JSON
file at `$CLAUDISH_TOKEN_FILE` (claudish >= 7.29):

```json
{ "plan": { "label": "GLM Coding Plan",
            "windows": [ { "id": "5h", "used_pct": 78, "resets_at": "2026-08-03T18:00:00Z" } ] } }
```

- Any number of windows, any `id` strings — nothing assumes `5h`/`7d`.
- Same styling as `plan_limits`: teal→red gradient, red background highlight at ≥80%,
  `↻countdown` from `resets_at`, bar colored by the most-consumed window.
- `label` renders dim ahead of the bar when present.
- When the `plan` key is absent (the case for every provider today), **nothing** is rendered —
  no placeholder and no dangling separator.

Example: `GLM Coding Plan ███████--- 5h:78% ↻48m 7d:16% ↻6d3h`

### Context Bar Token Count

After the percentage, a dim token count shows current/max context usage:

- `45% 90k/200k` — 90k tokens used out of 200k window
- `72% 144k/200k` — approaching limit
- Only shown when Claude Code provides token data in stdin

### Compaction Detection

A bold magenta `⟳` appears after the token count when auto-compaction is detected:

- `25% 50k/200k ⟳` — compaction just happened (tokens dropped)
- The indicator appears for one render only, then disappears
- Detection works by caching `total_input_tokens` between renders; a drop means compaction occurred
- Cache file: `~/.claude/.statusline-token-cache`

## Themes

| Theme | Description |
|-------|-------------|
| `default` | Warm/cool ANSI palette — bright cyan, green, yellow, orange, red |
| `monochrome` | White and gray only — no colors |
| `minimal` | Muted dim ANSI colors (30-series) — subtle and low-contrast |
| `neon` | 256-color bright variants — vivid and high-contrast |

## Script Architecture

### Data Flow

1. Claude Code pipes JSON session data to stdin
2. Script reads config from `~/.claude/statusline-config.json`
3. Extracts fields with `jq`
4. Detects git branch and worktree from `cwd`
5. Reads plan usage from non-blocking background cache
6. Renders ANSI-colored output to stdout

### Non-Blocking API Cache

- **Cache file:** `~/.claude/.statusline-usage-cache.json`
- **TTL:** 60 seconds
- **Mechanism:** Background subshell `( ... ) &` fires API call; current render uses stale cache
- **Token source:** macOS Keychain (`security find-generic-password -s "Claude Code-credentials"`)
- **API endpoint:** `https://api.anthropic.com/api/oauth/usage`

### Input JSON Schema (from Claude Code)

```json
{
  "model": { "display_name": "Claude Opus 4.6" },
  "cost": { "total_cost_usd": 1.23, "total_duration_ms": 180000 },
  "context_window": { "used_percentage": 45.2 },
  "cwd": "/path/to/project"
}
```

## Troubleshooting

### jq not found
The script requires `jq` for JSON parsing. Install with:
```bash
brew install jq
```

### No plan limits showing
- Check if cache file exists: `ls -la ~/.claude/.statusline-usage-cache.json`
- Verify Keychain access: `security find-generic-password -s "Claude Code-credentials" -w | head -c 20`
- If Keychain prompts are denied, the API call silently fails — grant access when prompted
- Plan limits only show when both 5h and 7d utilization data are available

### Config not taking effect
- Verify JSON syntax: `jq . ~/.claude/statusline-config.json`
- After changing config, the script picks it up on next render (no restart needed)
- To redeploy the script itself after a plugin update, run `/setup:statusline-install`

### Script not executable
```bash
chmod +x ~/.claude/statusline-command.sh
# or for project-level:
chmod +x .claude/statusline-command.sh
```

### Reset countdown not showing
- Reset times come from the `resets_at` field in the usage API response
- If the field is missing from the API response, no countdown is shown
- Verify with: `jq '.five_hour.resets_at, .seven_day.resets_at' ~/.claude/.statusline-usage-cache.json`
