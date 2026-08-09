# Designer

UI design validation. Compares a rendered screen against its reference by pixel diff, then
reviews the result for spacing, hierarchy, and design-system consistency.

The point is to catch "it looks roughly right" before it ships. A pixel diff tells you
*what* moved; the review pass tells you whether it matters.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "designer@magus": true } }
```

Designer declares `claudish` as a dependency, so that installs alongside it. The visual
analysis passes run through an external multimodal model.

## Commands

| Command | What it does |
|---|---|
| `/designer:review` | Compare a reference against an implementation. Takes a Figma URL, an image file, or a browser screenshot |
| `/designer:ui` | Usability and accessibility review of a rendered screen |
| `/designer:create-style` | Generate the design-style file the other commands check against |

Start with `/designer:create-style` if the project has no design system recorded yet.
Everything else compares against that file.

## Agents

- **`designer:design-review`** — full design review in its own context window
- **`designer:ui`** — usability, accessibility, and Figma implementation help

## Skills

| Skill | Covers |
|---|---|
| `designer:ui-style-format` | Schema for `.claude/design-style.md` and the design-system files |
| `designer:ui-design-review` | The review protocol: what to check and in what order |
| `designer:design-references` | Material 3, Apple HIG, Tailwind UI, Ant Design, Shadcn/ui |
| `designer:ui-analyse` | Prompting patterns and severity guidelines for visual analysis |
| `designer:browser-use-integration` | Capturing screenshots of URL references via the browser-use plugin |

`designer:compare` is a library skill holding the `compare.ts` CLI invocation pattern. It is
not offered for automatic matching; invoke it by name if you need it directly.

## Working with browser-use

If `browser-use@magus` is installed, designer detects it and can screenshot a URL reference
itself rather than making you produce the image. Without it, pass an image file or a Figma
URL.
