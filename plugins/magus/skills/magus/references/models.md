# Per-subagent model routing

Gives each subagent its own model and effort. The routing lives on the active profile, so
the team shares it; a hook applies it.

## Commands

| Command | Does |
|---|---|
| `magus models` / `magus models status` | what is routed now: off, on, invalid or unhooked, plus drift; exits 1 only when invalid |
| `magus models list` | the presets; ● marks the active one |
| `magus models use <preset>` | applies the preset, records it on the active profile, registers the hook |
| `magus models off` | stops routing; subagents use the session model again |

An unknown preset is an error listing the valid names — never a near match.

## Presets

| Preset | Main session | smart | normal | cheap |
|---|---|---|---|---|
| `fable-advisor` (default) | opus, xhigh | fable, medium | opus, xhigh | sonnet, high |
| `fable-lead` | fable, medium | fable, medium | fable, medium | sonnet, high |
| `fable-top` | fable, xhigh | fable, xhigh | opus, xhigh | sonnet, high |
| `opus-lead` | opus, xhigh | opus, xhigh | opus, xhigh | sonnet, high |
| `sonnet-economy` | sonnet, xhigh everywhere; external models at medium | | | |

**Tiers.** smart = judgement work (Plan, dev:architect, dev:reviewer, dev:debugger,
multimodel:deep-analyst). normal = dev:spec-writer, dev:aggregator, and any agent not
listed. cheap = search and lookup (code-search:analyze, Explore, dev:stack-detector,
dev:docs, terminal:tui-navigator, statusline-setup).

Effort is low, medium, high or xhigh, and is set once per model per preset.

## What it writes

`magus models use` writes `.claude/models.json` (generated, gitignored), the `model`,
`effortLevel` and `modelSettings` settings, records them on the active profile (committed,
so teammates get it), and registers a hook in USER settings. The hook runs before every
Agent call, finds the nearest `.claude/models.json` and sets the model; on any problem it
does nothing, so a broken config never blocks a subagent.

`magus doctor` checks the config and the hook; `--fix` registers a missing hook. A set
`CLAUDE_CODE_SUBAGENT_MODEL` overrides routing, and doctor warns about it.

## In the TUI

Tab `0` Models: Enter or `a` applies a preset, `c` turns the tiers off, `r` reloads, `/`
filters.
