# Per-operation playbooks

The operation is in the briefing's file name (`<time>-<operation>.md`) and in its
"Where it ran" table. Read only the section that matches it. THE RULES in `SKILL.md`
apply to every section; nothing here relaxes them.

Every Terraform command below runs from `env/<env>/` with the briefing's profile:
`AWS_PROFILE=<profile> terraform …`.

## apply

Opened with `a` on meroku's failed-apply screen.

**What the briefing holds.** Under "Failed resources", each resource that failed: its
address, the action (create, update, delete, replace), a summary, the detail, and a
`file:line` location when Terraform gave one. Resources cancelled because an earlier one
failed are left out: they are not causes. "Diagnostics without a resource address" holds
provider, backend and configuration errors. "Error output" holds the exit cause and
Terraform's stderr; when it says `(tail)`, only the last 16 KiB were kept, so the start
of a long log is missing.

**Look first.**

1. Each failed address: `terraform state show <address>` says whether Terraform tracks
   it; the matching `aws … describe-*` / `get-*` says what exists in AWS. The gap between
   the two is usually the story.
2. The location: it points into the generated `env/<env>/*.tf`. Find the module call or
   block that rendered it in `infrastructure/env/main.hbs` or `infrastructure/modules/`,
   then the YAML key that fed it. That chain decides between (a) and (c).
3. A partial apply changed some resources. Before proposing anything, run
   `terraform plan` to see what is still pending, so the fix covers the current state and
   not the state before the run.

**meroku's name-collision hint.** When an error carries `EntityAlreadyExists`,
`ResourceConflictException`, `ResourceAlreadyExistsException`, `AlreadyExistsException`
or `BucketAlreadyOwnedByYou`, meroku appends a hint to the detail: the name already exists
in the account, probably owned by another meroku project deployed there. Check the
resource's `Project` tag with a read-only call. Then:

- owned by another project or environment: the names collide, which is a configuration
  question (c). Changing a name usually replaces resources; read `../../yaml/SKILL.md`
  before proposing it.
- created by hand or by an earlier tool, and the user wants meroku to own it: an edge
  case (b), typically an agreed `terraform import`.
- left over from an earlier run of this same environment: also (b); interview first,
  because removing or importing it decides what data survives.

**Scripted resources.** In a Route 53 zone meroku did not create, SES TXT values are
managed through `infrastructure/modules/ses/scripts/route53-txt.sh`, which needs `/bin/sh`
and AWS CLI v2. A failure inside that script is often the machine, not the YAML: check
`aws --version`. meroku also refuses at plan to replace a foreign SPF or DMARC value the
YAML does not set; that refusal is by design, and the answer is a YAML decision (c).

**After an update to 6.0.0.** `AccessDenied` on `events:PutEvents`: the workload lacks
`events.produces` for that event, a YAML fix (c). `AccessDenied` on `logs:` or
`cloudwatch:` reads, or on `sns:Publish`: task roles lost `CloudWatchFullAccess` in 6.0.0;
the workload needs a `policy` block (c). A plan that fails in `env_secret_check`: a vault
secret collides with an env var, another vault's secret, or `ENV` (c).

## plan

Opened with `a` on meroku's failed-plan screen. Nothing in AWS changed.

**What the briefing holds.** The `Error:` and `Warning:` headlines picked out of
Terraform's output, and the full stderr.

**Look first.** A plan fails before any change, so the cause is in what Terraform was
given or could reach:

- configuration: a YAML value that renders invalid or inconsistent Terraform, or fails a
  module's validation. Trace the error to the template and the YAML key (c), or to a
  template or module that mishandles a valid value (a).
- backend: errors naming the S3 state backend point at `state_bucket`, `state_file` or
  `state_lock_table` in the YAML, or at credentials. Check `aws sts get-caller-identity`
  with the profile first.
- an uninitialised or disconnected `env/<env>/`: `terraform init` is a write here; the
  briefing offers `meroku sync <env>`, which the user runs or agrees to.

`terraform plan` without `-out` is safe to rerun while you investigate. In a Neon env it
fails on the Neon providers (this pane lacks their credentials): read state instead, and
rerun meroku for a plan.

## destroy

Opened with `a` on meroku's failed-destroy screen.

**What the briefing holds.** The same shape as plan: the `Error:` / `Warning:` headlines
and the full stderr.

**Look first.** A destroy that failed part way has removed some resources and not others.
Establish which with `terraform state list`; what remains in state is what the next
destroy will try again. For each resource that blocked, find out with read-only calls
what holds it.

A destroy that fails on the data bucket (`BucketNotEmpty`) is by design: its
`force_destroy` is false. Emptying every object version is a (b) step, agreed and logged.

Never remove a leftover resource from AWS yourself (rule 1), and never `state rm` it to
make the destroy pass: either is (b), interviewed and logged, because it decides what is
lost or orphaned. The rerun is `meroku --env <env>`, then "💥 Nuke/Destroy Environment".

## sso

Opened from the AWS SSO Tools menu, the startup SSO check, or choice 2 of the profile
validator's fix prompt. meroku can hand off one profile after another; each has its own
briefing, `<time>-sso-<profile>.md`.

**What the briefing holds.** The profile name, whether it exists in the AWS config, its
type, the fields the inspector found missing (on the profile and on its `sso-session`),
the path of the AWS config file, and the validator's messages. It holds no tokens, keys
or cached credentials; do not go looking for them.

**Look first.**

- `aws configure list-profiles`, and the profile's section in the AWS config file the
  briefing names. Compare it with `aws_profile`, `region` and `account_id` in the env YAML.
- `AWS_PROFILE=<profile> aws sts get-caller-identity` tells working credentials from a
  missing or expired login.

**Fixes.**

- The YAML names the wrong profile, region or account: (c), change the env YAML.
- The profile is missing or incomplete: editing the AWS config file is a write outside
  the project. Show the exact lines, and wait for a yes. meroku's own route is its AWS SSO
  Setup Wizard, which creates or completes the profile; offer it.
- Login expired: `aws sso login --profile <profile>` opens the user's browser. Ask the
  user to run it.

## menu

Opened from "🤖 Fix with AI (Claude Code)" on meroku's main menu. Nothing has failed, so
the briefing carries no failure data.

Ask the user what is wrong before running anything. Then pick the playbook above that
matches their answer and work it. For a broad "something is off", the briefing's
read-only checks help, with the user's agreement: `meroku sync <env>` compares the
environment with its S3 state, and `meroku dns status` / `meroku dns validate` check DNS.
