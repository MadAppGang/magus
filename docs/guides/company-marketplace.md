# Company marketplaces

A company marketplace is your team's own Claude Code plugin marketplace: a GitHub
repository holding the plugins and skills your team shares. magus lists it first, above
every public marketplace, and keeps it in sync for everyone whose project profile includes
it.

You manage it with the `magus market` commands, or on its own screens with `magus edit`.
Every change shows its plan first and asks before it writes anything. `magus market --help`
lists every command, flag and exit code.

You need magus 7.13.0 or later (`magus upgrade`) and the GitHub CLI, signed in
(`gh auth login`).

## Create or connect one

Create a new repository that holds an empty marketplace:

```bash
magus market create acme/claude-market --private --name acme --company "Acme Labs"
```

`--company` is the company name magus shows the marketplace by: it reads **by Acme Labs**
in the plugin list, where magus's own marketplaces read **by MadAppGang**. Leave it out and
the GitHub owner (`acme`) is used. It is one line of at most 64 characters, and it is
written into the marketplace as its `owner.name`, so every teammate sees the same name.

Or use a repository that already exists, on GitHub, at any git URL, or on disk:

```bash
magus market connect acme/claude-market
```

`--name` and `--company` with `connect` apply only when the repository holds no marketplace
yet; otherwise the marketplace keeps the name and the company name it already has (its
`owner.name`, or the GitHub owner when it names none).

Either way the marketplace is added to this machine at **USER** scope. `magus market list`
shows it with its company name, plugins and skills, and `magus market remove acme` takes it off this
machine again, uninstalling its plugins. The repository itself is never deleted.

If the repository runs `claude plugin validate --strict` in its own CI, that check fails on
the marker magus adds to the marketplace. Use plain `claude plugin validate` there.

## Plugins and skills

```bash
magus market plugin create review-kit@acme          # a new, empty plugin
magus market skill add review --plugin review-kit@acme
magus market skill add review --plugin review-kit@acme --create-plugin   # create the plugin with it
magus market plugin add .claude/skills/lint-kit --to acme                # a plugin folder of your own
magus market skill remove review --plugin review-kit@acme
magus market plugin delete review-kit@acme
```

`--create-plugin` creates the plugin, at 0.1.0, in the same commit as the skill when the
marketplace has no plugin of that name (`--description` describes it). Without it, a plugin
that does not exist is an error.

`plugin add` copies a plugin folder of your own, one holding `.claude-plugin/plugin.json`,
into the marketplace as a new plugin, at the version its `plugin.json` gives (0.1.0 when it
gives none). `--name` names it differently there. The same files are left out as for a
skill: dotfiles other than `.claude-plugin/`, `node_modules`, ignored files and symlinks.
The folder itself stays; install the plugin from magus to use the marketplace's copy, then
remove the folder so it does not load twice.

`skill add` takes a skill from this project's `.claude/skills/`, or from your USER skills
with `--from global`, adds it to the plugin as its next version, and moves this machine's
installs of the plugin to that version. The local copy is then removed, because the plugin
now provides the skill; `--keep-local` keeps it. When this machine has only one company
marketplace, `@acme` can be left out.

## Change a skill: edit, then publish

1. **Get a copy to edit.**

   ```bash
   magus market skill edit review
   ```

   This copies the plugin's `review` skill into this project (`--to global` puts it in your
   USER skills) and remembers which version it came from. Start every change this way: a
   copy made by hand has no known origin, so its publish asks twice.

2. **Edit the copy** — by hand or by asking Claude.

3. **Check where things stand.**

   ```bash
   magus market status
   ```

   Each local copy of a company skill shows one of: edited here, edited here with origin
   unknown, changed here and on GitHub, the plugin has a newer version, same as the plugin,
   or not checked (run `magus market fetch` and look again).

4. **Publish.**

   ```bash
   magus market publish review
   ```

   The plan names the version change (for example `review-kit 0.3.1 → 0.3.2`), the files
   that change, any files that will not be published and why (dotfiles, `node_modules`,
   ignored files, symlinks), the installs that move, and whether the local copy is removed.
   `--dry-run` shows the plan and changes nothing.

   Edited several skills of one plugin? `magus market publish --plugin review-kit@acme`
   sends every one of them as one new version: one commit, one version bump, one move of
   the installs. A copy with origin unknown, or changed on both sides, is left out and
   named; publish it on its own with `--force`.

On yes, magus pushes the new version, moves this machine's installs to it, and removes the
local copy. A copy is kept, with the reason shown, when it holds anything that was not
published, when your profile manages it, or when an install did not move. Pass
`--keep-local` to keep it anyway. A removed project copy is a deletion under
`.claude/skills/` to commit.

Changes take effect in new Claude Code sessions, or after `/reload-plugins` in a running
one.

### Asking Claude to do it

The `setup` plugin's `market` skill drives the same commands. Say "publish this skill",
"update the company plugin" or "add this skill to our plugin"; Claude shows you each plan
and asks before applying it. See the [setup plugin page](../plugins/magus/setup.md).

## When a publish does not go straight through

**Both sides changed.** If a teammate published the same skill after you made your copy,
`status` shows *changed here and on GitHub*, and `publish` stops with the files that differ.
Nothing is written. Publishing anyway replaces the plugin's version of the skill with yours:
`magus market publish review --force`, which asks a second time, defaulting to no. To keep
their change, `skill edit` again, redo your edit on the fresh copy, and publish.

**Origin unknown.** A copy that did not come from `skill edit`, or that was moved or
restored, has no known origin. Publishing it works the same way: it needs `--force` and the
second yes.

**GitHub moved while you were deciding.** The plan you agreed to is the only plan magus
applies. If the marketplace changed in the meantime, nothing is pushed: magus shows the new
plan and asks again.

**Protected branch.** When the marketplace's main branch only accepts pull requests, or you
have no write access but can fork, magus opens a pull request instead and prints its link.
A pull request moves no install and keeps your local copy. Once it is merged, the new
version reaches everyone through `magus update`.

**Signed out.** magus says GitHub sign-in is needed and names the command to run.

## How teammates get it

Teammates receive a company marketplace through the project's profile, the same way they
receive every other plugin:

1. Install one of the marketplace's plugins at **PROJECT** scope in the project (or save a
   project profile in magus).
2. Commit `.claude/profiles.json`.
3. Each teammate runs `magus update` in that project.

`magus update` adds the marketplace to their machine, installs its plugins, and from then
on brings them to every newly published version, however recently it was published.
magus tells them once that it now treats the marketplace as a company marketplace.

## The screens

`magus edit` opens the company marketplace screens (`magus market` with no arguments
prints the command help instead). Opening them changes nothing; every change goes through the same plan and confirmation as the commands.

**Company marketplaces**

| Key | Does |
|---|---|
| `Enter` | open the marketplace |
| `c` | create one on GitHub: asks for the owner, the company name (prefilled with the owner), the repository name and who can see it |
| `o` | connect an existing repository |
| `a` | on a row under *Here, in no marketplace*: add that skill or plugin folder to a company marketplace |
| `d` | remove it from this machine (the repository stays) |
| `r` | fetch what changed on GitHub |
| `?` | every key |
| `q`, `Esc` | quit |

**A marketplace** — its plugins, with USER, PROJECT and LOCAL install badges, each opening
to its skills:

| Key | Does |
|---|---|
| `Enter`, `→` | show or hide a plugin's skills |
| `p` | on a skill: publish its edits; on a plugin: push every skill edited here as one new version |
| `e` | copy the skill into this project to edit it |
| `a` | add a skill from this project or your USER skills |
| `x` | remove the skill from its plugin |
| `n` | create a plugin |
| `D` | delete the plugin |
| `r` | fetch what changed on GitHub |
| `Esc` | back to the marketplaces |

A marketplace row shows `● N plugins to push` when skills of its plugins are edited here,
and a plugin row `● N skills edited here`.

Below the marketplaces, *Here, in no marketplace* lists this project's skills and your USER
skills that are not a copy of a company skill, and the plugin folders among them (a folder
holding `.claude-plugin/plugin.json`), each with its scope. `a` on a skill asks which
marketplace (when there is more than one) and which plugin, a new one included, then shows
one plan that creates the plugin if needed, adds the skill and pushes. `a` on a plugin
folder adds it as a new plugin. With no company marketplace yet, the rows are still listed
and `a` says to create or connect one first.

Skill rows are marked `●` edited here, `◇` edited here with origin unknown, `⚠` changed here
and on GitHub, `↓` the plugin has a newer version, and `?` not checked against GitHub.
Publishing a `◇` or `⚠` row asks twice.
