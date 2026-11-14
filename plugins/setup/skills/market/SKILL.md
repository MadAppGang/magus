---
name: market
description: Publishes skill edits to the company plugin marketplace and manages its plugins and skills with magus market. Use when the user says publish this skill, update the company plugin, or add this skill to our plugin.
allowed-tools: Bash, Read
---

# Company marketplace changes through `magus market`

A company marketplace is the team's own Claude Code plugin marketplace on GitHub.
`magus market` changes it: it plans every change, binds consent to that plan, pushes (or
opens a pull request), and moves this machine's installs. Your job is to drive the verbs,
get the user's consent on the exact plan, and report the result.

**Not this skill:** "update my plugins", "update magus", "get the latest plugins" — that
is `magus update`, which installs what the project's profile declares. Teammates receive
published changes the same way.

## Rules

- Never run `git` or `gh` yourself for marketplace work, and never run
  `claude plugin marketplace update`. `magus market` does all of it.
- Always pass `--json` and read the one JSON object on the last line of stdout.
- Run a changing verb **without** `--yes` first. Apply only with `--yes=<planId>`, the
  `planId` taken from the JSON of the plan the user approved. Never plain `--yes`: it
  plans again and can apply a plan the user never saw.
- `--force` only after a `conflict` or `no-base` answer, and only when the user has
  explicitly agreed to replace the plugin's version.

## 1. Check magus

Run `magus --version`. The `market` command needs magus 7.14.0 or later. Older → tell the
user to run `magus upgrade`, and stop.

## 2. Pick the verb

| The user wants to | Run |
|---|---|
| see company marketplaces, plugins, skills | `magus market list --json` |
| change a company skill | `magus market skill edit <skill> --json` (copies it into this project; edit that copy) |
| send edits back | `magus market publish <skill> --json` |
| update the plugin (several of its skills edited) | `magus market publish --plugin <p@m> --json` — every `edited` skill as one version; `no-base`/`conflict` copies are left out, each goes on its own with `--force` |
| add a project or USER skill to a plugin | `magus market skill add <skill> --plugin <p@m> --json` (`--from global` for a USER skill; `--create-plugin` when the plugin does not exist yet) |
| add a plugin folder of the user's own | `magus market plugin add <path> [--to <m>] --json` (the folder holds `.claude-plugin/plugin.json`; it stays in place) |
| remove a skill from a plugin | `magus market skill remove <skill> --plugin <p@m> --json` |
| new or deleted plugin | `magus market plugin create\|delete <p@m> --json` |
| new marketplace | `magus market create <owner>/<repo> --private\|--public [--company <name>] --json` — ask which visibility and the company name magus shows it by (defaults to the GitHub owner) |
| use an existing repo | `magus market connect <owner/repo\|git-url\|path> [--company <name>] --json` (`--company` only for a repo with no marketplace yet) |
| take one off this machine | `magus market remove <m> --json` (the repository stays) |

`<p@m>` is `plugin@marketplace`; `@m` may be left out when there is one company
marketplace. `magus market --help` lists every flag.

**Publish without a named skill:** run `magus market status --json` and read `skills[]`.

- any `not-checked` row → `magus market fetch --json`, then `status` again
- `edited`, `no-base` and `conflict` rows are candidates. None → say there is nothing to
  publish. One → publish it. Several → list them and ask which; several `edited` rows of
  one plugin can go together with `publish --plugin <p@m>`.
- `ambiguous` (`owners[]`) → ask which plugin, then pass `--plugin <p@m>`
- `plugin-newer` → the plugin has a newer version of this skill; nothing to publish

## 3. Consent, by exit code

| Exit | JSON | Do |
|---|---|---|
| 3 | `outcome: "needs-consent"`, `planId`, `plan[]` | Show the plan in plain words: each `plan[]` line, the version change, files not published (`notPublished[]` with reasons), and whether the local copy is removed. Ask. Yes → rerun the same command with `--yes=<planId>`. No → nothing changed. |
| 3 | `outcome: "stale"` | `magus market fetch --json`, then rerun without `--yes`. Still stale and it names a marketplace other than the target → rerun with `--plugin <p@m>`. |
| 3 | `error.code: "plan-changed"` | The marketplace moved since the user approved. Show the new `plan[]`, ask again, apply with the new `planId`. |
| 1 | `error.code: "conflict"` or `"no-base"` | Show `files[]` and the `plan[]` lines. Explain: `conflict` = changed here and on GitHub; `no-base` = this copy's origin is unknown. Publishing replaces the plugin's version of the skill. Only on an explicit yes, rerun with `--force` (no `--yes`), then consent to that plan as above, applying with `--force --yes=<planId>`. |
| 1 | other `outcome: "failed"` or `"partial"` | Relay `error.message` and `error.fix`, plus each `installs[]` row with `status: "failed"` and its `fix`. `partial` means the push landed and an install did not move. |
| 4 | `error.code: "gh-auth"` | GitHub sign-in needed: relay `error.fix`. |
| 2 | usage, unknown or ambiguous name | Show `error.message`; fix the arguments or ask the user. |
| 0 | `ok`, `unchanged`, `plugin-newer`, `pull-request` | Report (below). |

## 4. Report

From the final JSON, in plain words:

- `pullRequest` — the PR URL when the branch was protected or a fork was used. A pull
  request moves no install and keeps the local copy.
- `version.from` → `version.to` of the plugin.
- `installs[]` — per scope (USER, PROJECT, LOCAL): moved to which version, or why not.
- `localCopy` — removed, kept or created, with its `reason`. A removed project copy is a
  deletion under `.claude/skills/` to commit.
- "Takes effect in new sessions, or after /reload-plugins."
- Teammates get it with `magus update` in a project whose profile includes the plugin.
