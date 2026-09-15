---
description: Multi-environment strategy — dev, staging, production sizing, and which configuration mechanism (Kustomize overlays, Terraform workspaces, Pulumi stacks, CDK stages) fits which tool. Read when a proposal spans more than one environment.
---

# Environments

Reference for `dev:devops`. Read when the request names more than one environment, or when a single-environment proposal must say how it extends to the others.

## Environment strategy

```
dev/        - minimal resources, scheduled shutdown outside working hours
staging/    - production-like topology at a smaller scale
production/ - full scale, multi-AZ, backups, alerting
```

Staging mirrors production's topology, not its size: the same services, load balancer and networking, fewer and smaller instances. Dev is the only environment allowed to differ in topology.

## Configuration management

| Approach | Tool | Best for |
|----------|------|----------|
| Overlays | Kustomize | Kubernetes manifests |
| Workspaces | Terraform | Multi-environment IaC with one module set |
| Stacks | Pulumi | Typed per-environment config |
| Stages | CDK | AWS environments |

Match the mechanism to the tool the repo already uses; see `iac.md` when the tool is open.

## Environment variables pattern

```bash
# .env.dev
AWS_REGION=us-east-1
INSTANCE_TYPE=t3.micro
REPLICAS=1

# .env.prod
AWS_REGION=us-east-1
INSTANCE_TYPE=t3.large
REPLICAS=3
```

Secrets never live in these files; they come from the platform's secret manager and are referenced by name.

Each environment is a separate target identity (account, project, subscription, or Firebase project). A proposal that covers three environments needs three named targets; a missing one makes the verdict BLOCKED for that environment.
