# The three places for custom Terraform

What meroku does with each place, what it passes in, what it reads back, and one example
each. Current as of meroku 6.0.0; the project's `infrastructure/env/main.hbs` (the
`custom_pre` and `custom_post` blocks) is the truth for the hook inputs.

Every example below goes in with a `README.md` beside it (the template is in
`../SKILL.md`).

## `custom/terraform/_shared/` and `custom/terraform/<env>/`

- meroku appends every `*.tf` file in `_shared/`, then every one in `<env>/`, to the
  generated `env/<env>/main.tf`, in name order. `.tf` files only; subfolders are not read.
- The files join the root module, so they read meroku's modules directly
  (`module.cognito.user_pool_id`, `module.workloads.backend_task_role_name`) and the
  bridge `env/<env>/_bridge.tf` builds (`local.bridge.api_endpoint`,
  `local.bridge.domain_zone_id`, `local.bridge.db_endpoint`, …). A 6.0.0 copy adds
  `data_bucket_name`, `data_bucket_arn`, `backend_bucket_arn`, `event_bus_name`,
  `event_bus_arn`, `event_queue_urls` (consumer name to queue URL), `alerts_topic_arn`,
  `valkey_address`, `valkey_port` and `valkey_security_group_id`. The bridge holds empty
  strings (an empty map for `event_queue_urls`) for a feature that is off.
- In 6.0.0 the alerts topic `<project>-<env>-alerts`, which receives the event DLQ alarms,
  has no subscriber. Subscribing to it is a typical `custom/terraform` file:

  ```hcl
  resource "aws_sns_topic_subscription" "oncall" {
    topic_arn = local.bridge.alerts_topic_arn
    protocol  = "email"
    endpoint  = "ops@example.com"
  }
  ```

- Names meroku's root module owns in 6.0.0 are refused at generate: `module
  "data_bucket"`, `"vaults"`, `"events"`, `"valkey"`, and the locals `workload_roles`,
  `workload_extra_env`, `workload_extra_secrets`.
- A module exists only while its YAML section is on. `module.cognito` needs
  `cognito.enabled: true`; reference a module whose section is off and the plan fails.
- Do not declare a `terraform`, `backend` or `provider "aws"` block: `main.tf` has them.
- Do not reuse meroku's resource names. meroku names YAML extensions `ext_<name>`; pick a
  prefix of your own.
- `_shared/` lands in every env's state. An account-wide setting (SMS preferences, for
  one) belongs in exactly one state per account: when two envs share an AWS account, put
  it in one env's folder, not `_shared/`.

Example, `custom/terraform/dev/sms.tf`:

```hcl
resource "aws_sns_sms_preferences" "account" {
  monthly_spend_limit = 50
  default_sms_type    = "Transactional"
}
```

AWS caps SMS spend low on a new account; a limit above that cap fails until AWS raises it.

Example, `custom/terraform/dev/admin_client.tf`, an app client on meroku's pool:

```hcl
resource "aws_cognito_user_pool_client" "admin_dashboard" {
  name            = "${local.bridge.project}-${local.bridge.env}-admin-dashboard"
  user_pool_id    = module.cognito.user_pool_id
  generate_secret = false

  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
}
```

## `custom/pre/`

- Turned on by `custom/pre/main.tf` existing. Wired into every env; there is no per-env
  pre hook.
- Inputs, exactly these six. Declare all six in `variables.tf`, or the plan fails on an
  unexpected argument:

  | Input | Value |
  |---|---|
  | `project`, `env`, `region`, `account_id` | from the env YAML |
  | `vpc_id`, `subnet_ids` | the env's VPC and subnets |

- Output: **`backend_env_vars` is the only one meroku reads.** A list of
  `{ name, value }` objects, added to the backend container's environment. meroku reads it
  through `try(..., [])`, so a misspelt output name fails silently: the backend simply
  gets no variable. Any other output is ignored.

Example:

```hcl
# custom/pre/variables.tf
variable "project" { type = string }
variable "env" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }

# custom/pre/main.tf
resource "aws_kms_key" "exports" {
  description = "${var.project}-${var.env} export encryption"
}

# custom/pre/outputs.tf
output "backend_env_vars" {
  value = [{ name = "EXPORTS_KMS_KEY_ARN", value = aws_kms_key.exports.arn }]
}
```

## `custom/post/`

- Turned on by `custom/post/main.tf` existing. Wired into every env, after meroku's own
  modules.
- Inputs. `variables.tf` declares every one; the conditional ones with `default = null`,
  so turning `domain` or `postgres` on or off later does not break the plan:

  | Input | Value | Passed |
  |---|---|---|
  | `project`, `env`, `region`, `account_id`, `vpc_id`, `subnet_ids` | as for pre | always |
  | `api_endpoint`, `api_gateway_id` | the backend's API Gateway | always |
  | `ecs_cluster_arn`, `ecs_cluster_name` | the env's ECS cluster | always |
  | `backend_ecr_repo_url` | the backend's ECR repository | always |
  | `backend_task_role` | the backend task role's **name**, not its ARN | always |
  | `domain_zone_id`, `api_domain` | the env's zone and API domain | only when `domain.enabled` |
  | `db_endpoint` | the database endpoint | only when `postgres.enabled` |

- meroku reads no output from it.

Example, an SNS topic that calls the API:

```hcl
# custom/post/variables.tf (every input above, abbreviated here)
variable "api_endpoint" { type = string }
variable "domain_zone_id" {
  type    = string
  default = null
}

# custom/post/main.tf
resource "aws_sns_topic" "billing_events" {
  name = "${var.project}-${var.env}-billing-events"
}

resource "aws_sns_topic_subscription" "billing_to_api" {
  topic_arn              = aws_sns_topic.billing_events.arn
  protocol               = "https"
  endpoint               = "${var.api_endpoint}/webhooks/billing"
  endpoint_auto_confirms = false
}
```

The API must confirm the subscription (SNS posts a `SubscriptionConfirmation` first).

## Checking the result

The user runs `meroku generate <env>` and a plan. Read the plan for:

- the custom resources as adds, under their own addresses (`aws_*.<name>`,
  `module.custom_pre.*`, `module.custom_post.*`);
- no `must be replaced` and no destroy on anything meroku owns;
- for a pre hook, the backend task definition changing only by the new env var.
