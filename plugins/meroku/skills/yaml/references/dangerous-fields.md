# Fields whose change replaces or removes resources

Written against meroku 6.1.0, schema v32. Every one of these is safe on an environment
that has never been deployed. On a deployed one, each needs the replacement answer in
your proposal and a plan read before anyone applies. A plan marks a replacement as
`-/+` or `must be replaced`; meroku's plan viewer shows it as a delete and a create.

Proving it: after the user agrees, `meroku generate <env>` and then, from `env/<env>/`,
`AWS_PROFILE=<profile from the YAML> terraform plan` (no `-out`, so it changes nothing).

## `vpc_cidr` and `use_default_vpc`

A VPC's primary range can never change. **Changing `vpc_cidr` on a deployed environment
replaces the VPC and everything in it**: subnets, security groups, the ALB and its target
groups, the database subnet group, and every ECS service.

- An unset `vpc_cidr` renders the module default `10.0.0.0/16`. Adding the key with any
  other value to an env deployed without it is the same replacement.
- `meroku generate` refuses a range outside the rules: an IPv4 network address in
  10.0.0.0/8 or 192.168.0.0/16, not overlapping 172.16.0.0/12, 169.254.0.0/16 or
  198.19.0.0/16, size /16 to /19. Overlap with a sibling env is only a warning.
- A deployed env whose range breaks the rules keeps it: set
  `allow_vpc_cidr_override: true`. Never "fix" the range itself.
- For a new env, `meroku vpc-cidr suggest <env> --aws` prints a free range and
  `meroku vpc-cidr assign <env> --aws` writes one; `assign` refuses a deployed env
  unless forced. `meroku vpc-cidr check <env> [--aws]` reports without writing.
- Flipping `use_default_vpc` moves every networked resource to another VPC. Treat it as
  the same replacement.

## Resource names: `project`, `env`, every `name`, `bucket_postfix`

Names are built from `project`, `env` and the item's own name (`services[].name`,
`scheduled_tasks[].name`, `event_processor_tasks[].name`, `buckets[].name`, extension
queue and topic names, and in 6.0.0 the event consumer queues and `vaults[].name`), plus
`bucket_postfix` for the backend bucket. Most AWS names cannot be changed in place, so
**a rename is a destroy and a create**:

- a target group that a listener rule references cannot be deleted, so the destroy can
  block part-way;
- the backend bucket and `buckets[]` have no force-destroy, so a bucket holding objects
  fails to delete;
- a renamed database identifier is a new, empty database unless the data is moved first;
- a renamed ECR repository loses its images;
- a renamed event consumer service replaces its three queues; messages in them are lost.

Renaming a deployed item is usually fix (b) of the troubleshooting rules, not a YAML
edit: a planned, agreed one-off step. How names are built and shortened:
`../../meroku/references/naming.md`.

## `region` and the state keys

- `region` is pinned into the provider and the S3 backend. Changing it on a deployed
  env plans the whole stack as a move: destroy here, create there. meroku warns at
  generate when the shell's region disagrees with the YAML.
- `state_bucket`, `state_file` and `state_lock_table` select the Terraform state.
  Pointing them elsewhere makes Terraform see a different deployment, or none, and plan
  to create everything that already exists. `meroku sync <env>` checks the env against
  its state without changing it.

## SES DNS: who owns the zone

Which DNS values meroku manages for an SES domain depends on who created the Route53
zone, decided at generate time:

| The domain's zone comes from | Origin |
|---|---|
| `ses.domains[].zone_id` | existing |
| `domain.additional_domains[]` with `zone_id` | existing |
| `domain.additional_domains[]` with `create_zone: true` | created |
| the main domain outside prod with `domain.root_zone_id` (delegated zone) | created |
| the main domain with `domain.create_domain_zone: true` | created |
| the main domain otherwise | existing |

- **Created zone: the YAML is the whole truth.** Each TXT record set (apex SPF plus
  `apex_txt_values`, `_amazonses`, `_dmarc`, every `txt_records[]` name) is replaced
  whole on apply. A value not in the YAML is removed on the next apply.
- **Existing zone: meroku edits only its own values**, value by value, through a script
  that needs `/bin/sh` and AWS CLI v2 where Terraform runs. Other values stay.
- **The takeover guard.** A domain has one SPF and one DMARC value. In an existing zone,
  plan refuses to replace a foreign one unless the YAML says what to publish: set
  `spf_record` (start from the live value with `include:amazonses.com` added) or
  `dmarc_policy` / `dmarc_rua_email`.
- Removing `spf_record` after meroku published a custom value is refused, because the
  live value now looks foreign. To return to the default, set
  `spf_record: v=spf1 include:amazonses.com ~all`, apply once, then remove the key.
- Removing a domain or disabling SES in an existing zone removes only meroku's values.
  A foreign value meroku replaced is not restored.
- Changing `zone_id`, `create_domain_zone`, `root_zone_id` or an additional domain's
  `create_zone` moves a domain between the two regimes. Name which regime it leaves and
  enters, and read the plan.

## `postgres.aurora` and `postgres.enabled`

`aurora` chooses between two different resources: an RDS instance and an Aurora cluster.
Flipping it destroys one database and creates an empty other one. The Aurora cluster is
built with `skip_final_snapshot = true`, so destroying it keeps no final snapshot. The
RDS instance follows the YAML's `skip_final_snapshot` and `deletion_protection`.
`enabled: false` destroys the database. Any of these on a deployed env needs the user to
confirm the data is backed up or disposable.

## `ecr_strategy`

Switching an environment to `cross_account` deletes its own repositories and the images
in them. The source environment must define the same services and tasks, because the
target pulls `<project>_backend`, `<project>_service_<name>` and `<project>_task_<name>`
from it.

## Backend health check and circuit breaker

`workload.backend_health_check` and `workload.backend_circuit_breaker` are optional;
absent keys render nothing.

- The health check is part of the container definition. Any change registers a new task
  definition revision, which deploys if `backend_auto_deploy` allows. No replacement of
  the service, but a running change.
- The command's tool (`curl`, `wget`, a binary) must exist in the image. If it does not,
  every probe fails and ECS replaces the task in a loop. Never invent a command; check the
  image. A string is run as `CMD-SHELL`; a list is passed as is and must start with `CMD`
  or `CMD-SHELL`. Ranges: `interval` 5-300, `timeout` 2-120, `retries` 1-10,
  `start_period` 0-300.
- **To turn a deployed breaker off, set `enable: false`.** Removing the key changes
  nothing in AWS: the provider hides the removal, and the service keeps its last setting.
- The ALB target group check (`backend_health_endpoint`) is separate; a task must pass
  both.

## Events, vaults, valkey, the data bucket (6.0.0; vaults as of 6.1.0)

| Change on a deployed env | Effect |
|---|---|
| `event_bus.enabled` toggled | event-task rules and subscription rules without `bus` are replaced; every workload gets a new task-definition revision |
| editing an unnamed subscription's `detail_type`, `detail_type_prefix` or `bus` | its derived key changes, so its rule is destroyed and created (the queue stays). Set `name` to pin it |
| renaming a consumer service | its three queues are renamed, that is replaced; messages in them are lost |
| removing `subscribes` from the last consumer | the queues, DLQs, alarms and the alerts topic are destroyed |
| renaming a vault | a new SSM path with no values; the values under the old path stay where they are. The plan warns about each declared secret, and a new task of a connected workload cannot start until the user sets the values in the Vaults tab |
| removing a vault | its secrets leave every connected task definition on the next apply; the values stay in SSM. The web UI removes every workload's connection with it; a connection left in the YAML by hand is refused at generate |
| adding or removing a name in `vaults[].secrets` (6.1.0) | every connected workload gets a new task-definition revision on the next apply. A removed name's value stays in SSM |
| `secrets: []` on a vault whose parameters are in use (6.1.0) | the next apply drops every vault secret from every connected task definition. Never write it to get past a generate refusal |
| deleting a vault secret's value while its name is still applied (6.1.0) | every connected workload's current revision still names it: new tasks fail to start until the value is set again or the removal is applied. Remove the name, apply, then delete the value |
| changing a vault secret's value (6.1.0) | nothing until each connected workload is redeployed; a running task keeps the value it started with |
| deleting a vault parameter on a 6.0.x copy | every connected workload's next task fails to start until the next apply |
| `valkey.enabled: false` | the cache is destroyed; its data is gone |
| `valkey.engine_version` | unknown until plan (an upgrade or a downgrade); read the plan |
| destroying an env | fails while the data bucket holds any object version (`force_destroy` is false) |
| destroying an env with vaults | the vault values stay in SSM: Terraform never deletes them. The user deletes them when the environment is gone for good |

## Not replacements, still changes people notice

- `services[].network_access`: narrowing cuts traffic. Deleting the key renders
  `public`, which narrows a pre-v30 service that the migration pinned to `full_open`.
- `event_bus.enabled: true`: every workload gets a new task-definition revision
  (`EVENT_BUS_NAME`).
- Updating to 6.0.0 replaces nothing, but task roles lose the managed
  `CloudWatchFullAccess`, and every workload gets one new revision.
- Updating from 6.0.x to 6.1.0 replaces nothing. `meroku generate` refuses every vault
  until it has a `secrets` list (`vaults.md`); after that, each workload connected to a
  vault gets one new revision (`valueFrom` is now the parameter's ARN).
- `auto_deploy` and per-target `auto_deploy`: decide whether a push deploys.
- `pubsub_appsync.api_key_enabled: false` deletes a live API key its clients may hold.
