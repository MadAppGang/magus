---
name: meroku
description: Explains how meroku turns an env YAML into Terraform on AWS: commands, project layout, naming. Use when working in a meroku project.
---

# How a meroku project works

meroku turns one YAML file per environment into Terraform and runs it against AWS. It
always runs from the project root, never from the meroku source tree. Use this to place
any file, error or command in the pipeline before you change anything.

Written against meroku 6.0.0 and schema v32. When this text disagrees with the project,
the project wins: the env YAML's `schema_version`, and its own `infrastructure/` copy
(`infrastructure/version.txt` names that copy's version; `meroku --version` names the
binary's).

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
in a browser. **"🤖 Fix with AI (Claude Code)"** writes a briefing and starts Claude Code.

Anything that writes (generate, migrate, update, a deploy, dns setup) runs only after the
user agrees. Prefer asking the user to run deploy and destroy themselves.

## Names

Resource names come from `project`, `env` and each item's name, shortened by a cascade
when AWS's length cap is tight, so a deployed name may not match the documented pattern.
Read `references/naming.md` only when a name is too long, a resource name in AWS looks
unexpected (hex at the end, words missing), or a change would rename something.

## Where to go next

- A failed meroku operation or a Fix with AI briefing: read `../troubleshoot/SKILL.md`.
- Changing the env YAML: read `../yaml/SKILL.md`.
- Adding an AWS resource meroku does not create: read `../extend/SKILL.md`.
- Design notes for a feature: `infrastructure/ai_docs/` in the project, when the copy
  carries it.
