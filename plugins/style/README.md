# Style

Communication style presets for a project. Composable rule blocks governing tone,
terminology, phrasing, and how information is presented, composed into **one native Claude
Code output style** and activated for you.

Claude Code runs exactly one output style at a time. That is the reason this plugin
composes rather than shipping nine separate styles: with nine, picking two would be
impossible.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "style@magus": true } }
```

## Commands

| Command | What it does |
|---|---|
| `/style:list` | Show the presets, importable output styles, and what is currently composed |
| `/style:apply [preset,preset,...]` | Compose and activate. `--global` for user scope, `--dry-run` to preview |

```
/style:list
/style:apply direct,no-slop
/style:apply explanatory,evidence-first --dry-run
```

## Presets

One **verbosity axis** — pick exactly one of `direct`, `explanatory`, or `terse` — plus any
number of free modifiers:

| Preset | Effect |
|---|---|
| `direct` | Lead with the answer, minimal preamble |
| `explanatory` | Teach as you go, more context per step |
| `terse` | Shortest useful output |
| `no-slop` | Bans filler, hype, and AI vocabulary |
| `evidence-first` | Claims must carry a citation, command output, or file reference |
| `calibrated` | State confidence honestly; no false certainty |
| `plain-language` | Prefer plain words over jargon |
| `structured` | Headings, tables, and lists over long paragraphs |
| `terminology` | Enforce project-specific vocabulary, filled in from your codebase |

Combining two verbosity presets is the one thing that does not compose. Everything else
stacks.

## What gets written

```
.claude/output-styles/composed.md    the composed rules (generated — do not hand-edit)
.claude/settings.json                "outputStyle": "composed"
```

`--global` writes to `~/.claude/` instead. Re-running rewrites the same file; it never
accumulates.

`outputStyle` lands in `.claude/settings.json`, so it reaches teammates only if you commit
that file.

## Importing styles you already have

Output styles you wrote yourself are composable too. `/style:apply` finds them in
`~/.claude/output-styles/` and `.claude/output-styles/` and offers them alongside the
presets, so your own voice rules and these presets end up in one file instead of competing
for the single active slot.

Built-in styles (`Explanatory`, `Learning`, `Proactive`) ship inside the Claude Code binary
rather than on disk, so there is no file to import until you capture one:

```bash
bun scripts/capture-builtin.ts --discover   # what Anthropic ships today
bun scripts/capture-builtin.ts --all        # capture every built-in
bun scripts/capture-builtin.ts --check      # what fell behind after an upgrade
```

Each capture runs one real `claude -p` round trip behind a transparent proxy and records the
system prompt Claude Code actually sent, writing
`~/.claude/output-styles/builtin-<name>.md`. From there it imports like any other style, so
`Explanatory` and your own presets can finally be active at the same time.

Captures are per machine and stamped with the Claude Code version they came from. **Re-run
`--check` after every upgrade** — it exits non-zero when a capture is stale, and lists
built-ins that exist but were never captured, which is how a newly introduced style gets
noticed. Nothing is committed to this repo: the text is Anthropic's, and it changes on their
release schedule, not ours.

Composing replaces whichever style was active, built-ins included.

## Coding rules stay on

The generated style sets `keep-coding-instructions: true`. Without that flag Claude Code
drops its own coding-discipline rules from the system prompt — no premature abstraction, no
error handling for impossible cases, verify UI changes in a browser. A plugin about how to
*communicate* has no business switching off how code gets written.

This plugin also never sets `force-for-plugin`, which would override your own
`/output-style` choice.

## Upgrading from 1.x

1.x wrote a `<!-- style:begin -->` block into `CLAUDE.md`. 2.0 writes an output style
instead. If the old block is still there, its rules are applied twice — `/style:apply`
detects it and offers to remove it.
