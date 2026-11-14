# What meroku creates, and how to tell what this project has

A map, not the truth. The truth is the project's own copy: what its
`infrastructure/env/main.hbs` reads and its `infrastructure/modules/` create. This file is
current as of meroku 6.1.0; read the template before relying on any row.

## How to tell what this project's meroku has

| Question | Where to look |
|---|---|
| Which meroku templates this project renders | `infrastructure/version.txt` (the copy). `meroku --version` names the binary, which is read-only and safe to run |
| Whether this copy has meroku 6.0.0's features | `infrastructure/version.txt` is `v6.0.0` or later, and `main.hbs` has `module "events" {`. The other signs are in "On a copy older than 6.0.0" below |
| Whether this copy has meroku 6.1.0's vaults | `infrastructure/version.txt` is `v6.1.0` or later. `main.hbs` has `module "vaults" {` from 6.0.0 on, so that sign does not tell the two apart. In the YAML, a 6.0.x vault has no `secrets` key |
| Whether a feature exists in this copy | the block in `infrastructure/env/main.hbs` that reads its key. No block reading the key: the copy does not have it |
| What a module creates and accepts | `infrastructure/modules/<module>/main.tf` and `variables.tf` |
| Whether a module exists in this env | most sit under an `{{#if <section>.enabled}}` wrapper in `main.hbs`, and need that section in the env YAML. In 6.0.0, `data_bucket`, `vaults` and `events` render in every env; `valkey` renders under `{{#if _valkey}}` |

A symlinked `infrastructure/` points at a meroku checkout: read it the same way. A copy
that carries `infrastructure/ai_docs/` has one file per 6.0.0 feature (`EVENTS.md`,
`DATA_BUCKET.md`, `WORKLOAD_IAM.md`, `VAULTS.md`, `VALKEY.md`, `amplify.md`): read the one
you need.

## Shipped: the change is in the env YAML

| Need | YAML section | Note |
|---|---|---|
| A long-running container | `services[]` | per-service image, port, size, `network_access` |
| A job on a schedule | `scheduled_tasks[]` | `schedule` is `rate(...)` or `cron(...)`, UTC |
| A job started by an EventBridge pattern | `event_processor_tasks[]` | `rules[]` hold the patterns |
| IAM permissions for the backend | `workload.policy` | statements added to the backend task's role. Before 6.0.0 no other workload had `policy`; in 6.0.0 every one has, see below |
| An SNS topic or SQS queue for the backend | `extensions.sns_topics`, `extensions.sqs_queues` | reach the backend's env only (`add_to_backend_env`), not other services. `sns:Publish` is granted for `add_to_backend_env` topics |
| A shared queue with an access policy | `sqs` | one queue; services and tasks get its access policy |
| A user pool and its app clients | `cognito` | `module.cognito` exists only while `cognito.enabled` is true |
| Frontend hosting | `amplify_apps` | per app, its branches and their env vars |
| Extra S3 buckets | `buckets[]` | |
| Email sending | `ses` | |
| A load balancer in front of services | `alb` | |

### Shipped in 6.0.0: present only when this copy is 6.0.0 or later

Check the sign in `main.hbs` before using any row.

| Need | YAML | What the workload gets | Sign in `main.hbs` |
|---|---|---|---|
| A queue for one service or the backend, fed by events | `events.subscribes` on `workload` or `services[]`; optional `events.queue` | its own queue `<project>-events-<name>-<env>`, an application DLQ, a delivery DLQ, a rule per subscription, a DLQ alarm; `EVENT_QUEUE_URL` | `module "events" {` with `consumers =` |
| Publishing events | `events.produces` on `workload`, `services[]`, `scheduled_tasks[]`, `event_processor_tasks[]` | `events:PutEvents` for what it declares, nothing else; `EVENT_SOURCE` | same block |
| A project event bus | `event_bus: { enabled: true }` (optional) | the bus `<project>-<env>`; `EVENT_BUS_NAME` names it | `bus_enabled =` in `module "events"` |
| Private storage per workload | nothing: the bucket always exists. `data_bucket.shared` to share a folder | `DATA_BUCKET_NAME`, `DATA_BUCKET_PATH` (`<name>/`), `DATA_BUCKET_SHARED_<NAME>` per shared folder; non-backend workloads also get `AWS_S3_BUCKET` | `module "data_bucket" {` |
| IAM for any workload | `policy` on `workload`, `services[]`, `scheduled_tasks[]`, `event_processor_tasks[]` | one managed policy on the task role; `effect` and `conditions` supported | `service_policies = {`; `custom_policy =` in the task modules |
| Secrets shared by several workloads | top-level `vaults[]` (`name`; in 6.1.0 also `secrets`), and `vaults` on each workload | 6.1.0: each name the vault's `secrets` list declares, from `/<env>/<project>/vault/<name>/<secret>`, as a container secret. 6.0.x: no `secrets` key, and the names came from SSM | `module "vaults" {`; `version.txt` tells 6.0.x from 6.1.0 |
| A Redis-compatible cache | `valkey` | `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_URL` (`rediss://`) for workloads in `access` | `module "valkey" {` under `{{#if _valkey}}` |
| Amplify rewrites, e.g. `/api/*` to the backend | `amplify_apps[].custom_rules` | rules applied before the single-page-app rule; app-level `environment_variables` now render | `custom_rules = [` inside `module "amplify"` |

Examples, one per row:

```yaml
services:
  - name: ai
    events:
      subscribes:
        - { detail_type: ai.job.requested }       # bus absent: the project bus when on, else default
      queue: { visibility_timeout: 30, max_receive_count: 5 }
  - name: api
    events:
      produces:
        - { detail_types: [ai.job.requested] }    # own_source_only: true by default
    policy:
      - actions: ["dynamodb:GetItem"]
        resources: ["arn:aws:dynamodb:us-east-1:000000000000:table/example"]
    vaults:
      - { name: payments, access: read_write, prefix: PAY }   # database_url → PAY_DATABASE_URL

event_bus: { enabled: true }        # optional; subscribes works without it

data_bucket:
  shared:                           # → shared/uploads/
    - { name: uploads, read_write: [api, backend], read: [reports] }

vaults:
  - name: payments
    secrets: [database_url]         # 6.1.0: required, names only; a 6.0.x copy has no secrets key

valkey:
  enabled: true
  engine_version: "8"               # "7" | "8" | "9"
  max_storage_gb: 1                 # a ceiling, never a minimum
  access: [api]

amplify_apps:
  - name: web
    custom_rules:
      - { source: "/api/<*>", workload: backend }
      - { source: "/old-pricing", target: "/pricing", status: "301" }
```

Things to know before writing them:

- **A consumer needs a producer.** The queue receives EventBridge events only. Nothing
  arrives until some workload has `events.produces` for that detail type (or AWS sends
  to the default bus). Say so when you add a subscription.
- A subscription takes exactly one of `detail_type` or `detail_type_prefix`, and optional
  `source`, `name` and `bus` (`project` or `default`). `subscribes` and `queue` are for the
  backend and services only.
- A `policy` statement needs non-empty `actions` and `resources`; `effect` defaults to
  `Allow`.
- Vault values are never in the YAML. On a 6.1.0 copy the vault's `secrets` list declares
  the names (`^[a-z][a-z0-9_]{0,62}$`, listed once; `[]` allowed), and only declared names
  reach a workload. The user sets each value in the web UI's Vaults tab. A declared secret
  with no value is a plan warning, and a new task of a connected workload cannot start
  until it is set. Read `../../yaml/references/vaults.md` before writing a vault.
- An Amplify rule sets exactly one of `target` or `workload`. A `backend` rule whose path
  starts with `/<s>` for a public service `s` is refused.
- Valkey costs about $6 a month idle, and needs a cluster-aware TLS client.
- Ordered (FIFO) events are not offered: those are custom Terraform.

Read `../../yaml/SKILL.md` before changing any of these.

## On a copy older than 6.0.0

The project's `main.hbs` wins. When `infrastructure/version.txt` is older than
`v6.0.0`, look for the sign; absent means this copy does not have the feature.

| Feature | Sign in `main.hbs` (absent: not in this copy) |
|---|---|
| events | `module "events" {` with `consumers =` and `bus_enabled =` |
| data bucket | `module "data_bucket" {` |
| vaults | `module "vaults" {` |
| valkey | `module "valkey" {` under `{{#if _valkey}}` |
| `policy` on services and tasks | `service_policies = {`; `custom_policy =` in `schedule_task_` and `event_bus_task_` |
| Amplify rewrites | `custom_rules = [` inside `module "amplify"` |
| all of them | the `workload_extra_env` local; `version.txt` `v6.0.0` or later |

`event_bus_task_<name>` is the older event task module, not the 6.0.0 bus.

When the sign is absent:

- Say meroku 6.0.0 has the feature, and name its YAML key.
- The path is `brew upgrade meroku`, then `meroku update` in the project. Both move
  together: generate refuses a binary newer than `infrastructure/`.
- Name the breaking changes below that apply to this project before recommending it.
- Offer a stop-gap in `custom/` too. Its README's "When this can be deleted" says: after
  `meroku update` to 6.0.0 or later, replaced by `<key>`.
- **Never write the 6.0.0 key into the YAML of an older copy.** It renders nothing, and the
  user believes the resource exists. A key the project's `main.hbs` does not read is not a
  feature of this copy.

## Before recommending the update to 6.0.0

Three breaking changes. Check each against the project and say what it needs.

1. **PutEvents is strict.** A workload can publish only what its `events.produces`
   declares; anything else is `AccessDenied`. There is no migration. Search the app code
   for `PutEvents` or `putEvents`, and add `events.produces` to every workload that
   publishes, before the upgrade.
2. **Task roles lose `CloudWatchFullAccess`** (which also granted `events:*`, `sns:*` and
   `logs:*`). They keep `cloudwatch:PutMetricData` and writes to their own log group. App
   code that reads logs or alarms, writes another log group, or publishes to an SNS topic
   meroku does not manage needs a `policy` block. The first apply may give a few seconds
   of `AccessDenied` on `PutLogEvents` or `PutMetricData`; stdout logs are unaffected.
3. **Turning `event_bus.enabled` on replaces event-task rules** and every subscription
   without `bus`, and moves `EVENT_BUS_NAME` to `<project>-<env>`. Set `bus: default` on an
   entry to keep it where it is.

The upgrade itself replaces nothing. Every workload gets one new task-definition revision,
and `terraform init` is needed for the new modules.

## Before recommending the update to 6.1.0

One breaking change, and only for a project whose YAML has vaults. A copy older than
6.0.0 has none, so for it this adds nothing to the three changes above.

**Every vault needs a `secrets` list.** `meroku generate` refuses a vault without one,
which is every vault meroku 6.0.0 wrote. No migration writes the list, because only SSM
knows the names. After the update the user opens the web UI's Vaults tab and uses
**Import names from AWS** on each vault, then generates and applies. Each connected
workload gets one new task-definition revision (`valueFrom` is now the parameter's ARN);
nothing is replaced.

- A parameter name with upper case, hyphens or dots cannot be imported as it is. List the
  names before recommending the update (`aws ssm describe-parameters`, read-only) and say
  which need a new lower-case name.
- Never write `secrets: []` on a vault whose parameters are in use: the next apply would
  drop every vault secret from every connected task definition.

## What `meroku generate` refuses in 6.0.0

Avoid these when writing YAML or custom `.tf`:

- a workload named `backend`, `vault`, `task` or `shared`; two workloads of any kind with
  the same name;
- `AWS_S3_BUCKET` in `workload.backend_env_variables` (on a service or task it is kept,
  with a warning);
- a YAML env var `DATA_BUCKET_NAME`, `DATA_BUCKET_PATH` or `DATA_BUCKET_SHARED_*`;
  `EVENT_QUEUE_URL` on an event consumer; `VALKEY_*` on a workload in `valkey.access`;
- two event tasks whose rules share a name on one bus;
- an `extensions.sns_topics` entry named `alerts` in an env with event consumers;
- a custom `.tf` declaring `module "data_bucket"`, `"vaults"`, `"events"` or `"valkey"`,
  or a local `workload_roles`, `workload_extra_env` or `workload_extra_secrets`;
- a `policy` statement with empty `actions` or `resources`;
- an Amplify `backend` rule shadowed by a public service's path.

In 6.1.0 it also refuses:

- a vault without a `secrets` key (`[]` is allowed), a secret name that does not match
  `^[a-z][a-z0-9_]{0,62}$`, or a name listed twice;
- a vault secret named `env` on a connection without a prefix;
- two vaults giving one workload the same variable;
- a vault secret with the name of one of that workload's YAML variables, or of a variable
  meroku sets for it (`DATA_BUCKET_*`, `EVENT_QUEUE_URL`, `VALKEY_*`, the backend's
  `AWS_S3_BUCKET`).

The other vault name collisions are still refused at plan, in `modules/env_secret_check`:
a variable only a module sets, and a parameter under the workload's own path with the
name of a variable or of a vault secret. On a 6.0.x copy every vault name collision is
refused at plan.

## Not a meroku resource

Passflow is an external auth service. Authentication for a new app goes there, not into a
new Cognito pool. meroku's `cognito` section exists for projects that use it; an extra
client on that pool is custom Terraform, not a second pool.

## Apps never create infrastructure at boot

App code that creates its own bus, queue or bucket on start-up looks convenient and costs
three things: the next meroku run neither knows about it nor removes it on destroy, its
name drifts from meroku's per-env naming, and its permissions have to be wide enough to
create resources. The resource belongs in the YAML, or in `custom/` with a README. The app
reads its name or URL from its environment. A 6.0.0 consumer reads `EVENT_QUEUE_URL`;
never set it in the YAML (generate refuses it).
