# What meroku creates, and how to tell what this project has

A map, not the truth. The truth is the project's own copy: what its
`infrastructure/env/main.hbs` reads and its `infrastructure/modules/` create. This file is
current as of meroku 5.6; read the template before relying on any row.

## How to tell what this project's meroku has

| Question | Where to look |
|---|---|
| Which meroku templates this project renders | `infrastructure/version.txt` (the copy). `meroku --version` names the binary, which is read-only and safe to run |
| Whether a feature exists in this copy | the block in `infrastructure/env/main.hbs` that reads its key. No block reading the key: the copy does not have it |
| What a module creates and accepts | `infrastructure/modules/<module>/main.tf` and `variables.tf` |
| Whether a module exists in this env | its `{{#if <section>.enabled}}` wrapper in `main.hbs`, and that section in the env YAML |

A symlinked `infrastructure/` points at a meroku checkout: read it the same way.

## Shipped: the change is in the env YAML

| Need | YAML section | Note |
|---|---|---|
| A long-running container | `services[]` | per-service image, port, size, `network_access` |
| A job on a schedule | `scheduled_tasks[]` | `schedule` is `rate(...)` or `cron(...)`, UTC |
| A job started by an EventBridge pattern | `event_processor_tasks[]` | `rules[]` hold the patterns |
| IAM permissions for the backend | `workload.policy` | statements added to the backend task's role. The backend only, not other services |
| An SNS topic or SQS queue for the backend | `extensions.sns_topics`, `extensions.sqs_queues` | reach the backend's env only (`add_to_backend_env`), not other services |
| A shared queue with an access policy | `sqs` | one queue; services and tasks get its access policy |
| A user pool and its app clients | `cognito` | `module.cognito` exists only while `cognito.enabled` is true |
| Frontend hosting | `amplify_apps` | per app, its branches and their env vars |
| Extra S3 buckets | `buckets[]` | |
| Email sending | `ses` | |
| A load balancer in front of services | `alb` | |

Read `../../yaml/SKILL.md` before changing any of these.

## Coming in a later meroku release

None of these is in any meroku release up to 5.6. **Their YAML key names are not final
until they ship: never write one into the YAML.** Search the project's `main.hbs` (and,
where named, a module) for the signs below. Found: treat the feature as shipped, and read
its block for the real keys. Not found: it is coming.

| Feature | Signs it has landed in this copy |
|---|---|
| An events section per service: a queue, two dead-letter queues, a rule on the project's event bus, the IAM to read them, and a dead-letter alarm sent to the alerts topic | inside the services handling, a per-service block that reads an events key and creates `aws_sqs_queue` and `aws_cloudwatch_event_rule` resources; an `aws_cloudwatch_event_bus` for the project; an alerts `aws_sns_topic`. `event_bus_task_<name>` is the existing event task module, not the bus |
| One private bucket per env, with a path per service | a single env bucket block, plus a per-service prefix or path passed to the workloads module |
| IAM statements on every service and task, not only the backend | a `policy` read inside the services, scheduled task or event task handling, beside today's `workload.policy` |
| Vaults | a block reading a vault key; `vault` in `main.hbs` or a `modules/` folder |
| Valkey | a block reading a valkey key; `valkey` in `main.hbs` or a `modules/` folder |
| An Amplify rewrite of `/api/*` to the backend | in the `amplify_apps` block, a per-app rules or rewrites key; in `infrastructure/modules/amplify/main.tf`, a `custom_rule` whose source is `/api/...`. Today's `custom_rule` blocks are the single-page-app fallback only |

When one is coming, tell the user so in those words, name the sign to look for after
`meroku update`, and offer a stop-gap in `custom/` whose README names the release that
removes it.

## Not a meroku resource

Passflow is an external auth service. Authentication for a new app goes there, not into a
new Cognito pool. meroku's `cognito` section exists for projects that use it; an extra
client on that pool is custom Terraform, not a second pool.

## Apps never create infrastructure at boot

App code that creates its own bus, queue or bucket on start-up looks convenient and costs
three things: the next meroku run neither knows about it nor removes it on destroy, its
name drifts from meroku's per-env naming, and its permissions have to be wide enough to
create resources. The resource belongs in the YAML, or in `custom/` with a README. The app
reads its name or URL from its environment.
