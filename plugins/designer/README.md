# Designer

UI design, both directions: `designer:ui` creates a design from a brief, and
`designer:review` judges a built screen against its reference.

Creating produces something a developer can build without guessing: an HTML/CSS artboard
per screen and per state, a token sheet those artboards use, and a list of the library
components they reuse. Judging runs a local pixel diff, hands both screens to an external
vision model for the semantic comparison, and gathers whatever review services the
project already runs. The report header says which eyes looked.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "designer@magus": true } }
```

Designer declares `claudish` as a dependency. The semantic judgement runs through an
external vision model resolved live from claudish's catalog — the newest Gemini Pro, or
the top GPT tier when none is listed. When claudish is unreachable the agent judges
locally and labels the report so.

## Commands

| Command | What it does |
|---|---|
| `/designer:ui` | Create a design from a brief; optionally implement it and review the result |
| `/designer:review` | Judge an implementation against a reference image, or audit one screenshot |
| `/designer:create-style` | Generate the design-style file the other commands work from |

Start with `/designer:create-style` if the project has no design system recorded yet.

## Agents

- **`designer:ui`** — the creator. Reads the style file and the component library,
  writes artboards per screen and state, tokens and a component list, screenshots them
  when browser-use is installed, and self-checks through the external judge.
- **`designer:review`** — the judge. Two image files in, one report out: pixel diff,
  external semantic verdict, review-services table, severity. One image in: a usability
  and WCAG audit.

Both take image files, never URLs. Export the Figma frame or capture the page first
(browser-use can do the capture), then dispatch.

## Skills

| Skill | Covers |
|---|---|
| `designer:review-services` | The external-judge procedure (resolve live, `team` run, poll, read, labelled fallback) and detection of axe-core, Lighthouse, Playwright snapshots, Percy, Chromatic, Applitools |
| `designer:ui-analyse` | Review prompts, depth tiers, severity guidelines |
| `designer:ui-style-format` | Schema for `.claude/design-style.md` and `.claude/design-references/` |
| `designer:design-references` | Material 3, Apple HIG, Tailwind UI, Ant Design, Shadcn/ui |
| `designer:browser-use-integration` | Screenshots through the browser-use plugin |

`designer:compare` is a library skill holding the `compare.ts` CLI invocation pattern. It is
not offered for automatic matching; invoke it by name if you need it directly.

## Working with browser-use

If `browser-use@magus` is installed, `designer:ui` screenshots its own artboards so
`designer:review` has a reference to judge against, and the commands can capture a page
you name. Without it, pass image files.
