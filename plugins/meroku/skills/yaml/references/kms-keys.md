# KMS signing keys: declared in the YAML, the private key never leaves KMS

Written against meroku 6.2.0, schema v32. A KMS signing key is an asymmetric AWS KMS key
that never leaves KMS. The YAML declares the keys of an environment; each workload
connected to a key may sign with it, verify with it, or both, and its container gets the
key's ARN and its public key as environment variables. Use it for tokens, webhooks or
documents that other parties verify: the private key cannot be read or copied, and anyone
holding the public key can verify a signature without calling AWS. The project's own copy
is the authority: `infrastructure/modules/kms_keys/`, and `infrastructure/ai_docs/KMS_KEYS.md`
when the copy carries it.

## Which shape this project has

| `infrastructure/version.txt` | `kms_keys` |
|---|---|
| `v6.2.0` or later | the top-level list and per-workload connections render; generate checks them |
| older than `v6.2.0` | no `kms_keys`: the key renders nothing. A custom `module "kms_keys"` was legal there |

The rest of this file describes 6.2.0. On an older copy never write `kms_keys`: it renders
nothing, and the user would believe the key exists. Say 6.2.0 has it and that the update
is `brew upgrade meroku`, then `meroku update`. After the update, a custom `.tf` that
declares `module "kms_keys"` is refused at generate, so it is renamed first.

There is no schema migration: an absent `kms_keys` block creates no key.

## The YAML

```yaml
kms_keys:
  - name: auth                 # required
    key_spec: ECC_NIST_P256    # optional; the default
  - name: webhooks
    key_spec: RSA_2048
  - name: old_auth
    retired: true              # still deployed; nothing may connect to it

workload:                      # the backend
  kms_keys:
    - { name: auth, access: both }

services:
  - name: api
    kms_keys:
      - { name: auth, access: sign }
      - { name: webhooks, access: verify }

scheduled_tasks:
  - name: nightly
    kms_keys: [{ name: auth, access: verify }]

event_processor_tasks:
  - name: ingest
    kms_keys: [{ name: webhooks, access: sign }]
```

| Key | Rule |
|---|---|
| `kms_keys[].name` | 1 to 31 lower-case letters, digits and underscores, starting with a letter (`^[a-z][a-z0-9_]{0,30}$`). Unique. The web UI names a new key `key<n>`, n one more than the highest `key<n>` already in the list |
| `kms_keys[].key_spec` | one of `ECC_NIST_P256` (the default), `ECC_NIST_P384`, `ECC_NIST_P521`, `ECC_SECG_P256K1`, `RSA_2048`, `RSA_3072`, `RSA_4096`. Once an apply has created the key, a changed value is ignored; see "Changing the key type" |
| `kms_keys[].retired` | optional, default `false`. See "Removing a key: two applies" |
| a connection's `name` | a key of the top-level list that is not retired. A workload connects to a key at most once |
| `access` | required, `sign`, `verify` or `both` |

Connections go on `workload` (the backend), `services[]`, `scheduled_tasks[]` and
`event_processor_tasks[]`.

## What a connected workload gets

For each key a workload connects to, with `<NAME>` the key name upper-cased:

| Variable | Value |
|---|---|
| `KMS_<NAME>_KEY_ARN` | The key's ARN, for `kms:Sign` and `kms:Verify` calls. |
| `KMS_<NAME>_PUBLIC_KEY` | The key's public key, PEM-encoded (`-----BEGIN PUBLIC KEY-----` …). |

`KMS_AUTH_PUBLIC_KEY` holds a **multi-line** PEM: the header line, the base64 body over
several lines, the footer line. ECS passes container variables as JSON strings, so the
newlines reach the process unchanged; read the variable as is and hand it to the PEM
parser. Do not expect a single line.

Every connected workload gets both variables whatever its access, sorted by key name. A
workload's YAML variable with the same name (`backend_env_variables`, `env_vars`,
`environment_variables`) is refused at generate, and so is a vault secret that would
become the same name on that workload.

The values are known only once the key exists: the first apply that creates a key
registers the task definitions that name it in the same run. Adding, retiring or deleting
one key leaves the other keys' variables known at plan, so a workload connected only to
other keys keeps its task definition.

A new grant can take a few seconds to reach every KMS endpoint after the apply that
creates it. An application that calls KMS at startup should retry an
`AccessDeniedException` a few times over several seconds before it gives up, so a task
started right after the apply does not crash on its first call.

## Grants

One inline policy on each connected workload's **task role**,
`<project>_kms_keys_<workload>_<env>`, scoped to the ARNs of its own keys:

| Access | Actions |
|---|---|
| `sign` | `kms:Sign`, `kms:GetPublicKey`, `kms:DescribeKey` |
| `verify` | `kms:Verify`, `kms:GetPublicKey`, `kms:DescribeKey` |
| `both` | `kms:Sign`, `kms:Verify`, `kms:GetPublicKey`, `kms:DescribeKey` |

Each key keeps the default key policy, which delegates to IAM in the account; no other
principal can use a key unless an IAM policy in the account grants it.

## The keys

| Setting | Value |
|---|---|
| Key usage | `SIGN_VERIFY` |
| Key type | `key_spec` (`customer_master_key_spec`) |
| Alias | `alias/<project>-<env>-<name>` |
| Deletion window | 7 days |
| Rotation | none: AWS does not rotate asymmetric keys |

## Signing and verifying in the application

The application signs with KMS, using the ARN from `KMS_<NAME>_KEY_ARN`. From an SDK it
calls `Sign` with `KeyId`, `Message`, `MessageType` and `SigningAlgorithm`:

- `MessageType: RAW` sends the message itself (up to 4096 bytes) and KMS hashes it.
  `DIGEST` sends a hash you computed, which suits large payloads; the hash must match the
  algorithm (32 bytes for `*_SHA_256`).
- `SigningAlgorithm` must suit the key type:

  | key_spec | Algorithm |
  |---|---|
  | `ECC_NIST_P256` | `ECDSA_SHA_256` |
  | `ECC_NIST_P384` | `ECDSA_SHA_384` |
  | `ECC_NIST_P521` | `ECDSA_SHA_512` |
  | `ECC_SECG_P256K1` | `ECDSA_SHA_256` |
  | `RSA_*` | `RSASSA_PSS_SHA_256` / `_384` / `_512`, or `RSASSA_PKCS1_V1_5_SHA_256` / `_384` / `_512` |

An ECDSA signature comes back DER-encoded. A JWT (`ES256`) wants the raw 64-byte
`r || s` form, so convert it before encoding.

Verify locally with the PEM from `KMS_<NAME>_PUBLIC_KEY`: parse it as a
SubjectPublicKeyInfo public key with the language's crypto library and check the
signature with the same algorithm. That needs no AWS call and no `kms:Verify`.
`kms:Verify` (access `verify` or `both`) is for an application that prefers KMS to check
the signature, or has no crypto library for the key type.

## Changing the key type

AWS cannot change the type of an existing key. Replacing the key would make every
signature made with it stop verifying, so `modules/kms_keys` never does: `aws_kms_key` has
`lifecycle { ignore_changes = [customer_master_key_spec] }`. Once an apply has created a
key, a changed `key_spec` in the YAML changes nothing in AWS, and the plan shows a warning
from the check `key_spec_unchanged`:

```
KMS key "auth" is ECC_NIST_P256 in AWS, but kms_keys sets RSA_2048. AWS cannot
change a key's type: add a new key with the type you want, move the workloads
to it, then retire this one. Until then the key keeps ECC_NIST_P256.
```

The warning never fails the plan or the apply. Until an apply creates the key, `key_spec`
is free to change. The replacement answer for a `key_spec` edit on a created key is "no:
nothing changes in AWS, and the plan warns".

The web UI offers the type only for a key added since the panel was opened; a key already
in the YAML when the panel opened shows its type read-only.

To move to another type:

1. Add a new key with the type you want.
2. Move the workloads' connections to it and apply.
3. Retire the old key once nothing verifies with it any more (see "Removing a key: two
   applies").

## Removing a key: two applies

Removing a key takes two applies, so nothing loses a key it still uses:

1. **Retire**: set `retired: true` and remove every connection to the key (the web UI's
   "Retire" does both). Apply. The variables and the IAM grants go; the key still exists,
   so a signature it made can still be verified with its public key, and anything outside
   meroku that uses it keeps working.

   The apply removes the workloads' grants at once, while the tasks it redeploys start
   without the variables. A task still running the old task definition loses `kms:Sign`
   and `kms:Verify` on the key as soon as the policy changes. Stop the application using
   the key, deploy that, then retire it.
2. **Delete**: remove the entry from `kms_keys`. Apply. Terraform destroys the key, which
   AWS turns into a **scheduled deletion 7 days ahead**. During those 7 days the key is
   disabled (no Sign, no Verify, no GetPublicKey) but not gone.

Recovery within the 7 days is for the user to run, after agreeing: these are AWS writes,
never a step you run.

```
aws kms cancel-key-deletion --key-id <key ARN>
aws kms enable-key --key-id <key ARN>
```

brings it back. Then the entry goes back in the YAML, and the user imports the key into
`module.kms_keys.aws_kms_key.key["<name>"]` (and its alias) before the next apply; that
`terraform import` is also a write the user runs. Without the import Terraform creates a
new key instead. After 7 days the key is gone for good; a saved copy of its public key
still verifies the signatures it made.

Setting `retired: false` again restores a retired key: connect it and apply.

- **The same-name trap.** A key's Terraform address is its name,
  `module.kms_keys.aws_kms_key.key["<name>"]`. Deleting a key's entry and adding a new
  entry with the same name before the next apply is, to Terraform, the same key: the old
  key stays, its deletion is not scheduled, and with a different `key_spec` the plan warns
  as in "Changing the key type". To get a fresh key under a name, apply the deletion
  first, or use a new name.

A renamed key is therefore a deleted key plus a new one: its address is its name.

## Destroy

`meroku destroy` destroys every key, retired ones included, which schedules each for
deletion with the 7-day window above. Cancel within the window to keep a key.

## Cost

About $1 per key per month (AWS bills asymmetric keys the same as symmetric ones), retired
keys included, plus per-request charges for `Sign`, `Verify` and `GetPublicKey`, a few
cents per 10,000 requests depending on the key type (see AWS KMS pricing). Verifying
locally with the PEM makes no request.

## Custom Terraform

A project's root-level custom files may read `module.kms_keys.key_arns`,
`module.kms_keys.environment` and `local.bridge.kms_key_arns`. `module.kms_keys.key_arns`
(and `local.bridge.kms_key_arns`, `{}` without keys) lists every key's ARN by name,
retired keys included. A custom `.tf` that declares its own `module "kms_keys"` is refused
at generate; rename it.

A signing key for a workload is never a custom `aws_kms_key`: it is `kms_keys`.

## What meroku generate refuses

`meroku generate` refuses each of these and names the field:

1. a malformed key name (not `^[a-z][a-z0-9_]{0,30}$`)
2. a duplicate key name
3. an unknown `key_spec`
4. a connection to a key not in the top-level list
5. a connection to a retired key
6. a bad or missing `access` (required; `sign`, `verify` or `both`)
7. one key connected twice to one workload
8. a workload YAML variable named like a variable a connected key gives it
   (`backend_env_variables`, `env_vars`, `environment_variables`)
9. a vault secret that would become the same name on that workload
10. a custom `.tf` that declares `module "kms_keys"` (rename it)

Two of the messages, for kinds 5 and 4:

```
kms_keys:
  workload.kms_keys[0]: kms key "auth" is retired: remove the connection, or set retired: false
  services[0].kms_keys ('api')[0] connects kms key "billing", which is not in the top-level kms_keys list; add it under kms_keys first
```

## The web UI

The web UI has a "KMS keys" node (add with a default name `key<n>`, choose the type,
retire, restore, delete) and a "KMS keys" tab on every workload (connect with sign, verify
or both, showing the variables it gives). Every workload's env editor warns about a
variable that a connected key already sets.
