---
name: extend
description: Decides where new AWS infrastructure goes in a meroku project and writes any custom Terraform with its README. Use when adding a queue, bucket, Cognito pool, SMS setting or other AWS resource.
---

# Adding infrastructure to a meroku project

Put a new AWS resource where the next meroku run keeps it, without a second copy of
anything meroku already creates. Success: the user's plan adds the new resources and
replaces nothing meroku owns, and every custom folder says why it exists.

Written against meroku 6.0.0. When this text disagrees with the project, the project wins:
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
- **Every custom folder has a `README.md`** with the four answers below, written in the
  same change as the code. Nothing without one merges.

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
   - **Not in any meroku release** in `references/defaults.md`: it is not meroku's
     default; go to step 3.
   - **Never write a YAML key the project's `main.hbs` does not read.** It renders
     nothing, and the user believes the resource exists.
3. **Close but missing something: Terraform next to meroku.** Pick one of the three places
   below. Ask the user with AskUserQuestion: the three places as options, the one you
   recommend first and marked "(Recommended)", one line each on why. Read
   `references/places.md` before writing a `custom/pre` or `custom/post` hook, or a
   `custom/terraform` file that references a meroku module.
4. **A meroku pull request is last.** Propose one only when both answers are yes: would
   the next new project turn it on, and would we want it in the projects already running?
   The one case custom code cannot handle is a setting on a resource meroku creates. The
   new option defaults to what is deployed today, so running projects see no change. Ask
   for the user's meroku checkout path; never edit `infrastructure/` as the pull request.
5. **Write, after the yes:** the `.tf` files and the folder's `README.md` together. A
   folder that already exists gets its README updated, not a second one.
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
| "an SQS queue for the ai service" | `events.subscribes` on the `ai` service in the env YAML: its own queue, two DLQs and `EVENT_QUEUE_URL`. A publisher needs `events.produces` | meroku 6.0.0's default; the shared `sqs` section only when one queue for every workload fits; a custom queue only on a pre-6.0.0 copy, with a README naming the update; never a queue the app creates at boot |
| "a private bucket for a service" | nothing to add: its data bucket folder `<name>/` exists (`DATA_BUCKET_*`); `data_bucket.shared` to share one | meroku 6.0.0's default |
| "IAM permissions for a service" | `services[].policy` | meroku 6.0.0's default, on the service's task role |
| "a Redis or Valkey cache" | `valkey` | meroku 6.0.0's default |
| "SMS account settings" | `custom/terraform/<env>/`, `aws_sns_sms_preferences` | account-wide setting meroku has no section for |
| "a second Cognito pool for the admin dashboard" | first a `cognito` key in the YAML when `main.hbs` reads one for it (a dashboard client); else `custom/terraform/<env>/`: an app client on `module.cognito.user_pool_id` | meroku already creates the pool; a meroku pull request only for a pool setting every project needs |
| "notify the API from SNS" | `custom/post/` | `api_endpoint` is one of its inputs |

## Failure modes

- Copying a meroku module "to change one setting". A setting on a resource meroku creates
  is step 4, a meroku pull request.
- Writing a YAML key for a feature this copy does not have.
- A custom queue, bucket, IAM grant or SSM path on a 6.0.0 copy for a need its YAML
  covers (events, data bucket, policy, vaults, valkey).
- A custom `.tf` declaring `module "events"`, `"data_bucket"`, `"vaults"`, `"valkey"` or
  the locals `workload_roles`, `workload_extra_env`, `workload_extra_secrets`: generate
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
