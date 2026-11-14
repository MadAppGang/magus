# Vaults: names in the YAML, values in the Vaults tab

Written against meroku 6.1.0, schema v32. A vault is a set of secrets several workloads
share. The YAML declares the vault and the names of its secrets. The values live only in
SSM Parameter Store, under `/<env>/<project>/vault/<name>/`, and are written from the web
UI's **Vaults** tab. The project's own copy is the authority:
`infrastructure/modules/vaults/`, and `infrastructure/ai_docs/VAULTS.md` when the copy
carries it.

## Which shape this project has

| `infrastructure/version.txt` | A vault in the YAML | What reaches a connected workload |
|---|---|---|
| `v6.1.0` or later | `name` and a required `secrets` list | only the names the list declares |
| `v6.0.0` to `v6.0.3` | `name` only, no `secrets` key | 6.0.x: every parameter directly under the vault's path became a secret |
| older than `v6.0.0` | no vaults | nothing |

The rest of this file describes 6.1.0. On a 6.0.x copy, leave a vault without `secrets`,
and name "Moving a 6.0.x vault" below before recommending the update.

## The YAML

```yaml
vaults:                                   # → /<env>/<project>/vault/<name>/
  - name: shared
    secrets: [api_key, database_url]      # required; the values are not here
  - name: payments
    secrets: []                           # a vault with nothing in it yet

workload:                                 # the backend
  vaults:
    - name: shared

services:
  - name: api
    vaults:
      - { name: shared, access: read }
      - { name: payments, access: read_write, prefix: PAY }  # database_url → PAY_DATABASE_URL

scheduled_tasks:
  - name: nightly
    vaults: [{ name: shared }]            # access defaults to read
```

| Key | Rule |
|---|---|
| `vaults[].name` | 1 to 32 lower-case letters, digits, hyphens and underscores, starting and ending with a letter or a digit. Unique |
| `vaults[].secrets` | required, `[]` allowed. Each name is 1 to 63 lower-case letters, digits and underscores, starting with a letter (`^[a-z][a-z0-9_]{0,62}$`), listed once |
| a connection's `name` | a vault of the top-level list. A workload connects to a vault at most once |
| `access` | `read` (the default) or `read_write` |
| `prefix` | optional; upper-case letters, digits and underscores, starting with a letter. It goes before every secret name from that vault, joined with `_` |

`meroku generate` refuses anything else and names the field.

A declared secret `database_url` of vault `payments` is the parameter
`/dev/myapp/vault/payments/database_url`. It becomes the container secret `DATABASE_URL`
for a workload connected without a prefix, and `PAY_DATABASE_URL` for one connected with
`prefix: PAY`. A parameter under the vault's path that the list does not declare is no
workload's secret. Nor is anything deeper (`…/vault/payments/old/database_url`).

`read_write` is for an application that writes its own secrets, for example a rotated
token. It may put and get, never delete. A secret the application writes must still be
declared in the YAML to reach a container.

## What a change to the list does

- **Adding or removing a name changes the task definition of every connected workload on
  the next apply.** No replacement: a new revision. Say so in the replacement answer.
- The order of the list never changes a task definition: secrets are sorted by name.
- **Never write `secrets: []` on a vault whose parameters are in use.** The next apply
  would drop every vault secret from every connected task definition. An empty list is
  for a vault nothing reads yet.
- **Changing a value needs a redeploy.** A changed value changes no task definition, and a
  running task keeps the value it started with. Redeploy each connected workload (or let
  its tasks be replaced) to pick up a new value.
- **Removing a secret: remove the name, apply, then delete the value, in that order.**
  Deleting the value first leaves every connected workload's current revision pointing at
  it: its new tasks fail to start until the value is set again or the removal is applied.
- `meroku destroy` keeps the values. Terraform never creates, reads or deletes a vault
  parameter. The user deletes them from the tab, or with `aws ssm delete-parameter`, when
  the environment is gone for good.

## `meroku generate` refuses a vault without `secrets`

```
vault "shared" has no secrets list: list its secret names under vaults[0].secrets; the Vaults tab can import the names already in SSM
```

That is the shape meroku 6.0.0 wrote, so after an update to 6.1.0 every vault is refused
until it has a list. There is no schema migration: a migration reads only the YAML and
cannot know the names in SSM. See "Moving a 6.0.x vault".

## Moving a 6.0.x vault

1. The user opens the web UI ("🌐 Edit environment with web UI") and its Vaults tab. The
   vault shows "meroku needs this vault's secret names".
2. **Import names from AWS** adds every name found under the path to `vaults[i].secrets`.
   (**Start empty** writes `secrets: []`: only for a vault nothing reads yet.)
3. Generate and apply. The task definitions are unchanged except for `valueFrom`, which is
   now the parameter's ARN and no longer its name, so each connected workload gets one new
   revision.

Names 6.0.0 accepted but the list does not (upper case, hyphens, dots) cannot be imported
as they are. The value is written again under a lower-case name from the tab, the
application is updated if the variable name changes, and the old parameter is deleted.

By hand, the names come from a read-only call, and the last segment of each goes into the
list:

```sh
aws ssm describe-parameters \
  --parameter-filters Key=Path,Option=OneLevel,Values=/<env>/<project>/vault/<name>
```

## Values: write-only, from the Vaults tab

meroku never stores a value, and nothing returns one. The user sets, replaces and deletes
values in the web UI's Vaults tab. You never write or delete a vault parameter yourself,
and a value never goes through this session.

| Row in the tab | Shown | Actions |
|---|---|---|
| declared, set | name → variable name, version, last modified | Replace value, Remove |
| declared, not set | "No value yet" | Set value |
| in SSM, not declared | "Not in the YAML" | Add to YAML, Delete from AWS |
| removed in this session, not applied | a warning: the deployed workloads still use it until you apply | Add to YAML, Delete from AWS |

- A value can be set only for a name the saved YAML declares. A name AWS already has but
  the YAML does not list: **Add to YAML** on its row, then **Replace value**.
- A value is 1 to 4096 bytes.
- When the YAML has `account_id`, the tab refuses credentials of another account and names
  both accounts.
- From a terminal the same write is `aws ssm put-parameter --type SecureString --overwrite`
  on `/<env>/<project>/vault/<name>/<secret>`. The Vaults tab is the normal way; the
  terminal is the user's choice, never a step you run. Keep vault parameters
  `SecureString`: the plan-time check returns the value of a `String` or `StringList`
  parameter in plaintext into the plan.

## A declared secret with no value: a warning at plan

```
Warning: Check block assertion failed
Vault "payments" has no value yet for database_url (under /dev/myapp/vault/payments/).
Set the values in the web UI's Vaults tab. Until then, a new task of a workload
connected to this vault cannot start.
```

It is a `check` block, so a missing value never fails a plan or an apply. The apply
registers the task definitions anyway; ECS refuses to start a task whose secret has no
parameter. The fix is **Set value** in the Vaults tab, and the next task starts. An error
reading SSM at plan (a missing permission, for example) does fail the plan.

## Name collisions

`meroku generate` refuses the ones it can see in the YAML:

- a secret named `env` on a connection without a prefix. Only the exact name `ENV` is
  reserved: with `prefix: PAY` it becomes `PAY_ENV`, which is allowed;
- two vaults connected to one workload giving the same variable;
- a vault secret with the name of one of that workload's YAML variables
  (`workload.backend_env_variables`, `services[].env_vars`, a task's
  `environment_variables`);
- a vault secret with the name of a variable meroku sets for that workload
  (`DATA_BUCKET_*`, `EVENT_QUEUE_URL`, `VALKEY_*`, the backend's `AWS_S3_BUCKET`).

The plan-time `modules/env_secret_check` remains for the rest: a variable only the owning
module sets (`AWS_REGION`, `PG_DATABASE_HOST` and the rest), and a parameter under the
workload's own path with the name of a variable or of a vault secret (its message names
both parameters). On a plan that adds or removes a service, the own-path check moves from
plan to apply for every service: add the service and connect the vault in separate
applies. On a 6.0.x copy every vault name collision is refused at plan.

## Moving from copied parameters

A project that copied the same parameter into several workloads' own paths moves to a
vault in one change:

1. Add the vault, its secret names and the connections to the YAML; the user sets the
   values in the Vaults tab.
2. The copies under each workload's own path are deleted.
3. Apply, and deploy the connected workloads right after.

Between step 2 and that deploy, a new task of the old revision cannot start. Run steps 2
and 3 together. Step 1 without step 2 is refused at plan: the same name would come from
the workload's own path and from the vault. If the copies must stay a little longer,
connect the vault with a prefix so the names differ.
