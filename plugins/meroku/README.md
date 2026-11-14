# Meroku

Skills for Claude Code sessions in a meroku project. meroku turns one YAML file per
environment into Terraform and runs it against AWS. When an operation fails, its "Fix with
AI" menu entry writes a briefing to `.meroku/claude/` and starts Claude Code at the project
root. This plugin teaches that session how to find the cause, explain it with evidence, and
fix it in a way the next meroku run keeps. When a project needs AWS infrastructure meroku
does not create, it decides where that goes and writes it beside meroku's own.

Written against meroku 6.0.0 and env YAML schema v32. Where the skills disagree with the
project itself (the briefing, the project's `infrastructure/` copy, or the YAML's
`schema_version`), the project wins.

## Install

```
claude plugin install meroku@magus
```

Or `/plugin install meroku@magus` inside Claude Code. The plugin has no scripts, hooks or
settings, and needs nothing on the machine beyond what meroku itself needs.

## Skills

| Skill | Loads when | What it does |
|---|---|---|
| `meroku:troubleshoot` | meroku opened the session, or a `.meroku/claude/` briefing is named | Reads the briefing, investigates a failed apply, plan, destroy or AWS SSO setup read-only, names the cause, and proposes a fix in the right place |
| `meroku:yaml` | an env YAML (`dev.yaml`, `prod.yaml`, …) is being read or changed | Explains the schema, migrations and backups, and names any change that forces AWS to replace a resource before it is made |
| `meroku:meroku` | any work in a meroku project | Explains the pipeline from YAML to Terraform, the commands, the project layout and how resources are named |
| `meroku:extend` | an AWS resource is being added: a queue, a bucket, a Cognito pool, an SMS setting | Checks meroku's default first, then picks one of `custom/terraform/`, the `custom/pre/` hook or the `custom/post/` hook, and writes the Terraform with a `README.md`; a meroku pull request only when every project would want the change |

`troubleshoot` is the entry point for a failure and carries the rules below; `extend` is
the entry point for new infrastructure. The other two supply the depth both point at.

## The rules

They hold for the whole session, and the briefing states them too.

- **Investigate read-only.** Reading project files, `describe`/`list`/`get` AWS calls,
  `terraform state list|show` and `terraform plan` without `-out` are always fine. Anything
  else counts as a write.
- **No direct writes to AWS.** A change made in the console or the AWS CLI is not in the
  YAML or the Terraform state, so the next meroku run reverts it or fails on the drift.
- **Never edit `env/<env>/`.** meroku regenerates every file there from the YAML on each run.
- **Ask before any write.** Changing a file, changing AWS or Terraform state, or rerunning
  meroku waits for the user's yes.
- **Fix in the right place.** A meroku bug is fixed in the user's meroku checkout; an edge
  case no migration handles is worked through with the user, one agreed command at a time,
  with a written log; a configuration problem is fixed in the env YAML, then meroku is rerun.
- **Never a copy of a meroku module.** New infrastructure uses meroku's default when it has
  one, and otherwise sits beside meroku's resources in `custom/`, reading them rather than
  duplicating them.
- **Every custom folder has a `README.md`.** It says what the folder adds, why meroku's
  default cannot do it, why it is not a meroku pull request, and when it can be deleted.
