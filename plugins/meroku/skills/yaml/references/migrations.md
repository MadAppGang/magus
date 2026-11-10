# schema_version, migrations and backups

Written against meroku 5.1, where the current schema is v31. The authority is the
meroku that runs: `meroku migrate` with no argument prints the current schema version.
In the project, `infrastructure/app/migrations.go` (when the copy carries it) holds
`CurrentSchemaVersion`, the per-version history in the comment above it, and
`AllMigrations` below it.

## When migrations run

Automatically, every time meroku loads an env YAML for real work: the menu, a deploy,
`meroku generate`, `meroku sync`. Generation migrates before it renders, so a YAML
several versions behind cannot reach the template unmigrated.

Steps, when the file is older than the binary:

1. Read `schema_version`. If it is missing, guess from the keys present (`account_id`
   means v5, `workload.backend_desired_count` v4, `domain.zone_id` v3,
   `postgres.aurora` v2, otherwise v1).
2. Copy the file to `backup/<file>.backup_<YYYYMMDD_HHMMSS>` in a `backup/` directory
   beside it: `backup/` at the project root for `<env>.yaml`, `project/backup/` for
   `project/<env>.yaml`.
3. Apply every migration above that version, in order, then set `schema_version`.
4. Write the file back.

A file already at the current version is not touched. A file at a **higher** version
than the binary is loaded as is: that binary is older than whoever wrote the file, so
ask the user to upgrade meroku (`brew upgrade meroku`) rather than editing the number.

The file is written back from parsed data, so **comments are lost and keys come out
sorted** after a migration. That is expected, not damage. The backup keeps the original.

## Commands

| Command | Does |
|---|---|
| `meroku migrate` | prints the current schema version and usage; changes nothing |
| `meroku migrate <path>` | migrates one file, e.g. `dev.yaml` or `project/dev.yaml` |
| `meroku migrate all` | migrates every `*.yaml` in `project/`, or in the current directory when there is no `project/` |

All of them write YAML. Ask before running one.

## What migrations change

Most add a key with a value that keeps today's deployment unchanged. Some do more, and
these are the ones a user may notice in a diff:

| Version | Change |
|---|---|
| v6 | custom VPC fields; removes `az_count`, `create_private_subnets`, `enable_nat_gateway`; older projects keep `use_default_vpc: true` |
| v11 | `host_port` forced to match `container_port` |
| v12 | every postgres boolean written explicitly |
| v23 | `pubsub_appsync.auth_mode: lambda`; `api_key_enabled: true` where AppSync was on, so a live key is not deleted |
| v24 | renames the misspelt `cognito.dashboard_callback_ur_ls` to `dashboard_callback_urls`; the correct key wins when both exist |
| v25, v29 | `container_command` and `backend_container_command` turned from a string into a list |
| v30 | `services[].network_access: full_open` on every existing service; an absent key renders `public` |
| v31 | name-based policy written as flags: `auto_deploy` true only in `dev`, every non-dev target's auto-deploy turned off, `is_prod` for `prod` and `production`, prod's domain settings |

For the full table, read `infrastructure/ai_docs/MIGRATIONS.md` in the project, when present.

## The binary and infrastructure/ must agree

The binary migrates the YAML; `infrastructure/` renders it. `meroku generate` refuses
when `infrastructure/version.txt` is older than the binary, because older modules drop
newer settings without a word and the plan would show "no changes" for them. The fix is
`meroku update`, which replaces `infrastructure/` with the copy that matches the binary.
`MEROKU_ALLOW_INFRA_MISMATCH=1` overrides the check; it exists for bisecting, not for
fixing a deploy. A newer `infrastructure/` than the binary is only a warning.

## Restoring a backup

Restoring is a write: show the user the backup's name and the diff against the current
file, and wait for a yes. Copy it back over the env YAML. The next load migrates it
again, which is usually what was wanted; if a migration itself is the problem, that is
a meroku bug, not a YAML fix.

Some other meroku writes (GitHub OIDC changes, disabling a DNS domain) leave
`<file>.backup_<timestamp>` beside the file instead of in `backup/`. Look in both places.
