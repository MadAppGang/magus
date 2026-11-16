---
name: extend
description: Decides where new AWS infrastructure goes in a meroku project and writes any custom Terraform with its README. Use when adding a queue, bucket, Cognito pool, KMS signing key, SMS setting or other AWS resource.
user-invocable: false
---

# Adding infrastructure to a meroku project

Put a new AWS resource where the next meroku run keeps it, without a second copy of
anything meroku already creates. Success: the user's plan adds the new resources and
replaces nothing meroku owns, and every custom folder says why it exists.

Written against meroku 6.2.0 (plus 6.4.0's event-consumer grants). When this text disagrees with the project, the project wins:
its `infrastructure/env/main.hbs` is what renders, and `infrastructure/version.txt` names
the copy's version. For the pipeline itself, read `../meroku/SKILL.md`.

## The rules

They hold for the whole task.

- **Ask before any write.** Show the files you will create and their README, and wait for
  a yes.
- **Never edit `env/<env>/`** (generated on every run) **or `infrastructure/`** (replaced
  on `meroku update`).
- **Never a copy of a meroku module.** No copied module folder, no second
  `module "x" { source = ".../infrastructure/modules/<m>" }` for something meroku already
  creates, no hand-written duplicate of a resource meroku makes.
- **Apps never create infrastructure at boot.** No bus, queue or bucket made by app code:
  the next meroku run neither knows about it nor cleans it up.
- **`policy` is only for resources outside meroku.** The env YAML describes the system,
  so it never carries an ARN, an account id or a generated AWS resource name. Never a
  `policy` statement for a resource meroku creates (its queues, DLQs, buses, buckets,
  vaults, KMS keys, Valkey). A consumer already receives from its own queue, and from
  6.4.0 sends to its own queue and application DLQ. Another workload is reached by
  `events.produces` and its subscription, never by `sqs:SendMessage` on its queue. A
  permission meroku does not grant on its own resource is a meroku gap: report it for
  github.com/MadAppGang/meroku, write no `policy`. The wrong and right example is in
  `../yaml/SKILL.md`, "The YAML describes the system, not AWS".
- **Every custom folder has a `README.md`** with the four answers below, written in the
  same change as the code. Nothing without one merges.
- **No AWS writes from here either**: inspecting what exists uses the read-only allowlist
  (rule 5 of `../troubleshoot/SKILL.md`), on every route, including `aws-core`'s MCP tools.

## Decide, in this order

1. **Name the resource and who uses it**: which service, and every env or one.
2. **meroku's default first.**
   - Read `references/defaults.md`. Then read the block in the project's
     `infrastructure/env/main.hbs` that would create the resource, and
     `infrastructure/version.txt`.
   - **Shipped in this copy:** the change is in the env YAML. `references/defaults.md`
     gives the key and an example; the block in `main.hbs` is the authority. Read
     `../yaml/SKILL.md` and follow it. Stop here.
   - **In meroku 6.0.0 but not in this copy** (`version.txt` older than `v6.0.0`, and the
     sign from `references/defaults.md` absent in `main.hbs`): say meroku 6.0.0 has it,
     name the YAML key, and say the upgrade brings it: `brew upgrade meroku`, then
     `meroku update`. Name the 6.0.0 breaking changes that apply to this project before
     recommending it (`references/defaults.md`). Offer two paths: upgrade, or a stop-gap
     in `custom/` whose README's "When this can be deleted" says "after `meroku update` to
     6.0.0 or later, replaced by `<key>`". A shipped section that covers part of the need
     is offered too.
   - **Vaults on a 6.0.x copy** (`version.txt` is `v6.0.0` to `v6.0.3`): the copy has
     vaults, in the 6.0.0 shape. A vault has no `secrets` key there. Write it that way,
     and name the 6.1.0 breaking change (`references/defaults.md`) before recommending the
     update. On a copy that is `v6.1.0` or later every vault needs its `secrets` list.
   - **KMS signing keys on a copy older than 6.2.0** (`version.txt` older than `v6.2.0`):
     the copy has no `kms_keys`. Say meroku 6.2.0 has it, name the key, and name the 6.2.0
     note in `references/defaults.md` before recommending the update. Never write
     `kms_keys` there.
   - **Not in any meroku release** in `references/defaults.md`: it is not meroku's
     default; go to step 3.
   - **Never write a YAML key the project's `main.hbs` does not read.** It renders
     nothing, and the user believes the resource exists.
3. **Close but missing something: Terraform next to meroku.** Pick one of the three places
   below. Ask the user one multiple-choice question: the three places as options, the one
   you recommend first and marked "(Recommended)", one line each on why. Read
   `references/places.md` before writing a `custom/pre` or `custom/post` hook, or a
   `custom/terraform` file that references a meroku module.
4. **A meroku pull request is last.** Propose one only when both answers are yes: would
   the next new project turn it on, and would we want it in the projects already running?
   The one case custom code cannot handle is a setting on a resource meroku creates. The
   new option defaults to what is deployed today, so running projects see no change. Ask
   for the user's meroku checkout path; never edit `infrastructure/` as the pull request.
5. **Write, after the yes:** the `.tf` files and the folder's `README.md` together. A
   folder that already exists gets its README updated, not a second one. Take resource
   arguments from the provider's docs through the `terraform` plugin, not from memory. AWS
   service behaviour (quotas, confirmations, account-wide settings) comes from `aws-core`'s
   skills. Either missing: see `../meroku/references/official-plugins.md`. With
   `terraform` missing, write the arguments you know and mark them in your reply as not
   checked against the provider docs. Never run `terraform init`, or any command off the
   read-only allowlist, to fetch a provider schema.
6. **Hand back.** The user runs `meroku generate <env>`, then a plan. The proof: the plan
   adds the custom resources and replaces nothing meroku owns.

## The three places

`env/<env>/main.tf` is generated; these are the places meroku keeps your code.

| Place | What it is | Pick it when | Examples |
|---|---|---|---|
| `custom/terraform/<env>/`, or `custom/terraform/_shared/` for every env | plain `.tf` files appended to `main.tf`; they read any meroku module directly (`module.cognito.user_pool_id`). The most common place | a few resources that sit beside meroku's | SNS SMS account settings; a CodeArtifact repository; an extra app client on meroku's Cognito pool |
| `custom/pre/` | a module meroku reads, for every env. Today meroku reads only its `backend_env_vars` output, added to the backend container's environment | meroku's own resources need a value you create | a value created here that the backend must see as an env var |
| `custom/post/` | a module that receives meroku's outputs, for every env. Its `variables.tf` declares every input, or the plan fails | the code is big enough to be its own module | an SNS subscription that calls the API; a CloudWatch alarm on the cluster; a DNS record in the env zone |

A request can span places (a pre output plus a custom file): one README per folder.

## README.md for every custom folder

One in `custom/pre/`, one in `custom/post/`, one in each `custom/terraform/<env>/` and
`custom/terraform/_shared/` that holds a file. Copy this and fill every section:

```markdown
# <folder>: <one line naming what it adds>

## What this adds
<the resources, and which env or every env>

## Why meroku's default cannot do it
<the meroku feature checked and what it lacks, or "in meroku 6.0.0 as <key>; this copy is <version>">

## Why this is not a meroku pull request
<which question is no: the next new project would not turn it on, or the running projects would not want it>

## When this can be deleted
<the condition: the `meroku update` that brings the feature (name the release and the key), or the feature it serves going away>
```

## Examples

| Request | Place | Why |
|---|---|---|
| "an SQS queue for the ai service" | `events.subscribes` on the `ai` service in the env YAML: its own queue, two DLQs and `EVENT_QUEUE_URL` (and `EVENT_DLQ_URL` from 6.4.0). A publisher needs `events.produces` | meroku 6.0.0's default; the shared `sqs` section only when one queue for every workload fits; a custom queue only on a pre-6.0.0 copy, with a README naming the update; never a queue the app creates at boot |
| "a private bucket for a service" | nothing to add: its data bucket folder `<name>/` exists (`DATA_BUCKET_*`); `data_bucket.shared` to share one | meroku 6.0.0's default |
| "IAM permissions for a service" | `services[].policy`, for resources outside meroku only | meroku 6.0.0's default, on the service's task role; meroku's own resources are granted by their YAML keys |
| "let the worker send to its queue" / "send to the orders queue" | nothing for its own queue and application DLQ on 6.4.0 or later (`meroku update` on an older copy); `events.produces` for another workload's queue | meroku grants it; a `policy` with a queue ARN is a hand-written duplicate of meroku's grant |
| "a Redis or Valkey cache" | `valkey` | meroku 6.0.0's default |
| "one API key for three services" | top-level `vaults[]` with the key's name in `secrets`, and `vaults` on each of the three; the user sets the value in the web UI's Vaults tab | meroku's default since 6.0.0, in the 6.1.0 shape; never a copy of the parameter under each workload's own path, never a custom SSM parameter |
| "a signing key for the api" / "let the api sign JWTs with KMS" | top-level `kms_keys` with the key, and `kms_keys: [{ name, access: sign }]` on the api (`verify` or `both` for the workloads that check); the api gets `KMS_<NAME>_KEY_ARN` and `KMS_<NAME>_PUBLIC_KEY` | meroku's default since 6.2.0; never a custom `aws_kms_key`, `policy` statement for `kms:Sign`, or a key the app creates |
| "SMS account settings" | `custom/terraform/<env>/`, `aws_sns_sms_preferences` | account-wide setting meroku has no section for |
| "a second Cognito pool for the admin dashboard" | first a `cognito` key in the YAML when `main.hbs` reads one for it (a dashboard client); else `custom/terraform/<env>/`: an app client on `module.cognito.user_pool_id` | meroku already creates the pool; a meroku pull request only for a pool setting every project needs |
| "notify the API from SNS" | `custom/post/` | `api_endpoint` is one of its inputs |

## Failure modes

- Copying a meroku module "to change one setting". A setting on a resource meroku creates
  is step 4, a meroku pull request.
- Writing a YAML key for a feature this copy does not have.
- A custom queue, bucket, IAM grant or SSM path on a 6.0.0 copy for a need its YAML
  covers (events, data bucket, policy, vaults, valkey, signing keys (6.2.0)).
- A `policy` statement on a queue, DLQ, bus, bucket, vault, KMS key or Valkey that meroku
  creates, or any ARN or account id in the env YAML.
- On a 6.1.0 copy, a vault without `secrets` (generate refuses it), or `secrets: []` on a
  vault whose parameters are in use (the next apply drops every vault secret from every
  connected task definition).
- A custom `.tf` declaring `module "events"`, `"data_bucket"`, `"vaults"`, `"valkey"`,
  `"kms_keys"` (6.2.0) or the locals `workload_roles`, `workload_extra_env`, `workload_extra_secrets`: generate
  refuses it.
- Adding a consumer without a producer: a queue fed by EventBridge gets nothing until a
  workload has `events.produces` for that detail type.
- App code creating its queue or bucket at boot.
- A custom folder without a `README.md`.
- A post hook whose `variables.tf` misses an input, or declares a conditional one without
  `default = null`.
- Relying on a pre-hook output other than `backend_env_vars`: meroku reads no other.
- Referencing `module.<name>` for a section the YAML has turned off: that module does not
  exist, and the plan fails.
- Proposing a meroku pull request before steps 2 and 3.

## Where the depth is

- Read `references/defaults.md` at step 2, every time: what meroku creates, what is
  shipped, from which release, and how to tell from the project's `main.hbs`.
- Read `references/places.md` at step 3, before writing `custom/pre` or `custom/post`, or
  a `custom/terraform` file that references a meroku module: exact hook inputs and
  outputs, and an example per place.
- Read `../yaml/SKILL.md` when the answer is a YAML change.
- Read `../meroku/SKILL.md` when you need the pipeline, the commands or the layout.
- Read `../meroku/references/official-plugins.md` the first time you would inspect AWS or
  look up a Terraform provider argument: the `aws-core` and `terraform` plugins, how to
  tell whether each is installed, its install command, and how the read-only rules apply
  to their MCP tools.
