---
name: plugin-sdk-patterns
description: Builds Claude Code plugins that load — manifest location, what registers, the frontmatter each component reads, hooks, MCP servers, verification. Use when creating or editing a plugin or its parts.
disable-model-invocation: true
---

# Building a Claude Code plugin that loads

Plugins fail quietly. A manifest in the wrong folder, a frontmatter key the loader does not
read, or a hook that exits 1 leaves every file looking right while the component does
nothing. For a skill that exists on disk but did not register, the loader answers
`Unknown skill: <plugin>:<name>`, the same string it gives for a typo. This file holds the
facts that decide whether each part of a plugin loads and behaves as written.

**Done means** `claude plugin list` shows the plugin loaded with no error, and every
component you touched did its job once in a real session (section 7).

If the repo you are working in has its own plugin standard, that standard wins where it
differs from this file. In the Magus marketplace source repo, also read section 8.

## 1. Directory structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json        # the manifest; the only file that belongs in this folder
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md
│       └── references/    # optional depth, opened only on an explicit instruction
├── commands/
│   └── <command>.md
├── agents/
│   └── <agent>.md
├── hooks/
│   └── hooks.json
├── .mcp.json              # MCP servers, if the plugin ships any
└── README.md              # for people; nothing loads it
```

- The manifest lives at `.claude-plugin/plugin.json`. A `plugin.json` at the plugin root is
  consulted at install time only; the runtime loader never reads it. The `skills`,
  `dependencies` and `mcpServers` it declares do nothing, the plugin falls back to scanning
  its default folders, and every nested skill it lists answers `Unknown skill`.
- Only `plugin.json` goes inside `.claude-plugin/`. Every component folder sits at the
  plugin root.
- Folders the loader does not know, such as `mcp-servers/` or `examples/`, are never read.
- A plugin cannot reach outside its own directory. A `../shared` component path is
  rejected, and files above the plugin root are not copied into the install cache, so a
  script that reads them works in your checkout and fails once installed.
- Component paths are relative to the plugin root, start with `./`, and use forward
  slashes.

## 2. The manifest

```json
{
  "name": "ts-guard",
  "version": "1.0.0",
  "description": "Formats and lints TypeScript after every edit and blocks commits that fail the type check. Ships a reviewer agent and a /ts-guard:fix command.",
  "author": { "name": "Your Name", "email": "you@example.com" },
  "license": "MIT",
  "keywords": ["typescript", "lint", "format"],
  "skills": ["./skills/review/type-safety"],
  "mcpServers": "./.mcp.json",
  "dependencies": [{ "name": "other-plugin", "version": "^2.0" }]
}
```

| Field | What decides whether it works |
|---|---|
| `name` | The only required field, in kebab-case. It is the plugin's id and the prefix of every component (`ts-guard:review`). There is no separate `id` field. |
| `version` | Optional. Once set it is the update key, and it wins over the marketplace entry's `version`: a change shipped without a bump never reaches installed users, and `/plugin update` tells them they are current. Omit it here and in the marketplace entry to version by git commit instead. |
| `description` | What the plugin is: capability first, then how it works, in the present tense. Never what changed in a release; that belongs in the changelog. |
| `skills` | Adds to the default `skills/` scan. A skill one level down (`skills/<name>/SKILL.md`) registers without an entry. A deeper one (`skills/<group>/<name>/SKILL.md`) registers only when its own directory is listed here. |
| `commands`, `agents` | Replace the default folder scan, so anything not listed stops loading. Leave both out and let `commands/` and `agents/` be scanned. |
| `hooks` | `hooks/hooks.json` loads without an entry. Do not name that file here; use the field only for an additional hooks file. |
| `mcpServers` | `"./.mcp.json"`, or the server map inline. |
| `dependencies` | Other plugins this one needs, as `{ "name", "version" }` entries. An unsatisfied dependency fails the whole plugin: no skill, agent or command loads, and the reason appears only in `claude plugin list`. |

Claude Code ignores top-level fields outside its schema, so a field such as `skillBundles`
or `compatibility` configures nothing; do not add one expecting behaviour. A recognized
field with the wrong type fails the load instead, for example `keywords` given as a string
rather than an array. `claude plugin validate <dir> --strict` reports both.

## 3. Skills

A skill is `skills/<name>/SKILL.md` and registers as `<plugin>:<name>`. Keep the
frontmatter `name` identical to the folder name: Claude Code versions have differed on
which of the two names the skill, and when they match the question never comes up.

### Frontmatter that is read

Skills and commands share one set of keys. Nothing outside it has any effect:

`name`, `description`, `when_to_use`, `argument-hint`, `arguments`,
`disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`,
`effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`, `metadata`

`triggers:`, `tags:` and `keywords:` are silently ignored, and so are `version:`,
`plugin:` and `updated:`. A skill that relies on them for matching has no triggers at all.
`skills:` is not on the list either: only agent files read it (section 5).

### The description

The description is the only part of a skill in context on every turn; the body loads when
the skill is invoked. The description alone decides whether the skill fires.

- Shape: `{What it does, third person, present tense}. Use when {the intent, artifacts and
  phrasings a user actually types}.`
- Capability first. The listing budget is shared by every skill the user has installed,
  from every plugin. Over budget, Claude Code shortens descriptions rather than dropping
  skills, so the tail is what disappears.
- Keep it under 250 characters. That is the Magus marketplace's CI ceiling; the platform
  itself truncates `description` plus `when_to_use` at 1,536.
- Leave out workflow steps (a description that summarises the procedure gets followed
  instead of the body), trailing keyword lists (words already in the sentence do the
  matching), marketing openers such as "Comprehensive", and the characters `<` and `>`,
  which fail validation.

### Visibility

| State | Frontmatter | In the listing, costing budget | Model can invoke | `/plugin:name` works | Can be preloaded into an agent |
|---|---|---|---|---|---|
| listed | none | yes | yes | yes | yes |
| hidden | `disable-model-invocation: true` | no | no; the Skill tool refuses it | yes | no |
| menu-hidden | `user-invocable: false` | yes | yes | no | yes |

- `user-invocable: false` saves no budget. It only removes the skill from the `/` menu.
- Setting both flags strands the skill: only a file read reaches it.
- Hiding a skill silently empties every agent that preloads it through `skills:`, and no
  error appears anywhere. Before hiding one, search `agents/` for its name and give each
  consumer the content another way in the same change.
- Hide large, conditionally relevant skills and reach them through a router: a listed skill
  or an agent whose body says *read `<path>` when `<condition>`*. Phrase the route as a
  file read, never as "invoke the Skill tool". The Skill tool refuses a hidden skill, and
  in the Magus marketplace's routing bench (IDX-1) the Skill-tool phrasing never fired while
  the file-read phrasing did.

### The body

Carry what most invocations need: the objective and what done looks like, inputs and
outputs, the ordered workflow, decision points, failure modes, and how to verify. Stay under
about 500 lines. Move conditional depth into `references/`, and give every reference an
explicit loading line in the body (`Read references/aws.md when the target is AWS`); a
reference nothing tells the model to open is never read. Cut what the model already knows.

`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_DATA}` and `$ARGUMENTS`
are substituted when Claude Code loads the skill: through the Skill tool, a slash command,
or an agent preload. They are not environment variables in the Bash tool. A skill read by
path with the Read tool, which is how a hidden skill is usually reached, contains the
literal placeholder, so name the skill's own files relative to its folder
(`references/format.md`) rather than through a placeholder.

```markdown
---
name: release-notes
description: Drafts release notes from merged pull requests, grouped by change type, in the project's changelog format. Use when preparing a release or when the user asks what changed since the last tag.
---

# Drafting release notes

Goal: one changelog entry covering every PR merged since the last tag, in the format the
project already uses. Done when the entry is written and each PR appears exactly once.

## Workflow
1. Find the last tag and list the PRs merged after it.
2. Group them by change type; skip PRs labelled `no-changelog`.
3. Write the entry in the format of the newest existing entry.

## When to read the references
- Read `references/format.md` only when the project has no changelog to copy the format from.

## Verify
- Every PR number from step 1 appears once in the entry.
```

## 4. Commands

- `commands/<name>.md` becomes `/<plugin>:<name>`. The file name is the command name;
  `name:` and `paths:` in a command's frontmatter are not read. Otherwise commands take the
  skill frontmatter set from section 3.
- `skills:` in a command does nothing, because the command parser never reads it. To give a
  command a skill's knowledge, have its body name the file:
  `Read ${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md before step 2.` A command body is
  loaded content, so the placeholder is substituted there.
- A command and a skill with the same name collide: a Skill-tool call for `<plugin>:<name>`
  returns the command's text, not the skill body. Use that on purpose, with the command as
  the front door to a hidden skill, or give the two different names.
- `$ARGUMENTS` receives what the user typed after the command, and `argument-hint` shows
  the expected shape in autocomplete.

## 5. Agents

An agent is `agents/<name>.md`: frontmatter, then the system prompt. It registers as
`<plugin>:<name>`, and a file in a subfolder registers as `<plugin>:<folder>:<name>`. The
`name` cannot contain `:`.

Plugin agents honour `name`, `description`, `model`, `effort`, `maxTurns`, `tools`,
`disallowedTools`, `skills`, `memory`, `background`, `isolation` (`worktree` is the only
value), `color` and `omitClaudeMd`. For security they ignore `hooks`, `mcpServers` and
`permissionMode`, and they also ignore `initialPrompt`. Multi-word keys are camelCase here,
unlike the kebab-case of skills, and a misspelled key is dropped without an error.

- `description` is what the parent reads to decide whether to delegate. Write it as the
  situation that calls for this agent.
- `tools` omitted gives the agent every tool the parent can pass on; listed, it gets exactly
  those. Check every step of the prompt against the list: an agent told to delegate without
  `Agent`, or to edit without `Edit`, cannot do it. The delegation tool is `Agent`; its old
  name `Task` still works as an alias. Name MCP tools by their full scoped name
  (`references/mcp-servers.md`).
- `skills:` preloads the full text of each listed skill into the agent at startup, and agent
  files are the only place it works. A skill flagged `disable-model-invocation` cannot be
  preloaded; its entry is silently empty. A preload costs its full length on every run, so
  for large content that only some tasks need, a table of *read this file when* rows in the
  prompt is cheaper.
- `model` takes an alias (`sonnet`, `opus`, `haiku`), a full model id, or `inherit`.

```markdown
---
name: type-reviewer
description: Reviews a TypeScript diff for type-safety holes (any, unchecked casts, non-null assertions) and reports each with a fix. Use after TypeScript changes, before merge.
tools: Read, Grep, Glob, Bash
skills: ts-guard:type-safety
---

You review TypeScript changes for type safety. You do not edit files.

Read the diff, check each changed file against the preloaded type-safety rules, and return
one finding per hole: file and line, the rule it breaks, and the smallest fix.
```

## 6. Hooks and MCP servers

Read `references/hooks.md` before writing or changing any hook. It covers the
`hooks/hooks.json` structure, what each exit code and JSON field does, matchers, changing
the permission mode from a hook, and the ways a hook disables itself without an error.

Read `references/mcp-servers.md` when the plugin ships an MCP server or names MCP tools
anywhere. It covers `.mcp.json`, how tool names are built, and where the full scoped name
is required.

## 7. Verify it loads

1. `claude plugin validate ./my-plugin --strict` checks the manifest, `hooks/hooks.json`,
   and the frontmatter of every component in the default folders. `--strict` turns
   unknown-field warnings into errors.
2. `claude --plugin-dir ./my-plugin` loads the plugin for one session without installing
   it. Pass a `--plugin-dir` for each plugin it depends on as well, or it fails to load.
   After an edit, run `/reload-plugins`.
3. `claude plugin list` reports what actually loaded, with a status and the failure reason.
   `claude plugin details` reports what the manifest declares, even for a plugin that
   failed to load, and never lists commands or agents; it is not evidence that anything
   works.
4. Exercise each component you changed: type `/<plugin>:<skill>`, ask for work the agent's
   description covers, provoke each hook's blocking case and a passing case, and call each
   MCP tool. On `Unknown skill` or `Unknown command`, check the manifest location and the
   `skills` list before the spelling.

## 8. In the Magus marketplace repo

This repo keeps its own standards, and they win over anything above:

- Any skill: read `skills/skill-authoring/SKILL.md`, and its `references/visibility.md`
  before changing a visibility flag.
- Descriptions: CLAUDE.md "Skill Description Rules" and "Plugin Description Rules". A
  plugin's `description` is identical in `.claude-plugin/marketplace.json` and in the
  plugin's `.claude-plugin/plugin.json`.
- Versions, CHANGELOG entries and tags belong to the release process in
  `skills/release/SKILL.md`, not to a feature change.
- Every hook-bearing plugin carries byte-identical copies of `hooks/magus-version-check.ts`
  and `hooks/lib/magus-cli-version.ts`. Editing one means editing all of them.

| Command | What it proves |
|---|---|
| `bun skills/skill-authoring/scripts/check-skill.ts <skill-dir>` | one skill's frontmatter, description and size |
| `bun scripts/skill-budget-check.ts` | the per-skill, per-plugin and total listing ceilings |
| `bun scripts/check-skill-reachability.ts --docs --strict` | every skill registers, and docs route to a form that reaches it |
| `bun scripts/check-plugin-registration.ts <plugin>` | a real install registers what is on disk; exit 2 means it measured nothing, which is not a pass |
| `bun scripts/dev-skill-inventory.ts <plugin>` | who preloads each skill; run it before hiding one |
| `node scripts/validate-versions.js` | versions and descriptions agree across both manifests |
| `bun scripts/generate-plugin-catalog.ts` | regenerates `userdocs/plugins/` after any frontmatter change; `--check` fails a release while it is stale |
| `bun run check:hook-copies` | the shared hook files are still byte-identical |
