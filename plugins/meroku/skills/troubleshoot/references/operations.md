# Per-operation playbooks

The operation is in the briefing's file name (`<time>-<operation>.md`) and in its
"Where it ran" table. Read only the section that matches it, and "vaults" or "kms keys"
at the end as well whenever the output names a vault, a vault secret, a KMS key or
`kms_keys`. THE RULES in `SKILL.md` apply
to every section; nothing here relaxes them.

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
the workload needs a `policy` block (c) for a log group, alarm or topic meroku does not
manage. On a resource meroku creates, never a `policy` block: see the next paragraph.

**`AccessDenied` on a resource meroku creates** (its event queue or DLQ, bus, bucket,
vault, KMS key, Valkey). Never fix it with a `policy` statement or an ARN in the YAML.
`sqs:SendMessage` on the consumer's own queue or application DLQ: the copy is older than
6.4.0, which grants it; recommend `meroku update` to 6.4.0. On another workload's queue:
the sender publishes through `events.produces` instead (c). Any other grant meroku lacks
on its own resource is a meroku gap (a): report it for github.com/MadAppGang/meroku.

**After an update to 6.1.0.** A refusal that a vault `has no secrets list`, a task that
cannot start on a vault secret, or a failure in `env_secret_check`: read "vaults" below.

**After an update to 6.2.0.** `meroku generate` refuses a custom `.tf` that declares
`module "kms_keys"`: rename it (c). A task that fails `kms:Sign` or `kms:Verify` with
`AccessDeniedException` right after the apply that granted it: the grant is still
reaching every KMS endpoint; the application should retry for a few seconds. After a
retire, a task still on the old revision has lost the grant. Read "kms keys" below.

**After an update to 6.5.0.** No migration, and no existing key changes. A failing
`kms:GenerateMac` or `kms:VerifyMac`, or an `HMAC_*` `key_spec` that generate refuses:
read "kms keys" below.

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
- vaults: `Warning: Check block assertion failed` naming a vault with no value yet is a
  warning and not why the plan failed. A failure in `env_secret_check` is a name
  collision. Read "vaults" below for both.
- KMS keys: a warning naming a key whose type in AWS differs from `kms_keys` (from the
  check `key_spec_unchanged`) is never why the plan failed. Read "kms keys" below.

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

Vault values still in SSM after a destroy are by design, not a leftover: Terraform never
deletes a vault parameter. The user deletes them when the environment is gone for good.

KMS keys scheduled for deletion after a destroy are by design: each has a 7-day window.
Cancelling is the user's AWS write.

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

- The profile's section in the AWS config file the briefing names. Compare it with
  `aws_profile`, `region` and `account_id` in the env YAML.
- `AWS_PROFILE=<profile> aws sts get-caller-identity`.
- How AWS sign-in and the config file work: `aws-core`'s sign-in and auth skills
  (`../../meroku/references/official-plugins.md`).

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

## vaults

Not an operation: read it under any of them when the output names a vault or a vault
secret. It describes meroku 6.1.0. `../../yaml/references/vaults.md` has the rest, and
says how to tell a 6.0.x project (its vaults have no `secrets` key, and that is correct
there).

**`meroku generate` refuses a vault without a `secrets` list.**

```
vault "shared" has no secrets list: list its secret names under vaults[0].secrets; the Vaults tab can import the names already in SSM
```

Every vault meroku 6.0.0 wrote has this shape, so the first generate after an update to
6.1.0 refuses each one. No migration writes the list: the names are the parameters
already under the vault's path in SSM, and a migration reads only the YAML. It is a
configuration fix (c):

1. The user opens the web UI ("🌐 Edit environment with web UI") and its Vaults tab. The
   vault shows "meroku needs this vault's secret names".
2. **Import names from AWS** adds every name found under the path to `vaults[i].secrets`.
3. Generate, then apply. Each connected workload gets one new task definition revision
   (`valueFrom` is now the parameter's ARN). Nothing is replaced.

**Never write `secrets: []` to make the refusal go away, and never offer "Start empty",
on a vault whose parameters are in use.** The next apply would drop every vault secret
from every connected task definition. An empty list is right only for a vault nothing
reads yet. Check first, read-only:

```sh
AWS_PROFILE=<profile> aws ssm describe-parameters \
  --parameter-filters Key=Path,Option=OneLevel,Values=/<env>/<project>/vault/<name>
```

The last segment of each name is a secret name. One with upper case, a hyphen or a dot
does not match `^[a-z][a-z0-9_]{0,62}$` and cannot be imported as it is: the value is
written again under a lower-case name from the tab, the application is updated if the
variable name changes, and the old parameter is deleted.

**A plan warns that a secret has no value.**

```
Warning: Check block assertion failed
Vault "payments" has no value yet for database_url (under /dev/myapp/vault/payments/).
Set the values in the web UI's Vaults tab. Until then, a new task of a workload
connected to this vault cannot start.
```

A warning, never the cause of a failed plan or apply: it is a `check` block. The apply
registers the task definitions anyway, and ECS refuses to start a task whose secret has
no parameter. The fix is the user's **Set value** in the Vaults tab; the next task starts.
It is not a YAML change, and never a write you make: you do not run `put-parameter`
(rule 1), and the value never goes through this session. An error reading SSM at plan (a
missing permission, for example) does fail the plan; that is access to SSM, not a missing
value.

**A task of a connected workload cannot start after an apply.** Two causes:

- a declared secret has no value yet: the warning above was in the plan;
- a value was deleted before its name was removed and applied. Every connected workload's
  current revision still names it. Either the user sets the value again, or the removal
  is applied. The order for removing a secret is: remove the name, apply, then delete the
  value.

**A new value does not reach the application.** Changing a value changes no task
definition, and a running task keeps the value it started with. Each connected workload
needs a redeploy.

**A name collision.** `meroku generate` refuses the ones it can see in the YAML: a secret
named `env` on a connection without a prefix, two vaults giving one workload the same
variable, and a vault secret with the name of the workload's YAML variable or of one
meroku sets for it. A plan that fails in `env_secret_check` is the rest: a variable only
a module sets, or a parameter under the workload's own path with the name of a variable
or of a vault secret (its message names both parameters). On a plan that adds or removes
a service, that own-path check runs at apply. All are configuration fixes (c): a `prefix`
on the connection, or another name. On a 6.0.x copy every vault collision fails at plan.

## kms keys

Not an operation: read it under any of them when the output names a KMS key or
`kms_keys`. It describes meroku 6.5.0; `../../yaml/references/kms-keys.md` has the rest.
A copy older than `v6.2.0` has no `kms_keys`; `v6.2.0` to `v6.4.x` has signing keys only.

**`meroku generate` refuses a `kms_keys` field.** It names the field. Two of the
messages:

```
kms_keys:
  workload.kms_keys[0]: kms key "auth" is retired: remove the connection, or set retired: false
  services[0].kms_keys ('api')[0] connects kms key "billing", which is not in the top-level kms_keys list; add it under kms_keys first
```

Each refusal is a configuration fix (c):

| Refusal | Fix |
|---|---|
| a malformed key name (not `^[a-z][a-z0-9_]{0,30}$`), or a duplicate one | another name |
| an unknown `key_spec` | one of the values in `kms-keys.md`. An `HMAC_*` value on a copy older than `v6.5.0`: the update to 6.5.0, or a signing key if a third party verifies |
| a connection to a key not in the top-level list | add the key under `kms_keys` first, or fix the name |
| a connection to a retired key | remove the connection, or set `retired: false` |
| a bad or missing `access` | `sign`, `verify` or `both` |
| one key connected twice to one workload | one connection |
| a workload YAML variable (`backend_env_variables`, `env_vars`, `environment_variables`) named like a variable a connected key gives it (an HMAC key gives only `KMS_<NAME>_KEY_ARN`; `KMS_<NAME>_PUBLIC_KEY` is free beside it) | rename the variable |
| a vault secret that would become the same name on that workload | rename the secret, or connect the vault with a `prefix` |
| a custom `.tf` that declares `module "kms_keys"` | rename the custom module |

**The plan warns that a key keeps its type.**

```
KMS key "auth" is ECC_NIST_P256 in AWS, but kms_keys sets RSA_2048. AWS cannot
change a key's type: add a new key with the type you want, move the workloads
to it, then retire this one. Until then the key keeps ECC_NIST_P256.
```

A warning from the check `key_spec_unchanged`, never the cause of a failed plan or apply.
It also fires when the YAML switches a key between a signing type and an `HMAC_*` type:
the usage cannot change either. Grants and variables follow the type in AWS, so the
workloads keep working on the old type. The fix: add a key of the wanted type, move the
connections to it, apply, then retire the old one. Never delete and re-add the entry under
the same name: to Terraform that is the same key.

**A task lost its key after a retire.** The variables and the grants go at that apply; a
task still on the old revision loses `kms:Sign` and `kms:Verify` (`kms:GenerateMac` and
`kms:VerifyMac` on an HMAC key) at once. The application must stop using the key and be
deployed before the retire.

**`kms:GenerateMac` or `kms:VerifyMac` fails with `AccessDeniedException`.** The grants
follow `access` and the key's type in AWS:

| When | Cause | Fix |
|---|---|---|
| right after the apply that granted it | the grant is still reaching every KMS endpoint | the application retries for a few seconds |
| on `kms:VerifyMac` (or `kms:GenerateMac`) | the workload's `access` is `sign` (or `verify`) on that key | `access: both`, or the other access, in the YAML (c) |
| while the YAML says `HMAC_*` | the key is a signing key in AWS: the plan warned `key_spec_unchanged`, and grants follow the AWS type | a new HMAC key, move the connections, retire the old one (c) |
| on `kms:Sign`, `kms:Verify` or `kms:GetPublicKey` with an HMAC key | the application treats an HMAC key as a signing key; an HMAC key has no such grant and no public key | the application calls `GenerateMac` and `VerifyMac` (outside meroku) |

A MAC that does not check is not a grant problem: the MAC algorithm must match the key
type (`HMAC_SHA_256` for `HMAC_256`), and a message over 4096 bytes is hashed first, the
same way on both sides. Never a `policy` statement for `kms:GenerateMac` or
`kms:VerifyMac`: meroku grants them from `access`.

**A key was deleted by mistake.** Within 7 days it is disabled, not gone. Recovery is
(b): every step is run by the user after agreement, and logged
(`manual-step-log.md`). The user runs `aws kms cancel-key-deletion` and
`aws kms enable-key`, the entry goes back in the YAML, and the user runs a
`terraform import` of `module.kms_keys.aws_kms_key.key["<name>"]` and its alias before the
next apply. Without the import Terraform creates a new key. After 7 days the key is gone.

**`KMS_<NAME>_PUBLIC_KEY` will not parse.** It is a multi-line PEM; read it as is and hand
it to the PEM parser. **It is not set at all:** the key is an HMAC key, which has no public
key; the workload gets only `KMS_<NAME>_KEY_ARN`.
