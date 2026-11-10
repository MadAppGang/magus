# How meroku names AWS resources

Written against meroku 5.1. The project's own copy is the authority:
`infrastructure/modules/naming/` (the rule), and each module's `naming.tf` (which names
go through it, with what limit).

## The base pattern

Names are `project`, a decoration, the item's name, and `env`, in that order, with `_`
for most resources (ECS, IAM, ECR, log groups) and `-` where AWS or convention needs it
(S3, target groups, schedule groups). Examples for project `myapp`, env `dev`:

| Resource | Pattern |
|---|---|
| backend ECS service | `myapp_service_dev` |
| backend task role | `myapp_backend_task_dev` |
| backend bucket | `myapp-backend-dev<bucket_postfix>` |
| named service | `myapp_service_api_dev` |
| service target group | `myapp-service-api-tg-dev` |
| scheduled task definition | `myapp_task_cleanup_dev` |
| ECR repositories | `myapp_backend`, `myapp_service_api`, `myapp_task_cleanup` (no env) |

## Length caps

AWS caps names per resource type: **32** for an ALB or target group, **40** App Runner,
**63** S3 bucket and RDS identifier, **64** IAM role, Lambda, EventBridge rule and
scheduler, **80** SQS queue, **128** IAM policy. Names capped at 128 or more (IAM
policies, security groups, log groups, task definitions, SSM parameters) stay as plain
templates; only caps up to 80 go through the cascade.

## The cascade: first form that fits wins

| # | Form | Example |
|---|---|---|
| 1 | the legacy name, verbatim | `myapp-service-api-tg-dev` |
| 2 | `project` + identity + `env`, decoration dropped | `myapp-orders-sync-dev` |
| 3 | identity + 8 hex characters of md5 over project, env and identity | `payments-4f2a9c1e` |

- **Form 1 protects what is deployed.** Any name that fits today comes back byte for
  byte, so no plan renames it.
- Form 2 drops words like `service`, `tg` and `task`, which identify nothing.
- Form 3 is reached only when project and env cannot fit beside the identity. The
  identity is kept, truncated if it must be; the digest keeps it unique across envs that
  share an account.
- A required suffix (`.fifo`, the bucket postfix) is counted against the limit and never
  cut.
- A brand-new resource type has no legacy form and starts at form 2.

## What this means in practice

- **Do not guess a deployed name from the pattern.** A long project or service name may
  be on form 2 or 3. Read the real name from state:
  `terraform state show <address>` in `env/<env>/`, with the YAML's profile.
- **Any change to `project`, `env` or an item's name changes the name**, whatever form it
  lands on. That is a destroy and a create; read `../../yaml/references/dangerous-fields.md`.
- A longer name can move a resource from form 1 to form 2 or 3 at the same time it is
  renamed. Say so in the proposal, with the new name.
- Forms can mix within one module, so two requests can land on the same name. The naming
  module reports those in its `collisions` output; AWS would otherwise reject the
  duplicate part-way through an apply, naming neither resource. An apply that fails on a
  duplicate name right after a rename is worth checking against it.

## Two implementations, one rule

- `infrastructure/modules/naming/` builds names for the Terraform modules.
- The meroku binary's `awsName` Handlebars helper builds names inside `main.hbs` (the
  extension SNS topics and SQS queues), before Terraform runs.

The two are tested against the same vectors in meroku. A plan or apply error like
`"name" cannot be longer than 32 characters` means a name bypassed both. That is a
meroku bug (fix (a) in the troubleshooting rules), not something to shorten by hand in
`env/<env>/`. Shortening the item's name in the YAML is a configuration workaround the
user can choose, and it is itself a rename.
