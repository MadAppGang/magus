# Meroku

A command, an agent and skills for Claude Code sessions in a meroku project. meroku turns
one YAML file per environment into Terraform and runs it against AWS. This plugin teaches
a Claude Code session to work in such a project: create and change env YAMLs, add AWS
infrastructure beside meroku's own, and fix a failed operation the way the next meroku run
keeps. When an operation fails, meroku's "Fix with AI" menu entry writes a briefing to
`.meroku/claude/` and starts Claude Code at the project root; the plugin works from that
briefing.

Written against meroku 6.1.0 and env YAML schema v32. Where the skills disagree with the
project itself (the briefing, the project's `infrastructure/` copy, or the YAML's
`schema_version`), the project wins.

## Install

```
claude plugin install meroku@magus
```

Or `/plugin install meroku@magus` inside Claude Code. The plugin has no scripts, hooks or
settings, and needs nothing on the machine beyond what meroku itself needs.

Recommended alongside it, from Anthropic's official marketplace. The meroku skills leave
generic AWS and Terraform to these two, and suggest them once when they are missing:

```
claude plugin install aws-core@claude-plugins-official
claude plugin install terraform@claude-plugins-official
```

- `aws-core` (Amazon Web Services): skills and an MCP server for reading AWS resources,
  explaining AWS errors, and AWS sign-in.
- `terraform` (HashiCorp): provider and module documentation from the Terraform registry,
  through HashiCorp's Terraform MCP server.

## Use

Type `/meroku:meroku` and what you want done. It explains how meroku works and loads the
skill the task needs:

```
/meroku:meroku create a staging environment
/meroku:meroku turn on valkey for api
/meroku:meroku add an SQS queue for the ai service
/meroku:meroku .meroku/claude/<file>.md
```

Fix with AI needs nothing typed: meroku starts the session, and the troubleshoot skill
loads by itself from the briefing.

## What is inside

| Kind | Name | Loaded by | What it does |
|---|---|---|---|
| command and skill | `meroku:meroku` | you (`/meroku:meroku`), the model, Fix with AI | Explains the pipeline from YAML to Terraform, the commands, the project layout and how resources are named, and routes the task to one of the three skills below |
| skill | `meroku:troubleshoot` | `/meroku:meroku`, the model, Fix with AI; not typed | Reads the briefing, investigates a failed apply, plan, destroy or AWS SSO setup read-only, names the cause, and proposes a fix in the right place |
| skill | `meroku:yaml` | `/meroku:meroku`, the model, Fix with AI; not typed | Creates and changes env YAMLs: the schema, migrations and backups, any change that forces AWS to replace a resource named before it is made, and vaults (secret names in the YAML, values set in the web UI's Vaults tab) |
| skill | `meroku:extend` | `/meroku:meroku`, the model; not typed | Checks meroku's default first, then picks one of `custom/terraform/`, the `custom/pre/` hook or the `custom/post/` hook, and writes the Terraform with a `README.md`; a meroku pull request only when every project would want the change |
| agent | `meroku` | another workflow, through the Agent tool | Preloads the four skills, investigates read-only and returns one proposal; writes only a change the user approved |

## The rules

They hold for the whole session, and the briefing states them too.

- **Investigate read-only.** Reading project files, `describe`/`list`/`get` AWS calls,
  `terraform state list|show` and `terraform plan` without `-out` are always fine. Anything
  else counts as a write. This covers every route to AWS, including MCP tools.
- **No direct writes to AWS.** A change made in the console, the AWS CLI or an MCP tool is
  not in the YAML or the Terraform state, so the next meroku run reverts it or fails on the
  drift.
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

## Upgrading from 1.x

`/meroku:yaml`, `/meroku:extend` and `/meroku:troubleshoot` are no longer typed commands.
Type `/meroku:meroku` and what you want instead; a briefing path after it works as it did
after `/meroku:troubleshoot`. The skills keep their names, so Fix with AI and anything that
loads them through the model work unchanged.
