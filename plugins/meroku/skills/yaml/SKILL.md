---
name: yaml
description: Reads and changes a meroku env YAML safely, naming any change that forces resource replacement. Use when editing dev.yaml, prod.yaml or any env YAML.
---

# Changing a meroku env YAML

The env YAML is the one file that describes an environment. meroku migrates it, renders
it through a Handlebars template into Terraform, and runs Terraform. A configuration fix
is a change to this file, followed by a meroku rerun. Never a hand edit of `env/<env>/`.

Written against meroku 5.1 and schema v31. When this text disagrees with the project,
the project wins: its `schema_version`, its `infrastructure/env/main.hbs`, and its
`infrastructure/modules/`. For the pipeline and the commands, read `../meroku/SKILL.md`.

## The rule for every proposal

**Every change you propose states whether it forces resource replacement**: yes, no, or
"unknown until plan". Say which resources and what is lost (data in a database or
bucket, a DNS value, a running service). A name or network change on a deployed
environment is a destroy and a create, not an edit. Before you call a change safe,
check it against `references/dangerous-fields.md`.

## Find the file

1. The env name comes from the briefing, the user, or `env/<env>/`.
2. meroku looks for `<env>.yaml` at the project root, then `project/<env>.yaml`. The
   first one found is the file. Edit that one.
3. Read its `schema_version`. Read `references/migrations.md` when it is below 31, when
   it is missing, or when the user asks about migrations or backups.

## Make the change

1. Read the whole file and the part of `infrastructure/env/main.hbs` that reads the key
   you will change. The template is the truth for what a key does and what its default
   is. `references/schema.md` says where each section lives.
2. Decide the replacement answer (the rule above).
3. Show the user the exact diff and the replacement answer. Wait for a yes.
4. Edit the file. Change only the keys you named. Never edit `schema_version` by hand.
5. Ask the user to rerun meroku: `meroku generate <env>` to regenerate, then a deploy
   from the menu. A plan is the proof: look for `must be replaced` and `-/+` on the
   resources you named.

## Absent, empty and zero are different

The template reads the YAML through two helpers, and they decide what a missing key
means.

| In the YAML | `{{default value fallback}}` gives | `(exists value)` is |
|---|---|---|
| key missing, or `null` | the fallback | false |
| `""`, `[]`, `{}` | the fallback | true |
| `false`, `0`, `0.0` | that value | true |

So deleting a key is not "no setting". It hands the decision to the template's default,
which may differ from what a migration wrote. Under `{{#if}}`, `0`, `false` and `""` all
count as off; `exists` is what tells `0` (for example Aurora `min_capacity: 0`, pause when
idle) from missing. To learn what removing a key does, find it in `main.hbs` and read
which helper wraps it.

## Where to look next

- Read `references/schema.md` only when you need to know which section a key belongs to,
  what it controls, or where its rules are checked.
- Read `references/migrations.md` only when `schema_version` is below 31 or missing, a
  backup is involved, or the user asks to migrate.
- Read `references/dangerous-fields.md` before any change to `vpc_cidr`, `use_default_vpc`,
  `project`, `env`, any `name`, `bucket_postfix`, `region`, the state keys, `domain` or
  `ses` zones and records, `postgres.aurora`, `ecr_strategy`, or the backend health
  check and circuit breaker.

## Never

- never change a key the user did not agree to, even one that looks wrong; report it
- never put a secret in the YAML; secrets live in SSM Parameter Store or Secrets Manager
- never edit `schema_version`, and never edit a backup to "restore" by hand without asking
- never fix the problem in AWS instead of the YAML
