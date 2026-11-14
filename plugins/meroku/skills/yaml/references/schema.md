# Env YAML field guide, by section

A map of the important keys, not the full schema. Written against meroku 6.0.0, schema
v32. For any key not here, or any doubt about a default, read the project's own files:

| Question | Where to look in the project |
|---|---|
| What does this key render to, and what is its default? | `infrastructure/env/main.hbs`: search for the key |
| What values does Terraform accept? | `infrastructure/modules/<module>/variables.tf` (`validation` blocks) |
| The full field list and design notes | `infrastructure/ai_docs/YAML_SPECIFICATION.md` and the other `infrastructure/ai_docs/*.md`, when the copy carries them |
| What other environments do | the sibling env YAMLs in the same directory |

`meroku generate <env>` checks several sections before it renders anything (VPC range,
ALB certificate, egress strategy, AppSync auth, SES DNS values, service network access,
backend health check, compute pools; in 6.0.0 also workload names (unique, not
`backend`, `vault`, `task` or `shared`), reserved env var names, events, vaults, valkey,
Amplify rules and policy statements). A refusal there names the key; that is the
cheapest place to find a mistake.

Turning a section or an item off removes what it built. `postgres.enabled: false`
drops the database module; `services[].enabled: false` (and the same on scheduled and
event tasks) filters the item out before rendering, so its resources are destroyed, not
paused. Treat `enabled: false` on a deployed item as a destroy.

## Core (top level)

| Key | What it is |
|---|---|
| `schema_version` | Set by migrations. Never edit by hand; see `migrations.md` |
| `project`, `env` | Feed every resource name. Renaming either renames everything: see `dangerous-fields.md` |
| `is_prod`, `auto_deploy` | Environment policy as flags (v31). `auto_deploy` is the default for the backend, services and scheduled tasks; each can override it |
| `region` | Pinned into the provider and the S3 backend. Changing it relocates the stack |
| `account_id`, `aws_profile` | Which AWS account and local profile meroku uses. meroku exports this profile before Terraform runs; use it for your own read-only commands |
| `state_bucket`, `state_file`, `state_lock_table` | The S3 backend. Changing them points Terraform at another state |

## Network

| Key | What it is |
|---|---|
| `use_default_vpc` | `true` uses the account's default VPC; `false` builds a custom VPC |
| `vpc_cidr` | The custom VPC's range. Unset renders the module default `10.0.0.0/16`. Never change on a deployed env |
| `allow_vpc_cidr_override` | Turns the range rule checks off for an env deployed before the rules existed |
| `egress_strategy` | `public_ip` (default), `nat_gateway`, `nat_gateway_ha`. A NAT strategy on the default VPC is refused |

Range rules and commands: `dangerous-fields.md`, and `meroku vpc-cidr check <env>`.

## Container registry

`ecr_strategy` (`local` or `cross_account`), `ecr_account_id`, `ecr_account_region`,
`ecr_trusted_accounts[]` (in the source env), `ecr_image_events`. A cross-account setup
touches two YAMLs: the source lists the target in `ecr_trusted_accounts`, the target
points at the source. Apply the receiving environment first.

## `workload` (the backend service)

Image and process: `backend_external_docker_image`, `backend_container_command` (a
list since v29), `backend_image_port`, `backend_health_endpoint`.
Size and scaling: `backend_cpu`, `backend_memory` (must be a valid Fargate pair),
`backend_desired_count`, `backend_autoscaling_*`, `backend_runtime`
(`fargate`/`ec2`), `backend_compute_pool`.
Environment: `backend_env_variables`, `env_files_s3`.
Deploy and health: `backend_auto_deploy`, `backend_health_check`,
`backend_circuit_breaker` (both optional; see `dangerous-fields.md`).
CI: `enable_github_oidc`, `github_oidc_subjects`, `github_oidc_create_provider`,
`github_push_external_image`.
Storage: `bucket_postfix` (part of the bucket name), `bucket_public`.
IAM: `policy`, a list of statements (`actions`, `resources`, optional `effect` and
`conditions`) on the backend task role. Before 6.0.0 a `Deny` or a condition deployed as
an unconditional Allow.
In 6.0.0: `events` (`subscribes`, `queue`, `produces`) and `vaults`, as for services below.

## `services[]`, `scheduled_tasks[]`, `event_processor_tasks[]`

Each item has a `name` (part of every resource name), `enabled`, `auto_deploy`, an
image or `ecr_config`, a command (a list), size, and environment. Services also carry
`container_port` (`host_port` is forced to match), `network_access` (`public` default,
`internal`, `full_open`, `none`), `health_check_command`, `runtime`, `compute_pool`.
Event tasks carry `rules[]` (EventBridge patterns); scheduled tasks carry `schedule`
(`rate(...)` or `cron(...)`, UTC).

In 6.0.0 every item also takes `policy` (statements on its task role) and `vaults`
(`name`, `access` `read` or `read_write`, `prefix`). Services take `events` with
`subscribes`, `queue` and `produces`; both task kinds take `events.produces` only
(`subscribes` or `queue` on a task is refused). Event-task `rules[]` take `bus`
(`project` or `default`).

Deleting `network_access` from a service is a change: the absent key renders `public`,
while v30 wrote `full_open` onto every service that existed before it.

## `domain`

`enabled`, `domain_name` (always the root domain, in every env), `create_domain_zone`,
`zone_id`, `root_zone_id`, `delegation_role_arn`, `api_domain_prefix`,
`add_env_domain_prefix` (off for prod), `additional_domains[]`. Who created a zone
decides how SES records are managed; read `dangerous-fields.md` before changing any of
these. Delegation is set up by `meroku dns setup`; `meroku dns status` reads it.

## `postgres`

`enabled`, `dbname`, `username`, `engine_version`, `public_access`, `aurora` (Serverless
v2 when true), `min_capacity`/`max_capacity` (Aurora; `0` is valid, read through
`exists`), `instance_class`, `allocated_storage`, `storage_type` (RDS, through
`default`), and the booleans written explicitly by v12: `multi_az`, `storage_encrypted`,
`deletion_protection`, `skip_final_snapshot`, `iam_database_authentication_enabled`.

## `ses`

`enabled`, `test_emails` (account level since v18), and `domains[]` (v17): per domain
`domain`, `zone_id`, `spf_record`, `spf_ttl`, `apex_txt_values`, `txt_records[]`,
`dmarc_policy`, `dmarc_rua_email`, `enable_mail_from`, `mail_from_subdomain`. The older
single `ses.domain_name` form still renders. Ownership rules: `dangerous-fields.md`.

## Other sections

`cognito` (pool, clients, `dashboard_callback_urls`), `sqs`, `alb` (`enabled`,
`idle_timeout`), `pubsub_appsync` (`auth_mode` `cognito`/`oidc`/`lambda`;
`api_key_enabled` bypasses the auth mode for whoever holds the key), `buckets[]`,
`amplify_apps`, `cloudfront_distributions[]`, `compute` (EC2 capacity pools),
`extensions` (`sns_topics`, `sqs_queues`), `manage_dns_records`. Read their block in
`main.hbs` before changing them.

New in 6.0.0, all optional (absent means off). Details in
`infrastructure/ai_docs/<FEATURE>.md` when the copy carries them:

- `event_bus` (`enabled`): the project bus `<project>-<env>` (`EVENTS.md`).
- `data_bucket` (`shared[]`: `name`, `read_write`, `read`): shared folders in the env's
  private bucket, which exists either way (`DATA_BUCKET.md`).
- `vaults[]` (`name`): SSM paths shared by the workloads that connect to them
  (`VAULTS.md`).
- `valkey` (`enabled`, `engine_version`, `max_storage_gb`, `access`): a serverless cache
  (`VALKEY.md`).
- `amplify_apps[].custom_rules` (`source`, then `target` and `status`, or `workload` and
  `path`): rewrites and redirects (`amplify.md`).

## Outside the YAML

Terraform that the YAML cannot express goes in `custom/terraform/_shared/*.tf` (every
env) or `custom/terraform/<env>/*.tf`, which meroku appends to the generated `main.tf`.
`env/<env>/_bridge.tf` exposes the module outputs to that code as `local.bridge`.

Before writing any of it, read `../../extend/SKILL.md`: it checks meroku's default first,
picks between `custom/terraform/`, the `custom/pre/` hook and the `custom/post/` hook, and
writes the `README.md` every custom folder needs.
