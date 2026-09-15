---
description: az CLI reference for AKS, Container Apps, ACR and Azure Functions. Read when the target platform is Azure — `dev:devops` routes here by path.
---

# Azure

Reference for `dev:devops`. Read when the workload targets Azure. Every command is a proposal for the caller to run; the agent that reads this file generates, it does not apply. `az account show` is the read-only check the agent may run itself.

## az CLI

```bash
# Identity and subscription (read-only; safe to run)
az account show

# AKS
az aks create --resource-group {rg} --name {name} \
  --node-count 3 --generate-ssh-keys
az aks get-credentials --resource-group {rg} --name {name}

# Container Apps
az containerapp create --name {name} --resource-group {rg} \
  --environment {env} --image {image} --target-port 8080 \
  --ingress external --min-replicas 1 --max-replicas 10

# ACR
az acr create --resource-group {rg} --name {name} --sku Basic
az acr login --name {name}
docker push {name}.azurecr.io/{image}:{tag}

# Functions
az functionapp create --resource-group {rg} --name {name} \
  --storage-account {storage} --consumption-plan-location {region} \
  --runtime node --runtime-version 20 --functions-version 4
```

## Choosing a runtime

| Workload | Service | Why |
|---|---|---|
| HTTP service, scale to zero | Container Apps | Managed containers with built-in ingress and KEDA scaling |
| Many services, custom networking | AKS | Full Kubernetes; read `kubernetes.md` as well |
| Single event-driven function | Azure Functions | Consumption plan, pay per execution |

For an AKS target, the `kubectl`, `helm` and `kustomize` reference lives in `kubernetes.md`.

The resource groups, regions and names above are illustrative. If the prompt did not establish the target subscription, resource group and environment, the verdict is BLOCKED naming them; never substitute these placeholders.
