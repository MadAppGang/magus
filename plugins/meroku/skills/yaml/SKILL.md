---
name: yaml
description: Changes a meroku env YAML safely, naming any change that forces resource replacement. Use when editing dev.yaml, prod.yaml or any env YAML.
---

# Changing a meroku env YAML

The env YAML is the one file that describes an environment. meroku migrates it, renders
it through a Handlebars template into Terraform, and runs Terraform. A configuration fix
is a change to this file, followed by a meroku rerun. Never a hand edit of `env/<env>/`.

Written against meroku 6.1.0 and schema v32. When this text disagrees with the project,
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
3. Read its `schema_version`. Read `references/migrations.md` when it is below 32, when
   it is missing, or when the user asks about migrations or backups.

## Make the change

1. Read the whole file and the part of `infrastructure/env/main.hbs` that reads the key
   you will change. The template is the truth for what a key does and what its default
   is. `references/schema.md` says where each section lives.
2. Decide the replacement answer (the rule above).
3. Show the user the exact diff and the replacement answer. Wait for a yes.
4. Edit the file. Change only the keys you named. Never edit `schema_version` by hand.
   Never set an env var meroku sets itself: `DATA_BUCKET_*`, `EVENT_QUEUE_URL`,
   `VALKEY_*`, or `AWS_S3_BUCKET` on the backend. Generate refuses them.
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

## Vaults list secret names, never values

In meroku 6.1.0 every vault declares its secret names:
`vaults: [{ name: payments, secrets: [api_key, webhook_secret] }]`. `secrets` is required
and `[]` is allowed. Each name matches `^[a-z][a-z0-9_]{0,62}$` and is listed once. Only
declared names reach the connected workloads. The user sets the values in the web UI's
Vaults tab; they are never read back.

- Adding or removing a name changes the task definition of every connected workload on the
  next apply. The replacement answer is "no, a new revision for each connected workload".
- `meroku generate` refuses a vault without the key, which is every vault meroku 6.0.0
  wrote:

  ```
  vault "shared" has no secrets list: list its secret names under vaults[0].secrets; the Vaults tab can import the names already in SSM
  ```

  The fix is the Vaults tab's **Import names from AWS**, then generate and apply. No
  migration writes the list.
- **Never write `secrets: []` on a vault whose parameters are in use.** The next apply
  would drop every vault secret from every connected task definition.
- To remove a secret: remove the name, apply, then delete the value. In that order.

Read `references/vaults.md` before any change to `vaults` or to a workload's `vaults`
connections. It also says how to tell a 6.0.x project, whose vaults have no `secrets` key.

## Where to look next

- Read `references/schema.md` only when you need to know which section a key belongs to,
  what it controls, or where its rules are checked.
- Read `references/migrations.md` only when `schema_version` is below 32 or missing, a
  backup is involved, or the user asks to migrate.
- Read `references/dangerous-fields.md` before any change to `vpc_cidr`, `use_default_vpc`,
  `project`, `env`, any `name`, `bucket_postfix`, `region`, the state keys, `domain` or
  `ses` zones and records, `postgres.aurora`, `ecr_strategy`, the backend health
  check and circuit breaker, `event_bus`, any `events` subscription, `vaults`, or
  `valkey`.
- Read `references/vaults.md` before any change to `vaults`, `vaults[].secrets` or a
  workload's `vaults` connections, when generate says `has no secrets list`, and when a
  plan warns that a vault has no value yet.
- The YAML cannot express the resource: read `../extend/SKILL.md` before writing any
  Terraform.

## Never

- never change a key the user did not agree to, even one that looks wrong; report it
- never put a secret's value in the YAML; values live in SSM Parameter Store or Secrets
  Manager. A vault's `secrets` list holds names only
- never write `secrets: []` on a vault whose parameters are in use
- never edit `schema_version`, and never edit a backup to "restore" by hand without asking
- never fix the problem in AWS instead of the YAML
