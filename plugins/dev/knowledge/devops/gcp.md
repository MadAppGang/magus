---
description: gcloud CLI reference for GKE, Cloud Run, Artifact Registry and Cloud Functions. Read when the target platform is Google Cloud — `dev:devops` routes here by path.
---

# Google Cloud

Reference for `dev:devops`. Read when the workload targets GCP. Every command is a proposal for the caller to run; the agent that reads this file generates, it does not apply. `gcloud config list` and `gcloud auth list` are read-only checks the agent may run itself.

## gcloud CLI

```bash
# Identity and project (read-only; safe to run)
gcloud auth list
gcloud config list

# GKE
gcloud container clusters create {name} \
  --zone {zone} --num-nodes 3 --machine-type e2-standard-2
gcloud container clusters get-credentials {name} --zone {zone}

# Cloud Run
gcloud run deploy {service} --image {image} \
  --platform managed --region {region} --allow-unauthenticated
gcloud run services update {service} --memory 512Mi --cpu 1

# Artifact Registry
gcloud artifacts repositories create {repo} \
  --repository-format=docker --location={region}
gcloud auth configure-docker {region}-docker.pkg.dev
docker push {region}-docker.pkg.dev/{project}/{repo}/{image}:{tag}

# Cloud Functions
gcloud functions deploy {name} \
  --runtime nodejs20 --trigger-http --allow-unauthenticated
```

## Choosing a runtime

| Workload | Service | Why |
|---|---|---|
| HTTP service, bursty traffic | Cloud Run | Scales to zero, container-based, no cluster to run |
| Many services, custom networking, stateful sets | GKE | Full Kubernetes; read `kubernetes.md` as well |
| Single event-driven function | Cloud Functions | Smallest unit; pay per invocation |

For a GKE target, the `kubectl`, `helm` and `kustomize` reference lives in `kubernetes.md`.

The zones, regions and names above are illustrative. If the prompt did not establish the target project, region and environment, the verdict is BLOCKED naming them; never substitute these placeholders.
