---
name: style-presets
description: Reference for the communication style presets — the axis model, what each preset governs, how the managed CLAUDE.md block works, and how to add a preset.
disable-model-invocation: true
user-invocable: false
---

# Style presets reference

The `style` plugin ships rule blocks that govern **how information is
communicated**: tone, terminology, phrasing, and the shape output takes. It
does not govern code style (that is the linter's job) or visual design (that is
`designer@magus`).

## The axis model

Presets sit on one of two axes, and the axis decides how they combine.

| Axis | Rule | Presets |
|---|---|---|
| `verbosity` | pick **exactly one** — they contradict each other | `direct`, `explanatory`, `terse` |
| `modifier` | combine freely | `evidence-first`, `plain-language`, `no-slop`, `structured`, `calibrated`, `terminology` |

The one-verbosity rule is not a style preference. `terse` says "do not explain
unless asked" and `explanatory` says "explain the specific choice"; applied
together they cancel, and the model resolves the contradiction unpredictably
turn to turn. One wins by being the only one present.

`plain-language` lists `terse` as a conflict for the same reason: glossing
jargon on first use costs words that `terse` forbids. The other modifiers are
orthogonal and stack cleanly.

## What each preset governs

| Preset | Governs |
|---|---|
| `direct` | Answer position, no preamble/postamble, recommend over survey |
| `explanatory` | Reasoning after the conclusion, rejected alternatives, mechanism claims |
| `terse` | Word count, fragments over sentences, no unrequested explanation |
| `evidence-first` | Commands and real output behind every claim; negative controls |
| `plain-language` | Jargon glosses, concrete nouns, active voice, reader impact |
| `no-slop` | Banned vocabulary, banned connectives, em dashes, formatting tics |
| `structured` | Table vs list vs paragraph, headings, backticks, `file:line` |
| `calibrated` | Confidence matching evidence, "I don't know", correction discipline |
| `terminology` | One name per concept; filled from the codebase at apply time |

## The managed block

`/style:apply` writes a single delimited region into CLAUDE.md:

```markdown
<!-- style:begin -->
<!-- presets: direct, no-slop, evidence-first -->
## Communication style
...
<!-- style:end -->
```

Two properties matter:

1. **Re-applying replaces, never appends.** The markers make the region
   addressable. Without them, the second run produces a second voice section
   that contradicts the first, and neither is obviously stale.
2. **Everything outside the markers is untouched.** The command reads the rest
   of CLAUDE.md but never rewrites it.

The `<!-- presets: ... -->` line is the record of what is applied. `/style:list`
reads it; do not edit it by hand, because it will disagree with the body below
it on the next run.

## Cost

CLAUDE.md is injected on every turn. A preset that reads well and changes
nothing is pure overhead — it is charged for on every message and only earns
its place by changing output.

Each preset is deliberately short. `/style:apply` reports the block's line and
character count for the same reason. If a project applies all nine presets,
that is the point at which to ask which ones actually altered anything.

## Adding a preset

Drop a file in `${CLAUDE_PLUGIN_ROOT}/styles/<name>.md`:

```markdown
---
name: <kebab-case, matching the filename>
axis: verbosity | modifier
summary: <one line — becomes the option description in /style:apply>
conflicts: <comma-separated preset names, or empty>
template: true   # optional — only if the body needs filling from the codebase
---

### <Title Case heading>

- <rules>
```

The body after the frontmatter is copied verbatim into CLAUDE.md, so write it
as the rules themselves, not as documentation about the rules. It must open
with a `###` heading so it nests under the block's `##`.

Both commands discover presets by globbing the directory. Nothing is
registered, and no manifest lists them — a new file is available immediately.

Write rules that are checkable. "Be clear" cannot be followed or violated;
"no em dashes" and "cite the command that produced the output" can.
