---
description: kubectl, helm and kustomize command reference plus a worked ingress-with-TLS example. Read when the target runs on Kubernetes (GKE, EKS, AKS, or self-managed) — `dev:devops` routes here by path.
---

# Kubernetes

Reference for `dev:devops`. Read when the workload deploys to a Kubernetes cluster. Every command is a proposal for the caller to run; the agent that reads this file generates, it does not apply.

## kubectl

```bash
# Cluster info
kubectl cluster-info
kubectl get nodes

# Deployments
kubectl apply -f deployment.yaml
kubectl rollout status deployment/{name}
kubectl rollout undo deployment/{name}

# Services
kubectl expose deployment {name} --port=80 --type=LoadBalancer
kubectl get svc

# Scaling
kubectl scale deployment {name} --replicas=3
kubectl autoscale deployment {name} --min=2 --max=10 --cpu-percent=80

# Debugging
kubectl logs {pod} -f
kubectl exec -it {pod} -- /bin/sh
kubectl describe pod {pod}

# Read-only validation (safe for the agent itself to run)
kubectl apply -f deployment.yaml --dry-run=client
kubectl kustomize ./overlays/staging
```

## helm

```bash
# Repository management
helm repo add {name} {url}
helm repo update

# Install / upgrade
helm install {release} {chart} -f values.yaml
helm upgrade {release} {chart} -f values.yaml
helm rollback {release} {revision}

# List / status
helm list
helm status {release}
helm history {release}
```

## kustomize

```bash
# Build and apply
kubectl apply -k ./overlays/production

# Preview without applying
kubectl kustomize ./overlays/staging
```

Overlay layout:

```
base/
  kustomization.yaml
  deployment.yaml
overlays/
  dev/
    kustomization.yaml
  staging/
    kustomization.yaml
  production/
    kustomization.yaml
```

## Worked example: ingress with TLS

Request: "Set up ingress with TLS for my Kubernetes cluster."

Research: search "kubernetes ingress nginx cert-manager" and "kubernetes TLS ingress best practices" for the current year. Expected pattern: ingress-nginx plus cert-manager issuing Let's Encrypt certificates.

CLI:

```bash
# 1. Install ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# 2. Install cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true

# 3. Create a ClusterIssuer for Let's Encrypt
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF

# 4. Create the Ingress with TLS
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - myapp.example.com
    secretName: myapp-tls
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app
            port:
              number: 80
EOF

# 5. Verify
kubectl get ingress
kubectl get certificate
```

IaC alternative (Terraform):

```hcl
resource "helm_release" "ingress_nginx" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  namespace        = "ingress-nginx"
  create_namespace = true
}

resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  namespace        = "cert-manager"
  create_namespace = true
  set {
    name  = "installCRDs"
    value = "true"
  }
}
```

The hostnames, namespaces and email above are illustrative. If the prompt did not establish the target cluster, project and environment, the verdict is BLOCKED naming them; never substitute these placeholders.
