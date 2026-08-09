# Style

Communication style presets for a project. Composable rule blocks governing tone,
terminology, phrasing, and how information is presented, written into `CLAUDE.md` as one
managed section that can be re-applied without duplicating itself.

The managed-block part is the design: applying a different combination rewrites the same
block rather than appending a second set of contradictory instructions.

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
| `/style:list` | Show the available presets and what each one changes |
| `/style:apply [preset,preset,...]` | Write the chosen combination into `CLAUDE.md`. `--global` for user scope, `--dry-run` to preview |

```
/style:list
/style:apply direct,no-slop
/style:apply explanatory,evidence-first --dry-run
```

## Presets

One **verbosity axis** — pick at most one of `direct`, `explanatory`, or `terse` — plus any
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
| `terminology` | Enforce project-specific vocabulary |

Combining two verbosity presets is the one thing that does not compose. Everything else
stacks.

## The managed block

`/style:apply` writes between `<!-- style:begin -->` and `<!-- style:end -->` markers in
`CLAUDE.md`. Edit outside those markers freely; anything inside is rewritten on the next
apply. Use `--dry-run` if you want to see the block before it lands.
