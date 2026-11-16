---
name: meroku
description: Explains how meroku turns an env YAML into Terraform on AWS, and routes the task to its yaml, extend or troubleshoot skill. Use when working in a meroku project or asked about meroku.
argument-hint: "[what to do, or a .meroku/claude briefing path]"
---

# meroku: the entry point

meroku turns one YAML file per environment into Terraform and runs it against AWS. It
always runs from the project root, never from the meroku source tree. Use this to place
any file, error or command in the pipeline before you change anything.

Written against meroku 6.2.0 (plus 6.4.0's event-consumer grants) and schema v32. When this text disagrees with the project,
the project wins: the env YAML's `schema_version`, and its own `infrastructure/` copy
(`infrastructure/version.txt` names that copy's version; `meroku --version` names the
binary's).

The task: `$ARGUMENTS`. Empty: take it from the conversation. Nothing there either: ask the
user what they want to do in this meroku project.

## Route the task

Pick the row that matches and load that skill before you do anything else. Load it with the
Skill tool (`meroku:troubleshoot`, `meroku:yaml`, `meroku:extend`). If the Skill tool is not
available or answers with an error, read the file instead, relative to this skill's
directory (`../troubleshoot/SKILL.md`, `../yaml/SKILL.md`, `../extend/SKILL.md`). Already in
your context, as in the meroku agent, which preloads all four: do not load it again; follow
it.

| The task | Load | Notes |
|---|---|---|
| a meroku operation failed (apply, plan, destroy, AWS SSO); a `.meroku/claude/*.md` briefing; "Fix with AI" | `meroku:troubleshoot` | pass the briefing path as the skill's argument when one is named. It reads `yaml` itself when the fix is in the YAML |
| create a new environment or a new env YAML | `meroku:yaml` | its "Create a new env YAML" section |
| change, review or migrate an env YAML; vaults; KMS signing keys; what a key does or what the YAML format is | `meroku:yaml` | |
| add AWS infrastructure: a queue, bucket, Cognito pool or client, SMS setting, alarm, IAM permission, cache, KMS signing key, anything meroku might create | `meroku:extend` | it checks meroku's default first and reads `yaml` itself when the answer is a YAML key |
| how meroku works, a command, the project layout, why a resource has the name it has | nothing more | answer from this skill |
| a failure and a change at once ("apply failed after I added a queue") | `meroku:troubleshoot` first | the failure decides what is safe to change |
| unclear between rows | — | ask the user one multiple-choice question, the rows as options, your best guess first and marked "(Recommended)" |

Load one skill at a time. Load a second only when the first one sends you there.

## AWS and Terraform themselves

This plugin teaches meroku. For AWS and Terraform it relies on two official plugins:
`aws-core@claude-plugins-official` and `terraform@claude-plugins-official`. Read
`references/official-plugins.md` the first time you would inspect AWS or look up a
Terraform provider argument: what each plugin is for, how to tell whether it is installed,
the install commands, and how the read-only rules apply to their tools.

## The pipeline

1. **Env YAML.** `<env>.yaml` at the project root, else `project/<env>.yaml`. The only
   file a configuration fix changes. How to change it: read `../yaml/SKILL.md`.
2. **Migrations.** On load the binary upgrades the YAML to its schema version, backing
   the old file up to `backup/` beside it first.
3. **Template.** The YAML renders `infrastructure/env/main.hbs` (Handlebars), which calls
   the modules in `infrastructure/modules/`. Files in `custom/terraform/_shared/` and
   `custom/terraform/<env>/` are appended as they are.
4. **Generated Terraform.** Written to `env/<env>/`: `main.tf`, plus `_bridge.tf`, which
   exposes module outputs to custom Terraform.
5. **Terraform.** meroku runs `init`, `plan` and `apply` (or `destroy`) inside
   `env/<env>/`, with the YAML's `aws_profile`. State is in the S3 backend named by
   `state_bucket` and `state_file`.

**`env/<env>/` is generated. Never edit it by hand.** Every generate rewrites it from the
YAML, so a hand edit is lost or drifts from the YAML. Change the YAML, `custom/`, or (for a
meroku bug) meroku itself.

## Project layout

| Path | What it is | Who changes it |
|---|---|---|
| `<env>.yaml` or `project/<env>.yaml` | one environment's config | the user, through review |
| `backup/` (beside the YAML) | timestamped YAML backups from migrations | meroku |
| `infrastructure/` | a copy of meroku's templates and modules at one version | `meroku update` only; it replaces the whole directory |
| `env/<env>/` | generated Terraform, plus `.terraform/` after init | meroku only |
| `custom/terraform/_shared/`, `custom/terraform/<env>/` | user Terraform appended to `main.tf` | the user |
| `custom/pre/`, `custom/post/` | user modules wired in when their `main.tf` exists | the user |
| `.meroku/` | local state; `.meroku/claude/` holds Fix with AI briefings. Ignores itself in git | meroku |
| `dns.yaml` | root zone and delegation records from DNS setup | meroku |

Where new infrastructure goes, and what each `custom/` place needs (a `README.md` in every
custom folder): read `../extend/SKILL.md`.

An edit to `infrastructure/` is lost on the next `meroku update`. It is a stop-gap at
most, and only when the user asks for one. A symlinked `infrastructure/` points at a
meroku checkout; change that checkout with git instead.

## Commands

| Command | Effect |
|---|---|
| `meroku generate <env>` | writes `env/<env>/` from the YAML. Local; may offer to reconnect state, asking first |
| `meroku migrate`, `meroku migrate <file>`, `meroku migrate all` | prints the schema version; or migrates YAML (writes, with backup) |
| `meroku sync [env]` | checks the env against its S3 state, reconnects a disconnected `env/<env>/`; never applies, destroys or migrates state |
| `meroku update [ref]` | replaces `infrastructure/` to match the binary, or a tag or branch |
| `meroku dns status`, `meroku dns validate` | read-only DNS checks |
| `meroku dns setup`, `delegate`, `remove` | change DNS zones and delegation in AWS |
| `meroku vpc-cidr check\|suggest\|assign <env> [--aws] [--force]` | check a VPC range, suggest a free one, or write one (`assign`, not yet deployed envs only) |
| `meroku monitor [env]` | the monitor dashboard |
| `meroku --env <env> [--profile <p>]` | the interactive menu for one env |

From the menu: **"🚀 Deploy environment"** generates, runs AWS pre-flight checks,
initialises Terraform, shows the plan and applies after confirmation. **"💥 Nuke/Destroy
Environment"** is the destroy flow. **"🌐 Edit environment with web UI"** edits the YAML
in a browser; its Vaults tab is also where the user sets vault secret values, which are
never in the YAML. **"🤖 Fix with AI (Claude Code)"** writes a briefing and starts Claude
Code. In 6.2.0 the web UI's "KMS keys" node and each workload's "KMS keys" tab add,
retire and connect signing keys.

Anything that writes (generate, migrate, update, a deploy, dns setup) runs only after the
user agrees. Prefer asking the user to run deploy and destroy themselves.

## Names

Resource names come from `project`, `env` and each item's name, shortened by a cascade
when AWS's length cap is tight, so a deployed name may not match the documented pattern.
Read `references/naming.md` only when a name is too long, a resource name in AWS looks
unexpected (hex at the end, words missing), or a change would rename something.

## Where to go next

- Vaults, their `secrets` list and their values: read `../yaml/references/vaults.md`.
- KMS signing keys, their connections and their removal: read
  `../yaml/references/kms-keys.md`.
- Design notes for a feature: `infrastructure/ai_docs/` in the project, when the copy
  carries it.
