# AWS and Terraform: the official plugins

The meroku skills teach meroku. For AWS and Terraform themselves they rely on two plugins in
Anthropic's official marketplace, `claude-plugins-official`. Source: its
`.claude-plugin/marketplace.json` in `anthropics/claude-plugins-official`, checked
2026-11-15. When this file and that marketplace disagree, the marketplace wins.

| Plugin | By | Use it for | Install |
|---|---|---|---|
| `aws-core` | Amazon Web Services | which read-only call answers a question about a resource; reading an AWS error; IAM, networking, containers, databases, messaging, observability; AWS sign-in. Its skills (start with `aws-core:aws-investigation`) and its `aws-mcp` MCP server | `claude plugin install aws-core@claude-plugins-official` |
| `terraform` | HashiCorp | a provider resource's arguments, a module's inputs, what an argument change does, through HashiCorp's Terraform MCP server and the Terraform registry | `claude plugin install terraform@claude-plugins-official` |

The marketplace comes with Claude Code. If an install says the marketplace is unknown:
`claude plugin marketplace add anthropics/claude-plugins-official`, then install again.

## Is it installed?

Look at what is already in your context. A name in your deferred tool list counts as
present, the same as a loaded tool.

- `aws-core`: your skill list carries `aws-core:` skills, or your tools (loaded or
  deferred) include names that start with `mcp__plugin_aws-core_`.
- `terraform`: your tools (loaded or deferred) include names that start with
  `mcp__plugin_terraform_`.

Still unsure: one ToolSearch for that prefix is the only check allowed. Never run a shell
command to find out.

## When one is missing

Say so once in the session, in one line with its install command, at the point you would
have used it. Then carry on with the `aws` CLI and the project's own files. Never install it
yourself, never ask a question about it, never wait for it. Installing changes the user's
Claude Code setup and takes effect only in a new session.

## THE RULES cover these tools too

- Every route to AWS is under the same read-only allowlist: the `aws` CLI, `aws-core`'s MCP
  tools, an SDK. A describe, list or get through `aws-mcp` is fine. Anything else through
  it is a write, and THE RULES forbid direct writes to AWS.
- Use the env's profile on every route (`aws_profile` from the env YAML, the profile the
  briefing names). If you cannot tell which credentials an MCP tool is using, use the CLI
  with `AWS_PROFILE=<profile>` instead.
- The `terraform` plugin is for reading the registry and provider docs. Never use it to
  start a run or to change a workspace or its variables: meroku keeps state in S3 and runs
  Terraform itself.
