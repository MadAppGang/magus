---
description: Terraform, Pulumi, AWS CDK and CloudFormation compared, with the IaC skeletons `dev:devops` emits beside every CLI proposal. Read when the choice of IaC tool is open or the caller asked for an IaC alternative.
---

# Infrastructure as Code

Reference for `dev:devops`. Read when the IaC tool is not already fixed by the repo (`*.tf`, `Pulumi.yaml`, `cdk.json`, `template.yaml`) or when the proposal must carry an IaC alternative beside the CLI commands. `terraform validate` and `terraform plan` against a local state are the read-only checks the agent may run itself; `apply` is never run here.

## Comparison

| Feature | Terraform | Pulumi | AWS CDK | CloudFormation |
|---------|-----------|--------|---------|----------------|
| Language | HCL | TypeScript / Python / Go | TypeScript / Python | YAML / JSON |
| Multi-cloud | Yes | Yes | AWS only | AWS only |
| State management | Remote or local backend | Managed service or self-hosted | CloudFormation stacks | CloudFormation stacks |
| Learning curve | Medium | Low for application developers | Low for AWS developers | High |
| Best for | Multi-cloud estates | Teams that want typed config | AWS-only shops | AWS enterprises with existing templates |

Pick by these rules, in order:

1. The repo already carries one of them: use that one. Mixing tools splits the state.
2. More than one cloud, or a cloud that may change: Terraform.
3. AWS only and the team writes TypeScript: CDK.
4. AWS only and the organisation mandates native tooling: CloudFormation.
5. Otherwise Pulumi when the team prefers a general-purpose language over HCL.

## Skeletons to emit

Every proposal shows the CLI commands and at least one IaC equivalent; the caller decides which to apply.

Terraform:

```hcl
# {resource_description}
resource "{type}" "{name}" {
  # ...
}
```

AWS CDK (AWS targets only):

```typescript
// {resource_description}
new {Construct}(this, '{name}', {
  // ...
});
```

Pulumi:

```typescript
// {resource_description}
const {resource} = new {type}('{name}', {
  // ...
});
```

State each option's trade-off in one line after the block; never ask the caller which they want.
